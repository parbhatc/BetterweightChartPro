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

function computeLive(bars, patch = {}) {
  const instance = LiquidityRunsIndicator.createInstance(0);
  instance.inputs = {
    ...instance.inputs,
    leftLen: 1,
    rightLen: 1,
    showHighs: true,
    showLows: false,
    ...patch,
  };
  return LiquidityRunsIndicator.computeOverlay(bars, bars, instance, {
    ...context,
    formingBar: bars.at(-1),
  });
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

test("sweep tolerance keeps a one-tick probe in LRLR", () => {
  const bars = [
    bar(0, 5, 1),
    bar(60, 7, 2),
    bar(120, 10, 3),
    bar(180, 7, 2),
    bar(240, 5, 1),
    bar(300, 8, 2),
    bar(360, 10.25, 3),
    bar(420, 8, 2),
  ];
  const lines = compute(bars, { toleranceTicks: 1, showHrlr: true });

  assert.equal(lines.length, 1);
  assert.equal(lines[0].label, "LRLR");
  assert.equal(lines[0].swept, false);
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
    requireCleanPath: true,
  });

  assert.equal(lines.length, 1);
  assert.equal(lines[0].label, "LRLR ×4");
  assert.equal(lines[0].priceStart, 10);
  assert.equal(lines[0].priceEnd, 7);
});

test("stacked mode mirrors correctly for four higher lows", () => {
  const bars = [
    bar(0, 10, 5),
    bar(60, 9, 1),
    bar(120, 10, 5),
    bar(180, 9, 2),
    bar(240, 10, 6),
    bar(300, 9, 3),
    bar(360, 10, 7),
    bar(420, 9, 4),
    bar(480, 10, 8),
  ];
  const lines = compute(bars, {
    mode: "stacked",
    minimumPivots: 4,
    requireCleanPath: true,
    showHighs: false,
    showLows: true,
  });

  assert.equal(lines.length, 1);
  assert.equal(lines[0].label, "LRLR ×4");
  assert.equal(lines[0].priceStart, 1);
  assert.equal(lines[0].priceEnd, 4);
  assert.equal(lines[0].labelStyle, "down");
});

test("an HRLR interruption resets the stack before a new run", () => {
  const highs = [5, 10, 6, 9, 5, 8, 4, 11, 5, 10, 4, 9, 3, 8, 2];
  const bars = highs.map((high, index) => bar(index * 60, high, 1));
  const lines = compute(bars, {
    mode: "stacked",
    minimumPivots: 4,
    requireCleanPath: false,
    showHrlr: true,
  });

  assert.equal(lines.length, 2);
  assert.equal(lines[0].label, "HRLR");
  assert.equal(lines[0].priceStart, 8);
  assert.equal(lines[0].priceEnd, 11);
  assert.equal(lines[1].label, "LRLR ×4");
  assert.equal(lines[1].priceStart, 11);
  assert.equal(lines[1].priceEnd, 8);
});

test("closed-pivot signals do not appear from a forming confirmation candle", () => {
  const bars = [
    bar(0, 5, 1),
    bar(60, 7, 2),
    bar(120, 10, 3),
    bar(180, 7, 2),
    bar(240, 5, 1),
    bar(300, 7, 2),
    bar(360, 9, 3),
    { ...bar(420, 7, 2), isForming: true },
  ];

  assert.deepEqual(compute(bars), []);

  const closed = bars.map((item, index) => index === bars.length - 1
    ? { ...item, isForming: false }
    : item);
  const confirmed = compute(closed);
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].label, "LRLR");

  const later = compute([...closed, { ...bar(480, 6, 1), isForming: true }]);
  assert.deepEqual(later, confirmed);
});

test("live context prevents repainting even when provider bars lack isForming", () => {
  const throughConfirmation = [
    bar(0, 5, 1),
    bar(60, 7, 2),
    bar(120, 10, 3),
    bar(180, 7, 2),
    bar(240, 5, 1),
    bar(300, 7, 2),
    bar(360, 9, 3),
    bar(420, 7, 2),
  ];

  assert.deepEqual(computeLive(throughConfirmation), []);
  const afterNextBarOpens = computeLive([...throughConfirmation, bar(480, 6, 1)]);
  assert.equal(afterNextBarOpens.length, 1);
  assert.equal(afterNextBarOpens[0].label, "LRLR");
});

test("stacked detection preserves confirmed milestones when a run extends", () => {
  const fourPivots = [
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
  const patch = { mode: "stacked", minimumPivots: 4, requireCleanPath: true };
  const firstSignal = compute(fourPivots, patch);
  const extended = compute([
    ...fourPivots,
    bar(540, 6, 2),
    bar(600, 2, 1),
  ], patch);

  assert.equal(firstSignal.length, 1);
  assert.equal(extended.length, 2);
  assert.deepEqual(extended[0], firstSignal[0]);
  assert.equal(extended[1].label, "LRLR \u00d75");
  assert.equal(extended[1].priceStart, 10);
  assert.equal(extended[1].priceEnd, 6);
});

test("stacked clean-path filtering rejects a run crossed by an opposing FVG", () => {
  const bars = [
    bar(0, 5, 1),
    bar(60, 10, 2),
    bar(120, 8.5, 8),
    bar(180, 9, 2),
    bar(240, 5, 1),
    bar(300, 8, 2),
    bar(360, 4, 1),
    bar(420, 7, 2),
    bar(480, 3, 1),
  ];
  const patch = { mode: "stacked", minimumPivots: 4 };

  assert.deepEqual(compute(bars, { ...patch, requireCleanPath: true }), []);
  assert.equal(compute(bars, { ...patch, requireCleanPath: false }).length, 1);
});

test("failure-swing output is prefix-stable after each confirmation close", () => {
  const bars = [
    bar(0, 5, 1),
    bar(60, 10, 2),
    bar(120, 6, 1),
    bar(180, 9, 2),
    bar(240, 5, 1),
    bar(300, 11, 2),
    bar(360, 4, 1),
    bar(420, 8, 2),
    bar(480, 3, 1),
  ];
  const patch = { showHrlr: true, maxPatterns: 1000 };
  const signatures = (lines) => new Set(lines.map((line) =>
    `${line.timeStart}|${line.timeEnd}|${line.priceStart}|${line.priceEnd}|${line.label}`));
  let previous = new Set();

  for (let length = 3; length <= bars.length; length += 1) {
    const current = signatures(compute(bars.slice(0, length), patch));
    for (const signature of previous) assert.ok(current.has(signature));
    previous = current;
  }
});
