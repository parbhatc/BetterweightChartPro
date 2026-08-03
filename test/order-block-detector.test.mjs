import test from "node:test";
import assert from "node:assert/strict";

import OrderBlockDetectorIndicator, {
  detectOrderBlocks,
  isVolumePivotHighAt,
} from "../public/js/indicators/definitions/orderBlockDetector/OrderBlockDetectorIndicator.js";
import { getIndicatorClass } from "../public/js/indicators/catalog.js";

const bar = (time, open, high, low, close, volume) => ({
  time,
  open,
  high,
  low,
  close,
  volume,
});

const bullishFormation = [
  bar(0, 3, 4, 2, 3, 1),
  bar(60, 3, 5, 1, 4, 10),
  bar(120, 4, 6, 2, 5, 1),
];

test("Order Block Detector is registered with the observed settings", () => {
  const instance = OrderBlockDetectorIndicator.createInstance(0);

  assert.equal(getIndicatorClass("order_block_detector"), OrderBlockDetectorIndicator);
  assert.equal(instance.inputs.volumePivotLength, 5);
  assert.equal(instance.inputs.bullishCount, 3);
  assert.equal(instance.inputs.bearishCount, 3);
  assert.equal(instance.inputs.averageLineStyle, "solid");
  assert.equal(instance.inputs.averageLineWidth, 1);
  assert.equal(instance.inputs.mitigation, "close");
  assert.equal(instance.style.bullFillColor, "#169400");
  assert.equal(instance.style.bullFillColorOpacity, 20);
  assert.equal(instance.style.bearFillColor, "#ff1100");
  assert.equal(instance.style.bearFillColorOpacity, 20);
  assert.equal(instance.style.bullAverageColorOpacity, 63);
  assert.deepEqual(OrderBlockDetectorIndicator.legendParams(instance), [
    "5", "3", "3", "⎯⎯⎯", "1", "Close",
  ]);
});

test("volume pivots use symmetric confirmation and reject a later equal high", () => {
  const confirmed = [
    { volume: 1 },
    { volume: 5 },
    { volume: 10 },
    { volume: 4 },
    { volume: 2 },
  ];
  const tiedRight = confirmed.map((item) => ({ ...item }));
  tiedRight[4].volume = 10;

  assert.equal(isVolumePivotHighAt(confirmed, 4, 2), true);
  assert.equal(isVolumePivotHighAt(tiedRight, 4, 2), false);
});

test("bullish blocks use the pivot low-to-midpoint range", () => {
  const detected = detectOrderBlocks(bullishFormation, bullishFormation, {
    volumePivotLength: 1,
    mitigation: "close",
  });

  assert.deepEqual(detected.bullish, [{
    side: "bull",
    index: 1,
    time: 60,
    top: 3,
    bottom: 1,
    average: 2,
  }]);
  assert.deepEqual(detected.bearish, []);
});

test("bearish blocks use the pivot midpoint-to-high range", () => {
  const bars = [
    bar(0, 5, 6, 2, 4, 1),
    bar(60, 7, 10, 5, 8, 10),
    bar(120, 6, 9, 4, 7, 1),
  ];
  const detected = detectOrderBlocks(bars, bars, {
    volumePivotLength: 1,
    mitigation: "close",
  });

  assert.deepEqual(detected.bearish, [{
    side: "bear",
    index: 1,
    time: 60,
    top: 10,
    bottom: 7.5,
    average: 8.75,
  }]);
  assert.deepEqual(detected.bullish, []);
});

test("wick mitigation removes a probed block while close mitigation keeps it", () => {
  const probe = bar(180, 2, 4, 0.5, 1.5, 1);
  const bars = [...bullishFormation, probe];

  const closeBlocks = detectOrderBlocks(bars, bars, {
    volumePivotLength: 1,
    mitigation: "close",
  });
  const wickBlocks = detectOrderBlocks(bars, bars, {
    volumePivotLength: 1,
    mitigation: "wick",
  });

  assert.equal(closeBlocks.bullish.some((block) => block.time === 60), true);
  assert.equal(wickBlocks.bullish.some((block) => block.time === 60), false);
});

test("overlay renders extend-right boxes and independently toggleable average lines", () => {
  const instance = OrderBlockDetectorIndicator.createInstance(0);
  instance.inputs = {
    ...instance.inputs,
    volumePivotLength: 1,
    bullishCount: 1,
  };
  let items = OrderBlockDetectorIndicator.computeOverlay(
    bullishFormation,
    bullishFormation,
    instance,
  );
  const box = items.find((item) => item.kind == null);
  const line = items.find((item) => item.kind === "line");

  assert.ok(box);
  assert.ok(line);
  assert.equal(box.extendRight, true);
  assert.equal(box.fillColor, "rgba(22, 148, 0, 0.2)");
  assert.equal(box.borderColor, "rgba(22, 148, 0, 0.3)");
  assert.equal(line.priceTop, 2);
  assert.equal(line.lineColor, "rgba(149, 152, 161, 0.63)");

  instance.style.graphicBoxes = false;
  items = OrderBlockDetectorIndicator.computeOverlay(
    bullishFormation,
    bullishFormation,
    instance,
  );
  assert.equal(items.some((item) => item.kind == null), false);
  assert.equal(items.some((item) => item.kind === "line"), true);
  assert.equal(OrderBlockDetectorIndicator.overlayGraphicsVisible(instance, "boxes"), true);

  instance.style.graphicLines = false;
  assert.equal(OrderBlockDetectorIndicator.overlayGraphicsVisible(instance, "boxes"), false);
});
