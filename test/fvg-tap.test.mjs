import assert from "node:assert/strict";
import test from "node:test";

import { isFvgTapped } from "../testing_web/frontend/js/indicators/fvg/tap.js";

test("bullish FVG tap begins at the upper edge", () => {
  const zone = { kind: "bull", top: 101, bottom: 100 };
  assert.equal(isFvgTapped(zone, { low: 101.25, high: 102 }), false);
  assert.equal(isFvgTapped(zone, { low: 101, high: 102 }), true);
});

test("bearish FVG tap begins at the lower edge", () => {
  const zone = { kind: "bear", top: 102, bottom: 101 };
  assert.equal(isFvgTapped(zone, { low: 100, high: 100.75 }), false);
  assert.equal(isFvgTapped(zone, { low: 100, high: 101 }), true);
});
