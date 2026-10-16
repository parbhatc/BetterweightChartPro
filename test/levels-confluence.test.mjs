import test from "node:test";
import assert from "node:assert/strict";

import { applyClusterConfluence, keepRecentSweptLevels } from "../testing_web/frontend/js/indicators/levels/confluence.js";
import { markPreviousPeriodSweeps } from "../testing_web/frontend/js/indicators/levels/referenceSweep.js";

function line(label, startTime, overrides = {}) {
  return {
    label,
    price: 100,
    kind: "low",
    startTime,
    endTime: startTime + 60,
    bornTime: startTime,
    swept: false,
    ...overrides,
  };
}

test("previous-period references merge while retaining the timeframe color", () => {
  const lines = [
    line("4H Low (100.00)", 1_000, { color: "#4h" }),
    line("PDL (100.00)", 200_000, { referenceLevel: true, color: "#pdl" }),
  ];

  const merged = applyClusterConfluence(lines, 1.5);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].label, "4H & PDL");
  assert.equal(merged[0].color, "#4h");
  assert.equal(merged[0].lineWidth, 3);
});

test("merged levels use the highest timeframe label and color", () => {
  const merged = applyClusterConfluence([
    line("1H Low", 2_000, { color: "#1h" }),
    line("4H Low", 1_000, { color: "#4h" }),
  ], 1.5);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].label, "4H & 1H Low");
  assert.equal(merged[0].color, "#4h");
});

test("timeframe color takes priority when merging with a session level", () => {
  const merged = applyClusterConfluence([
    line("London Low", 2_000, {
      color: "#london",
      sessionLabelColor: "#london-label",
      sessionBorn: 2_000,
      sessionTag: "London",
    }),
    line("1H Low", 1_000, { color: "#1h" }),
  ], 1.5);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].label, "1H Low");
  assert.equal(merged[0].sessionLabel, "London");
  assert.equal(merged[0].sessionLabelColor, "#london-label");
  assert.equal(merged[0].splitSessionLabel, true);
  assert.equal(merged[0].color, "#1h");
});

test("Asia color stays on the line when merged with a timeframe level", () => {
  const merged = applyClusterConfluence([
    line("Asia Low", 2_000, {
      color: "#asia",
      sessionLabelColor: "#asia-label",
      sessionBorn: 2_000,
      sessionTag: "Asia",
    }),
    line("1H Low", 1_000, { color: "#1h" }),
  ], 1.5);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].label, "1H Low");
  assert.equal(merged[0].sessionLabel, "Asia");
  assert.equal(merged[0].sessionLabelColor, "#asia-label");
  assert.equal(merged[0].color, "#asia");
});

test("ordinary levels still respect the one-day confluence boundary", () => {
  const lines = [
    line("4H Low (100.00)", 1_000),
    line("15m Low (100.00)", 200_000),
  ];

  const merged = applyClusterConfluence(lines, 1.5, "#high", "#low");

  assert.equal(merged.length, 2);
});

test("session midpoint remains separate from nearby levels", () => {
  const lines = [
    line("4H Low (99.75)", 1_000, { price: 99.75 }),
    line("1H High (100.50)", 1_000, { price: 100.5, kind: "high" }),
    line("Mid (100.00)", 200_000, {
      referenceLevel: true,
      referenceTag: "Mid",
      kind: "mid",
      label: "",
      extendLeft: true,
      extendRight: true,
    }),
  ];

  const merged = applyClusterConfluence(lines, 1.5, "#high", "#low");

  assert.equal(merged.length, 3);
  const midpoint = merged.find((item) => item.referenceTag === "Mid");
  assert.equal(midpoint?.label, "");
  assert.equal(midpoint?.extendLeft, true);
  assert.equal(midpoint?.extendRight, true);
  assert.equal(merged.some((item) => item.label.includes("1H")), true);
});

test("zero max expires swept lines after three candles; positive max retains them", () => {
  const active = line("1H Low", 1_000);
  const sweptHtf = line("4H Low", 1_000, { swept: true, sweepTime: 30 });
  const sweptSession = line("Asia Low", 1_000, { swept: true, sweepTime: 30 });
  const sweptReference = line("PDL", 1_000, { swept: true, sweepTime: 30, referenceLevel: true });
  const levels = [active, sweptHtf, sweptSession, sweptReference];
  for (const interval of [30, 60]) {
    const bars = Array.from({ length: 5 }, (_, i) => ({ time: i * interval }));
    const timedLevels = levels.map((level) =>
      level.swept ? { ...level, sweepTime: interval } : level,
    );
    assert.deepEqual(keepRecentSweptLevels(timedLevels, bars, 3, 3, 0), timedLevels);
    assert.deepEqual(keepRecentSweptLevels(timedLevels, bars, 4, 3, 0), [active]);
    assert.deepEqual(keepRecentSweptLevels(timedLevels, bars, 1, 0, 0), [active]);
    assert.deepEqual(keepRecentSweptLevels(timedLevels, bars, 4, 3, 1), timedLevels);
  }
});

test("previous-day levels become swept at the first crossing", () => {
  const high = line("PDH", 100, { kind: "high", price: 110, referenceTag: "PDH" });
  const low = line("PDL", 100, { price: 90, referenceTag: "PDL" });
  const bars = [
    { time: 100, high: 105, low: 95 },
    { time: 160, high: 111, low: 94 },
    { time: 220, high: 112, low: 89 },
  ];

  markPreviousPeriodSweeps([high, low], bars, bars, { first: 0, last: 2 });

  assert.equal(high.sweepTime, 160);
  assert.equal(high.endTime, 160);
  assert.equal(low.sweepTime, 220);
  assert.equal(low.endTime, 220);
});
