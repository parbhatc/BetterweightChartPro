import test from "node:test";
import assert from "node:assert/strict";
import { createBarLoader } from "../public/js/app/bar/loader.js";
import { clearResolutionCache } from "../public/js/app/bar/resolutionCache.js";

globalThis.requestAnimationFrame ??= (callback) => setImmediate(() => callback(Date.now()));
globalThis.cancelAnimationFrame ??= clearImmediate;

function fixture({ initial = 350, want = 3600, responseLimit = Infinity, getBars, replay = false, subscribeBars, barSec = 30, resolution = "30S" } = {}) {
  const requests = [];
  const restored = [];
  let range = { from: 200, to: 245 };
  const pane = {
    index: 0, symbol: "NQ", resolution, symbolInfo: { ticker: "NQ" },
    bars: Array.from({ length: initial }, (_, index) => ({ time: 1_000_000 + index * barSec, open: 1, high: 2, low: 0, close: 1 })),
    chart: { timeScale: () => ({ getVisibleLogicalRange: () => range, setVisibleLogicalRange(value) { range = value; restored.push(value); } }) },
  };
  const panes = [pane];
  const loader = createBarLoader({
    datafeed: {
      resolveSymbol: async (symbol) => ({ ticker: symbol }),
      subscribeBars,
      unsubscribeBars() {},
      async getBars(info, resolution, params) {
        requests.push({ symbol: info.ticker, resolution, ...params });
        if (getBars) return getBars(info, resolution, params, requests.length);
        const count = Math.min(responseLimit, params.countBack);
        return { bars: Array.from({ length: count }, (_, index) => ({ time: params.to - (count - index - 1) * 30, open: 1, high: 2, low: 0, close: 1 })) };
      },
    },
    getAllChartPanes: () => panes,
    getBarSecForPane: () => barSec,
    getRequiredChartBarsForPane: () => want,
    isReplayLocked: () => replay,
    refreshPaneCandleData() {},
    setPrimaryBars() {},
    getActivePaneIndex: () => 0,
    setBarsLoading() {}, refreshStatusLine() {}, setHoverState() {},
  });
  return { loader, pane, panes, requests, restored };
}

function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

test("indicator backfill uses seven bounded pages instead of 26 viewport pages", async () => {
  const { loader, pane, requests, restored } = fixture();
  await loader.ensureIndicatorChartHistory(pane);
  assert.equal(pane.bars.length, 3600);
  assert.deepEqual(requests.map(({ countBack }) => countBack), [500, 500, 500, 500, 500, 500, 250]);
  assert.equal(requests.every(({ firstDataRequest }) => firstDataRequest === false), true);
  assert.equal(restored.at(-1).from, 3450, "visible candles stay fixed after the total 3250-bar prepend");
});

test("ordinary scrollback retains viewport-sized pages capped at 200", async () => {
  const { loader, pane, requests } = fixture();
  await loader.prependHistory(pane);
  assert.equal(requests[0].countBack, 125);
});

test("indicator history callers share and upgrade one pane backfill promise", async () => {
  const waiting = gate();
  const { loader, pane, requests } = fixture({ initial: 350, want: 500, async getBars(_info, _resolution, params) {
    await waiting.promise;
    return { bars: Array.from({ length: params.countBack }, (_, index) => ({ time: params.to - (params.countBack - index - 1) * 30 })) };
  } });
  const first = loader.ensureIndicatorChartHistory(pane);
  const second = loader.ensureIndicatorChartHistory(pane, { countBack: 1200 });
  assert.equal(first, second);
  waiting.release();
  await Promise.all([first, second]);
  assert.equal(pane.bars.length, 1200);
  assert.deepEqual(requests.map(({ countBack }) => countBack), [150, 500, 200]);
});

test("indicator warmup joins an existing edge request and then finishes its remaining depth", async () => {
  const waiting = gate();
  const { loader, pane, requests } = fixture({ want: 1000, async getBars(_info, _resolution, params, count) {
    if (count === 1) await waiting.promise;
    return { bars: Array.from({ length: params.countBack }, (_, index) => ({ time: params.to - (params.countBack - index - 1) * 30 })) };
  } });
  const edge = loader.prependHistory(pane);
  await Promise.resolve();
  const warmup = loader.ensureIndicatorChartHistory(pane);
  waiting.release();
  await Promise.all([edge, warmup]);
  assert.equal(pane.bars.length, 1000);
  assert.deepEqual(requests.map(({ countBack }) => countBack), [125, 500, 25]);
});

test("short provider pages complete the requested depth beyond the former 16-page cutoff", async () => {
  const { loader, pane, requests } = fixture({ responseLimit: 125 });
  await loader.ensureIndicatorChartHistory(pane);
  assert.equal(pane.bars.length, 3600);
  assert.equal(requests.length, 26);
});

test("one canceled caller does not cancel another caller sharing its history task", async () => {
  const waiting = gate();
  let firstActive = true;
  const { loader, pane } = fixture({ want: 1000, async getBars(_info, _resolution, params) {
    await waiting.promise;
    return { bars: Array.from({ length: params.countBack }, (_, index) => ({ time: params.to - (params.countBack - index - 1) * 30 })) };
  } });
  const first = loader.ensureIndicatorChartHistory(pane, { shouldContinue: () => firstActive });
  const second = loader.ensureIndicatorChartHistory(pane);
  firstActive = false;
  waiting.release();
  await Promise.all([first, second]);
  assert.equal(pane.bars.length, 1000);
});

test("a timeframe change starts a separate task and drops the stale response", async () => {
  const waiting = gate();
  const { loader, pane, requests } = fixture({ want: 1000, async getBars(_info, _resolution, params, count) {
    if (count === 1) await waiting.promise;
    return { bars: Array.from({ length: params.countBack }, (_, index) => ({ time: params.to - (params.countBack - index - 1) * 30 })) };
  } });
  const oldTask = loader.ensureIndicatorChartHistory(pane);
  await Promise.resolve();
  pane.resolution = "1";
  pane.bars = [{ time: 2_000_000 }];
  pane._barSeriesIdentity = { symbol: pane.symbol, resolution: pane.resolution };
  const currentTask = loader.ensureIndicatorChartHistory(pane);
  assert.notEqual(currentTask, oldTask);
  await currentTask;
  const currentBars = pane.bars.slice();
  waiting.release();
  await oldTask;
  assert.deepEqual(pane.bars, currentBars);
  assert.equal(pane.bars.length, 1000);
  assert.equal(requests.filter(({ resolution }) => resolution === "30S").length, 1);
});

test("returning to a warm replay timeframe preserves every backfilled candle without more requests", async (t) => {
  t.after(clearResolutionCache);
  const { loader, pane, requests } = fixture({ replay: true });
  await loader.ensureIndicatorChartHistory(pane);
  const warmBars = pane.bars.slice();
  loader.stashPaneResolutionCache(pane, pane.resolution);
  pane.resolution = "5";
  await loader.loadPaneBars(pane, { force: true });
  loader.stashPaneResolutionCache(pane, pane.resolution);
  pane.resolution = "30S";
  const beforeReturn = requests.length;
  await loader.loadPaneBars(pane, { force: true });
  await loader.ensureIndicatorChartHistory(pane);
  assert.deepEqual(pane.bars, warmBars);
  assert.equal(requests.length, beforeReturn);
});

test("returning to a partial snapshot fills its shortfall once and saves the completed history", async (t) => {
  t.after(clearResolutionCache);
  const { loader, pane, requests } = fixture({ want: 1800, replay: true });
  loader.stashPaneResolutionCache(pane, pane.resolution);
  pane.resolution = "5";
  await loader.loadPaneBars(pane, { force: true });
  loader.stashPaneResolutionCache(pane, pane.resolution);
  pane.resolution = "30S";
  await loader.loadPaneBars(pane, { force: true });
  await loader.ensureIndicatorChartHistory(pane);
  assert.equal(pane.bars.length, 1800);
  const complete = requests.length;
  loader.stashPaneResolutionCache(pane, pane.resolution);
  pane.resolution = "5";
  await loader.loadPaneBars(pane, { force: true });
  loader.stashPaneResolutionCache(pane, pane.resolution);
  pane.resolution = "30S";
  await loader.loadPaneBars(pane, { force: true });
  await loader.ensureIndicatorChartHistory(pane);
  assert.equal(pane.bars.length, 1800);
  assert.equal(requests.length, complete, "the same older pages are not downloaded on later returns");
});

test("new timeframe warmup cannot read old timeframe bars or overwrite its warm snapshot", async (t) => {
  t.after(clearResolutionCache);
  const { loader, pane, requests } = fixture({ initial: 1800, want: 1800, replay: true });
  await loader.ensureIndicatorChartHistory(pane);
  const original = pane.bars.slice();
  loader.stashPaneResolutionCache(pane, pane.resolution);
  pane.resolution = "5";
  await loader.loadPaneBars(pane, { force: true });
  loader.stashPaneResolutionCache(pane, pane.resolution);
  pane.resolution = "30S";
  const before = requests.length;
  // Data/visible-range callbacks can run after the picker changes resolution
  // but before loadPaneBars restores the returning timeframe's own candles.
  await loader.ensureIndicatorChartHistory(pane);
  assert.equal(await loader.prependHistory(pane), false);
  assert.equal(requests.length, before);
  await loader.loadPaneBars(pane, { force: true });
  assert.deepEqual(pane.bars, original);
  assert.equal(requests.length, before);
});

test("live cache restore repairs missed buckets and finalizes the former forming candle", async (t) => {
  t.after(clearResolutionCache);
  const tail = Math.floor(Date.now() / 30_000) * 30 - 30;
  const { loader, pane, requests } = fixture({ want: 0, async getBars(_info, _resolution, params) {
    return { bars: Array.from({ length: Math.floor((params.to - params.from) / 30) + 1 }, (_, index) => ({ time: params.from + index * 30, close: 9 + index })) };
  } });
  pane.bars = [tail - 60, tail - 30, tail].map((time) => ({ time, close: 1 }));
  await loader.ensureIndicatorChartHistory(pane);
  loader.stashPaneResolutionCache(pane, pane.resolution);
  await loader.loadPaneBars(pane, { force: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].refresh, true);
  assert.equal(requests[0].requestReason, "chart.resume");
  assert.ok(requests[0].countBack <= 64);
  assert.ok(requests[0].from <= tail - 30);
  assert.equal(pane.bars[0].time, tail - 60);
  assert.equal(pane.bars.find((bar) => bar.time === tail).close, 10);
  assert.equal(pane.bars.at(-1).time, requests[0].to);
  assert.ok(pane.bars.every((bar, index) => index === 0 || bar.time - pane.bars[index - 1].time === 30));
});

test("tail repair preserves newer host live values received while its response is pending", async (t) => {
  t.after(clearResolutionCache);
  const tail = Math.floor(Date.now() / 30_000) * 30;
  const { loader, pane } = fixture({ want: 0, async getBars() {
    pane.bars[pane.bars.length - 1] = { time: tail, close: 99 };
    return { bars: [{ time: tail, close: 9 }] };
  } });
  pane.bars = [{ time: tail - 30, close: 1 }, { time: tail, close: 1 }];
  await loader.ensureIndicatorChartHistory(pane);
  loader.stashPaneResolutionCache(pane, pane.resolution);
  await loader.loadPaneBars(pane, { force: true });
  assert.equal(pane.bars.at(-1).close, 99);
});

test("tail repair uses declared market delay rather than fetching wall-clock gaps", async (t) => {
  t.after(clearResolutionCache);
  const tail = Math.floor((Date.now() / 1000 - 900) / 30) * 30 - 30;
  const { loader, pane, requests } = fixture({ want: 0, getBars: async () => ({ bars: [] }) });
  pane.symbolInfo = { ticker: "NQ", data_status: "delayed", delay_minutes: 15 };
  pane.bars = [{ time: tail - 30 }, { time: tail }];
  await loader.ensureIndicatorChartHistory(pane);
  loader.stashPaneResolutionCache(pane, pane.resolution);
  await loader.loadPaneBars(pane, { force: true });
  assert.ok(requests[0].countBack <= 4);
  assert.ok(requests[0].to <= Date.now() / 1000 - 900);
});

test("a canceled cache-tail repair cannot clear or replace the newly selected timeframe", async (t) => {
  t.after(clearResolutionCache);
  const waiting = gate();
  const tail = Math.floor(Date.now() / 30_000) * 30;
  const { loader, pane, requests } = fixture({ want: 0, async getBars() {
    await waiting.promise;
    return { bars: [{ time: tail, close: 9 }] };
  } });
  pane.bars = [{ time: tail - 30 }, { time: tail }];
  await loader.ensureIndicatorChartHistory(pane);
  loader.stashPaneResolutionCache(pane, pane.resolution);
  const restore = loader.loadPaneBars(pane, { force: true });
  await new Promise(setImmediate);
  assert.equal(requests.length, 1);
  pane.resolution = "5";
  pane.bars = [{ time: tail, close: 77 }];
  pane._barSeriesIdentity = { symbol: pane.symbol, resolution: pane.resolution };
  waiting.release();
  await restore;
  assert.deepEqual(pane.bars, [{ time: tail, close: 77 }]);
});

test("late bars from an old live subscription cannot enter the replacement timeframe", async () => {
  const callbacks = [];
  const { loader, pane } = fixture({ want: 0, subscribeBars(_info, _resolution, callback) { callbacks.push(callback); } });
  await loader.loadPaneBars(pane, { force: true });
  pane.resolution = "5";
  await loader.loadPaneBars(pane, { force: true });
  const current = pane.bars.slice();
  callbacks[0]({ time: pane.bars.at(-1).time + 30, open: 1, high: 2, low: 0, close: 9 });
  assert.deepEqual(pane.bars, current);
});

test("returning after ten minutes restores all scrollback and pages the complete 1S gap", async (t) => {
  t.after(clearResolutionCache);
  let now = 1_800_000_000_000;
  t.mock.method(Date, "now", () => now);
  const tail = now / 1000;
  const { loader, pane, requests } = fixture({ want: 0, barSec: 1, resolution: "1S", async getBars(_info, _resolution, params) {
    return { bars: Array.from({ length: params.countBack }, (_, index) => ({ time: params.from + index, close: 9 })) };
  } });
  pane.bars = Array.from({ length: 3600 }, (_, index) => ({ time: tail - 3599 + index, close: 1 }));
  const oldest = pane.bars[0];
  const oldConfirmed = pane.bars.at(-3);
  loader.stashPaneResolutionCache(pane, pane.resolution);
  pane.resolution = "5";
  pane.bars = [{ time: tail, close: 55 }];
  pane._barSeriesIdentity = { symbol: pane.symbol, resolution: pane.resolution };
  now += 10 * 60_000;
  pane.resolution = "1S";
  await loader.loadPaneBars(pane, { force: true });
  assert.deepEqual(requests.map(({ countBack }) => countBack), [500, 102]);
  assert.ok(requests.every(({ refresh, firstDataRequest, requestReason }) => refresh && !firstDataRequest && requestReason === "chart.resume"));
  assert.equal(pane.bars.length, 4200);
  assert.equal(pane.bars[0], oldest);
  assert.equal(pane.bars.find((bar) => bar.time === oldConfirmed.time), oldConfirmed);
  assert.equal(pane.bars.find((bar) => bar.time === tail).close, 9);
  assert.equal(pane.bars.at(-1).time, now / 1000);
  assert.ok(pane.bars.every((bar, index) => index === 0 || bar.time - pane.bars[index - 1].time === 1));
});

test("a failed warm gap page retries its original checkpoint after newer live candles arrive", async (t) => {
  t.after(clearResolutionCache);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 1_800_000_000_000;
  t.mock.method(Date, "now", () => now);
  const tail = now / 1000;
  const { loader, pane, requests } = fixture({ want: 0, barSec: 1, resolution: "1S", async getBars(_info, _resolution, params, count) {
    if (count === 2) throw new Error("Temporary history failure");
    return { bars: Array.from({ length: params.countBack }, (_, index) => ({ time: params.from + index, close: 9 })) };
  } });
  pane.bars = Array.from({ length: 3600 }, (_, index) => ({ time: tail - 3599 + index, close: 1 }));
  const original = pane.bars.slice();
  loader.stashPaneResolutionCache(pane, pane.resolution);
  now += 10 * 60_000;
  await loader.loadPaneBars(pane, { force: true });
  assert.deepEqual(pane.bars, original, "a failed page never publishes a partial repaired gap");
  const newest = { time: now / 1000, close: 99 };
  pane.bars.push(newest);
  t.mock.timers.tick(1000);
  await new Promise(setImmediate);
  assert.deepEqual(requests.map(({ countBack }) => countBack), [500, 102, 500, 102]);
  assert.equal(pane.bars.length, 4200);
  assert.equal(pane.bars[0], original[0]);
  assert.equal(pane.bars.at(-1), newest);
  assert.ok(pane.bars.every((bar, index) => index === 0 || bar.time - pane.bars[index - 1].time === 1));
});
