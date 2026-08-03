import test from "node:test";
import assert from "node:assert/strict";

import { defineIndicator } from "../public/js/indicators/defineIndicator.js";
import { registerIndicatorDefinition, getIndicatorClass } from "../public/js/indicators/catalog.js";
import { runIncrementalOverlay } from "../public/js/indicators/script/incrementalOverlay.js";

const bars = [
  { time: 60, open: 10, high: 12, low: 9, close: 11 },
  { time: 120, open: 11, high: 14, low: 10, close: 13 },
  { time: 180, open: 15, high: 17, low: 13, close: 16 },
  { time: 240, open: 12, high: 13, low: 10, close: 11 },
  { time: 300, open: 8, high: 8.5, low: 7, close: 7.5 },
];

test("one-file drawing scripts preserve session-gap-safe three-bar detection", () => {
  const Indicator = defineIndicator({
    id: "test_three_bar_zones",
    title: "Three bar zones",
    overlayPrimitive: "boxes",
    init() {
      this.state.seconds = this.bars[1].time - this.bars[0].time;
    },
    onBar(bar, index) {
      if (index < 2) return;
      const first = this.bars[index - 2];
      const middle = this.bars[index - 1];
      if (middle.time - first.time > this.state.seconds || bar.time - middle.time > this.state.seconds) return;
      if (bar.low > first.high) {
        this.drawBox({ timeStart: first.time, priceTop: bar.low, priceBottom: first.high, label: "Up zone" });
      } else if (bar.high < first.low) {
        this.drawBox({ timeStart: first.time, priceTop: first.low, priceBottom: bar.high, label: "Down zone" });
      }
    },
  });
  const instance = Indicator.createInstance(0);
  const boxes = Indicator.computeOverlay(bars, bars, instance);
  assert.deepEqual(
    boxes.map(({ timeStart, priceTop, priceBottom, label }) => ({ timeStart, priceTop, priceBottom, label })),
    [
      { timeStart: 60, priceTop: 13, priceBottom: 12, label: "Up zone" },
      { timeStart: 180, priceTop: 13, priceBottom: 8.5, label: "Down zone" },
    ],
  );
});

test("compact advanced definitions receive HTF, loading, schema, and table hooks", () => {
  const definition = {
    id: "test_advanced_hooks",
    title: "Advanced hooks",
    overlayPrimitive: "lines",
    inputSchema: (inputs, resolution) => [{ id: "tf", type: "text", title: resolution, defval: inputs.tf }],
    requiredChartBars: () => 750,
    collectDataNeeds: (_instance, pane) => ({ htf: [{ symbol: pane.symbol, resolution: "60", countBack: 200 }] }),
    overlayPending: (_instance, ctx) => ctx.loading === true,
    overlayRecomputeExtra: (_instance, ctx) => `htf:${ctx.revision}`,
    needsLiveOverlayRefresh: () => false,
    chartTables: () => [{ id: "summary", rows: [] }],
    overlay: () => [],
  };
  const Indicator = registerIndicatorDefinition(definition);
  const instance = Indicator.createInstance(0);
  assert.equal(getIndicatorClass(definition.id), Indicator);
  assert.equal(Indicator.requiredChartBars({}, "5"), 750);
  assert.equal(Indicator.inputSchema({ tf: "60" }, "5")[0].title, "5");
  assert.deepEqual(Indicator.collectDataNeeds(instance, { symbol: "NQ" }).htf[0], {
    symbol: "NQ", resolution: "60", countBack: 200,
  });
  assert.equal(Indicator.overlayPending(instance, { loading: true }), true);
  assert.equal(Indicator.overlayRecomputeExtra(instance, { revision: 3 }), "htf:3");
  assert.equal(Indicator.needsLiveOverlayRefresh(instance), false);
  assert.equal(Indicator.chartTables(instance)[0].id, "summary");
});

test("shared incremental overlays select full, data, append, and live work", () => {
  const instance = {};
  const calls = [];
  const run = (chartBars, keys) => runIncrementalOverlay({
    chartBars,
    instance,
    keys,
    full: () => { calls.push("full"); return { output: ["full"], snapshot: { ok: true } }; },
    patchData: () => { calls.push("data"); return { output: ["data"] }; },
    patchAppend: () => { calls.push("append"); return { output: ["append"] }; },
    patchLive: () => { calls.push("live"); return { output: ["live"] }; },
  });
  const bars = [{ time: 1 }, { time: 2 }];
  assert.deepEqual(run(bars, { chart: "a", data: "1", live: "x" }), ["full"]);
  assert.deepEqual(run(bars, { chart: "a", data: "1", live: "x" }), ["full"]);
  assert.deepEqual(run(bars, { chart: "a", data: "2", live: "x" }), ["data"]);
  assert.deepEqual(run([...bars, { time: 3 }], { chart: "b", data: "2", live: "x" }), ["append"]);
  assert.deepEqual(run([...bars, { time: 3 }], { chart: "b", data: "2", live: "y" }), ["live"]);
  assert.deepEqual(calls, ["full", "data", "append", "live"]);
});
