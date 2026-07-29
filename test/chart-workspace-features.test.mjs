import test from "node:test";
import assert from "node:assert/strict";

import { CHART_FEATURES, createFeatureFlags } from "../public/js/chart/features.js";
import { CHART_TYPES, loadChartType } from "../public/js/ui/header/chartTypes.js";
import { readPageOptions } from "../public/js/datafeed/client.js";
import { layoutAxisLabels, seriesLastValueColor, usesCustomOhlcRenderer } from "../public/vendor/prochart/render/renderer.mjs";
import { resolveChartStyleLineColor } from "../public/js/app/symbol/lineStyle.js";
import { shouldShowTimeframeMenu } from "../public/js/ui/timeframe/favorites.js";
import { timeframeSwitchPrefersUtcRestore } from "../public/js/app/boot/chart/timeframeRestorePolicy.js";
import { createLayoutSync, scaleLogicalPanDelta } from "../public/js/app/layout/sync.js";
import { chartAppearancePreset, chartThemeFallback } from "../public/js/app/boot/themes.js";
import { createChartSettings } from "../public/js/ui/settings/store.js";
import { clearResolvedPaneEmptyState } from "../public/js/app/bar/loader.js";
import {
  clearResolutionCache,
  publishResolutionCache,
  tryRestorePaneResolutionCache,
} from "../public/js/app/bar/resolutionCache.js";
import {
  bindEvents,
  TOUCH_TRACKING_CANCEL_DISTANCE,
  TOUCH_TRACKING_LONG_PRESS_MS,
  trackingCrosshairPosition,
} from "../public/vendor/prochart/input/interactions.mjs";
import { pointInRightPriceAxis } from "../public/vendor/prochart/api/chartModel.mjs";
import {
  statusPointerRefreshesDuringPan,
  statusPointerSelectsHover,
} from "../public/js/chart/status/hover.js";

test("resolution cache does not leak candles between chart widgets", () => {
  clearResolutionCache();
  const replayScope = {};
  const liveScope = {};
  const replayPane = {
    index: 0,
    symbol: "NQ",
    resolution: "30S",
    bars: [{ time: 100, close: 20 }],
    _historyExhausted: false,
    _firstDataRequest: false,
  };
  const livePane = {
    index: 0,
    symbol: "NQ",
    resolution: "30S",
    bars: [],
  };

  publishResolutionCache(replayPane, replayScope);

  assert.equal(tryRestorePaneResolutionCache(livePane, liveScope), false);
  assert.deepEqual(livePane.bars, []);
  assert.equal(tryRestorePaneResolutionCache(livePane, replayScope), true);
  assert.deepEqual(livePane.bars, replayPane.bars);
  clearResolutionCache();
});

test("workspace features are enabled by default and independently disableable", () => {
  const defaults = createFeatureFlags();
  assert.equal(defaults.isEnabled(CHART_FEATURES.REPLAY), true);
  assert.equal(defaults.isEnabled(CHART_FEATURES.CHART_TYPES), true);

  const disabled = createFeatureFlags({ disabled_features: [CHART_FEATURES.REPLAY] });
  assert.equal(disabled.isEnabled(CHART_FEATURES.REPLAY), false);
  assert.equal(disabled.isEnabled(CHART_FEATURES.CHART_TYPES), true);
});

test("chart type catalog is stable, unique, and safely defaults to candles", () => {
  const ids = CHART_TYPES.map((item) => item.id);
  assert.deepEqual(ids, ["candles", "hollow-candles", "bars", "line", "area", "baseline", "heikin-ashi"]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(loadChartType(), "candles");
});

test("the trader workspace defaults to live data while fake data stays explicit", () => {
  const live = readPageOptions("");
  assert.equal(live.datafeedType, "tradingview");
  assert.equal(live.tradingview, true);

  const fake = readPageOptions("?datafeed=fake");
  assert.equal(fake.datafeedType, "fake");
  assert.equal(fake.tradingview, false);
});

test("non-candle OHLC styles bypass native candle geometry", () => {
  assert.equal(usesCustomOhlcRenderer({ type: "Candlestick", options: { chartStyle: "candles" } }), false);
  assert.equal(usesCustomOhlcRenderer({ type: "Candlestick", options: { chartStyle: "line" } }), true);
  assert.equal(usesCustomOhlcRenderer({ type: "Candlestick", options: { chartStyle: "area" } }), true);
  assert.equal(usesCustomOhlcRenderer({ type: "Line", options: { chartStyle: "line" } }), false);
});

test("line-style price labels use the chart line color instead of candle direction", () => {
  const options = {
    chartStyle: "line",
    chartLineColor: "#2962ff",
    upColor: "#089981",
    downColor: "#f23645",
  };
  assert.equal(resolveChartStyleLineColor(options), "#2962ff");
  assert.equal(seriesLastValueColor({ type: "Candlestick", valueCount: 4, options }), "#2962ff");
  assert.equal(resolveChartStyleLineColor({ ...options, chartStyle: "candles" }), null);
});

test("interval menu visibility follows favorite count and active interval", () => {
  assert.equal(shouldShowTimeframeMenu([], "1"), false);
  assert.equal(shouldShowTimeframeMenu(["1"], "1"), false);
  assert.equal(shouldShowTimeframeMenu(["1"], "5"), true);
  assert.equal(shouldShowTimeframeMenu(["1", "5"], "1"), true);
});

test("live timeframe switches preserve bar slots instead of UTC duration", () => {
  const hourlyLayout = {
    resolution: "60",
    barSec: 3600,
    width: 89.5,
    toBeyondAnchor: 9,
    visibleFromUtc: 1_752_676_200,
    visibleToUtc: 1_753_198_800,
  };
  assert.equal(timeframeSwitchPrefersUtcRestore(hourlyLayout, "1"), false);
  assert.equal(
    timeframeSwitchPrefersUtcRestore(
      { visibleFromUtc: hourlyLayout.visibleFromUtc, visibleToUtc: hourlyLayout.visibleToUtc },
      "1",
    ),
    true,
  );
});

test("multi-pane pans scale logical movement by each pane interval", () => {
  assert.deepEqual(scaleLogicalPanDelta({ from: 1, to: 1 }, 3600, 60), {
    from: 60,
    to: 60,
  });

  const queuedFrames = [];
  const previousRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (fn) => {
    queuedFrames.push(fn);
    return queuedFrames.length;
  };
  try {
    let sourceRange = { from: 10, to: 20 };
    let targetRange = { from: 100, to: 200 };
    const sourceChart = {
      timeScale: () => ({
        getVisibleRange: () => null,
        getVisibleLogicalRange: () => sourceRange,
        setVisibleLogicalRange: (range) => { sourceRange = range; },
        subscribeVisibleLogicalRangeChange: () => {},
      }),
    };
    const targetChart = {
      timeScale: () => ({
        getVisibleRange: () => null,
        getVisibleLogicalRange: () => targetRange,
        setVisibleLogicalRange: (range) => { targetRange = range; },
        subscribeVisibleLogicalRangeChange: () => {},
      }),
    };
    const panes = [
      { chart: sourceChart, bars: [{}], barSec: 3600 },
      { chart: targetChart, bars: [{}], barSec: 60 },
    ];
    const sync = createLayoutSync({
      getLayoutManager: () => ({ getSync: () => ({ dateRange: true }) }),
      getLayoutPanes: () => panes,
      getActivePane: () => panes[0],
      isChartPanning: () => true,
      isBarsLoading: () => false,
      isHistoryRestorePending: () => false,
    });

    sync.syncLayoutDateRangeFrom(sourceChart, sourceRange);
    assert.deepEqual(targetRange, { from: 100, to: 200 });
    sourceRange = { from: 11, to: 21 };
    sync.syncLayoutDateRangeFrom(sourceChart, sourceRange);
    assert.deepEqual(targetRange, { from: 160, to: 260 });
    queuedFrames.shift()?.();
  } finally {
    globalThis.requestAnimationFrame = previousRaf;
  }
});

test("appearance presets include trader-friendly gray and never enable attribution", () => {
  const gray = chartAppearancePreset("gray");
  assert.equal(gray.theme, "light");
  assert.equal(gray.canvas.backgroundColor, "#b9bec8");
  assert.equal(gray.symbol.bordersUpColor, "#090d14");

  const settings = createChartSettings();
  settings.replace({ canvas: { attributionLogo: true } });
  assert.equal(settings.get().canvas.attributionLogo, false);
  assert.equal(settings.get().scales.bidLabelValue, false);
  assert.equal(settings.get().scales.bidLabelLine, false);
  assert.equal(settings.get().scales.askLabelValue, false);
  assert.equal(settings.get().scales.askLabelLine, false);
  assert.equal(settings.get().canvas.showNewsMarkers, true);
  settings.set("canvas", "showNewsMarkers", false);
  assert.equal(settings.get().canvas.showNewsMarkers, false);

  settings.replace({ scales: {
    bidAskDefaultsVersion: 1,
    bidLabelValue: true,
    bidLabelLine: true,
    askLabelValue: true,
    askLabelLine: true,
  } });
  assert.equal(settings.get().scales.bidAskDefaultsVersion, 2);
  assert.equal(settings.get().scales.bidLabelValue, false);
  assert.equal(settings.get().scales.askLabelValue, false);
});

test("dark appearance uses Auren's neutral palette", () => {
  const dark = chartAppearancePreset("dark");
  assert.equal(dark.theme, "dark");
  assert.equal(dark.canvas.backgroundColor, "#09090b");
  assert.equal(dark.canvas.scalesTextColor, "#a1a1aa");

  assert.deepEqual(chartThemeFallback("dark"), {
    bg: "#09090b",
    text: "#a1a1aa",
    grid: "#27272a",
    border: "#3f3f46",
    crosshair: "#71717a",
    labelBg: "#18181b",
    up: "#10b981",
    down: "#ef4444",
  });
});

test("saved legacy dark Basic styles migrate without replacing custom colors", () => {
  const settings = createChartSettings();
  settings.replace({
    canvas: {
      backgroundColor: "#020617",
      backgroundGradientTopColor: "#0f172a",
      backgroundGradientBottomColor: "#020617",
      gridVertColor: "rgba(226, 232, 240, 0.06)",
      gridHorzColor: "rgba(226, 232, 240, 0.06)",
      crosshairColor: "#64748b",
      watermarkColor: "rgba(148, 163, 184, 0.25)",
      scalesTextColor: "#e2e8f0",
      scalesLineColor: "#123456",
    },
  });

  assert.deepEqual(settings.get().canvas, {
    ...settings.getDefaults().canvas,
    scalesLineColor: "#123456",
  });
});

test("overlapping close, ask, and bid labels remain sorted by price", () => {
  const model = { options: { layout: { fontSize: 12 } } };
  const labels = layoutAxisLabels(model, [
    { y: 100, subtitle: "00:42", title: "", priority: 0 },
    { y: 101, subtitle: "", title: "Ask", priority: 1 },
    { y: 115, subtitle: "", title: "Bid", priority: 2 },
  ], 0, 300);

  assert.deepEqual(labels.map((label) => label.title || "Close"), ["Close", "Ask", "Bid"]);
  assert.ok(labels[0].top + labels[0].height < labels[1].top);
  assert.ok(labels[1].top + labels[1].height < labels[2].top);
});

test("a successful cached timeframe load clears a stale no-data overlay", () => {
  const pane = { bars: [{ time: 1 }], _emptyStateMeta: { reason: "unsupported_resolution" } };
  const calls = [];
  assert.equal(clearResolvedPaneEmptyState(pane, (...args) => calls.push(args)), true);
  assert.equal(pane._emptyStateMeta, null);
  assert.deepEqual(calls, [[pane, { show: false }]]);

  const emptyPane = { bars: [], _emptyStateMeta: { reason: "unsupported_resolution" } };
  assert.equal(clearResolvedPaneEmptyState(emptyPane, () => calls.push("unexpected")), false);
  assert.notEqual(emptyPane._emptyStateMeta, null);
});

test("mobile tracking moves both crosshair lines by gesture delta without jumping", () => {
  assert.equal(TOUCH_TRACKING_LONG_PRESS_MS, 240);
  assert.equal(TOUCH_TRACKING_CANCEL_DISTANCE, 5);
  assert.deepEqual(
    trackingCrosshairPosition(
      { x: 10, y: 40 },
      { x: 100, y: 200 },
      { x: 125, y: 185 },
    ),
    { x: 35, y: 25 },
  );
  assert.deepEqual(
    trackingCrosshairPosition(
      { x: 10, y: 40 },
      { x: 100, y: 200 },
      { x: 500, y: -500 },
      { minX: 0, maxX: 300, minY: 20, maxY: 180 },
    ),
    { x: 300, y: 20 },
  );
  assert.deepEqual(
    trackingCrosshairPosition(
      { x: 290, y: 170 },
      { x: 100, y: 100 },
      { x: -500, y: 500 },
      { minX: 0, maxX: 300, minY: 20, maxY: 180 },
    ),
    { x: 0, y: 180 },
  );
});

test("plot pan input is coalesced to one chart update per animation frame", () => {
  const listeners = new Map();
  let rectReads = 0;
  const root = {
    addEventListener(type, listener) {
      const bucket = listeners.get(type) ?? [];
      bucket.push(listener);
      listeners.set(type, bucket);
    },
    getBoundingClientRect() {
      rectReads += 1;
      return { left: 0, top: 0, width: 800, height: 600 };
    },
    setPointerCapture() {},
  };
  const dispatch = (type, overrides = {}) => {
    const event = {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: 100,
      clientY: 100,
      preventDefault() {},
      ...overrides,
    };
    for (const listener of listeners.get(type) ?? []) listener(event);
  };

  const scrollCalls = [];
  const pricePanCalls = [];
  const crosshairCalls = [];
  const scale = {
    options: { autoScale: false },
    panByPixels(delta) {
      pricePanCalls.push(delta);
    },
  };
  const model = {
    root,
    width: 800,
    height: 600,
    _leftW: 0,
    _rightW: 72,
    options: {
      timeScale: { visible: true },
      handleScale: {
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      handleScroll: {
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      kineticScroll: { mouse: false, touch: true },
    },
    timeScale: {
      barSpacing: 8,
      scrollBy(delta) {
        scrollCalls.push(delta);
      },
    },
    panes: [{ top: 0, height: 572, priceScales: new Map([["right", scale]]) }],
    crosshair: { x: 0, y: 0, paneIndex: 0 },
    timeAxisHeight: () => 28,
    paneWidth: () => 728,
    paneIndexAtY: () => 0,
    updateCrosshair(x, y) {
      crosshairCalls.push({ x, y });
    },
    clearCrosshair() {},
    _stopKinetic() {},
    _startKinetic() {},
  };

  const queuedFrames = new Map();
  let nextFrameId = 1;
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancelRaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (fn) => {
    const id = nextFrameId++;
    queuedFrames.set(id, fn);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    queuedFrames.delete(id);
  };

  try {
    bindEvents(model);
    dispatch("pointerdown");
    dispatch("pointermove", { clientX: 110, clientY: 105 });
    dispatch("pointermove", { clientX: 125, clientY: 110 });
    dispatch("pointermove", { clientX: 130, clientY: 115 });

    assert.deepEqual(scrollCalls, []);
    assert.deepEqual(pricePanCalls, []);
    assert.equal(crosshairCalls.length, 0);
    assert.equal(queuedFrames.size, 1);

    const frame = [...queuedFrames.values()][0];
    queuedFrames.clear();
    frame(performance.now());

    assert.deepEqual(scrollCalls, [-30]);
    assert.deepEqual(pricePanCalls, [-15]);
    // Full crosshair/status fan-out stays deferred during a mouse pan.
    assert.deepEqual(crosshairCalls, []);
    assert.equal(rectReads, 1);

    dispatch("pointerup", { clientX: 130, clientY: 115 });
    assert.deepEqual(scrollCalls, [-30]);
    assert.deepEqual(pricePanCalls, [-15]);
    assert.deepEqual(crosshairCalls, [{ x: 130, y: 115 }]);
  } finally {
    globalThis.requestAnimationFrame = previousRaf;
    globalThis.cancelAnimationFrame = previousCancelRaf;
  }
});

test("mobile OHLC follows a pinned crosshair after pointer release", () => {
  assert.equal(
    statusPointerSelectsHover({
      crosshairOverChart: true,
      crosshairOverFuture: false,
      crosshairPointerActive: false,
      _statusPointerType: "touch",
    }),
    true,
  );
  assert.equal(
    statusPointerSelectsHover({
      crosshairOverChart: false,
      crosshairOverFuture: false,
    }),
    false,
  );
  assert.equal(
    statusPointerSelectsHover({
      crosshairOverChart: true,
      crosshairOverFuture: true,
    }),
    false,
  );
});

test("mobile OHLC keeps refreshing while a pinned crosshair is dragged", () => {
  const pane = {
    crosshairOverChart: true,
    crosshairOverFuture: false,
  };
  assert.equal(
    statusPointerRefreshesDuringPan(pane, {
      point: { x: 120, y: 80 },
      sourceEvent: { pointerType: "touch" },
    }),
    true,
  );
  assert.equal(
    statusPointerRefreshesDuringPan(pane, {
      point: { x: 120, y: 80 },
      sourceEvent: { pointerType: "mouse" },
    }),
    false,
  );
  assert.equal(
    statusPointerRefreshesDuringPan(
      { ...pane, crosshairOverFuture: true },
      {
        point: { x: 120, y: 80 },
        sourceEvent: { pointerType: "touch" },
      },
    ),
    false,
  );
});

test("mobile A/L controls toggle only from the visible right price axis", () => {
  assert.equal(pointInRightPriceAxis(390, 844, 72, 28, 350, 400), true);
  assert.equal(pointInRightPriceAxis(390, 844, 72, 28, 317, 400), false);
  assert.equal(pointInRightPriceAxis(390, 844, 72, 28, 350, 816), false);
  assert.equal(pointInRightPriceAxis(390, 844, 0, 28, 350, 400), false);
});
