/** Isolated open-position pan regression. Run: node test/browser/position-pan.mjs */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const port = 3475;
const server = spawn(process.execPath, ["server/index.mjs"], {
  cwd: new URL("../../", import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let browser;
try {
  await Promise.race([
    new Promise((resolve, reject) => {
      server.stdout.on("data", chunk => { if (String(chunk).includes("Chart UI:")) resolve(); });
      server.once("error", reject);
      server.once("exit", code => reject(new Error(`Pan test server exited: ${code}`)));
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Pan test server timed out")), 10000).unref()),
  ]);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("tv-pane-symbols", JSON.stringify({ 0: "NQ", 1: "ES" }));
    localStorage.setItem("tv-chart-layout-state", JSON.stringify({ layoutId: "2h", sync: { dateRange: true, priceAxis: true } }));
  });
  await page.goto(`http://127.0.0.1:${port}/?datafeed=fake&resolution=30S`);
  await page.waitForFunction(() => {
    const panes = window.__BWC_WIDGET__?.getAllChartPanes();
    return panes?.length === 2 && panes.every(pane => pane.bars.length && pane.series.coordinateToPrice(0) != null);
  });

  const result = await page.evaluate(async () => {
    const widget = window.__BWC_WIDGET__;
    const overlay = widget.positionOverlay;
    const pane = widget.getAllChartPanes()[0];
    const entry = pane.bars.at(-1).close;
    // This is the isolated fake widget's display model; no host trade handler
    // or account/order connection exists in this browser context.
    await overlay.buy({ price: entry, qty: 2 });
    await overlay.setStopLoss(entry - 100);
    await overlay.setTakeProfit(entry + 100);
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    await nextFrame();
    await nextFrame();
    const before = overlay.getPosition();
    const activeLines = () => widget.orderLines._activeStates().map(state => ({ text: state.text, price: state.price }));
    const beforeLines = activeLines();
    const rect = pane.el.getBoundingClientRect();
    const root = pane.chart.chartElement();
    const origin = { x: rect.left + rect.width * 0.4, y: rect.top + 180 };
    const pointer = (type, x, y, buttons) => root.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons,
      clientX: x, clientY: y,
    }));
    const counters = {};
    window.__AUREN_POS_PERF__ = { count(key, n = 1) { counters[key] = (counters[key] ?? 0) + n; } };
    const nativeRaf = window.requestAnimationFrame.bind(window);
    let updatingMark = false;
    let markFramesDuringPan = 0;
    window.requestAnimationFrame = callback => {
      if (updatingMark) markFramesDuringPan++;
      return nativeRaf(callback);
    };
    const frameTimes = [];
    const panes = widget.getAllChartPanes();
    const referencePrices = panes.map(chartPane => chartPane.series.coordinateToPrice(180));
    const maxDisplacements = panes.map(() => 0);
    let previous = performance.now();
    let lastMark = entry;
    pointer("pointerdown", origin.x, origin.y, 1);
    for (let frame = 0; frame < 120; frame++) {
      const phase = frame / 120 * Math.PI * 2;
      pointer("pointermove", origin.x + Math.sin(phase) * 35, origin.y + Math.cos(phase) * 25 - 25, 1);
      for (let tick = 0; tick < 50; tick++) {
        lastMark = entry + ((frame * 50 + tick) % 80) * 0.25;
        updatingMark = true;
        try { overlay.setMarkPrice(lastMark); } finally { updatingMark = false; }
      }
      await nextFrame();
      panes.forEach((chartPane, index) => {
        maxDisplacements[index] = Math.max(maxDisplacements[index],
          Math.abs(chartPane.series.priceToCoordinate(referencePrices[index]) - 180));
      });
      const now = performance.now();
      frameTimes.push(now - previous);
      previous = now;
    }
    const panning = widget.isChartPanning();
    const duringLines = activeLines();
    const duringApplies = counters["bwc.overlay.pnlApply"] ?? 0;
    window.requestAnimationFrame = nativeRaf;
    pointer("pointerup", origin.x, origin.y, 0);
    await nextFrame();
    await nextFrame();
    await nextFrame();
    const afterLines = activeLines();
    const expectedPnl = (lastMark - entry) / 0.25 * 5 * 2;
    const sortedTimes = [...frameTimes].sort((a, b) => a - b);
    return {
      before, after: overlay.getPosition(), panning, panningAfter: widget.isChartPanning(),
      beforeLines, duringLines, afterLines, duringApplies, markFramesDuringPan,
      afterApplies: counters["bwc.overlay.pnlApply"] ?? 0,
      expectedPnl, lastMark, counters,
      frames: frameTimes.length,
      maxDisplacements,
      medianFrameMs: sortedTimes[Math.floor(sortedTimes.length * 0.5)],
      p95FrameMs: sortedTimes[Math.floor(sortedTimes.length * 0.95)],
    };
  });
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.panning, true);
  assert.equal(result.panningAfter, false);
  assert.ok(result.maxDisplacements.every(delta => delta > 20), "both charts must actually move during the held gesture");
  assert.equal(result.duringApplies, 0, "position display must not compete with held panning");
  assert.equal(result.markFramesDuringPan, 0, "quote notifications must not enqueue idle display frames during the drag");
  assert.deepEqual(result.duringLines, result.beforeLines, "pan must not modify position/bracket text or prices");
  assert.deepEqual(result.after, result.before, "panning must preserve entry, size, stop and target");
  assert.equal(result.afterApplies, 1, "release must paint the final pending mark once without another quote");
  assert.ok(result.afterLines.some(line => line.text.includes(result.expectedPnl.toFixed(2))), "final position label must use the latest mark");
  assert.deepEqual(errors, []);
  console.log("Open-position panning passed: 6,000 marks, two linked charts, no trading state change, latest mark painted once on release.");
} finally {
  await browser?.close();
  if (server.exitCode == null && server.signalCode == null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
}
