import test from "node:test";
import assert from "node:assert/strict";

import LiquidityRunsIndicator from "../public/js/indicators/definitions/liquidityRuns/LiquidityRunsIndicator.js";
import { getIndicatorClass } from "../public/js/indicators/catalog.js";

const bar = (time, high, low, close = (high + low) / 2) => ({
  time,
  open: close,
  high,
  low,
  close,
  volume: 1,
});

const context = {
  symbolInfo: {
    minmov: 1,
    pricescale: 4,
  },
};

function compute(bars, patch = {}) {
  const instance = LiquidityRunsIndicator.createInstance(0);
  instance.inputs = {
    ...instance.inputs,
    leftLen: 1,
    rightLen: 1,
    showHighs: true,
    showLows: false,
    ...patch,
  };
  return LiquidityRunsIndicator.computeOverlay(bars, bars, instance, context);
}

test("LRLR / HRLR is registered with failure-swing defaults", () => {
  const instance = LiquidityRunsIndicator.createInstance(0);
  assert.equal(getIndicatorClass("lrlr_hrlr"), LiquidityRunsIndicator);
  assert.equal(instance.inputs.mode, "failure");
  assert.equal(instance.inputs.leftLen, 3);
  assert.equal(instance.inputs.rightLen, 3);
  assert.equal(instance.inputs.showLrlr, true);
  assert.equal(instance.inputs.showHrlr, false);
  assert.equal(instance.inputs.minimumPivots, 4);
});

test("a lower high leaves high-side LRLR", () => {
  const bars = [
    bar(0, 5, 1),
    bar(60, 7, 2),
    bar(120, 10, 3),
    bar(180, 7, 2),
    bar(240, 5, 1),
    bar(300, 7, 2),
    bar(360, 9, 3),
    bar(420, 7, 2),
    bar(480, 5, 1),
  ];
  const lines = compute(bars);
  const lrlr = lines.find((line) => line.label === "LRLR");

  assert.ok(lrlr);
  assert.equal(lrlr.priceStart, 10);
  assert.equal(lrlr.priceEnd, 9);
  assert.equal(lrlr.timeStart, 120);
  assert.equal(lrlr.timeEnd, 360);
});

test("a higher low leaves low-side LRLR", () => {
  const bars = [
    bar(0, 10, 5),
    bar(60, 9, 3),
    bar(120, 8, 1),
    bar(180, 9, 3),
    bar(240, 10, 5),
    bar(300, 9, 4),
    bar(360, 8, 2),
    bar(420, 9, 4),
    bar(480, 10, 5),
  ];
  const lines = compute(bars, { showHighs: false, showLows: true });
  const lrlr = lines.find((line) => line.label === "LRLR");

  assert.ok(lrlr);
  assert.equal(lrlr.priceStart, 1);
  assert.equal(lrlr.priceEnd, 2);
});

test("a swept high is classified as HRLR when enabled", () => {
  const bars = [
    bar(0, 5, 1),
    bar(60, 7, 2),
    bar(120, 10, 3),
    bar(180, 7, 2),
    bar(240, 5, 1),
    bar(300, 8, 2),
    bar(360, 11, 3),
    bar(420, 8, 2),
    bar(480, 5, 1),
  ];
  const lines = compute(bars, { showHrlr: true });
  const hrlr = lines.find((line) => line.label === "HRLR");

  assert.ok(hrlr);
  assert.equal(hrlr.priceStart, 10);
  assert.equal(hrlr.priceEnd, 11);
  assert.equal(hrlr.swept, true);
});

test("stacked mode connects a clean four-pivot lower-high run", () => {
  const bars = [
    bar(0, 5, 1),
    bar(60, 10, 2),
    bar(120, 6, 1),
    bar(180, 9, 2),
    bar(240, 5, 1),
    bar(300, 8, 2),
    bar(360, 4, 1),
    bar(420, 7, 2),
    bar(480, 3, 1),
  ];
  const lines = compute(bars, {
    mode: "stacked",
    minimumPivots: 4,
    requireCleanPath: false,
  });

  assert.equal(lines.length, 1);
  assert.equal(lines[0].label, "LRLR ×4");
  assert.equal(lines[0].priceStart, 10);
  assert.equal(lines[0].priceEnd, 7);
});
