import test from "node:test";
import assert from "node:assert/strict";

import { compileIndicatorFormula, parseIndicatorFormula } from "../public/js/indicators/custom/formula.js";
import {
  createCustomIndicator,
  loadCustomIndicatorSpecs,
  normalizeCustomIndicatorSpec,
} from "../public/js/indicators/custom/definitions.js";

const bars = Array.from({ length: 30 }, (_, index) => ({
  open: index + 1,
  high: index + 3,
  low: index,
  close: index + 2,
}));

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("custom formulas combine sources, arithmetic, and rolling functions", () => {
  const evaluate = compileIndicatorFormula("ema(close, 3) - sma(hl2, 3)");
  const output = evaluate(bars);
  assert.equal(output.length, bars.length);
  assert.equal(output[0], null);
  assert.ok(Number.isFinite(output.at(-1)));
});

test("custom formula parser rejects unknown code instead of evaluating it", () => {
  assert.throws(() => parseIndicatorFormula("window.alert(1)"), /Unexpected character/);
  assert.throws(() => parseIndicatorFormula("fetch(close)"), /Unknown function/);
  assert.throws(() => parseIndicatorFormula("sma(close, 0)"), /whole number/);
});

test("custom indicator definitions persist as serializable specs and compute", () => {
  const storage = memoryStorage();
  const created = createCustomIndicator({
    title: "Fast trend",
    formula: "ema(close, 5)",
    placement: "pane",
    color: "#123456",
  }, { storage });
  assert.equal(created.id, "custom_fast_trend");
  assert.deepEqual(loadCustomIndicatorSpecs(storage), [created]);

  const normalized = normalizeCustomIndicatorSpec(created);
  assert.equal(normalized.placement, "pane");
});
