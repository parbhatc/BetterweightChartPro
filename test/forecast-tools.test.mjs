import test from "node:test";
import assert from "node:assert/strict";

import {
  renderAnchoredVwap,
  renderBarsPattern,
  renderGhostFeed,
} from "../public/js/drawings/tools/forecast/index.js";

function createCanvasContext() {
  const calls = {
    fillRect: 0,
    lineTo: 0,
    moveTo: 0,
    stroke: 0,
  };
  return {
    calls,
    beginPath() {},
    fillRect() {
      calls.fillRect += 1;
    },
    lineTo() {
      calls.lineTo += 1;
    },
    moveTo() {
      calls.moveTo += 1;
    },
    restore() {},
    save() {},
    setLineDash() {},
    stroke() {
      calls.stroke += 1;
    },
  };
}

const bars = Array.from({ length: 24 }, (_, index) => {
  const open = 100 + index * 0.4;
  const close = open + (index % 2 === 0 ? 0.6 : -0.25);
  return {
    time: 1_700_000_000 + index * 60,
    open,
    high: Math.max(open, close) + 0.35,
    low: Math.min(open, close) - 0.3,
    close,
    volume: 100 + index,
  };
});

const renderState = {
  bars,
  barSec: 60,
  timeToX: (time) => (time - bars[0].time) / 6,
  priceToY: (price) => 500 - price * 3,
};

test("bars pattern projects source OHLC geometry at its destination", () => {
  const context = createCanvasContext();
  renderBarsPattern(
    context,
    {
      type: "bars-pattern",
      points: [
        { time: bars[19].time, price: bars[19].close },
        { time: bars[23].time + 600, price: 115 },
      ],
    },
    renderState,
  );

  assert.ok(context.calls.stroke >= 2);
  assert.ok(context.calls.lineTo >= 4);
});

test("ghost feed renders deterministic future candle bodies", () => {
  const context = createCanvasContext();
  renderGhostFeed(
    context,
    {
      type: "ghost-feed",
      points: [
        { time: bars[20].time, price: 108 },
        { time: bars[23].time + 900, price: 114 },
      ],
    },
    renderState,
  );

  assert.equal(context.calls.fillRect, 16);
  assert.equal(context.calls.stroke, 16);
});

test("anchored VWAP renders the cumulative volume-weighted series", () => {
  const context = createCanvasContext();
  renderAnchoredVwap(
    context,
    {
      type: "anchored-vwap",
      points: [{ time: bars[8].time, price: bars[8].close }],
      vwapShowBands: true,
    },
    renderState,
  );

  assert.equal(context.calls.stroke, 3);
  assert.ok(context.calls.lineTo > bars.length);
});
