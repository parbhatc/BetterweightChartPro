import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createBarLoader } from "../public/js/app/bar/loader.js";
import { clearResolutionCache } from "../public/js/app/bar/resolutionCache.js";
import { refreshPaneCandleData } from "../public/js/chart/pane/data.js";
import { TimeScaleModel } from "../public/vendor/prochart/scale/timeScaleModel.mjs";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "prochart") return { url: new URL("../public/vendor/prochart/index.mjs", import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
const { captureViewportBarLayout } = await import("../public/js/chart/pane/viewportBarLayout.js");
const { paintPaneAfterTimeframeLoad } = await import("../public/js/app/boot/chart/timeframeSwitch.js");

function fixture(t) {
  const frames = [];
  globalThis.requestAnimationFrame ??= (callback) => setImmediate(callback);
  t.mock.method(globalThis, "requestAnimationFrame", (callback) => { frames.push(callback); return frames.length; });
  const now = 1_800_000_000_000;
  t.mock.method(Date, "now", () => now);
  let width = 360;
  let painted = 0;
  let onRequest = null;
  const resolutions = [{ id: "30S", sec: 30 }, { id: "1", sec: 60 }, { id: "5", sec: 300 }];
  const settingsStore = { get: () => ({ symbol: { session: "electronic", timezone: "UTC" } }) };
  const series = { times: [], remapIndices() {}, setData(bars) {
    painted += 1;
    series.times = bars.map((bar) => bar.time);
    scale.rebuildIndex();
  } };
  const model = { allSeries: () => [series], paneWidth: () => width, invalidate() {} };
  const scale = new TimeScaleModel(model);
  scale.applyOptions({ rightOffset: 8, barSpacing: 6 });
  const timeScale = {
    getVisibleRange: () => scale.visibleTimeRange(),
    getVisibleLogicalRange: () => scale.visibleLogicalRange(),
    setVisibleRange: (range) => scale.setVisibleTimeRange(range),
    setVisibleLogicalRange: (range) => scale.setVisibleLogicalRange(range),
    options: () => ({ ...scale.options, rightOffset: 8 }),
  };
  const barSec = (resolution) => resolutions.find((item) => item.id === resolution).sec;
  const candle = (time) => ({ time, open: 100, high: 102, low: 99, close: 101 });
  const pane = {
    index: 0, symbol: "NQ", resolution: "30S", symbolInfo: { ticker: "NQ" },
    bars: Array.from({ length: 3600 }, (_, index) => candle(now / 1000 - (3599 - index) * 30)),
    chart: { timeScale: () => timeScale }, series,
  };
  const refresh = (pane, opts) => refreshPaneCandleData(pane, settingsStore, pane.symbolInfo, resolutions, null, opts);
  refresh(pane, { avoidPreserveViewport: true });
  scale.setVisibleLogicalRange({ from: pane.bars.length - 80, to: pane.bars.length + 8 });
  const loader = createBarLoader({
    datafeed: {
      resolveSymbol: async (symbol) => ({ ticker: symbol }),
      async getBars(_info, resolution, params) {
        onRequest?.(resolution, params);
        const step = barSec(resolution);
        return { bars: Array.from({ length: params.countBack }, (_, index) => candle(params.to - (params.countBack - index - 1) * step)) };
      },
    },
    getAllChartPanes: () => [pane],
    getBarSecForPane: (pane) => barSec(pane.resolution),
    getActivePaneIndex: () => 0,
    refreshPaneCandleData: refresh,
    setPrimaryBars() {}, refreshStatusLine() {}, setHoverState() {},
  });
  const ctx = { settingsStore, resolutions, refreshPaneCandleData: refresh };
  return {
    pane, scale, loader, settingsStore, resolutions, ctx,
    get painted() { return painted; },
    resize(value) { width = value; },
    onRequest(callback) { onRequest = callback; },
    flushFrames() {
      while (frames.length) {
        const current = frames.splice(0);
        for (const frame of current) frame();
      }
    },
  };
}

test("warm timeframe loads leave candle painting to the deferred timeframe transition", async (t) => {
  t.after(clearResolutionCache);
  const state = fixture(t);
  state.loader.stashPaneResolutionCache(state.pane, "30S");
  const before = state.painted;
  await state.loader.loadPaneBars(state.pane, { force: true, deferChartRefresh: true });
  assert.equal(state.painted, before, "a data-only warm restore cannot paint with the leaving interval's viewport");
});

test("repeated warm interval returns retain visible candles after a resize and queued animation frames", async (t) => {
  t.after(clearResolutionCache);
  const state = fixture(t);
  const { pane, loader, settingsStore, resolutions, ctx, scale } = state;
  for (const [resolution, width] of [["1", 360], ["5", 360], ["30S", 1536], ["1", 768], ["5", 1536], ["30S", 360]]) {
    const saved = captureViewportBarLayout(pane, settingsStore, resolutions);
    loader.stashPaneResolutionCache(pane, pane.resolution);
    pane.resolution = resolution;
    state.onRequest(() => state.resize(width));
    await loader.loadPaneBars(pane, { force: true, deferChartRefresh: true });
    paintPaneAfterTimeframeLoad(ctx, pane, saved);
    state.flushFrames();
    const range = scale.visibleLogicalRange();
    const latest = pane.bars.length - 1;
    assert.ok(range.from < latest && range.to > latest, `${resolution}: newest candles remain inside the actual engine viewport`);
    assert.ok(range.to - latest <= 10, `${resolution}: old interval timestamps cannot push the viewport into future whitespace`);
    assert.ok(Math.abs((range.to - range.from) - saved.width) < 1e-6, `${resolution}: preserve visible bar slots across the resize`);
  }
});
