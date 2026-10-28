import test from "node:test";
import assert from "node:assert/strict";
import { startIndicatorReload } from "../public/js/app/boot/chart/indicatorReload.js";
import { createIndicatorDataLoader } from "../public/js/app/boot/chart/indicatorDataLoader.js";
import { registerIndicatorDefinition } from "../public/js/indicators/catalog.js";
import { bumpDataEpoch, clearAllHtfBars } from "../public/js/app/bar/htfBarCache.js";
import { getNewsSettingsStore } from "../public/js/news/settings.js";

test("both panes start current-window indicators without waiting for primary backfill", async () => {
  const panes = [0, 1].map((index) => ({ index, symbol: "NQ", resolution: "1", bars: [{ time: 60 }] }));
  const overlays = [];
  const histories = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const task = startIndicatorReload({
    ensureIndicatorDataThenOverlay: async (pane) => { overlays.push(pane.index); },
    ensureIndicatorChartHistory: async (pane) => { histories.push(pane.index); await gate; },
  }, panes);
  assert.deepEqual(overlays, [0, 1]);
  assert.deepEqual(histories, [0, 1]);
  release();
  await task;
  assert.deepEqual(overlays, [0, 1], "unchanged history needs no duplicate study passes");
  assert.ok(panes.every((pane) => !pane._indicatorHistoryBulkLoad));
});

test("deeper primary history causes exactly one expanded indicator pass", async () => {
  const pane = { index: 0, symbol: "NQ", resolution: "1", bars: [{ time: 60 }] };
  const loadedCounts = [];
  await startIndicatorReload({
    ensureIndicatorDataThenOverlay: async (target) => { loadedCounts.push(target.bars.length); },
    ensureIndicatorChartHistory: async (target) => { target.bars = [{ time: 0 }, ...target.bars]; },
  }, [pane]);
  assert.deepEqual(loadedCounts, [1, 2]);
});

test("a failed pane keeps other pane backfill guards until its work completes", async () => {
  const panes = [0, 1].map((index) => ({ index, symbol: "NQ", resolution: "1", bars: [] }));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const task = startIndicatorReload({
    ensureIndicatorDataThenOverlay: async () => {},
    ensureIndicatorChartHistory: async (pane) => { if (pane.index === 0) throw new Error("unavailable"); await gate; },
  }, panes);
  await Promise.resolve();
  assert.equal(panes[1]._indicatorHistoryBulkLoad, true);
  release();
  await assert.rejects(task, /unavailable/);
  assert.ok(panes.every((pane) => !pane._indicatorHistoryBulkLoad));
});

function loaderFixture({ compare = false } = {}) {
  getNewsSettingsStore().setEnabled(false);
  bumpDataEpoch("indicator-scheduler-test");
  clearAllHtfBars();
  const definition = registerIndicatorDefinition({
    id: "scheduler-test-htf", title: "Scheduler test", overlay: true,
    collectDataNeeds: (_instance, pane) => compare === "security"
      ? { htf: [{ symbol: "ES", resolution: "1", countBack: 320 }] }
      : compare
        ? { compare: [{ symbol: "ES", chartCountBack: 320 }] }
        : { htf: [{ symbol: pane.symbol, resolution: "15", countBack: 50 }] },
  });
  const instances = [definition.createInstance(0), definition.createInstance(1)];
  const pane = { index: 0, symbol: "NQ", resolution: "1", bars: [{ time: 18_000_000, open: 1, high: 2, low: 0, close: 1 }], symbolInfo: { ticker: "NQ" } };
  const panes = [pane, { ...pane, index: 1 }];
  if (compare) panes[1].symbol = "ES";
  const refreshed = [];
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const peerBackfills = [];
  const loader = createIndicatorDataLoader({
    ctx: {
      resolutions: [], opts: {}, settingsStore: { get: () => ({ symbol: { timezone: "Etc/UTC" } }) }, getAllChartPanes: () => panes,
      ensureIndicatorChartHistory: async (target, options) => {
        if (!compare || target.index !== 1) return;
        peerBackfills.push(options.countBack);
        await gate;
        target.bars = Array.from({ length: options.countBack }, (_, index) => ({ time: 18_000_000 - (options.countBack - index - 1) * 60, open: 1, high: 2, low: 0, close: 1 }));
      },
      datafeed: { async resolveSymbol(ticker) { return { ticker }; }, async getBars(_info, _resolution, params) { calls++; await gate; return { bars: Array.from({ length: params.countBack }, (_, index) => ({ time: params.to - (params.countBack - index - 1) * 900, open: 1, high: 2, low: 0, close: 1 })) }; } },
    },
    controller: { indicatorsForPane: (index) => [instances[index]], invalidateOverlayCacheForPane() {}, refreshOverlaysSilent() {} },
    requestOverlayRefresh: (index) => refreshed.push(index),
  });
  return { loader, pane, panes, refreshed, release, peerBackfills, calls: () => calls };
}

test("a shared scheduled HTF fetch refreshes every dependent pane", async () => {
  const { loader, panes, refreshed, release, calls } = loaderFixture();
  loader.scheduleHtfBarsFetch(panes[0], "NQ", "15", 50);
  loader.scheduleHtfBarsFetch(panes[1], "NQ", "15", 50);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls(), 1);
  assert.deepEqual(refreshed.sort(), [0, 1]);
});

test("joining an active pane load waits for history instead of painting an empty overlay", async () => {
  const { loader, pane, refreshed, release, calls } = loaderFixture();
  const first = loader.ensurePaneDataThenOverlay(pane);
  const second = loader.ensurePaneDataThenOverlay(pane);
  await Promise.resolve();
  assert.equal(refreshed.length, 0);
  release();
  await Promise.all([first, second]);
  assert.equal(calls(), 1);
  assert.equal(refreshed.length, 1, "callers of the same load share its final overlay pass");
});

test("a superseded pane load cannot refresh the newly selected timeframe", async () => {
  const { loader, pane, refreshed, release } = loaderFixture();
  const task = loader.ensurePaneDataThenOverlay(pane);
  await Promise.resolve();
  bumpDataEpoch("timeframe-change");
  pane.resolution = "5";
  release();
  await task;
  assert.deepEqual(refreshed, []);
});

test("compare indicators join visible peer history instead of fetching duplicate security pages", async () => {
  const { loader, pane, release, peerBackfills, calls, refreshed } = loaderFixture({ compare: true });
  const task = loader.ensurePaneDataThenOverlay(pane);
  await Promise.resolve();
  assert.deepEqual(peerBackfills, [320]);
  release();
  await task;
  assert.equal(calls(), 0, "the visible ES pane supplies all 320 compare bars");
  assert.ok(refreshed.includes(0));
});

test("scheduled compare reads also reuse a visible peer's history", async () => {
  const { loader, pane, release, peerBackfills, calls, refreshed } = loaderFixture({ compare: true });
  loader.scheduleCompareBarsFetch(pane, "ES", "1", 320);
  await Promise.resolve();
  assert.deepEqual(peerBackfills, [320]);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls(), 0);
  assert.ok(refreshed.includes(0));
});

test("direct security dependencies at the chart interval join visible peer history", async () => {
  const { loader, pane, release, peerBackfills, calls } = loaderFixture({ compare: "security" });
  const task = loader.ensurePaneDataThenOverlay(pane);
  await Promise.resolve();
  assert.deepEqual(peerBackfills, [320]);
  release();
  await task;
  assert.equal(calls(), 0, "direct HTF/security loading borrows the visible ES pane too");
});

test("scheduled security reads at the chart interval join visible peer history", async () => {
  const { loader, pane, release, peerBackfills, calls } = loaderFixture({ compare: "security" });
  loader.scheduleHtfBarsFetch(pane, "ES", "1", 320);
  await Promise.resolve();
  assert.deepEqual(peerBackfills, [320]);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls(), 0);
});

test("indicator warmup and scheduled reads wait for replacement timeframe candles", async () => {
  const { loader, pane, release, calls, refreshed } = loaderFixture();
  pane._barSeriesIdentity = { symbol: pane.symbol, resolution: "5" };
  const task = loader.ensurePaneDataThenOverlay(pane);
  loader.scheduleHtfBarsFetch(pane, "NQ", "15", 50);
  loader.scheduleCompareBarsFetch(pane, "ES", "1", 320);
  release();
  await task;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls(), 0);
  assert.deepEqual(refreshed, []);
});

test("a replacement candle generation prevents the previous indicator load from painting", async () => {
  const { loader, pane, release, refreshed } = loaderFixture();
  const task = loader.ensurePaneDataThenOverlay(pane);
  await Promise.resolve();
  pane._historyGeneration = (pane._historyGeneration ?? 0) + 1;
  release();
  await task;
  assert.deepEqual(refreshed, []);
});
