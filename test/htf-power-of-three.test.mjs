import test from "node:test";
import assert from "node:assert/strict";

import HtfPowerOfThreeIndicator from "../public/js/indicators/definitions/htfPowerOfThree/HtfPowerOfThreeIndicator.js";
import { formatCountdownLabel } from "../public/js/indicators/primitives/boxes.js";
import { getIndicatorClass } from "../public/js/indicators/catalog.js";

const bar = (time, open, high, low, close) => ({
  time,
  open,
  high,
  low,
  close,
  volume: 1,
});

function context(chartBars, securityBars = []) {
  return {
    barSec: 60,
    chartResolution: "1",
    chartTimeZone: "Etc/UTC",
    primarySymbol: "NQ1!",
    symbol: "NQ1!",
    symbolInfo: {
      minmov: 1,
      pricescale: 4,
      currency_code: "USD",
    },
    utcBars: chartBars,
    getSecurityBars: () => ({
      utcBars: securityBars,
      chartBars: securityBars,
      source: "test",
    }),
  };
}

test("HTF Power of Three is registered with the observed defaults", () => {
  const instance = HtfPowerOfThreeIndicator.createInstance(0);
  assert.equal(getIndicatorClass("htf_power_of_three"), HtfPowerOfThreeIndicator);
  assert.equal(instance.inputs.htfTimeframe, "240");
  assert.equal(instance.inputs.offset, 0);
  assert.equal(instance.inputs.showOhlc, true);
  assert.equal(instance.inputs.showOpenLine, true);
  assert.equal(instance.inputs.showHighLowLines, true);
  assert.equal(instance.inputs.rangeMode, "price");
  assert.equal(instance.inputs.closeTimeMode, "exact");
  assert.equal(instance.style.bullBodyColor, "#4caf50");
  assert.equal(instance.style.bearBodyColor, "#000000");
  assert.equal(instance.style.bullBodyColorOpacity, 100);
  assert.equal(instance.style.bearBodyColorOpacity, 100);
});

test("HTF Power of Three projects a live aggregate candle, levels, prices, and range", () => {
  const chartBars = [
    bar(14400, 100, 103, 99, 102),
    bar(14460, 102, 108, 101, 107),
    bar(14520, 107, 109, 105, 106),
  ];
  const closedHtf = [bar(0, 90, 105, 85, 100)];
  const instance = HtfPowerOfThreeIndicator.createInstance(0);
  const items = HtfPowerOfThreeIndicator.computeOverlay(
    chartBars,
    chartBars,
    instance,
    context(chartBars, closedHtf),
  );

  const body = items.find((item) => item.fillColor === "#4caf50");
  const lines = items.filter((item) => item.kind === "line");
  const labels = items.filter((item) => item.kind === "label");
  const wick = items.find((item) => item.kind === "vertical-line");
  const table = items.filter((item) => item.kind === "screen-box");
  const infoLabels = items.filter((item) => item.showLabel).map((item) => item.label);

  assert.ok(body);
  assert.equal(body.priceTop, 106);
  assert.equal(body.priceBottom, 100);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((item) => item.priceTop).sort((a, b) => a - b), [99, 100, 109]);
  assert.deepEqual(
    { high: wick.priceTop, low: wick.priceBottom, width: wick.lineWidth },
    { high: 109, low: 99, width: 1 },
  );
  assert.equal(labels.length, 4);
  assert.deepEqual(labels.map((item) => item.label).sort(), ["100", "106", "109", "99"]);
  assert.equal(table.length, 3);
  assert.ok(table.every((item) => item.screenHorizontal === "right"));
  assert.ok(table.every((item) => item.screenVertical === "middle"));
  assert.deepEqual(table.map((item) => item.screenRow), [0, 1, 2]);
  assert.ok(infoLabels.some((label) => /4H CANDLE PO3°/.test(label)));
  assert.ok(infoLabels.some((label) => /Range: 10 USD/.test(label)));
  assert.ok(infoLabels.some((label) => /Closes: 8:00 AM/.test(label)));
});

test("NY Midnight daily mode begins with the first New York calendar-day bar", () => {
  const beforeMidnight = Date.parse("2026-07-30T03:59:00Z") / 1000;
  const midnight = Date.parse("2026-07-30T04:00:00Z") / 1000;
  const chartBars = [
    bar(beforeMidnight, 90, 95, 89, 94),
    bar(midnight, 100, 104, 98, 103),
    bar(midnight + 60, 103, 110, 101, 108),
  ];
  const instance = HtfPowerOfThreeIndicator.createInstance(0);
  instance.inputs = {
    ...instance.inputs,
    htfTimeframe: "D",
    useNyMidnight: true,
  };

  const items = HtfPowerOfThreeIndicator.computeOverlay(
    chartBars,
    chartBars,
    instance,
    context(chartBars),
  );
  const openLine = items.find((item) => item.kind === "line" && item.priceTop === 100);
  const body = items.find((item) => item.fillColor === "#4caf50");

  assert.equal(openLine.timeStart, midnight);
  assert.equal(body.priceBottom, 100);
  assert.equal(body.priceTop, 108);
});

test("HTF Power of Three maps info-table inputs to fixed pane anchors", () => {
  const chartBars = [bar(14400, 100, 109, 99, 106)];
  const instance = HtfPowerOfThreeIndicator.createInstance(0);
  instance.inputs = {
    ...instance.inputs,
    infoHorizontal: "left",
    infoVertical: "bottom",
  };

  const table = HtfPowerOfThreeIndicator.computeOverlay(
    chartBars,
    chartBars,
    instance,
    context(chartBars),
  ).filter((item) => item.kind === "screen-box");

  assert.equal(table.length, 3);
  assert.ok(table.every((item) => item.screenHorizontal === "left"));
  assert.ok(table.every((item) => item.screenVertical === "bottom"));
  assert.ok(table.every((item) => item.screenWidth === 94));
  assert.ok(table.every((item) => item.screenHeight === 20));
});

test("HTF Power of Three supports countdown and hidden close-time rows", () => {
  const chartBars = [bar(14400, 100, 109, 99, 106)];
  const instance = HtfPowerOfThreeIndicator.createInstance(0);
  instance.inputs = { ...instance.inputs, closeTimeMode: "countdown" };

  const countdownTable = HtfPowerOfThreeIndicator.computeOverlay(
    chartBars,
    chartBars,
    instance,
    context(chartBars),
  ).filter((item) => item.kind === "screen-box");
  assert.equal(countdownTable.length, 3);
  assert.equal(countdownTable[2].countdownTo, 28800);
  assert.equal(formatCountdownLabel(28800, 22500), "Closes in: 1:45:00");

  instance.inputs.closeTimeMode = "off";
  const hiddenTable = HtfPowerOfThreeIndicator.computeOverlay(
    chartBars,
    chartBars,
    instance,
    context(chartBars),
  ).filter((item) => item.kind === "screen-box");
  assert.equal(hiddenTable.length, 2);
});

test("HTF Power of Three aligns intraday buckets to the exchange session", () => {
  const beforeSession = Date.parse("2026-07-30T20:00:00Z") / 1000;
  const sessionOpen = Date.parse("2026-07-30T22:00:00Z") / 1000;
  const chartBars = [
    bar(beforeSession, 90, 150, 80, 140),
    bar(sessionOpen, 100, 110, 98, 105),
    bar(sessionOpen + 60, 105, 115, 101, 112),
  ];
  const previousHtf = bar(Date.parse("2026-07-30T18:00:00Z") / 1000, 80, 160, 70, 90);
  const ctx = context(chartBars, [previousHtf]);
  ctx.symbolInfo = {
    ...ctx.symbolInfo,
    timezone: "America/Chicago",
    session: "1700-1600",
  };

  const items = HtfPowerOfThreeIndicator.computeOverlay(
    chartBars,
    chartBars,
    HtfPowerOfThreeIndicator.createInstance(0),
    ctx,
  );
  const openLine = items.find((item) => item.kind === "line" && item.priceTop === 100);
  const body = items.find((item) => item.fillColor === "#4caf50");

  assert.equal(openLine.timeStart, sessionOpen);
  assert.equal(body.priceBottom, 100);
  assert.equal(body.priceTop, 112);
});
