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
  TOUCH_TRACKING_CANCEL_DISTANCE,
  TOUCH_TRACKING_LONG_PRESS_MS,
  trackingCrosshairPosition,
} from "../public/vendor/prochart/input/interactions.mjs";
import { pointInRightPriceAxis } from "../public/vendor/prochart/api/chartModel.mjs";

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

test("mobile A/L controls toggle only from the visible right price axis", () => {
  assert.equal(pointInRightPriceAxis(390, 844, 72, 28, 350, 400), true);
  assert.equal(pointInRightPriceAxis(390, 844, 72, 28, 317, 400), false);
  assert.equal(pointInRightPriceAxis(390, 844, 72, 28, 350, 816), false);
  assert.equal(pointInRightPriceAxis(390, 844, 0, 28, 350, 400), false);
});
