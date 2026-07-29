import test from "node:test";
import assert from "node:assert/strict";

import { TimeScaleModel } from "../public/vendor/prochart/scale/timeScaleModel.mjs";
import { TRADINGVIEW_KINETIC_SCROLL } from "../public/vendor/prochart/input/interactions.mjs";
import { nearestBarForTooltip } from "../public/js/drawings/controller/tooltip/overlay.js";
import { supportsValuesLongPress } from "../public/js/drawings/controller/pointer/handlers.js";

test("future logical positions extrapolate time instead of clamping to the latest bar", () => {
  const chart = { allSeries: () => [], paneWidth: () => 600, invalidate() {} };
  const scale = new TimeScaleModel(chart);
  scale.times = [1_000, 1_060, 1_120];
  scale._avgStep = 60;
  assert.equal(scale.indexToTime(5), 1_300);
  assert.equal(scale.coordinateToTime(scale.logicalToCoordinate(5)), 1_300);
});

test("value inspector resolves real candles and uses the latest candle in future whitespace", () => {
  const bars = [
    { time: 1_000, close: 10 },
    { time: 1_060, close: 11 },
    { time: 1_120, close: 12 },
  ];
  assert.equal(nearestBarForTooltip(bars, 1_061, 60).bar.close, 11);
  const future = nearestBarForTooltip(bars, 1_240, 60);
  assert.equal(future.bar.close, 12);
  assert.equal(future.future, true);
});

test("value inspector long press is desktop-only", () => {
  assert.equal(supportsValuesLongPress("mouse"), true);
  assert.equal(supportsValuesLongPress("touch"), false);
  assert.equal(supportsValuesLongPress("pen"), false);
});

test("TradingView-style panning stops immediately for mouse but keeps touch momentum", () => {
  assert.deepEqual(TRADINGVIEW_KINETIC_SCROLL, { mouse: false, touch: true });
});
