import test from "node:test";
import assert from "node:assert/strict";

import { refreshLivePaneIndicators } from "../public/js/app/boot/chart/barLoader.js";
import {
  cachedOverlayWhilePending,
  overlayChartHistoryHeadKey,
} from "../public/js/indicators/controller/overlaySync.js";

function liveContext({ plots = false, liveOverlay = false } = {}) {
  const calls = [];
  return {
    calls,
    opts: {},
    indicatorController: {
      paneHasPlotSeriesIndicators: () => plots,
      paneNeedsLiveOverlayRefresh: () => liveOverlay,
      refreshOverlaysForPane: (paneIndex) => calls.push(["overlay", paneIndex]),
    },
    refreshIndicators: (paneIndex) => calls.push(["plots-throttled", paneIndex]),
    refreshIndicatorTails: (paneIndex) => calls.push(["plots-tail", paneIndex]),
    refreshIndicatorsImmediate: (paneIndex) => calls.push(["plots-immediate", paneIndex]),
    refreshOverlaysImmediate: (paneIndex) => calls.push(["overlay-immediate", paneIndex]),
    ensureIndicatorData: () => calls.push(["ensure-data"]),
  };
}

test("forming bars update only the latest plot-series point", () => {
  const ctx = liveContext({ plots: true });
  refreshLivePaneIndicators(ctx, { index: 2 }, { isNewBar: false });
  assert.deepEqual(ctx.calls, [["plots-tail", 2]]);
});

test("forming bars update plot tails and live overlays independently", () => {
  const ctx = liveContext({ plots: true, liveOverlay: true });
  refreshLivePaneIndicators(ctx, { index: 4 }, { isNewBar: false });
  assert.deepEqual(ctx.calls, [["plots-tail", 4], ["overlay", 4]]);
});

test("forming bars retain the live-overlay-only refresh path", () => {
  const ctx = liveContext({ liveOverlay: true });
  refreshLivePaneIndicators(ctx, { index: 3 }, { isNewBar: false });
  assert.deepEqual(ctx.calls, [["overlay", 3]]);
});

test("new bars still refresh plot-series indicators immediately", () => {
  const ctx = liveContext({ plots: true });
  refreshLivePaneIndicators(ctx, { index: 1 }, { isNewBar: true });
  assert.deepEqual(ctx.calls, [["ensure-data"], ["plots-immediate", 1]]);
});

test("host replay rebinds overlay timing before waiting for indicator data", () => {
  const ctx = liveContext();
  ctx.opts.replayHostControlled = true;
  ctx.indicatorController.syncOverlayTimeCtxForPane = (paneIndex) => {
    ctx.calls.push(["sync-overlay-time", paneIndex]);
  };
  ctx.ensureIndicatorDataThenOverlay = (pane) => {
    ctx.calls.push(["ensure-data-then-overlay", pane.index]);
  };

  refreshLivePaneIndicators(ctx, { index: 5 }, { isNewBar: true });

  assert.deepEqual(ctx.calls, [
    ["sync-overlay-time", 5],
    ["ensure-data-then-overlay", 5],
  ]);
});

test("appending replay bars preserves the overlay history-head cache key", () => {
  const before = [{ time: 100 }, { time: 200 }];
  const afterAppend = [...before, { time: 300 }];
  const afterHistoryShift = [{ time: 50 }, ...afterAppend];

  assert.equal(overlayChartHistoryHeadKey(afterAppend), overlayChartHistoryHeadKey(before));
  assert.notEqual(overlayChartHistoryHeadKey(afterHistoryShift), overlayChartHistoryHeadKey(before));
});

test("pending HTF refreshes retain the last valid overlay frame", () => {
  const overlay = [{ timeStart: 100, timeEnd: 200, label: "PDH" }];

  assert.equal(cachedOverlayWhilePending({ _overlayBoxCache: overlay }), overlay);
  assert.deepEqual(cachedOverlayWhilePending({ _overlayBoxCache: [] }), []);
  assert.deepEqual(cachedOverlayWhilePending({}), []);
});
