import test from "node:test";
import assert from "node:assert/strict";

import { ChartApi } from "../public/vendor/prochart/api/chartApi.mjs";
import { normalizeSeriesOptions as normalizeFromBarrel } from "../public/vendor/prochart/data/series.mjs";
import { SeriesApi } from "../public/vendor/prochart/data/seriesApi.mjs";
import { normalizeSeriesOptions } from "../public/vendor/prochart/data/seriesOptions.mjs";
import { PaneApi } from "../public/vendor/prochart/layout/paneApi.mjs";
import * as renderer from "../public/vendor/prochart/render/renderer.mjs";
import * as axisRenderer from "../public/vendor/prochart/render/sub/axisRenderer.mjs";
import * as seriesRenderer from "../public/vendor/prochart/render/sub/seriesRenderer.mjs";
import { PriceScaleModel } from "../public/vendor/prochart/scale/priceScaleModel.mjs";
import { contrastTextColor } from "../public/vendor/prochart/core/utils.mjs";
import { TimeScaleApi } from "../public/vendor/prochart/scale/timeScaleApi.mjs";

test("series option normalization is isolated and remains available from the barrel", () => {
  const options = {
    borderColor: "#111111",
    wickColor: "#222222",
  };
  const normalized = normalizeSeriesOptions(options);

  assert.equal(normalizeFromBarrel, normalizeSeriesOptions);
  assert.deepEqual(normalized, {
    borderColor: "#111111",
    borderUpColor: "#111111",
    borderDownColor: "#111111",
    wickColor: "#222222",
    wickUpColor: "#222222",
    wickDownColor: "#222222",
  });
  assert.deepEqual(options, {
    borderColor: "#111111",
    wickColor: "#222222",
  });
});

test("renderer orchestrator preserves legacy utility exports", () => {
  assert.equal(renderer.renderSeries2d, seriesRenderer.renderSeries2d);
  assert.equal(
    renderer.seriesLastValueColor,
    seriesRenderer.seriesLastValueColor,
  );
  assert.equal(
    renderer.usesCustomOhlcRenderer,
    seriesRenderer.usesCustomOhlcRenderer,
  );
  assert.equal(renderer.layoutAxisLabels, axisRenderer.layoutAxisLabels);
  assert.equal(renderer.tickDate, axisRenderer.tickDate);
  assert.equal(renderer.timeTicks, axisRenderer.timeTicks);
});

test("price scale classifies every fifth mark as a bold major price", () => {
  const chart = {
    options: {
      layout: { fontSize: 12, fontFamily: "sans-serif" },
      localization: {},
    },
    invalidate() {},
  };
  const pane = { height: 500, seriesFor: () => [] };
  const scale = new PriceScaleModel(chart, pane, "right", {
    scaleMargins: { top: 0, bottom: 0 },
  });
  scale.priceRange = { min: 0, max: 100 };

  const ticks = scale.ticks();
  assert.equal(ticks.find((tick) => tick.price === 50)?.major, true);
  assert.equal(ticks.find((tick) => tick.price === 40)?.major, false);
});

test("price scale retains TradingView-style half steps on a futures range", () => {
  const chart = {
    options: {
      layout: { fontSize: 12, fontFamily: "sans-serif" },
      localization: {},
    },
    invalidate() {},
  };
  const pane = { height: 612, seriesFor: () => [] };
  const scale = new PriceScaleModel(chart, pane, "right", {
    scaleMargins: { top: 0, bottom: 0 },
  });
  scale.priceRange = { min: 28000, max: 28800 };

  const prices = scale.ticks().map((tick) => tick.price);
  assert.ok(prices.includes(28550));
  assert.ok(prices.includes(28600));
});

test("price-axis chips use dark text only for pale label colors", () => {
  assert.equal(contrastTextColor("#b2b5be"), "#131722");
  assert.equal(contrastTextColor("#434651"), "#ffffff");
  assert.equal(contrastTextColor("#376b89"), "#ffffff");
});

test("candlestick renderer outlines bullish and bearish bodies", () => {
  const rects = [];
  const fillStyles = [];
  const context = {
    beginPath() {},
    moveTo() {},
    lineTo() {},
    fill() {},
    stroke() {},
    fillRect() {},
    rect(...args) { rects.push(args); },
  };
  Object.defineProperty(context, "fillStyle", {
    set(value) { fillStyles.push(value); },
  });
  const series = {
    type: "Candlestick",
    whitespace: [false, false],
    packed: new Float64Array([10, 12, 8, 11, 11, 12, 9, 10]),
    indices: [0, 1],
    options: {
      upColor: "#b2b5be",
      downColor: "#434651",
      wickUpColor: "#000000",
      wickDownColor: "#000000",
      borderVisible: true,
      borderUpColor: "#000000",
      borderDownColor: "#000000",
    },
    visibleLocalRange: () => ({ a: 0, b: 1 }),
  };
  const model = {
    dpr: 1.25,
    timeScale: {
      barSpacing: 8,
      visibleLogicalRange: () => ({ from: 0, to: 2 }),
    },
  };
  const pane = {
    scale: () => ({
      priceRange: { min: 0, max: 20 },
      priceToCoordinate: (price) => 100 - price * 5,
    }),
  };

  seriesRenderer.renderSeries2d(model, context, pane, series, 100);

  assert.ok(fillStyles.includes("#000000"));
  assert.ok(rects.length > 2);
  assert.ok(rects.flat().every((value) => Math.abs(value * 1.25 - Math.round(value * 1.25)) < 1e-9));
});

test("TimeScaleApi delegates range and navigation calculations to its model", () => {
  const calls = [];
  const model = {
    options: {},
    times: [1],
    rightOffset: 4,
    barSpacing: 6,
    _defaultRightOffset: 2,
    visibleLogicalRange: () => ({ from: 1, to: 2 }),
    visibleTimeRange: () => ({ from: 10, to: 20 }),
    setVisibleLogicalRange: (range) => calls.push(["logical", range]),
    setVisibleTimeRange: (range) => calls.push(["time", range]),
    scrollToPosition: (position) => calls.push(["scroll", position]),
    reset: () => calls.push(["reset"]),
    fitContent: () => calls.push(["fit"]),
    _rangeSubs: new Set(),
    _timeRangeSubs: new Set(),
  };
  const chart = {
    paneWidth: () => 800,
    timeAxisHeight: () => 28,
    _sizeSubs: new Set(),
  };
  const api = new TimeScaleApi(model, chart);

  api.setVisibleRange({ from: 10, to: 20 });
  api.scrollToPosition(7, true);
  api.scrollToRealTime();
  api.resetTimeScale();
  api.fitContent();

  assert.deepEqual(calls, [
    ["time", { from: 10, to: 20 }],
    ["scroll", 7],
    ["scroll", 2],
    ["reset"],
    ["fit"],
  ]);
  assert.equal(api.width(), 800);
  assert.equal(api.height(), 28);
  assert.equal(api.barSpacing(), 6);
});

test("series, pane, and chart facades delegate domain behavior", () => {
  const rangeResult = { from: 1, to: 2 };
  const seriesModel = {
    barsInLogicalRange: () => rangeResult,
    attachPrimitive: (primitive, api) => {
      assert.equal(primitive.id, "primitive");
      assert.ok(api instanceof SeriesApi);
    },
    detachPrimitive: (primitive) => {
      assert.equal(primitive.id, "primitive");
    },
  };
  const seriesApi = new SeriesApi(seriesModel, {});
  const primitive = { id: "primitive" };
  assert.equal(seriesApi.barsInLogicalRange({ from: 1, to: 2 }), rangeResult);
  seriesApi.attachPrimitive(primitive);
  seriesApi.detachPrimitive(primitive);

  const heightCalls = [];
  const paneApi = new PaneApi({
    panes: [{
      height: 120,
      series: [],
      setRequestedHeight: (height) => heightCalls.push(height),
    }],
  }, 0);
  paneApi.setHeight(240);
  assert.equal(paneApi.getHeight(), 120);
  assert.deepEqual(heightCalls, [240]);

  const chartCalls = [];
  const chartApi = new ChartApi({
    addPane: () => {
      chartCalls.push("add");
      return "pane";
    },
    removePane: (index) => chartCalls.push(["remove", index]),
    updateCrosshair: (x, y) => chartCalls.push(["crosshair", x, y]),
    isPointInPlot: (x, y) => x < 700 && y < 500,
  });
  assert.equal(chartApi.addPane(), "pane");
  chartApi.removePane(2);
  chartApi.setCrosshairPositionAtCoordinate(140, 260);
  assert.equal(chartApi.isPointInPlot(650, 450), true);
  assert.equal(chartApi.isPointInPlot(750, 450), false);
  assert.deepEqual(chartCalls, ["add", ["remove", 2], ["crosshair", 140, 260]]);
});
