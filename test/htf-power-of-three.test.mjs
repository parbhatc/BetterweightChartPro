import test from "node:test";
import assert from "node:assert/strict";

import HtfPowerOfThreeIndicator from "../public/js/indicators/definitions/htfPowerOfThree/HtfPowerOfThreeIndicator.js";
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
  const infoLabels = items.filter((item) => item.showLabel).map((item) => item.label);

  assert.ok(body);
  assert.equal(body.priceTop, 106);
  assert.equal(body.priceBottom, 100);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((item) => item.priceTop).sort((a, b) => a - b), [99, 100, 109]);
  assert.equal(labels.length, 4);
  assert.ok(infoLabels.some((label) => /4H CANDLE PO3°/.test(label)));
  assert.ok(infoLabels.some((label) => /Range: 10\.00 USD/.test(label)));
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
