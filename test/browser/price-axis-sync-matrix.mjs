/**
 * Real-input regression for the NQ/ES 30-second layout used by Auren.
 * Run: node test/browser/price-axis-sync-matrix.mjs
 * Optional ratio-lock diagnostics: BWC_SYNC_INCLUDE_LOCK=1
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const port = Number(process.env.BWC_MATRIX_PORT || 3473);
const url = `http://127.0.0.1:${port}/?datafeed=fake&symbol=NQ&resolution=30S`;
const includeLock = process.env.BWC_SYNC_INCLUDE_LOCK === "1";
const cases = [];
// Test the reported configuration first. A fresh browser context prevents a
// previous test's saved viewports or account symbols from masking the result.
for (const lockPriceToBarRatio of includeLock ? [false, true] : [false]) {
  for (const dateRange of [true, false]) {
    for (const autoScale of [false, true]) cases.push({ dateRange, autoScale, lockPriceToBarRatio });
  }
}

const server = spawn(process.execPath, ["server/index.mjs"], {
  cwd: new URL("../../", import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
const serverErrors = [];
server.stderr.on("data", chunk => serverErrors.push(String(chunk)));
let browser;
const results = [];
try {
  await Promise.race([
    new Promise((resolve, reject) => {
      server.stdout.on("data", chunk => { if (String(chunk).includes("Chart UI:")) resolve(); });
      server.once("error", reject);
      server.once("exit", code => reject(new Error(`Matrix server exited: ${code}; ${serverErrors.join("")}`)));
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Matrix server startup timed out")), 10000).unref()),
  ]);
  browser = await chromium.launch({ headless: true });

  for (const config of cases) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.addInitScript(({ dateRange }) => {
      localStorage.setItem("tv-pane-symbols", JSON.stringify({ 0: "NQ", 1: "ES" }));
      localStorage.setItem("tv-chart-layout-state", JSON.stringify({
        layoutId: "2h",
        sync: { symbol: false, interval: false, crosshair: true, time: false, dateRange, priceAxis: true, drawings: false, indicators: false },
        autoSave: false,
      }));
    }, config);
    try {
      await page.goto(url);
      await page.waitForFunction(() => {
        const panes = window.__BWC_WIDGET__?.getAllChartPanes();
        return panes?.length === 2 && panes.every(pane => pane.bars.length && pane.series.coordinateToPrice(0) != null);
      });
      const settle = async () => {
        await page.evaluate(() => new Promise(resolve => {
          let frames = 6;
          const next = () => --frames > 0 ? requestAnimationFrame(next) : resolve();
          requestAnimationFrame(next);
        }));
        await page.waitForTimeout(200);
      };
      const snapshot = () => page.evaluate(() => {
        const widget = window.__BWC_WIDGET__;
        return {
          scales: { ...widget.settings.get().scales },
          sync: JSON.parse(localStorage.getItem("tv-chart-layout-state")).sync,
          panes: widget.getAllChartPanes().map(pane => {
            const height = pane.chart.paneSize().height;
            const rect = pane.el.getBoundingClientRect();
            const scale = pane.series.priceScale();
            return {
              index: pane.index, symbol: pane.symbol, resolution: pane.resolution,
              span: Math.abs(pane.series.coordinateToPrice(0) - pane.series.coordinateToPrice(height)),
              middle: pane.series.coordinateToPrice(height / 2),
              barSpacing: pane.chart.timeScale().options().barSpacing,
              scaleOptions: scale.options(),
              rootWidth: pane.chart.chartElement().getBoundingClientRect().width,
              containerWidth: rect.width,
              axisWidth: pane.chart.priceScale("right").width(),
              x: rect.right - 15, y: rect.top + height * 0.4,
            };
          }),
        };
      });
      await page.evaluate(() => {
        window.__axisSyncMatrixEvents = [];
        for (const pane of window.__BWC_WIDGET__.getAllChartPanes()) {
          pane.el.addEventListener("prochart-price-axis-scale", event => {
            window.__axisSyncMatrixEvents.push({ source: pane.index, ...event.detail });
          });
        }
      });

      for (const source of [0, 1]) {
        try {
          await page.evaluate(({ autoScale, lockPriceToBarRatio }) => {
            const widget = window.__BWC_WIDGET__;
            const pane = widget.getAllChartPanes()[0];
            const height = pane.chart.paneSize().height;
            const spacing = pane.chart.timeScale().options().barSpacing;
            const target = Math.abs(pane.series.coordinateToPrice(height / 2 - spacing / 2)
              - pane.series.coordinateToPrice(height / 2 + spacing / 2));
            widget.settings.merge({ scales: {
              autoScale, lockPriceToBarRatio,
              lockPriceToBarRatioValue: target, lockPriceToBarRatioVersion: 2,
            } });
            window.__axisSyncMatrixEvents.length = 0;
          }, config);
          await settle();
          const before = await snapshot();
          assert.deepEqual(before.panes.map(pane => pane.symbol), ["NQ", "ES"]);
          assert.deepEqual(before.panes.map(pane => pane.resolution), ["30S", "30S"]);
          assert.equal(before.sync.priceAxis, true);
          assert.equal(before.sync.dateRange, config.dateRange);
          assert.equal(before.scales.lockPriceToBarRatio, config.lockPriceToBarRatio);
          await page.mouse.move(before.panes[source].x, before.panes[source].y);
          await page.mouse.wheel(0, -120);
          await settle();
          const after = await snapshot();
          const events = await page.evaluate(() => window.__axisSyncMatrixEvents);
          const ratios = after.panes.map((pane, index) => pane.span / before.panes[index].span);
          const sourceChanged = Math.abs(ratios[source] - 1) > 0.0005;
          const linked = Math.abs(ratios[0] - ratios[1]) < 1e-7;
          const passed = sourceChanged && linked && events.length === 1 && events[0].source === source && !pageErrors.length;
          const result = { config, source, passed, ratios, events, before, after, errors: [...pageErrors] };
          results.push(result);
          console.log(JSON.stringify({ config, source, passed, ratios, events, errors: pageErrors }));
        } catch (error) {
          results.push({ config, source, passed: false, exception: error.stack || String(error), errors: [...pageErrors] });
          console.error(JSON.stringify(results.at(-1)));
        }
      }
    } catch (error) {
      results.push({ config, passed: false, exception: error.stack || String(error), errors: [...pageErrors] });
      console.error(JSON.stringify(results.at(-1)));
    } finally {
      await context.close();
    }
  }
  const failed = results.filter(result => !result.passed);
  if (failed.length) console.error("Failed matrix snapshots:", JSON.stringify(failed, null, 2));
  assert.equal(failed.length, 0, `${failed.length} of ${results.length} price-axis wheel cases failed`);
  console.log(`Price-axis wheel matrix passed: ${results.length} source/configuration cases, NQ/ES, 30S, six frames plus 200 ms after each wheel.`);
} finally {
  await browser?.close();
  if (server.exitCode == null && server.signalCode == null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
}
