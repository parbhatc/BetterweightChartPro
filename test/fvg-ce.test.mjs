import assert from "node:assert/strict";
import test from "node:test";

import { fvgCePrice } from "../testing_web/frontend/js/indicators/fvg/ce.js";

test("FVG CE is the exact midpoint for bullish and bearish zones", () => {
  assert.equal(fvgCePrice({ top: 29358, bottom: 29350 }), 29354);
  assert.equal(fvgCePrice({ top: 7715.25, bottom: 7714.5 }), 7714.875);
});

test("FVG CE ignores incomplete zone geometry", () => {
  assert.equal(fvgCePrice({ top: 100 }), null);
  assert.equal(fvgCePrice(null), null);
});
