/** Full-widget input regression. Run: node test/browser/price-axis-sync.mjs */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const port = 3469;
const url = `http://127.0.0.1:${port}/?datafeed=fake`;
const server = spawn(process.execPath, ["server/index.mjs"], {
  cwd: new URL("../../", import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let browser;
try {
  await Promise.race([
    new Promise((resolve, reject) => {
      server.stdout.on("data", chunk => { if (String(chunk).includes("Chart UI:")) resolve(); });
      server.once("error", reject);
      server.once("exit", code => reject(new Error(`Test server exited: ${code}`)));
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Test server startup timed out")), 10000).unref()),
  ]);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__BWC_WIDGET__?.getAllChartPanes().some(p => p.bars.length));
  await page.getByRole("button", { name: "Layout setup", exact: true }).click();
  await page.getByRole("button", { name: "2h", exact: true }).click();
  await page.waitForFunction(() => {
    const panes = window.__BWC_WIDGET__?.getAllChartPanes();
    return panes?.length === 2 && panes.every(p => p.bars.length && p.series.coordinateToPrice(0) != null);
  });
  await page.getByRole("button", { name: "Layout setup", exact: true }).click();
  await page.getByRole("switch", { name: "Date range", exact: true }).uncheck();
  await page.getByRole("switch", { name: "Price axis", exact: true }).check();
  await page.getByRole("button", { name: "Layout setup", exact: true }).click();

  const snapshot = () => page.evaluate(() => window.__BWC_WIDGET__.getAllChartPanes().map(pane => {
    const height = pane.chart.paneSize().height;
    const rect = pane.el.getBoundingClientRect();
    const span = Math.abs(pane.series.coordinateToPrice(0) - pane.series.coordinateToPrice(height));
    return { span, x: rect.right - 15, y: rect.top + height * 0.4 };
  }));
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const assertLinked = (before, after, label) => {
    const ratios = after.map((value, i) => value.span / before[i].span);
    assert.ok(Math.abs(ratios[0] - 1) > 0.001, `${label}: source must change`);
    assert.ok(Math.abs(ratios[0] - ratios[1]) < 1e-7, `${label}: peer must follow (${ratios})`);
  };

  for (const source of [0, 1]) {
    let before = await snapshot();
    await page.mouse.move(before[source].x, before[source].y);
    await page.mouse.wheel(0, -120);
    await settle();
    assertLinked(before, await snapshot(), `wheel from chart ${source + 1}`);

    before = await snapshot();
    await page.mouse.move(before[source].x, before[source].y);
    await page.mouse.down();
    await page.mouse.move(before[source].x, before[source].y + 40, { steps: 4 });
    await page.mouse.up();
    await settle();
    assertLinked(before, await snapshot(), `drag from chart ${source + 1}`);
  }

  await page.reload();
  await page.waitForFunction(() => window.__BWC_WIDGET__?.getAllChartPanes().length === 2 && window.__BWC_WIDGET__.getAllChartPanes().every(p => p.bars.length && p.series.coordinateToPrice(0) != null));
  await page.getByRole("button", { name: "Layout setup", exact: true }).click();
  assert.equal(await page.getByRole("switch", { name: "Price axis", exact: true }).getAttribute("checked"), "");
  if (process.env.BWC_SYNC_SCREENSHOT) {
    await page.getByRole("switch", { name: "Price axis", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.BWC_SYNC_SCREENSHOT, fullPage: false });
  }
  await page.getByRole("switch", { name: "Price axis", exact: true }).uncheck();
  await page.getByRole("button", { name: "Layout setup", exact: true }).click();
  const before = await snapshot();
  await page.mouse.move(before[0].x, before[0].y);
  await page.mouse.wheel(0, -120);
  await settle();
  const after = await snapshot();
  assert.ok(Math.abs(after[0].span - before[0].span) > 0.001);
  assert.ok(Math.abs(after[1].span - before[1].span) < 1e-7, "disabled sync must leave peer independent");
  assert.deepEqual(errors, [], "widget must not report runtime errors");
  console.log("Full-widget price axis: bidirectional wheel and drag, reload persistence, and disabled independence passed.");
} finally {
  await browser?.close();
  if (server.exitCode == null && server.signalCode == null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
}
