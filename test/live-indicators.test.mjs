import test from "node:test";
import assert from "node:assert/strict";

import { refreshLivePaneIndicators } from "../public/js/app/boot/chart/barLoader.js";

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
