import test from "node:test";
import assert from "node:assert/strict";

import {
  POSITION_STYLE_DEFAULTS,
  finalizePositionDrawing,
} from "../public/js/drawings/types/position/index.js";
import {
  buildCompactPositionCenterStatLines,
  buildCompactPositionZoneLabel,
} from "../public/js/drawings/types/position/stats.js";

test("position drawings expose the complete style contract", () => {
  const drawing = finalizePositionDrawing({
    id: "position",
    type: "long-position",
    points: [
      { time: 100, price: 100 },
      { time: 200, price: 110 },
      { time: 200, price: 95 },
    ],
  });

  assert.equal(drawing.color, POSITION_STYLE_DEFAULTS.color);
  assert.equal(drawing.profitColor, "#089981");
  assert.equal(drawing.profitOpacity, 20);
  assert.equal(drawing.stopColor, "#F23645");
  assert.equal(drawing.stopOpacity, 20);
  assert.equal(drawing.textColor, "#FFFFFF");
  assert.equal(drawing.compactStatsMode, false);
});

test("compact position stats preserve selected values", () => {
  const fields = {
    tpPriceOffset: true,
    tpPercentOffset: true,
    tpTickOffset: true,
    tpAmount: true,
    openClosedPL: true,
    qty: true,
    riskRewardRatio: true,
    slPriceOffset: true,
    slPercentOffset: true,
    slTickOffset: true,
    slAmount: true,
  };
  const values = {
    tpPriceOffset: "10.00",
    tpPercentOffset: "1.000",
    tpTickOffset: "40",
    tpAmount: "250",
    openClosedPL: "12.50",
    qty: "25",
    riskRewardRatio: "2",
    slPriceOffset: "5.00",
    slPercentOffset: "0.500",
    slTickOffset: "20",
    slAmount: "125",
  };

  assert.equal(buildCompactPositionZoneLabel(fields, values, "target"), "T 10.00 (1.000%) 40t 250");
  assert.equal(buildCompactPositionZoneLabel(fields, values, "stop"), "S 5.00 (0.500%) 20t 125");
  assert.deepEqual(buildCompactPositionCenterStatLines(fields, values), [
    "P&L 12.50  Q 25  R:R 2",
  ]);
});
