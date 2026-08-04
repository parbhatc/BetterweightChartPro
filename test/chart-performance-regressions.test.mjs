import test from "node:test";
import assert from "node:assert/strict";

import {
  chartDebugCount,
  clearChartDebugStats,
  configureChartDebug,
  createPanFpsMonitor,
  getChartDebugStats,
} from "../public/js/debug/chart/index.js";
import {
  barAtTime,
  barIndexAtTime,
  nearestBarIndex,
} from "../public/js/chart/pane/hoverBar.js";
import { formatDisplayPrice } from "../public/js/chart/format.js";
import { renderStatusLine } from "../public/js/chart/status/line.js";
import { formatAxisTimeTick } from "../public/js/chart/time/labelFormat.js";
import { attachPriceLineLabelPrimitive } from "../public/js/primitives/priceLineLabel/index.js";
import { ChartModel } from "../public/vendor/prochart/api/chartModel.mjs";
import { SeriesModel } from "../public/vendor/prochart/data/seriesModel.mjs";
import { bindEvents } from "../public/vendor/prochart/input/interactions.mjs";
import { RenderFrameTickCache } from "../public/vendor/prochart/render/frameTickCache.mjs";
import { renderChart } from "../public/vendor/prochart/render/renderer.mjs";
import {
  createPanePrimitiveViewGroups,
  renderPaneBottomOverlays,
  renderPaneSeriesOverlays,
  renderPaneTopCanvasOverlays,
  renderTop as renderCrosshairTop,
} from "../public/vendor/prochart/render/sub/overlayRenderer.mjs";
import { PriceScaleMode } from "../public/vendor/prochart/core/enums.mjs";
import { PriceScaleModel } from "../public/vendor/prochart/scale/priceScaleModel.mjs";
import { createPointerHandlers } from "../public/js/drawings/controller/pointer/handlers.js";

test("overlay passes reuse one primitive pane-view classification per frame", () => {
  let paneViewCalls = 0;
  let zOrderCalls = 0;
  let drawCalls = 0;
  const views = ["bottom", "normal", "top"].map((zone) => ({
    zOrder() {
      zOrderCalls += 1;
      return zone;
    },
    renderer() {
      return {
        draw() {
          drawCalls += 1;
        },
      };
    },
  }));
  const pane = {
    top: 0,
    height: 100,
    series: [{
      options: { visible: false },
      overlays: [{
        paneViews() {
          paneViewCalls += 1;
          return views;
        },
      }],
    }],
  };
  const model = { _frameId: 1 };
  const context = new Proxy(
    {},
    {
      get() {
        return () => {};
      },
    },
  );

  const groups = createPanePrimitiveViewGroups(model, pane);
  renderPaneBottomOverlays(model, context, pane, 0, 200, 1, groups);
  renderPaneSeriesOverlays(model, context, pane, 0, 200, 1, groups);

  assert.equal(paneViewCalls, 1);
  assert.equal(zOrderCalls, 3);
  assert.equal(drawCalls, 3);
});

test("top-canvas primitives bypass the main chart overlay pass", () => {
  let drawCalls = 0;
  const pane = {
    top: 0,
    height: 100,
    series: [{
      options: { visible: false },
      overlays: [{
        paneViews() {
          return [{
            zOrder: () => "top",
            useTopCanvas: true,
            renderer() {
              return {
                draw() {
                  drawCalls += 1;
                },
              };
            },
          }];
        },
      }],
    }],
  };
  const model = { _frameId: 1 };
  const context = new Proxy(
    {},
    {
      get() {
        return () => {};
      },
    },
  );

  const groups = createPanePrimitiveViewGroups(model, pane);
  renderPaneSeriesOverlays(model, context, pane, 0, 200, 1, groups);
  assert.equal(drawCalls, 0);

  renderPaneTopCanvasOverlays(model, context, pane, 0, 200, 1, groups);
  assert.equal(drawCalls, 1);
});

test("top-canvas primitive attachment never invalidates the full chart", () => {
  let fullInvalidations = 0;
  let topInvalidations = 0;
  const chart = {
    api: {},
    options: { localization: {} },
    invalidate() {
      fullInvalidations += 1;
    },
    invalidateCrosshairOnly() {
      topInvalidations += 1;
    },
  };
  const series = new SeriesModel(chart, "Line", {}, 0);
  const primitive = {
    useTopCanvas: true,
    attached() {},
    detached() {},
  };

  series.attachPrimitive(primitive, {});
  series.detachPrimitive(primitive);

  assert.equal(topInvalidations, 2);
  assert.equal(fullInvalidations, 0);
});

test("orderline debug does not activate unrelated pan instrumentation", () => {
  configureChartDebug({ force: true, tags: "orderline" });
  clearChartDebugStats();

  chartDebugCount("crosshair", "move");
  chartDebugCount("perf", "visibleRange");

  let scheduledFrames = 0;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => {
    scheduledFrames += 1;
    return scheduledFrames;
  };
  try {
    const monitor = createPanFpsMonitor();
    monitor.start("pan");
    assert.deepEqual(monitor.activeModes(), []);
    assert.equal(scheduledFrames, 0);
    assert.deepEqual(getChartDebugStats().counters, {});
  } finally {
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    configureChartDebug({ force: false, tags: "" });
    clearChartDebugStats();
  }
});

test("sorted hover-bar lookup is exact and preserves nearest tie behavior", () => {
  const bars = [
    { time: 10, close: 1 },
    { time: 20, close: 2 },
    { time: 30, close: 3 },
    { time: 40, close: 4 },
  ];

  assert.equal(barIndexAtTime(bars, 30), 2);
  assert.equal(barIndexAtTime(bars, 31), -1);
  assert.equal(barAtTime(bars, 20), bars[1]);
  assert.equal(barAtTime(bars, 21), undefined);
  assert.equal(nearestBarIndex(bars, 5), 0);
  assert.equal(nearestBarIndex(bars, 15), 0);
  assert.equal(nearestBarIndex(bars, 16), 1);
  assert.equal(nearestBarIndex(bars, 50), 3);
});

test("cached locale formatters preserve existing price and time output", () => {
  for (const precision of [0, 2, "4"]) {
    const normalized = Math.max(0, Number(precision) || 0);
    const expected = Number(-12345.6789).toLocaleString(undefined, {
      minimumFractionDigits: normalized,
      maximumFractionDigits: normalized,
    });
    assert.equal(
      formatDisplayPrice(-12345.6789, precision),
      expected,
    );
  }

  const date = new Date("2026-03-08T07:05:06.000Z");
  for (const timeZone of ["Etc/UTC", "America/New_York"]) {
    for (const hour12 of [true, false]) {
      for (const withSeconds of [true, false]) {
        const options = {
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
          second: withSeconds ? "2-digit" : undefined,
          hour12,
        };
        const formatter = new Intl.DateTimeFormat("en-US", options);
        const expected = hour12
          ? (() => {
              const parts = formatter.formatToParts(date);
              const pick = (type) =>
                parts.find((part) => part.type === type)?.value ?? "";
              const seconds = withSeconds ? `:${pick("second")}` : "";
              return `${pick("hour")}:${pick("minute")}${seconds} ${pick("dayPeriod").toUpperCase()}`;
            })()
          : formatter.format(date);
        assert.equal(
          formatAxisTimeTick(
            date,
            timeZone,
            { timeHoursFormat: hour12 ? "12-hours" : "24-hours" },
            withSeconds,
          ),
          expected,
        );
      }
    }
  }
});

test("status line rebuilds its retained view after an external loading clear", () => {
  class FakeStyle {
    setProperty(name, value) {
      this[name] = value;
    }

    removeProperty(name) {
      delete this[name];
    }
  }

  class FakeClassList {
    constructor(owner) {
      this.owner = owner;
    }

    add(name) {
      const names = new Set(this.owner.className.split(/\s+/).filter(Boolean));
      names.add(name);
      this.owner.className = [...names].join(" ");
    }

    remove(name) {
      this.owner.className = this.owner.className
        .split(/\s+/)
        .filter((candidate) => candidate && candidate !== name)
        .join(" ");
    }
  }

  class FakeElement {
    constructor(className = "") {
      this.className = className;
      this.children = [];
      this.parentNode = null;
      this.style = new FakeStyle();
      this.classList = new FakeClassList(this);
      this.dataset = {};
      this._innerHTML = "";
      this.innerHTMLWrites = 0;
    }

    get childElementCount() {
      return this.children.length;
    }

    get firstElementChild() {
      return this.children[0] ?? null;
    }

    hasChildNodes() {
      return this.children.length > 0;
    }

    get innerHTML() {
      return this._innerHTML;
    }

    set innerHTML(value) {
      this.innerHTMLWrites += 1;
      this.replaceChildren();
      this._innerHTML = String(value);
      if (this._innerHTML) this.append(new FakeElement("rendered-root"));
    }

    append(...nodes) {
      for (const node of nodes) {
        node.parentNode = this;
        this.children.push(node);
      }
    }

    appendChild(node) {
      this.append(node);
      return node;
    }

    replaceChildren(...nodes) {
      for (const child of this.children) child.parentNode = null;
      this.children = [];
      this._innerHTML = "";
      this.append(...nodes);
    }

    contains(node) {
      return node === this || this.children.some((child) => child.contains(node));
    }

    querySelector(selector) {
      if (selector === "[data-status-change-pair]") return null;
      if (!selector.startsWith(".")) return null;
      const className = selector.slice(1);
      for (const child of this.children) {
        if (child.className.split(/\s+/).includes(className)) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    }

    querySelectorAll() {
      return [];
    }
  }

  const previousHTMLElement = globalThis.HTMLElement;
  globalThis.HTMLElement = FakeElement;

  const host = new FakeElement("status-line");
  const main = new FakeElement("status-line__main");
  const studies = new FakeElement("status-line__studies");
  host.append(main, studies);
  const options = {
    symbol: "MNQ1!",
    resolution: "5",
    bar: { open: 100, high: 102, low: 99, close: 101, volume: 500 },
    prevBar: { close: 100 },
    settings: {
      statusLine: {
        showTitle: true,
        showOHLC: true,
        showBarChange: true,
        showVolume: true,
      },
      symbol: { precision: "2" },
    },
  };

  try {
    renderStatusLine(host, options);
    const firstRoot = main.firstElementChild;
    assert.ok(firstRoot);
    assert.equal(main.innerHTMLWrites, 1);
    assert.match(
      main.innerHTML,
      /status-line__meta[\s\S]*status-line__values/,
      "instrument metadata should occupy the row above OHLC values",
    );

    options.bar = { open: 101, high: 103, low: 100, close: 102, volume: 600 };
    renderStatusLine(host, options);
    assert.strictEqual(main.firstElementChild, firstRoot);
    assert.equal(main.innerHTMLWrites, 1);

    // The loading path clears this node directly, outside renderStatusLine.
    main.innerHTML = "";
    assert.equal(main.firstElementChild, null);
    assert.equal(main.innerHTMLWrites, 2);

    renderStatusLine(host, options);
    assert.ok(main.firstElementChild);
    assert.notStrictEqual(main.firstElementChild, firstRoot);
    assert.equal(main.innerHTMLWrites, 3);
  } finally {
    globalThis.HTMLElement = previousHTMLElement;
  }
});

test("price-line synchronization skips unchanged options", async () => {
  const previousWindow = globalThis.window;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.window = { setInterval: () => 1 };
  globalThis.requestAnimationFrame = () => 1;

  let state = {
    symbolLabelActive: true,
    scaleVisible: true,
    countdownToBarClose: false,
    marketOpen: true,
    price: 100,
    color: "#089981",
    lineVisible: true,
    axisLabelVisible: true,
    priceText: "100.00",
    title: "TEST",
    lineWidth: 1,
    lineStyle: 0,
  };
  let applyCount = 0;
  let createCount = 0;
  let removeCount = 0;
  const line = {
    applyOptions() {
      applyCount += 1;
    },
  };
  const series = {
    createPriceLine() {
      createCount += 1;
      return line;
    },
    removePriceLine() {
      removeCount += 1;
    },
  };

  try {
    const primitive = attachPriceLineLabelPrimitive({
      series,
      getState: () => state,
    });
    await Promise.resolve();

    primitive.requestRefresh();
    primitive.requestRefresh();
    assert.equal(createCount, 1);
    assert.equal(applyCount, 0);

    state = { ...state, price: 101, priceText: "101.00" };
    primitive.requestRefresh();
    primitive.requestRefresh();
    assert.equal(applyCount, 1);

    primitive.destroy();
    assert.equal(removeCount, 1);
  } finally {
    globalThis.window = previousWindow;
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  }
});

test("frame tick cache shares empty and populated snapshots", () => {
  let priceTickCalls = 0;
  const scale = {
    ticks() {
      priceTickCalls += 1;
      return [];
    },
  };
  const model = {
    timeScale: {
      times: [0, 60, 120],
      barSpacing: 12,
      visibleLogicalRange: () => ({ from: 0, to: 2 }),
      indexToTime: (logical) => logical * 60,
    },
    options: {
      timeScale: { timezoneProvider: null },
    },
  };
  const cache = new RenderFrameTickCache(model);

  const firstPriceTicks = cache.priceTicks(scale);
  assert.strictEqual(cache.priceTicks(scale), firstPriceTicks);
  assert.equal(priceTickCalls, 1);

  const firstTimeTicks = cache.timeTicks(800);
  assert.strictEqual(cache.timeTicks(800), firstTimeTicks);
  assert.notStrictEqual(cache.timeTicks(400), firstTimeTicks);
});

test("full chart rendering computes each price scale tick snapshot once per frame", () => {
  const noop = () => {};
  const context = {
    setTransform: noop,
    clearRect: noop,
    fillRect: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    rect: noop,
    clip: noop,
    translate: noop,
    stroke: noop,
    moveTo: noop,
    lineTo: noop,
    setLineDash: noop,
    fillText: noop,
    measureText: (value) => ({ width: String(value).length * 7 }),
  };
  const pane = {
    top: 0,
    height: 300,
    series: [],
    seriesFor: () => [],
    priceScales: new Map(),
  };
  const model = {
    dpr: 1,
    width: 800,
    height: 300,
    _leftW: 0,
    _rightW: 0,
    panes: [pane],
    baseCanvas: { width: 800, height: 300, style: {} },
    glCanvas: { width: 300, height: 150, style: {} },
    mainCanvas: { width: 800, height: 300 },
    topCanvas: { width: 800, height: 300, style: {} },
    baseCtx: context,
    mainCtx: context,
    topCtx: context,
    timeScale: {
      barSpacing: 8,
      visibleLogicalRange: () => ({ from: 0, to: 10 }),
    },
    options: {
      renderer: "cpu",
      layout: {
        background: { color: "#000000" },
        textColor: "#ffffff",
        fontSize: 12,
        fontFamily: "sans-serif",
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: true, color: "#333333" },
      },
      timeScale: { visible: false },
      localization: { priceFormatter: null },
      crosshair: { mode: 0 },
    },
    crosshair: { visible: false },
    _layoutPanes: noop,
    paneWidth() {
      return this.width - this._leftW - this._rightW;
    },
    timeAxisHeight: () => 0,
  };
  const rightScale = new PriceScaleModel(
    model,
    pane,
    "right",
    { visible: true },
  );
  const leftScale = new PriceScaleModel(
    model,
    pane,
    "left",
    { visible: true },
  );
  rightScale.priceRange = { min: 0, max: 100 };
  leftScale.priceRange = { min: -50, max: 50 };
  pane.priceScales.set("right", rightScale);
  pane.priceScales.set("left", leftScale);

  const tickCalls = new Map([
    [rightScale, 0],
    [leftScale, 0],
  ]);
  const frameTicks = [
    { y: 40, price: 75 },
    { y: 160, price: 50 },
  ];
  for (const scale of [rightScale, leftScale]) {
    scale.ticks = () => {
      tickCalls.set(scale, tickCalls.get(scale) + 1);
      return frameTicks;
    };
  }

  renderChart(model);
  assert.equal(tickCalls.get(rightScale), 1);
  assert.equal(tickCalls.get(leftScale), 1);
  assert.equal(model.baseCanvas.style.display, "none");
  assert.equal(model.glCanvas.style.display, "none");
  assert.equal(model.topCanvas.style.display, "none");
  assert.equal(model.glCanvas.width, 1);
  assert.equal(model.glCanvas.height, 1);

  renderChart(model);
  assert.equal(tickCalls.get(rightScale), 2);
  assert.equal(tickCalls.get(leftScale), 2);
});

test("logarithmic mode preserves a manually positioned futures price range", () => {
  let invalidations = 0;
  const chart = {
    invalidate() {
      invalidations += 1;
    },
    options: {
      localization: { priceFormatter: null },
      layout: { fontSize: 12, fontFamily: "sans-serif" },
    },
  };
  const pane = {
    height: 300,
    seriesFor: () => [],
  };
  const scale = new PriceScaleModel(chart, pane, "right", {
    autoScale: false,
  });
  scale.priceRange = { min: 24_000, max: 25_000 };
  scale._manual = true;

  scale.applyOptions({ mode: PriceScaleMode.Logarithmic });

  assert.equal(invalidations, 1);
  assert.ok(Math.abs(scale.fromScale(scale.priceRange.min) - 24_000) < 1e-6);
  assert.ok(Math.abs(scale.fromScale(scale.priceRange.max) - 25_000) < 1e-6);
  const candleY = scale.priceToCoordinate(24_500);
  assert.ok(Number.isFinite(candleY));
  assert.ok(candleY > 0 && candleY < pane.height);

  scale.applyOptions({ mode: PriceScaleMode.Normal });

  assert.ok(Math.abs(scale.priceRange.min - 24_000) < 1e-6);
  assert.ok(Math.abs(scale.priceRange.max - 25_000) < 1e-6);
});

test("crosshair movement clears only its previous dirty strips", () => {
  const clearCalls = [];
  const noop = () => {};
  const context = {
    beginPath: noop,
    clearRect: (...args) => clearCalls.push(args),
    lineTo: noop,
    moveTo: noop,
    restore: noop,
    save: noop,
    setLineDash: noop,
    setTransform: noop,
    stroke: noop,
  };
  const pane = {
    top: 0,
    height: 275,
    priceScales: new Map(),
  };
  const model = {
    dpr: 1,
    width: 800,
    height: 300,
    _leftW: 0,
    _rightW: 0,
    panes: [pane],
    topCanvas: { width: 800, height: 300, style: {} },
    topCtx: context,
    crosshair: {
      visible: true,
      logical: 4,
      x: 40,
      y: 120,
      paneIndex: 0,
    },
    options: {
      crosshair: {
        mode: 0,
        vertLine: {
          visible: true,
          width: 1,
          labelVisible: false,
        },
        horzLine: {
          visible: true,
          width: 1,
          labelVisible: false,
        },
      },
      timeScale: { visible: false },
      layout: { fontSize: 12 },
    },
    timeScale: {
      barSpacing: 10,
      visibleLogicalRange: () => ({ from: 0, to: 20 }),
    },
    paneWidth: () => 800,
    timeAxisHeight: () => 25,
  };

  renderCrosshairTop(model);
  assert.deepEqual(clearCalls.shift(), [0, 0, 800, 300]);

  model.crosshair.logical = 5;
  model.crosshair.x = 50;
  model.crosshair.y = 130;
  renderCrosshairTop(model);

  assert.equal(clearCalls.length, 2);
  assert.ok(clearCalls.every(([, , width, height]) => width < 800 || height < 300));
});

test("chart input geometry is shared within a frame and refreshes after layout moves", () => {
  const firstRect = { left: 10, top: 20, width: 800, height: 600 };
  const movedRect = { left: 40, top: 50, width: 800, height: 600 };
  let currentRect = firstRect;
  let rectReads = 0;
  let nextFrameId = 1;
  const frames = new Map();
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const model = {
    _inputRootRect: null,
    _inputRootRectFrame: 0,
    root: {
      getBoundingClientRect() {
        rectReads += 1;
        return currentRect;
      },
    },
  };

  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);

  try {
    assert.strictEqual(ChartModel.prototype.inputRootRect.call(model), firstRect);
    assert.strictEqual(ChartModel.prototype.inputRootRect.call(model), firstRect);
    assert.equal(rectReads, 1);
    assert.equal(frames.size, 1);

    currentRect = movedRect;
    const [frameId, expireRect] = [...frames.entries()][0];
    frames.delete(frameId);
    expireRect();

    assert.strictEqual(ChartModel.prototype.inputRootRect.call(model), movedRect);
    assert.equal(rectReads, 2);

    ChartModel.prototype.invalidateInputRootRect.call(model);
    assert.strictEqual(ChartModel.prototype.inputRootRect.call(model), movedRect);
    assert.equal(rectReads, 3);
  } finally {
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
  }
});

test("direct chart-surface pointer points use exact offsets without layout reads", () => {
  const root = {};
  const baseCanvas = {};
  const glCanvas = {};
  const mainCanvas = {};
  const topCanvas = {};
  let rectReads = 0;
  const model = {
    root: {
      ...root,
      getBoundingClientRect() {
        rectReads += 1;
        return { left: 40, top: 60 };
      },
    },
    baseCanvas,
    glCanvas,
    mainCanvas,
    topCanvas,
    _inputPointCache: new WeakMap(),
    _inputRootRect: null,
    _inputRootRectFrame: 0,
    inputRootRect() {
      return ChartModel.prototype.inputRootRect.call(this);
    },
  };
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;

  try {
    for (const [index, target] of [
      model.root,
      baseCanvas,
      glCanvas,
      mainCanvas,
      topCanvas,
    ].entries()) {
      const event = {
        target,
        offsetX: 100 + index,
        offsetY: 200 + index,
        clientX: 500,
        clientY: 600,
      };
      const point = ChartModel.prototype.inputPoint.call(model, event);
      assert.deepEqual(point, { x: 100 + index, y: 200 + index });
      assert.strictEqual(ChartModel.prototype.inputPoint.call(model, event), point);
    }
    assert.equal(rectReads, 0);

    const delegatedEvent = {
      target: {},
      offsetX: 3,
      offsetY: 4,
      clientX: 150,
      clientY: 190,
    };
    const delegatedPoint = ChartModel.prototype.inputPoint.call(model, delegatedEvent);
    assert.deepEqual(delegatedPoint, { x: 110, y: 130 });
    assert.strictEqual(
      ChartModel.prototype.inputPoint.call(model, delegatedEvent),
      delegatedPoint,
    );
    assert.equal(rectReads, 1);
  } finally {
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  }
});

test("chart interactions consume direct-surface points without reading layout", () => {
  const listeners = new Map();
  let rectReads = 0;
  const root = {
    addEventListener(type, listener) {
      const bucket = listeners.get(type) ?? [];
      bucket.push(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      const bucket = listeners.get(type) ?? [];
      listeners.set(
        type,
        bucket.filter((candidate) => candidate !== listener),
      );
    },
    getBoundingClientRect() {
      rectReads += 1;
      return { left: 700, top: 800 };
    },
  };
  const topCanvas = {};
  const crosshairPoints = [];
  const model = {
    root,
    baseCanvas: {},
    glCanvas: {},
    mainCanvas: {},
    topCanvas,
    _inputPointCache: new WeakMap(),
    _inputRootRect: null,
    _inputRootRectFrame: 0,
    _leftW: 48,
    _rightW: 72,
    width: 800,
    height: 600,
    options: {
      timeScale: { visible: true },
      handleScale: {},
      handleScroll: {},
      kineticScroll: {},
    },
    inputRootRect() {
      return ChartModel.prototype.inputRootRect.call(this);
    },
    inputPoint(event) {
      return ChartModel.prototype.inputPoint.call(this, event);
    },
    timeAxisHeight: () => 28,
    updateCrosshair(x, y) {
      crosshairPoints.push({ x, y });
    },
    clearCrosshair() {},
  };

  const dispose = bindEvents(model);
  try {
    const pointerMove = listeners.get("pointermove")[0];
    pointerMove({
      target: topCanvas,
      pointerType: "mouse",
      pointerId: 1,
      buttons: 0,
      offsetX: 348,
      offsetY: 219,
      clientX: 999,
      clientY: 999,
    });

    assert.deepEqual(crosshairPoints, [{ x: 300, y: 219 }]);
    assert.equal(rectReads, 0);
  } finally {
    dispose();
  }
});

test("chart destroy disposes input work and cancels geometry expiry", () => {
  let disposeCalls = 0;
  const canceledFrames = [];
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = (id) => canceledFrames.push(id);

  const model = {
    _destroyed: false,
    _raf: 0,
    _rafTop: 0,
    _priceAxisHoverFrame: 0,
    _inputRootRectFrame: 17,
    _inputRootRect: { left: 1, top: 2 },
    _pendingPriceAxisHover: null,
    _disposeInputEvents() {
      disposeCalls += 1;
    },
    _crosshairManager: { destroy() {} },
    _stopKinetic() {},
    _ro: null,
    _onRootGeometryChange() {},
    root: { remove() {} },
    panes: [],
    seriesApis: new Map(),
  };

  try {
    ChartModel.prototype.destroy.call(model);
    assert.equal(disposeCalls, 1);
    assert.deepEqual(canceledFrames, [17]);
    assert.equal(model._inputRootRectFrame, 0);
    assert.equal(model._inputRootRect, null);
    assert.equal(model._disposeInputEvents, null);
  } finally {
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
  }
});

test("drawing hover skips empty collections and coalesces the latest frame point", () => {
  class FakeTarget {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(type, handler) {
      const handlers = this.listeners.get(type) ?? [];
      handlers.push(handler);
      this.listeners.set(type, handlers);
    }

    removeEventListener(type, handler) {
      const handlers = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        handlers.filter((candidate) => candidate !== handler),
      );
    }
  }

  const previousDocument = globalThis.document;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const documentTarget = new FakeTarget();
  const container = new FakeTarget();
  const overlayRoot = new FakeTarget();
  const chart = {
    subscribeCrosshairMove() {},
    unsubscribeCrosshairMove() {},
  };
  const frames = new Map();
  let nextFrameId = 1;
  const hoverPoints = [];
  let drawings = [];

  globalThis.document = documentTarget;
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);

  const handlers = createPointerHandlers({
    container,
    overlayRoot,
    chart,
    isValuesTooltipPinned: () => false,
    useMobileDragPlacement: () => false,
    isCursorTool: () => true,
    isPrimaryButtonDown: (event) => Boolean(event.buttons & 1),
    isDragging: () => false,
    hasActiveDrag: () => false,
    getMeasureDragActive: () => false,
    getFreehandDrawing: () => null,
    getPlacementStaged: () => [],
    getDrawings: () => drawings,
    shouldSyncDrawCrosshair: () => false,
    updateCursorMark() {},
    cancelLongPressIfMoved() {},
    updateDrawingHover(x, y) {
      hoverPoints.push({ x, y });
    },
    tryActivateDrag() {},
    getActiveTool: () => "cursor",
    clearLongPress() {},
    hideValuesTooltip() {},
    setHoveredDrawing() {},
    hideCursorMark() {},
  });

  try {
    handlers.bindChartListeners();
    assert.equal(container.listeners.get("pointermove")?.length ?? 0, 0);
    assert.equal(overlayRoot.listeners.get("pointermove")?.length ?? 0, 1);

    const move = overlayRoot.listeners.get("pointermove")[0];
    move({ buttons: 0, clientX: 10, clientY: 20 });
    move({ buttons: 0, clientX: 30, clientY: 40 });
    move({ buttons: 0, clientX: 50, clientY: 60 });

    assert.equal(frames.size, 0);
    assert.deepEqual(hoverPoints, []);

    drawings = [{ id: "line-1" }];
    move({ buttons: 0, clientX: 10, clientY: 20 });
    move({ buttons: 0, clientX: 30, clientY: 40 });
    move({ buttons: 0, clientX: 50, clientY: 60 });

    assert.equal(frames.size, 1);
    assert.deepEqual(hoverPoints, []);
    [...frames.values()][0]();
    assert.deepEqual(hoverPoints, [{ x: 50, y: 60 }]);
  } finally {
    handlers.unbindChartListeners();
    globalThis.document = previousDocument;
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
  }
});

test("mobile drawing crosshair survives the pointerleave dispatched on touch release", () => {
  class FakeTarget {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(type, handler) {
      const handlers = this.listeners.get(type) ?? [];
      handlers.push(handler);
      this.listeners.set(type, handlers);
    }

    removeEventListener(type, handler) {
      const handlers = this.listeners.get(type) ?? [];
      this.listeners.set(type, handlers.filter((candidate) => candidate !== handler));
    }
  }

  const previousDocument = globalThis.document;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const documentTarget = new FakeTarget();
  const container = new FakeTarget();
  const overlayRoot = new FakeTarget();
  let clearCalls = 0;
  let restoreCalls = 0;

  globalThis.document = documentTarget;
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };

  const handlers = createPointerHandlers({
    container,
    overlayRoot,
    chart: {
      subscribeCrosshairMove() {},
      unsubscribeCrosshairMove() {},
    },
    clearLongPress() {},
    isValuesTooltipPinned: () => false,
    hideValuesTooltip() {},
    setHoveredDrawing() {},
    useMobileDragPlacement: () => true,
    shouldSyncDrawCrosshair: () => true,
    clearDrawCrosshair() {
      clearCalls += 1;
    },
    syncDrawCrosshairAtMediaAnchor() {
      restoreCalls += 1;
    },
    getActiveTool: () => "trendline",
  });

  try {
    handlers.bindChartListeners();
    const leave = overlayRoot.listeners.get("pointerleave")[0];

    leave({ pointerType: "touch" });
    assert.equal(clearCalls, 0);
    assert.equal(restoreCalls, 1);

    leave({ pointerType: "mouse" });
    assert.equal(clearCalls, 1);
    assert.equal(restoreCalls, 1);
  } finally {
    handlers.unbindChartListeners();
    globalThis.document = previousDocument;
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  }
});
