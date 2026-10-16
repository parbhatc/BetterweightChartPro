import assert from "node:assert/strict";
import test from "node:test";

import {
  isPartialClose,
  isPartialFvgVisible,
} from "../testing_web/frontend/js/indicators/fvg/partial.js";

test("lower-timeframe closes can hide and reclaim an unconfirmed HTF FVG", () => {
  const bullish = { kind: "bull", top: 105, bottom: 100 };
  assert.equal(isPartialClose(bullish, { close: 99.75 }), true);
  assert.equal(isPartialClose(bullish, { close: 100.25 }), false);
  assert.equal(isPartialFvgVisible({ ...bullish, partial: true }, false), false);
  assert.equal(isPartialFvgVisible({ ...bullish, partial: false }, false), true);
  assert.equal(isPartialFvgVisible({ ...bullish, partial: true }), true);

  const bearish = { kind: "bear", top: 105, bottom: 100 };
  assert.equal(isPartialClose(bearish, { close: 105.25 }), true);
  assert.equal(isPartialClose(bearish, { close: 104.75 }), false);
});
