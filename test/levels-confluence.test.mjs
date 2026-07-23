import test from "node:test";
import assert from "node:assert/strict";

import { applyClusterConfluence } from "../testing_web/frontend/js/indicators/levels/confluence.js";

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
