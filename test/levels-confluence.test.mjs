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

test("previous-period references merge with matching older timeframe levels", () => {
  const lines = [
    line("4H Low (100.00)", 1_000),
    line("PDL (100.00)", 200_000, { referenceLevel: true }),
  ];

  const merged = applyClusterConfluence(lines, 1.5, "#high", "#low");

  assert.equal(merged.length, 1);
  assert.equal(merged[0].label, "4H & PDL");
  assert.equal(merged[0].color, "#low");
  assert.equal(merged[0].lineWidth, 3);
});

test("ordinary levels still respect the one-day confluence boundary", () => {
  const lines = [
    line("4H Low (100.00)", 1_000),
    line("15m Low (100.00)", 200_000),
  ];

  const merged = applyClusterConfluence(lines, 1.5, "#high", "#low");

  assert.equal(merged.length, 2);
});

test("session midpoint joins only its nearest overlapping level", () => {
  const lines = [
    line("4H Low (99.75)", 1_000, { price: 99.75 }),
    line("1H High (100.50)", 1_000, { price: 100.5, kind: "high" }),
    line("Mid (100.00)", 200_000, {
      referenceLevel: true,
      referenceTag: "Mid",
      kind: "mid",
    }),
  ];

  const merged = applyClusterConfluence(lines, 1.5, "#high", "#low");

  assert.equal(merged.length, 2);
  assert.equal(merged.some((item) => item.label === "4H & Mid"), true);
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
