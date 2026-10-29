import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { PriceScaleModel } from "../public/vendor/prochart/scale/priceScaleModel.mjs";
import { PriceScaleApi } from "../public/vendor/prochart/scale/priceScaleApi.mjs";
import { bindEvents } from "../public/vendor/prochart/input/interactions.mjs";
import { createChartSettings } from "../public/js/ui/settings/store.js";
import { createManualPriceScaleSync } from "../public/js/app/layout/manualScaleSync.js";

const engineImports = registerHooks({ resolve(specifier, context, next) {
  return specifier === "prochart"
    ? { url: new URL("../public/vendor/prochart/index.mjs", import.meta.url).href, shortCircuit: true }
    : next(specifier, context);
} });
const { restoreViewportBarLayout, restoreViewportBarLayoutFromUtc } = await import("../public/js/chart/pane/viewportBarLayout.js");
const { applySettingsToChart } = await import("../public/js/chart/settings/applier.js");
engineImports.deregister();

function frameQueue(t) {
  const frames = new Map();
  let sequence = 0;
  t.mock.method(globalThis, "requestAnimationFrame", (callback) => {
    const id = ++sequence;
    frames.set(id, callback);
    return id;
  });
  t.mock.method(globalThis, "cancelAnimationFrame", (id) => frames.delete(id));
  return () => {
    for (let turn = 0; frames.size; turn += 1) {
      assert.ok(turn < 30, "frame queue must settle");
      const batch = [...frames.values()];
      frames.clear();
      for (const callback of batch) callback(performance.now());
    }
  };
}

// A real price-scale model and native pointer binder exercise the restored
// scale's behavior, rather than just asserting the option passed by a helper.
function paneFixture(index, base, settings) {
  const bars = Array.from({ length: 100 }, (_, i) => ({
    time: 1_800_000_000 + i * 60, open: base + i, high: base + i + 2,
    low: base + i - 2, close: base + i + 1,
  }));
  const listeners = new Map();
  const root = {
    style: {},
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
    removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) ?? []).filter(fn => fn !== listener)); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) ?? []) listener(event); return true; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 528 }),
    setPointerCapture() {},
  };
  let logical = { from: 60, to: 110 };
  let renderFrame = 0;
  const chartModel = {
    root, width: 800, height: 528, _leftW: 0, _rightW: 72,
    options: {
      timeScale: { visible: true }, handleScroll: { pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: { price: true } }, kineticScroll: { mouse: false },
    },
    crosshair: { x: 0, y: 0, paneIndex: 0 },
    _clickSubs: new Set(), _crosshairParam: () => ({}),
    timeAxisHeight: () => 28, paneIndexAtY: () => 0,
    _stopKinetic() {}, updateCrosshair() {}, clearCrosshair() {},
    invalidate() {
      if (renderFrame) return;
      renderFrame = requestAnimationFrame(() => {
        renderFrame = 0;
        for (const scale of scales.values()) scale.updateAutoScale();
      });
    },
  };
  const scalePane = {
    height: 500,
    seriesFor(scale) {
      if (scale.id !== "right") return [];
      return [{ autoscaleRange: () => ({ minValue: base + 58, maxValue: base + 101 }) }];
    },
  };
  const scales = new Map(["right", "left"].map(id => [id, new PriceScaleModel(chartModel, scalePane, id)]));
  const priceScale = new PriceScaleApi(scales.get("right"));
  const timeScale = {
    options: () => ({ barSpacing: 8, rightOffset: 10 }),
    getVisibleLogicalRange: () => logical,
    setVisibleLogicalRange(next) { logical = { ...next }; chartModel.invalidate(); },
    scrollBy(delta) { logical = { from: logical.from + delta / 8, to: logical.to + delta / 8 }; chartModel.invalidate(); },
  };
  chartModel.timeScale = timeScale;
  chartModel.panes = [{ ...scalePane, priceScales: scales }];
  const chart = {
    timeScale: () => timeScale, paneSize: () => ({ width: 728, height: 500 }),
    priceScale: (id) => new PriceScaleApi(scales.get(id)),
    applyOptions(options) {
      if (options.rightPriceScale) scales.get("right").applyOptions(options.rightPriceScale);
      if (options.leftPriceScale) scales.get("left").applyOptions(options.leftPriceScale);
    },
  };
  const series = {
    priceScale: () => priceScale,
    coordinateToPrice: (y) => priceScale.coordinateToPrice(y),
    applyOptions() {},
  };
  const pane = { index, symbol: index ? "ES" : "NQ", resolution: "1", bars, chart, series };
  const dispatch = (type, x, y) => {
    for (const listener of listeners.get(type) ?? []) listener({
      type, pointerId: 1, pointerType: "mouse", button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: x, clientY: y, preventDefault() {},
    });
  };
  const layout = {
    width: 50, toBeyondAnchor: 10, resolution: "1",
    visibleFromUtc: bars[60].time, visibleToUtc: bars[99].time + 11 * 60,
    // Older saved per-pane snapshots can disagree with the shared setting.
    price: { autoScale: true, scaleMargins: { top: 0.08, bottom: 0.04 } },
  };
  return { pane, layout, scales, chartModel, dispatch, settings };
}

// Node has no browser frame globals by default.
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => {};

test("both restored panes honor shared manual mode and pan vertically before either axis is touched", (t) => {
  const flush = frameQueue(t);
  const settings = createChartSettings();
  assert.equal(settings.get().scales.autoScale, false);
  const fixtures = [paneFixture(0, 29000, settings), paneFixture(1, 7700, settings)];
  for (const fixture of fixtures) {
    restoreViewportBarLayout(fixture.pane, fixture.layout, settings, [], "layout", () => "right");
  }
  flush();
  for (const fixture of fixtures) {
    const scale = fixture.scales.get("right");
    assert.equal(scale.options.autoScale, false, `pane ${fixture.pane.index}: saved autoscale cannot override shared manual mode`);
    const centerPrice = scale.coordinateToPrice(250);
    const dispose = bindEvents(fixture.chartModel);
    t.after(dispose);
    fixture.dispatch("pointerdown", 400, 250);
    fixture.dispatch("pointermove", 430, 325);
    flush();
    assert.ok(Math.abs(scale.priceToCoordinate(centerPrice) - 325) < 1e-8, "the held pointer moves candles 1:1 vertically");
    fixture.dispatch("pointermove", 400, 250);
    fixture.dispatch("pointerup", 400, 250);
    flush();
    assert.ok(Math.abs(scale.priceToCoordinate(centerPrice) - 250) < 1e-8, "a circular return preserves the original price coordinate");
  }
});

test("UTC timeframe restores obey shared manual mode despite a stale per-pane autoscale snapshot", (t) => {
  const flush = frameQueue(t);
  const settings = createChartSettings();
  const fixture = paneFixture(1, 7700, settings);
  restoreViewportBarLayoutFromUtc(fixture.pane, fixture.layout, settings, [], "timeframe", () => "right");
  flush();
  assert.equal(fixture.scales.get("right").options.autoScale, false);
});

test("explicit shared autoscale remains enabled after restoring a previously manual pane", (t) => {
  const flush = frameQueue(t);
  const settings = createChartSettings();
  settings.set("scales", "autoScale", true);
  const fixture = paneFixture(1, 7700, settings);
  fixture.layout.price.autoScale = false;
  restoreViewportBarLayout(fixture.pane, fixture.layout, settings, [], "layout", () => "right");
  flush();
  assert.equal(fixture.scales.get("right").options.autoScale, true);
});

test("switching shared autoscale off releases the actual fitted scale without refitting its range", (t) => {
  const flush = frameQueue(t);
  const settings = createChartSettings();
  const f = paneFixture(0, 29000, settings);
  const scale = f.scales.get("right");
  const apply = () => applySettingsToChart({
    targetChart: f.pane.chart, targetSeries: f.pane.series, pane: f.pane,
    settingsStore: settings, themeColors: { bg: "#000000", text: "#ffffff" },
    symbolInfo: null, activePriceScaleId: () => "right",
  });
  settings.set("scales", "autoScale", true);
  apply();
  flush();
  const fitted = { ...scale.priceRange };
  settings.set("scales", "autoScale", false);
  apply();
  flush();
  assert.equal(scale.options.autoScale, false);
  assert.deepEqual(scale.priceRange, fitted);
});

test("a deliberate vertical plot drag unlocks autoscale once and preserves every pointer pixel", (t) => {
  const flush = frameQueue(t);
  const f = paneFixture(0, 29000, createChartSettings());
  const scale = f.scales.get("right");
  scale.updateAutoScale();
  const overlay = new PriceScaleModel(f.chartModel, { height: 500, seriesFor: () => [] }, "study");
  overlay.priceRange = { min: 0, max: 100 };
  f.scales.set("study", overlay);
  const centerPrice = scale.coordinateToPrice(250);
  const manualEvents = [];
  f.chartModel.root.addEventListener("prochart-price-scale-manual", event => manualEvents.push(event.detail));
  t.after(bindEvents(f.chartModel));
  f.dispatch("pointerdown", 400, 250);
  f.dispatch("pointermove", 420, 252);
  flush();
  assert.equal(scale.options.autoScale, true, "horizontal drags with slight pointer noise preserve autoscale");
  assert.deepEqual(manualEvents, []);
  f.dispatch("pointermove", 430, 257);
  flush();
  assert.equal(scale.options.autoScale, false);
  assert.ok(Math.abs(scale.priceToCoordinate(centerPrice) - 257) < 1e-8, "include the pre-threshold vertical distance");
  f.dispatch("pointermove", 445, 300);
  flush();
  assert.ok(Math.abs(scale.priceToCoordinate(centerPrice) - 300) < 1e-8);
  assert.equal(overlay.options.autoScale, true, "indicator overlay scales retain their own autoscaling");
  assert.deepEqual(manualEvents, [{ paneIndex: 0, zone: "plot" }]);
  f.dispatch("pointerup", 445, 300);
});

test("a price-axis drag publishes the same manual-mode transition for linked panes", (t) => {
  const flush = frameQueue(t);
  const f = paneFixture(0, 29000, createChartSettings());
  const scale = f.scales.get("right");
  scale.updateAutoScale();
  const events = [];
  f.chartModel.root.addEventListener("prochart-price-scale-manual", event => events.push(event.detail));
  t.after(bindEvents(f.chartModel));
  f.dispatch("pointerdown", 780, 250);
  f.dispatch("pointermove", 780, 275);
  f.dispatch("pointermove", 780, 300);
  f.dispatch("pointerup", 780, 300);
  flush();
  assert.equal(scale.options.autoScale, false);
  assert.deepEqual(events, [{ paneIndex: 0, zone: "right" }]);
});

test("linked price-axis drags apply the same zoom factor to every chart", (t) => {
  const flush = frameQueue(t);
  const settings = createChartSettings();
  settings.set("scales", "autoScale", true);
  const fixtures = [paneFixture(0, 29000, settings), paneFixture(1, 7700, settings)];
  let saves = 0;
  const sync = createManualPriceScaleSync({
    settingsStore: settings,
    getPanes: () => fixtures.map(fixture => fixture.pane),
    isPanning: () => true,
    isLinked: () => true,
    onViewportChange: () => saves++,
  });
  for (const fixture of fixtures) {
    fixture.scales.get("right").updateAutoScale();
    fixture.chartModel.root.addEventListener("prochart-price-scale-manual", sync.handleManualScale);
    fixture.chartModel.root.addEventListener("prochart-price-axis-scale", event => sync.handleAxisScale(fixture.pane, event));
    t.after(bindEvents(fixture.chartModel));
  }
  const before = fixtures.map(fixture => {
    const range = fixture.scales.get("right").priceRange;
    return range.max - range.min;
  });

  fixtures[0].dispatch("pointerdown", 780, 250);
  fixtures[0].dispatch("pointermove", 780, 290);
  fixtures[0].dispatch("pointerup", 780, 290);
  flush();

  const ratios = fixtures.map((fixture, index) => {
    const range = fixture.scales.get("right").priceRange;
    return (range.max - range.min) / before[index];
  });
  assert.ok(Math.abs(ratios[0] - ratios[1]) < 1e-10, `expected matching zoom factors, got ${ratios}`);
  assert.ok(ratios[0] > 1, "dragging down expands both visible price ranges");
  assert.equal(saves, 1);
});

test("unlinked price-axis drags leave peer zoom unchanged", (t) => {
  const settings = createChartSettings();
  const fixtures = [paneFixture(0, 29000, settings), paneFixture(1, 7700, settings)];
  const sync = createManualPriceScaleSync({
    settingsStore: settings,
    getPanes: () => fixtures.map(fixture => fixture.pane),
    isPanning: () => true,
    isLinked: () => false,
  });
  for (const fixture of fixtures) {
    fixture.scales.get("right").updateAutoScale();
    fixture.chartModel.root.addEventListener("prochart-price-scale-manual", sync.handleManualScale);
    fixture.chartModel.root.addEventListener("prochart-price-axis-scale", event => sync.handleAxisScale(fixture.pane, event));
    t.after(bindEvents(fixture.chartModel));
  }
  const peerBefore = { ...fixtures[1].scales.get("right").priceRange };
  fixtures[0].dispatch("pointerdown", 780, 250);
  fixtures[0].dispatch("pointermove", 780, 290);
  fixtures[0].dispatch("pointerup", 780, 290);
  assert.deepEqual(fixtures[1].scales.get("right").priceRange, peerBefore);
});

test("disabled mouse panning cannot unlock autoscale or publish a manual transition", (t) => {
  const flush = frameQueue(t);
  const f = paneFixture(0, 29000, createChartSettings());
  const scale = f.scales.get("right");
  scale.updateAutoScale();
  const before = { ...scale.priceRange };
  f.chartModel.options.handleScroll.pressedMouseMove = false;
  let events = 0;
  f.chartModel.root.addEventListener("prochart-price-scale-manual", () => events++);
  t.after(bindEvents(f.chartModel));
  f.dispatch("pointerdown", 400, 250);
  f.dispatch("pointermove", 430, 325);
  f.dispatch("pointerup", 430, 325);
  flush();
  assert.equal(scale.options.autoScale, true);
  assert.deepEqual(scale.priceRange, before);
  assert.equal(events, 0);
});

test("native circular pans move both layout charts in the same frame and work from either chart", (t) => {
  const flush = frameQueue(t);
  const settings = createChartSettings();
  settings.set("scales", "autoScale", true);
  const fixtures = [paneFixture(0, 29000, settings), paneFixture(1, 7700, settings)];
  let panning = true;
  let saves = 0;
  let linked = true;
  const sync = createManualPriceScaleSync({
    settingsStore: settings, getPanes: () => fixtures.map(f => f.pane),
    isPanning: () => panning, isLinked: () => linked, onViewportChange: () => saves++,
  });
  for (const f of fixtures) {
    f.scales.get("right").updateAutoScale();
    f.chartModel.root.addEventListener("prochart-price-scale-manual", sync.handleManualScale);
    f.chartModel.root.addEventListener("prochart-plot-pan", event => sync.handlePlotPan(f.pane, event));
    t.after(bindEvents(f.chartModel));
  }
  // Different instrument spans and pane heights still move by screen pixels.
  fixtures[1].chartModel.panes[0].height = 350;
  fixtures[1].scales.get("right").pane.height = 350;
  fixtures[1].scales.get("right").priceRange = { min: 7700, max: 7900 };
  const prices = fixtures.map(f => f.scales.get("right").coordinateToPrice(250));
  const assertDisplacement = delta => fixtures.forEach((f, index) => {
    const y = f.scales.get("right").priceToCoordinate(prices[index]);
    assert.ok(Math.abs(y - (250 + delta)) < 1e-7, `pane ${index}: expected shared displacement ${delta}, got ${y - 250}`);
  });

  fixtures[0].dispatch("pointerdown", 400, 250);
  fixtures[0].dispatch("pointermove", 420, 252);
  flush();
  assertDisplacement(0);
  assert.equal(saves, 0);
  // More than one mouse sample shares one native animation-frame update.
  fixtures[0].dispatch("pointermove", 430, 260);
  fixtures[0].dispatch("pointermove", 440, 280);
  assertDisplacement(0);
  flush();
  assertDisplacement(30);
  assert.equal(saves, 1, "one viewport save notification, with no peer echo");
  fixtures[0].dispatch("pointermove", 400, 250);
  fixtures[0].dispatch("pointerup", 400, 250); // flush queued final movement before release
  flush();
  assertDisplacement(0);
  panning = false;
  sync.flushPending();
  assert.equal(settings.get().scales.autoScale, false);

  panning = true;
  fixtures[1].dispatch("pointerdown", 400, 250);
  fixtures[1].dispatch("pointermove", 430, 290);
  flush();
  assertDisplacement(40);
  fixtures[1].dispatch("pointermove", 400, 250);
  fixtures[1].dispatch("pointerup", 400, 250);
  flush();
  assertDisplacement(0);
  const settledSaves = saves;
  fixtures[1].dispatch("pointerdown", 400, 250);
  fixtures[1].dispatch("pointermove", 400, 250);
  flush();
  fixtures[1].dispatch("pointerup", 400, 250);
  assert.equal(saves, settledSaves, "stationary frames never emit a viewport save");

  linked = false;
  fixtures[0].dispatch("pointerdown", 400, 250);
  fixtures[0].dispatch("pointermove", 400, 280);
  flush();
  assert.ok(Math.abs(fixtures[0].scales.get("right").priceToCoordinate(prices[0]) - 280) < 1e-7);
  assert.ok(Math.abs(fixtures[1].scales.get("right").priceToCoordinate(prices[1]) - 250) < 1e-7, "disabling linked dates keeps peer panning independent");
  fixtures[0].dispatch("pointerup", 400, 280);
});
