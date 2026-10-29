import test from "node:test";
import assert from "node:assert/strict";
import { PriceScaleModel } from "../public/vendor/prochart/scale/priceScaleModel.mjs";
import { PriceScaleApi } from "../public/vendor/prochart/scale/priceScaleApi.mjs";
import { bindEvents } from "../public/vendor/prochart/input/interactions.mjs";
import { createManualPriceScaleSync } from "../public/js/app/layout/manualScaleSync.js";
import { mountPriceAxisWheel } from "../public/js/chart/view/priceAxisWheel.js";

// ProChart emits gestures from a root nested inside the application container.
// Retain that event boundary here: wiring the controller directly to the input
// root would miss failures to publish or bubble the app's axis-wheel events.
class ChartElement extends EventTarget {
  constructor(parent = null) {
    super();
    this.parent = parent;
  }

  dispatchEvent(event) {
    const result = super.dispatchEvent(event);
    if (event.bubbles && !event.cancelBubble) this.parent?.dispatchEvent(event);
    return result && !event.defaultPrevented;
  }

  getBoundingClientRect() {
    return { left: 100, top: 50, width: 800, height: 428 };
  }
}

function chartFixture(index, base, side = "right") {
  const el = new ChartElement();
  const root = new ChartElement(el);
  const timeZooms = [];
  root.style = {};
  const model = {
    root, width: 800, height: 428,
    _leftW: side === "left" ? 72 : 0, _rightW: side === "right" ? 72 : 0,
    options: {
      timeScale: { visible: true }, handleScroll: { pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: { price: true } }, kineticScroll: { mouse: false },
    },
    crosshair: { x: 0, y: 0, paneIndex: 0 },
    timeScale: { zoomAt(x, factor) { timeZooms.push({ x, factor }); }, scrollBy() {} },
    timeAxisHeight: () => 28, paneIndexAtY: y => y < 300 ? 0 : 1,
    _stopKinetic() {}, invalidate() {}, updateCrosshair() {}, clearCrosshair() {},
  };
  const mainPane = { height: 300 };
  const scales = new Map(["left", "right"].map(id => {
    const scale = new PriceScaleModel(model, mainPane, id);
    scale.priceRange = { min: base, max: base + (index ? 250 : 50) };
    scale.applyOptions({ visible: id === side, scaleMargins: { top: 0.08, bottom: 0.04 } });
    scale._width = 72;
    return [id, scale];
  }));
  const studyScale = new PriceScaleModel(model, { height: 100 }, side);
  studyScale.priceRange = { min: 0, max: 100 };
  model.panes = [{ ...mainPane, priceScales: scales }, { height: 100, priceScales: new Map([[side, studyScale]]) }];
  const chart = {
    priceScale: id => new PriceScaleApi(scales.get(id)),
    chartElement: () => root,
    panes: () => [{ getHeight: () => 300 }, { getHeight: () => 100 }],
  };
  const series = { priceScale: () => new PriceScaleApi(scales.get(side)) };
  const pane = { index, el, chart, series, bars: [{ time: 1, close: base }] };
  mountPriceAxisWheel({ el, chart, series });
  bindEvents(model);

  return {
    ...pane, pane, root, scales, studyScale, timeZooms,
    mainScale: scales.get(side),
    dragAxis(dy) {
      for (const [type, offset] of [["pointerdown", 0], ["pointermove", dy], ["pointerup", dy]]) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          clientX: { value: 100 + (side === "left" ? 20 : 780) }, clientY: { value: 200 + offset },
          pointerId: { value: 1 }, pointerType: { value: "mouse" },
          button: { value: 0 }, buttons: { value: type === "pointerup" ? 0 : 1 },
        });
        root.dispatchEvent(event);
      }
    },
    wheel({ deltaY = 100, deltaMode = 0, x = side === "left" ? 20 : 780, y = 150 } = {}) {
      const event = new Event("wheel", { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        clientX: { value: 100 + x }, clientY: { value: 50 + y },
        deltaX: { value: 0 }, deltaY: { value: deltaY }, deltaMode: { value: deltaMode },
      });
      root.dispatchEvent(event);
      return event;
    },
  };
}

function layoutFixture({ linked = true, side = "right" } = {}) {
  const charts = [chartFixture(0, 20_000, side), chartFixture(1, 5_000, side)];
  const settings = { scales: { autoScale: true, scalesPlacement: side } };
  const writes = [];
  let viewportChanges = 0;
  const sync = createManualPriceScaleSync({
    settingsStore: {
      get: () => settings,
      set(section, key, value) { settings[section][key] = value; writes.push({ section, key, value }); },
    },
    getPanes: () => charts.map(chart => chart.pane),
    isPanning: () => false,
    isLinked: () => linked,
    onViewportChange: () => viewportChanges++,
  });
  const gestures = [];
  for (const chart of charts) {
    chart.el.addEventListener("prochart-price-scale-manual", sync.handleManualScale);
    chart.el.addEventListener("prochart-price-axis-scale", event => {
      gestures.push({ source: chart.index, detail: event.detail });
      sync.handleAxisScale(chart.pane, event);
    });
  }
  return { charts, settings, writes, gestures, viewportChanges: () => viewportChanges };
}

function range(scale) {
  return { ...scale.priceRange };
}

function span(scale) {
  return scale.priceRange.max - scale.priceRange.min;
}

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, got ${actual}`);
}

test("axis wheel zoom reaches the parent container and synchronizes different instruments once", () => {
  const f = layoutFixture();
  const before = f.charts.map(chart => span(chart.mainScale));
  const centers = f.charts.map(chart => (chart.mainScale.priceRange.min + chart.mainScale.priceRange.max) / 2);
  const event = f.charts[0].wheel();
  const ratios = f.charts.map((chart, index) => span(chart.mainScale) / before[index]);

  assert.equal(event.defaultPrevented, true);
  assert.ok(ratios[0] > 1, "wheel down expands the visible price range");
  assertClose(ratios[1], ratios[0], "peer receives the source's relative zoom");
  for (const [index, chart] of f.charts.entries()) {
    assertClose((chart.mainScale.priceRange.min + chart.mainScale.priceRange.max) / 2, centers[index], "each instrument keeps its own center");
    assert.equal(chart.mainScale.options.autoScale, false);
    assert.deepEqual(chart.mainScale.options.scaleMargins, { top: 0.08, bottom: 0.04 });
  }
  assert.equal(f.settings.scales.autoScale, false);
  assert.equal(f.writes.length, 1, "the manual setting is persisted once");
  assert.equal(f.gestures.length, 1, "programmatic peer zoom cannot echo another gesture");
  assert.equal(f.viewportChanges(), 1);
  assert.deepEqual({ ...f.gestures[0].detail, factor: undefined }, { paneIndex: 0, zone: "right", factor: undefined });
  assertClose(f.gestures[0].detail.factor, ratios[0], "event describes the applied zoom");
});

test("a wheel on the second chart drives the first chart in the opposite direction", () => {
  const f = layoutFixture();
  const before = f.charts.map(chart => span(chart.mainScale));
  f.charts[1].wheel({ deltaY: -100 });
  const ratios = f.charts.map((chart, index) => span(chart.mainScale) / before[index]);
  assert.ok(ratios[1] < 1, "wheel up contracts the visible range");
  assertClose(ratios[0], ratios[1], "linking is bidirectional");
  assert.deepEqual(f.gestures.map(gesture => gesture.source), [1]);
});

test("engine axis drags bubble from the nested root to the same parent sync wiring", () => {
  const f = layoutFixture();
  const before = f.charts.map(chart => span(chart.mainScale));
  f.charts[0].dragAxis(30);
  const firstRatios = f.charts.map((chart, index) => span(chart.mainScale) / before[index]);
  assert.ok(firstRatios[0] > 1);
  assertClose(firstRatios[1], firstRatios[0], "source-root event reaches the peer");
  f.charts[1].dragAxis(-30);
  f.charts.forEach((chart, index) => assertClose(span(chart.mainScale), before[index], "the reverse peer drag restores both ranges"));
  assert.deepEqual(f.gestures.map(gesture => gesture.source), [0, 1]);
  assert.equal(f.viewportChanges(), 2, "each user gesture saves once, without peer echo");
});

test("disabled linking changes the source but preserves the peer's price range", () => {
  const f = layoutFixture({ linked: false });
  const before = f.charts.map(chart => range(chart.mainScale));
  f.charts[0].wheel();
  assert.notDeepEqual(range(f.charts[0].mainScale), before[0]);
  assert.deepEqual(range(f.charts[1].mainScale), before[1]);
});

test("left-axis wheel gestures use the main left scale on both charts", () => {
  const f = layoutFixture({ side: "left" });
  const before = f.charts.map(chart => span(chart.mainScale));
  const unused = f.charts.map(chart => range(chart.scales.get("right")));
  f.charts[0].wheel();
  const ratios = f.charts.map((chart, index) => span(chart.mainScale) / before[index]);
  assert.ok(ratios[0] > 1);
  assertClose(ratios[0], ratios[1], "left scale peer receives matching zoom");
  assert.equal(f.gestures[0].detail.zone, "left");
  f.charts.forEach((chart, index) => assert.deepEqual(range(chart.scales.get("right")), unused[index]));
});

test("study-axis wheel cannot change the main layout prices or publish a linked gesture", () => {
  const f = layoutFixture();
  const before = f.charts.map(chart => range(chart.mainScale));
  const studyBefore = range(f.charts[0].studyScale);
  f.charts[0].wheel({ y: 350 });
  f.charts.forEach((chart, index) => assert.deepEqual(range(chart.mainScale), before[index]));
  assert.deepEqual(range(f.charts[0].studyScale), studyBefore);
  assert.deepEqual(f.gestures, []);
  assert.deepEqual(f.writes, []);
  assert.equal(f.viewportChanges(), 0);
});

test("plot wheel remains available to the time-scale input handler", () => {
  const f = layoutFixture();
  const before = f.charts.map(chart => range(chart.mainScale));
  const event = f.charts[0].wheel({ x: 400 });
  assert.equal(event.defaultPrevented, true, "the engine still consumes its normal plot zoom");
  assert.equal(f.charts[0].timeZooms.length, 1, "plot wheel reaches the engine's time-scale handler");
  f.charts.forEach((chart, index) => assert.deepEqual(range(chart.mainScale), before[index]));
  assert.deepEqual(f.gestures, []);
  assert.deepEqual(f.writes, []);
});

test("zero-delta wheel does not zoom, change autoscale, or emit a save", () => {
  const f = layoutFixture();
  const before = f.charts.map(chart => range(chart.mainScale));
  f.charts[0].wheel({ deltaY: 0 });
  f.charts.forEach((chart, index) => assert.deepEqual(range(chart.mainScale), before[index]));
  assert.deepEqual(f.gestures, []);
  assert.deepEqual(f.writes, []);
  assert.equal(f.viewportChanges(), 0);
});

test("pixel, line, and page wheel modes apply equivalent normalized axis zoom", () => {
  const inputs = [{ deltaY: 16, deltaMode: 0 }, { deltaY: 1, deltaMode: 1 }, { deltaY: 16 / 428, deltaMode: 2 }];
  const ratios = inputs.map(input => {
    const f = layoutFixture();
    const before = span(f.charts[0].mainScale);
    f.charts[0].wheel(input);
    assert.equal(f.gestures.length, 1);
    return span(f.charts[0].mainScale) / before;
  });
  assertClose(ratios[1], ratios[0], "line delta normalizes to sixteen pixels");
  assertClose(ratios[2], ratios[0], "page delta normalizes to container height");
});
