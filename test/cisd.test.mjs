import test from "node:test";
import assert from "node:assert/strict";

import CisdIndicator from "../public/js/indicators/definitions/cisd/CisdIndicator.js";
import MarketStructureIndicator from "../public/js/indicators/definitions/marketStructure/MarketStructureIndicator.js";
import { getIndicatorClass } from "../public/js/indicators/catalog.js";

const bar = (time, open, close) => ({
  time,
  open,
  high: Math.max(open, close) + 0.25,
  low: Math.min(open, close) - 0.25,
  close,
  volume: 1,
});

function cisdLines(bars, inputs = {}) {
  const instance = CisdIndicator.createInstance(0);
  instance.inputs = { ...instance.inputs, waitClose: false, ...inputs };
  return CisdIndicator.computeOverlay(bars, bars, instance);
}

test("CISD is registered as a standalone indicator", () => {
  assert.equal(getIndicatorClass("cisd"), CisdIndicator);
  assert.equal(CisdIndicator.id, "cisd");
  assert.equal(CisdIndicator.createInstance(0).inputs.minCandles, 3);
  assert.equal(
    MarketStructureIndicator.inputs.some((input) => input.id === "showCisd"),
    false,
  );
});

test("bullish CISD closes above the first open of a minimum-length bearish run", () => {
  const bars = [
    bar(0, 10, 9),
    bar(1, 9, 8),
    bar(2, 8, 7),
    bar(3, 7, 9.5),
    bar(4, 9.5, 10.5),
  ];

  assert.deepEqual(cisdLines(bars), [{
    timeStart: 0,
    priceStart: 10,
    timeEnd: 4,
    priceEnd: 10,
    color: "#089981",
    width: 1,
    dash: [4, 3],
    label: "CISD",
    labelPlain: true,
    labelTextColor: "#089981",
    labelStyle: "up",
  }]);
});

test("look-left value is a minimum, so longer delivery runs remain valid", () => {
  const fourBearCandles = [
    bar(0, 12, 11),
    bar(1, 11, 10),
    bar(2, 10, 9),
    bar(3, 9, 8),
    bar(4, 8, 12.5),
  ];
  const twoBearCandles = [
    bar(0, 10, 9),
    bar(1, 9, 8),
    bar(2, 8, 10.5),
  ];

  assert.equal(cisdLines(fourBearCandles, { minCandles: 3 }).length, 1);
  assert.equal(cisdLines(twoBearCandles, { minCandles: 3 }).length, 0);
});

test("bearish CISD mirrors the rule for a consecutive bullish run", () => {
  const bars = [
    bar(0, 10, 11),
    bar(1, 11, 12),
    bar(2, 12, 13),
    bar(3, 13, 14),
    bar(4, 14, 10.5),
    bar(5, 10.5, 9.5),
  ];

  const lines = cisdLines(bars);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].timeStart, 0);
  assert.equal(lines[0].priceStart, 10);
  assert.equal(lines[0].timeEnd, 5);
  assert.equal(lines[0].labelStyle, "down");
});
