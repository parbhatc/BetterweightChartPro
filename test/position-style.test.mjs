import test from "node:test";
import assert from "node:assert/strict";

import {
  POSITION_STYLE_DEFAULTS,
  finalizePositionDrawing,
} from "../public/js/drawings/types/position/index.js";
import {
  positionPriceAxisLabels,
  renderPositionDrawing,
  resolvePositionLabelTextColor,
} from "../public/js/drawings/types/position/render.js";
import {
  buildPositionCenterStatLines,
  buildCompactPositionCenterStatLines,
  buildCompactPositionZoneLabel,
} from "../public/js/drawings/types/position/stats.js";
import { UserDrawingsPrimitive } from "../public/js/drawings/primitives/userDrawings/index.js";
import {
  positionAnchorPoints,
  positionDragUpdate,
} from "../public/js/drawings/types/position/index.js";

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

test("legacy blue position-label text migrates to readable white", () => {
  assert.equal(resolvePositionLabelTextColor("#2962FF"), "#ffffff");
  assert.equal(resolvePositionLabelTextColor("#f5f5f5"), "#f5f5f5");
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

test("position labels propagate configured target and stop colors", () => {
  const drawing = finalizePositionDrawing({
    id: "gray-position",
    type: "long-position",
    points: [
      { time: 100, price: 110 },
      { time: 200, price: 90 },
    ],
    positionEntryPrice: 100,
    profitColor: "#376b89",
    stopColor: "#5e6977",
  });

  assert.deepEqual(positionPriceAxisLabels(drawing, { isSelected: true }), [
    { id: "target", price: 110, color: "#376b89" },
    { id: "entry", price: 100, color: "rgba(120, 123, 134, 0.92)" },
    { id: "stop", price: 90, color: "#5e6977" },
  ]);

  const fills = [];
  const context = {
    save() {},
    restore() {},
    fillRect() {},
    strokeRect() {},
    setLineDash() {},
    measureText(text) { return { width: text.length * 6 }; },
    fillText() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    roundRect() {},
    fill() { fills.push(this.fillStyle); },
    stroke() {},
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return { getContext: () => ({ measureText: (text) => ({ width: text.length * 6 }) }) };
    },
  };
  try {
    renderPositionDrawing(
      context,
      drawing,
      (time) => time,
      (price) => 200 - price,
      400,
      { isSelected: true, precision: 2, bars: [{ close: 95 }] },
    );
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  assert.ok(fills.includes("#376b89"));
  assert.ok(fills.includes("#5e6977"));
});

test("position price labels remain complete while the drawing is idle", () => {
  const drawing = finalizePositionDrawing({
    id: "idle-position",
    type: "long-position",
    points: [
      { time: 100, price: 110 },
      { time: 200, price: 90 },
    ],
    positionEntryPrice: 100,
    showPriceLabels: true,
    alwaysShowStats: false,
  });

  assert.deepEqual(
    positionPriceAxisLabels(drawing, { isSelected: false, isHovered: false })
      .map((label) => label.id),
    ["target", "entry", "stop"],
  );
  assert.deepEqual(
    positionPriceAxisLabels({ ...drawing, showPriceLabels: false }),
    [],
  );
});

test("position axis bands appear only while the drawing is selected", () => {
  const drawing = finalizePositionDrawing({
    id: "axis-band-position",
    type: "long-position",
    points: [
      { time: 100, price: 110 },
      { time: 200, price: 90 },
    ],
    positionEntryPrice: 100,
  });
  const primitive = new UserDrawingsPrimitive();
  primitive._series = { priceToCoordinate: (price) => 200 - price };
  primitive.setDrawings([drawing]);

  assert.deepEqual(primitive.positionAxisBands(), []);
  primitive.setSelectedId(drawing.id);
  assert.equal(primitive.positionAxisBands().length, 2);
  primitive.setSelectedId(null);
  assert.deepEqual(primitive.positionAxisBands(), []);
});

test("positions expose TradingView's four functional anchors", () => {
  const drawing = finalizePositionDrawing({
    id: "four-anchor-position",
    type: "long-position",
    points: [
      { time: 100, price: 110 },
      { time: 200, price: 90 },
    ],
    positionEntryPrice: 100,
  });
  const anchors = positionAnchorPoints(drawing);
  assert.deepEqual(anchors, [
    { time: 100, price: 110 },
    { time: 100, price: 100 },
    { time: 200, price: 100 },
    { time: 100, price: 90 },
  ]);

  const widened = positionDragUpdate(2, anchors, { time: 260, price: 100 }, drawing);
  assert.equal(widened.points[1].time, 260);
  assert.equal(widened.positionEntryPrice, 100);
  const raisedEntry = positionDragUpdate(1, anchors, { time: 100, price: 102 }, drawing);
  assert.equal(raisedEntry.positionEntryPrice, 102);
  assert.deepEqual(raisedEntry.points.map((point) => point.price), [112, 92]);
});

test("position center stats use TradingView open P&L wording", () => {
  assert.deepEqual(
    buildPositionCenterStatLines(
      { openClosedPL: true, qty: true, riskRewardRatio: true },
      { openClosedPL: "-28.25", qty: "0.153", riskRewardRatio: "1", isClosed: false },
    ),
    ["Open P&L: -28.25, Qty: 0.153", "Risk/Reward Ratio: 1"],
  );
});

test("position center stats switch to closed P&L after a stop or target hit", () => {
  assert.deepEqual(
    buildPositionCenterStatLines(
      { openClosedPL: true, qty: true, riskRewardRatio: true },
      { openClosedPL: "-81.50", qty: "0.153", riskRewardRatio: "1", isClosed: true },
    ),
    ["Closed P&L: -81.50, Qty: 0.153", "Risk/Reward Ratio: 1"],
  );
});
