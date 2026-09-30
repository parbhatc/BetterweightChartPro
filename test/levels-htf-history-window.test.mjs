import test from "node:test";
import assert from "node:assert/strict";

import { liquidityTakenBeforeChartWindow } from "../testing_web/frontend/js/indicators/levels/htfHistoryWindow.js";

const HOUR = 3600;
const bars = [
  { time: 0, high: 100, low: 90 },
  { time: 4 * HOUR, high: 95, low: 91 }, // pivot confirmation bar
  { time: 8 * HOUR, high: 101, low: 89 }, // fully before the chart window
  { time: 12 * HOUR, high: 105, low: 85 }, // overlaps the chart window
];

test("discard HTF levels swept before lower-timeframe history begins", () => {
  assert.equal(
    liquidityTakenBeforeChartWindow(bars, 1, 4 * HOUR, 12 * HOUR, "high", 100),
    true,
  );
  assert.equal(
    liquidityTakenBeforeChartWindow(bars, 1, 4 * HOUR, 12 * HOUR, "low", 90),
    true,
  );
});

test("leave the bucket overlapping lower-timeframe history for exact sweep timing", () => {
  const noEarlierCross = bars.map((bar, index) =>
    index === 2 ? { ...bar, high: 99, low: 91 } : bar,
  );
  assert.equal(
    liquidityTakenBeforeChartWindow(noEarlierCross, 1, 4 * HOUR, 14 * HOUR, "high", 100),
    false,
  );
  assert.equal(
    liquidityTakenBeforeChartWindow(noEarlierCross, 1, 4 * HOUR, 14 * HOUR, "low", 90),
    false,
  );
});
