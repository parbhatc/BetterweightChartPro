import { resolutionSec } from "/js/chart/resolutions.js";
import { ensureCompareAligned } from "/js/indicators/security/compareBars.js";
import { pendingInit, readyInit } from "/js/indicators/security/initWait.js";
import { inputsColorWithOpacity } from "/js/indicators/styleColor.js";
import { resolveFvgSizeFilterLimits } from "../ui/symbolSizeRulesPanel.js";
import { resolveFvgLayers, applyHideLowerTfFilter, dedupeRedundantChartLayer } from "../ui/fvgTimeframesPanel.js";
import {
  debugFvgInitOk,
  debugFvgInitPending,
  debugFvgInitSkip,
} from "./fvgDebug.js";
import { buildCompareLayerSeries, buildLayerSeries, scanLayerSeries } from "./layers.js";
import {
  DEFAULT_FVG_BEAR_COLOR,
  DEFAULT_FVG_BORDER_OPACITY,
  DEFAULT_FVG_BULL_COLOR,
  DEFAULT_FVG_FILL_OPACITY,
  DEFAULT_FVG_TAP_BORDER_COLOR,
  DEFAULT_IFVG_COLOR,
  DEFAULT_IFVG_FILL_OPACITY,
  resolveDefaultIfvgSetting,
} from "./palette.js";

/** Pine-style init — runs once before the bar loop. */
export function initFvgEngine(script) {
  const inputs = script.inputs;
  const style = script.style;
  const ctx = script.overlayCtx ?? {};

  if ((inputs.showFvg === false && inputs.showIfvg === false) || style.graphicBoxes === false) {
    script.state.skip = true;
    debugFvgInitSkip("boxes disabled", {
      showFvg: inputs.showFvg,
      showIfvg: inputs.showIfvg,
      graphicBoxes: style.graphicBoxes,
    });
    return;
  }

  const chartSec = ctx.barSec ?? resolutionSec(ctx.chartResolution ?? "1");
  const chartResolution = ctx.chartResolution ?? null;
  const maxBack = Math.max(10, Number(inputs.maxBarsBack) || 300);
  const deleteOnFill = inputs.deleteOnFill !== false;
  const boxLen = Math.max(1, Number(inputs.boxLength) || 20);
  const fillType = inputs.filledType === "wick" ? "wick" : "close";
  const boxesVisible = style.graphicBoxes !== false;
  const showLabels = inputs.showLabels !== false && style.graphicLabels !== false;
  const showFvg = inputs.showFvg !== false && boxesVisible;
  const showLiveForming = inputs.showLiveForming !== false && boxesVisible && showFvg;
  const showIfvg = inputs.showIfvg !== false && boxesVisible;
  const maxFvgZones = Math.max(0, inputs.maxFvgZones != null && inputs.maxFvgZones !== "" ? Number(inputs.maxFvgZones) : 300);
  const maxIfvgZones = Math.max(0, inputs.maxIfvgZones != null && inputs.maxIfvgZones !== "" ? Number(inputs.maxIfvgZones) : 1);

  const borderStyle = String(inputs.borderStyle ?? "solid");
  const borderWidth = Math.max(1, Number(inputs.borderWidth) || 1);
  const borderDash = borderStyle === "dotted" ? [2, 2] : borderStyle === "dashed" ? [6, 4] : [];
  const bullBorderOp = inputs.bullBorderColorOpacity !== undefined
    ? Number(inputs.bullBorderColorOpacity)
    : DEFAULT_FVG_BORDER_OPACITY;
  const bearBorderOp = inputs.bearBorderColorOpacity !== undefined
    ? Number(inputs.bearBorderColorOpacity)
    : DEFAULT_FVG_BORDER_OPACITY;
  const ifvgSetting = resolveDefaultIfvgSetting(
    inputs.ifvgBoxColor,
    inputs.ifvgBoxColorOpacity,
  );
  const ifvgInputs = {
    ...inputs,
    ifvgBoxColor: ifvgSetting.color,
    ifvgBoxColorOpacity: ifvgSetting.opacity,
  };
  const ifvgFill = inputsColorWithOpacity(
    ifvgInputs,
    "ifvgBoxColor",
    DEFAULT_IFVG_COLOR,
    DEFAULT_IFVG_FILL_OPACITY,
  );

  const lastChartTime = script.chartBars.at(-1)?.time;
  if (lastChartTime == null) {
    script.state.skip = true;
    debugFvgInitSkip("no chart bars");
    return;
  }

  let layers = resolveFvgLayers(inputs, chartSec);
  if (!layers.length) {
    script.state.skip = true;
    debugFvgInitSkip("no enabled layers");
    return;
  }

  layers = applyHideLowerTfFilter(layers, inputs, chartSec);
  layers = dedupeRedundantChartLayer(layers, chartSec, chartResolution);
  if (!layers.length) {
    script.state.skip = true;
    debugFvgInitSkip("no layers after hideLowerTf");
    return;
  }

  const requireCorrelatedFvg = inputs.requireCorrelatedFvg === true;
  let compareSeriesByLayer = null;

  if (requireCorrelatedFvg) {
    const minCovered = Math.min(script.bars.length, 3);
    const cmp = ensureCompareAligned(ctx, inputs, script.chartBars, script.bars.length, minCovered);
    if (!cmp.ready) {
      pendingInit(script.state);
      debugFvgInitPending("compare not aligned", {
        compare: cmp.compare,
        covered: cmp.covered,
        need: minCovered,
      });
      return;
    }
    compareSeriesByLayer = new Map();
    for (const layer of layers) {
      const built = buildCompareLayerSeries(
        cmp.aligned,
        script.chartBars,
        layer,
        chartSec,
        maxBack,
        cmp.compare,
      );
      compareSeriesByLayer.set(layer.label, built.series);
    }
    script.state.compareSymbol = cmp.compare;
    readyInit(script.state);
  } else {
    readyInit(script.state);
  }

  script.state.cfg = {
    chartSec,
    maxBack,
    deleteOnFill,
    boxLen,
    fillType,
    showLabels,
    showSizeOnLabel: inputs.showSizeOnLabel === true,
    showFvgNameOnLabel: inputs.showFvgNameOnLabel !== false,
    sizeLabelFormat:
      inputs.sizeLabelFormat === "points" || inputs.sizeLabelFormat === "ticks"
        ? inputs.sizeLabelFormat
        : "both",
    showFvg,
    showLiveForming,
    showIfvg,
    showPartial: true,
    maxFvgZones,
    maxIfvgZones,
    ifvgLabel: String(inputs.ifvgLabel ?? "IFVG"),
    borderWidth,
    borderDash,
    bullFill: inputsColorWithOpacity(
      inputs,
      "bullBoxColor",
      DEFAULT_FVG_BULL_COLOR,
      DEFAULT_FVG_FILL_OPACITY,
    ),
    bearFill: inputsColorWithOpacity(
      inputs,
      "bearBoxColor",
      DEFAULT_FVG_BEAR_COLOR,
      DEFAULT_FVG_FILL_OPACITY,
    ),
    bullBorder:
      bullBorderOp > 0
        ? inputsColorWithOpacity(inputs, "bullBorderColor", DEFAULT_FVG_BULL_COLOR, bullBorderOp)
        : null,
    bearBorder:
      bearBorderOp > 0
        ? inputsColorWithOpacity(inputs, "bearBorderColor", DEFAULT_FVG_BEAR_COLOR, bearBorderOp)
        : null,
    tapBorder: inputs.showTapBorder === true
      ? inputsColorWithOpacity(inputs, "tapBorderColor", DEFAULT_FVG_TAP_BORDER_COLOR, 100)
      : null,
    ifvgColor: ifvgFill,
    ifvgBorder: ifvgSetting.usesDefault ? null : ifvgFill,
    ifvgTextColor: ifvgSetting.color,
    partialFill: inputsColorWithOpacity(inputs, "partialCloseColor", "#ff9800", 20),
    formingBullFill: inputsColorWithOpacity(inputs, "formingBullColor", "#00bcd4", 25),
    formingBearFill: inputsColorWithOpacity(inputs, "formingBearColor", "#ab47bc", 25),
    requireCorrelatedFvg,
    correlatedFvgTf: String(inputs.correlatedFvgTf ?? "all"),
    sizeFilterLimits: resolveFvgSizeFilterLimits(ctx.primarySymbol ?? ctx.symbol, inputs),
    lastChartTime,
  };
  script.state.compareSeriesByLayer = compareSeriesByLayer;
  script.state.chartLayers = [];
  script.state.htfLayers = [];
  script.state.layerActive = new Map();
  script.state.layerIfvg = new Map();

  for (const layer of layers) {
    const built = buildLayerSeries(script, layer);
    if (!built) continue;
    if (layer.tfSec <= chartSec) {
      script.state.chartLayers.push({ layer, ...built });
      script.state.layerActive.set(layer.label, []);
      script.state.layerIfvg.set(layer.label, []);
    } else {
      scanLayerSeries(script, layer, built.series, built.startIdx);
      script.state.htfLayers.push({ layer, series: built.series });
    }
  }

  debugFvgInitOk(script, layers, script.state.cfg);
}
