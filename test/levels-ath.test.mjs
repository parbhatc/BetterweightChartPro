import assert from "node:assert/strict";
import test from "node:test";

import {
  allTimeHighFromBars,
  ATH_HISTORY_BARS,
  ATH_RESOLUTION,
} from "../testing_web/frontend/js/indicators/levels/allTimeHigh.js";

test("ATH uses the highest finite bar at or before the replay anchor", () => {
  const bars = [
    { time: 100, high: 100 },
    { time: 200, high: 125 },
    { time: 300, high: 140 },
    { time: 400, high: Number.NaN },
  ];

  assert.equal(allTimeHighFromBars(bars, 250), 125);
  assert.equal(allTimeHighFromBars(bars, 350), 140);
  assert.equal(allTimeHighFromBars([], 350), null);
});

test("ATH requests deep daily history only when enabled by the indicator", () => {
  assert.equal(ATH_RESOLUTION, "D");
  assert.equal(ATH_HISTORY_BARS, 4000);
});
