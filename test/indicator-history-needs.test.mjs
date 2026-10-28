import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Testing indicators use the same /js imports as the browser's SDK root.
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier.startsWith("/js/")
        ? new URL(`../public${specifier}`, import.meta.url).href
        : specifier,
      context,
    );
  },
});

const { default: FvgIndicator } = await import("../testing_web/frontend/js/indicators/fvg/FvgIndicator.js");
const { default: LevelsIndicator } = await import("../testing_web/frontend/js/indicators/levels/LevelsIndicator.js");
const { initFvgEngine } = await import("../testing_web/frontend/js/indicators/fvg/init.js");
const { refreshCompareSeriesForLive } = await import("../testing_web/frontend/js/indicators/fvg/live.js");
const { collectPaneDataNeeds } = await import("../public/js/indicators/security/indicatorDataNeeds.js");

const pane = { symbol: "NQ", resolution: "1", bars: Array(1800).fill({}) };
const fvgRows = [
  { enabled: true, label: "Chart", timeframe: "chart" },
  { enabled: true, label: "15m", timeframe: "15" },
  { enabled: true, label: "1h", timeframe: "60" },
  { enabled: true, label: "4h", timeframe: "240" },
];

function instance(Indicator, inputs = {}, style = {}) {
  const value = Indicator.createInstance(0);
  value.inputs = { ...value.inputs, ...inputs };
  value.style = { ...value.style, ...style };
  return value;
}

test("Levels and FVG share one full-depth request per enabled HTF", () => {
  const levels = instance(LevelsIndicator);
  const fvg = instance(FvgIndicator, { fvgTimeframes: fvgRows });
  const classes = new Map([["levels", LevelsIndicator], ["fvg", FvgIndicator]]);
  const needs = collectPaneDataNeeds([levels, fvg, { ...fvg, id: "second-fvg" }], pane, (id) => classes.get(id));
  assert.deepEqual([...needs.htf].sort(), [["NQ|15", 320], ["NQ|240", 320], ["NQ|60", 320]]);
  assert.equal(LevelsIndicator.requiredChartBars(levels.inputs, pane.resolution), 1800);
});

test("single-timeframe FVG correlation fetches only that compare HTF", () => {
  const fvg = instance(FvgIndicator, {
    fvgTimeframes: fvgRows,
    requireCorrelatedFvg: true,
    correlatedFvgTf: "60",
  });
  const needs = FvgIndicator.collectDataNeeds(fvg, pane);
  assert.deepEqual(needs.compare[0].htf, [{ resolution: "60", countBack: 320 }]);
  assert.equal(needs.compare[0].chartCountBack, 1800);
  assert.deepEqual(needs.htf.map(({ resolution }) => resolution), ["15", "60", "240"]);
});

test("all-timeframe correlation retains each history and chart-only correlation omits compare HTFs", () => {
  for (const selected of ["all", "chart"]) {
    const fvg = instance(FvgIndicator, {
      fvgTimeframes: fvgRows,
      requireCorrelatedFvg: true,
      correlatedFvgTf: selected,
    });
    const needs = FvgIndicator.collectDataNeeds(fvg, pane);
    assert.deepEqual(needs.compare[0].htf.map(({ resolution }) => resolution), selected === "all" ? ["15", "60", "240"] : []);
  }
});

test("disabled FVG graphics do not fetch hidden primary or compare histories", () => {
  for (const fvg of [
    instance(FvgIndicator, { fvgTimeframes: fvgRows, showFvg: false, showIfvg: false, requireCorrelatedFvg: true }),
    instance(FvgIndicator, { fvgTimeframes: fvgRows, requireCorrelatedFvg: true }, { graphicBoxes: false }),
  ]) {
    assert.deepEqual(FvgIndicator.collectDataNeeds(fvg, pane), { htf: [], compare: [] });
  }
  assert.equal(FvgIndicator.requiredChartBars({ showFvg: false, showIfvg: false }, "1"), 0);
});

test("duplicate timeframe rows share history while keeping the requested lookback", () => {
  const fvg = instance(FvgIndicator, {
    fvgTimeframes: [...fvgRows, { enabled: true, label: "Same 1h", timeframe: "1h" }],
  });
  assert.equal(FvgIndicator.collectDataNeeds(fvg, pane).htf.length, 3);
  const levels = instance(LevelsIndicator, {
    timeLevels: [{ enabled: true, label: "Day", layer: "D" }, { enabled: true, label: "Same day", layer: "1D" }],
    previousDayEnabled: false,
  });
  assert.deepEqual(LevelsIndicator.collectDataNeeds(levels, pane).htf, [{ symbol: "NQ", resolution: "D", countBack: 300 }]);
});

test("previous-day hourly history keeps its depth when the pivot scan is shorter", () => {
  const levels = instance(LevelsIndicator, {
    maxBarsBack: 30,
    timeLevels: [{ enabled: true, label: "1h", layer: "60" }],
  });
  assert.deepEqual(LevelsIndicator.collectDataNeeds(levels, pane).htf, [{ symbol: "NQ", resolution: "60", countBack: 240 }]);
});

test("correlation on an inactive FVG timeframe does not request or await comparison", () => {
  const fvg = instance(FvgIndicator, {
    fvgTimeframes: [{ enabled: true, label: "15m", timeframe: "15" }],
    requireCorrelatedFvg: true,
    correlatedFvgTf: "60",
  });
  assert.deepEqual(FvgIndicator.collectDataNeeds(fvg, pane).compare, []);
  const bars = [0, 60, 120].map((time) => ({ time, open: 10, high: 11, low: 9, close: 10 }));
  let compareRequests = 0;
  const script = {
    inputs: fvg.inputs,
    style: fvg.style,
    bars,
    chartBars: bars,
    state: {},
    overlayCtx: { chartResolution: "1", requestCompareBars() { compareRequests += 1; } },
  };
  initFvgEngine(script);
  assert.equal(compareRequests, 0);
  assert.equal(script.state.loading, false);
  assert.equal(script.state.htfLayers.length, 1);
});

test("FVG initialization and live ticks only rebuild the selected comparison layer", () => {
  const fvg = instance(FvgIndicator, {
    fvgTimeframes: fvgRows,
    requireCorrelatedFvg: true,
    correlatedFvgTf: "60",
  });
  const bars = [0, 60, 120].map((time) => ({ time, open: 10, high: 11, low: 9, close: 10 }));
  const script = {
    inputs: fvg.inputs,
    style: fvg.style,
    bars,
    chartBars: bars,
    state: {},
    overlayCtx: { chartResolution: "1", getCompareBars: () => ({ utcBars: bars, chartBars: bars }) },
  };
  initFvgEngine(script);
  assert.equal(script.state.loading, false);
  assert.deepEqual([...script.state.compareSeriesByLayer.keys()], ["1h"]);
  assert.equal(refreshCompareSeriesForLive(script), true);
  assert.deepEqual([...script.state.compareSeriesByLayer.keys()], ["1h"]);
});
