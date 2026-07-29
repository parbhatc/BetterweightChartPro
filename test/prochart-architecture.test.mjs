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
  });
  assert.equal(chartApi.addPane(), "pane");
  chartApi.removePane(2);
  assert.deepEqual(chartCalls, ["add", ["remove", 2]]);
});
