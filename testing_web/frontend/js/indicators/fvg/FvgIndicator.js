import { BarScriptIndicator } from "/js/indicators/BarScriptIndicator.js";
import { symbolTicker } from "/js/app/symbol/ticker.js";
import { resolveFvgTimeframeRows } from "../ui/fvgTimeframesPanel.js";
import { compareSymbol } from "/js/indicators/security/compareSymbol.js";
import { compareBarsRecomputeKey } from "/js/indicators/security/compareBars.js";
import { overlayRecomputeKey } from "/js/indicators/overlayCache.js";
import { bindOverlayEngine } from "/js/indicators/script/overlayEngine.js";
import {
  incrementalOverlayNeedsRefresh,
  runIncrementalOverlay,
} from "/js/indicators/script/incrementalOverlay.js";
import { getSecuritySeries } from "/js/indicators/security/htfAccess.js";
import { FvgEngine, fvgAtBar } from "./FvgEngine.js";

const fvgOverlay = bindOverlayEngine(FvgEngine);
import { fvgHtf } from "./htf.js";
import { buildInputs } from "./inputs.js";

/** @param {import("../../types.js").IndicatorInstance} instance @param {object} ctx */
function htfRecomputeKey(instance, ctx) {
  /** @type {string[]} */
  const parts = [];
  for (const { tfId } of fvgHtf.enabledResolutions(instance.inputs, ctx.chartResolution ?? "1")) {
    const htf = getSecuritySeries(ctx, undefined, tfId);
    const bars = htf?.utcBars ?? [];
    const last = bars.at(-1);
    // Include last-bar OHLC: a tail refetch can finalize the forming bucket's
    // values without changing head/tail time or length.
    parts.push(
      `${tfId}:${bars[0]?.time ?? ""}|${last?.time ?? ""}|${bars.length}|${last?.high ?? ""},${last?.low ?? ""},${last?.close ?? ""}`,
    );
  }
  return parts.join(";");
}

/** Live-tick key — fields that can change forming FVG on the same candle. */
function formingLiveKey(instance, ctx) {
  const b = ctx.formingBar;
  if (!b) return "";
  const inputs = instance.inputs;
  const parts = [`t:${b.time}`];
  const boxesVisible = instance.style?.graphicBoxes !== false;
  if (inputs.showLiveForming !== false && inputs.showFvg !== false && boxesVisible) {
    parts.push(`hl:${b.high}|${b.low}`);
    if (inputs.sizeFilterOn === true) {
      parts.push(`cls:${b.close}`);
    }
    const utcBars = ctx.utcBars;
    const barSec = Number(ctx.barSec) || 60;
    if (utcBars?.length >= 3) {
      const hit = fvgAtBar(utcBars, utcBars.length - 1, barSec);
      parts.push(hit ? `fvg:${hit.kind}|${hit.top}|${hit.bottom}` : "fvg:none");
    }
  }
  if (inputs.showTapBorder === true) {
    parts.push(`tap:${b.high}|${b.low}`);
  }
  const fillType = inputs.filledType === "wick" ? "wick" : "close";
  const liveFill = inputs.deleteOnFill !== false || inputs.showPartial === true;
  if (liveFill) {
    parts.push(fillType === "wick" ? `wick:${b.high}|${b.low}` : `cls:${b.close}`);
  }
  if (inputs.requireCorrelatedFvg === true) {
    parts.push(compareBarsRecomputeKey(ctx, inputs, { ohlc: true }));
  }
  return parts.join("|");
}

class FvgIndicator extends BarScriptIndicator {

  constructor() {
    super("fvg", "FVG", "FVG");
    this.setOverlayPrimitive("boxes");
    this.setGraphicObjects([
      { styleKey: "graphicBoxes", label: "Boxes", overlay: "boxes" },
      { styleKey: "graphicLabels", label: "Labels", overlay: "labels" },
    ]);
    this.setInputs(buildInputs());
  }

  mergeStyleDefaults(style) {
    const boxesVisible =
      style.graphicBoxes !== false &&
      style.graphicForming !== false &&
      style.graphicIfvg !== false;
    return {
      ...style,
      graphicBoxes: style.graphicBoxes ?? boxesVisible,
      graphicLabels: style.graphicLabels ?? true,
    };
  }

  /** @param {object} [inputs] @param {string} [chartResolution] */
  inputSchema(inputs = {}, chartResolution = "1") {
    const options = fvgHtf.correlatedTfOptions(inputs, chartResolution);
    return buildInputs().map((item) =>
      item.id === "correlatedFvgTf" ? { ...item, options } : item,
    );
  }

  requiredChartBars(inputs, chartResolution) {
    return fvgHtf.requiredChartBars(inputs, chartResolution);
  }

  /** @param {import("../../types.js").IndicatorInstance} instance @param {{ symbol?: string, resolution?: string, bars?: object[] }} pane */
  collectDataNeeds(instance, pane) {
    const inputs = instance.inputs;
    const chartCount = Math.max(pane.bars?.length ?? 300, 300);
    const htfPad = fvgHtf.requiredHtfBars(inputs) + 20;
    /** @type {import("../../security/indicatorDataNeeds.js").IndicatorDataNeeds} */
    const needs = { htf: [], compare: [] };
    for (const { tfId } of fvgHtf.enabledResolutions(inputs, pane.resolution ?? "1")) {
      needs.htf.push({ symbol: pane.symbol ?? "", resolution: tfId, countBack: htfPad });
    }
    if (fvgHtf.requiresCorrelatedCompare(inputs)) {
      const sym = compareSymbol.resolve(inputs, pane.symbol ?? "");
      /** @type {import("../../security/indicatorDataNeeds.js").CompareNeed} */
      const compare = { symbol: sym, chartCountBack: chartCount, htf: [] };
      for (const { tfId } of fvgHtf.enabledResolutions(inputs, pane.resolution ?? "1")) {
        compare.htf.push({ resolution: tfId, countBack: htfPad });
      }
      needs.compare.push(compare);
    }
    return needs;
  }

  legendParams(instance, ctx = {}) {
    const inputs = instance.inputs;
    /** @type {string[]} */
    const params = [];
    const enabled = resolveFvgTimeframeRows(inputs).filter((r) => r.enabled);
    if (enabled.length) params.push(enabled.map((r) => r.label).join(", "));
    if (inputs.requireCorrelatedFvg === true) {
      params.push(symbolTicker(compareSymbol.resolve(inputs, ctx.primarySymbol ?? "")));
      const tf = inputs.correlatedFvgTf ?? "all";
      if (tf !== "all") {
        const opt = fvgHtf.correlatedTfOptions(inputs, ctx.chartResolution ?? "1").find((o) => o.id === tf);
        if (opt?.label) params.push(opt.label);
      }
    }
    return params;
  }

  /** @param {object} instance @param {object} ctx */
  overlayRecomputeExtra(instance, ctx) {
    let extra = "";
    if (instance.inputs.sizeFilterOn === true) {
      extra += `|sf:${instance.inputs.sizeFilterUnit}|${instance.inputs.sizeFilterMin}|${instance.inputs.sizeFilterMax}|${JSON.stringify(instance.inputs.sizeFilterRules ?? [])}`;
    }
    extra += `|lbl:${instance.inputs.showLabels}|${instance.style?.graphicLabels}|${instance.inputs.showSizeOnLabel}|${instance.inputs.showFvgNameOnLabel}|${instance.inputs.sizeLabelFormat}`;
    extra += `|fvgBc:${instance.inputs.showFvgBoxColors !== false}|${JSON.stringify(instance.inputs.fvgBoxColorsByTf ?? {})}`;
    if (instance.inputs.requireCorrelatedFvg !== true) return extra;
    const corrTf = instance.inputs.correlatedFvgTf ?? "all";
    return `${extra}|${compareBarsRecomputeKey(ctx, instance.inputs)}|${corrTf}`;
  }

  /**
   * @param {object[]} utcBars
   * @param {object[]} chartBars
   * @param {import("../../types.js").IndicatorInstance} instance
   * @param {object} [ctx]
   */
  static computeOverlay(utcBars, chartBars, instance, ctx = {}) {
    const baseKey = overlayRecomputeKey(instance, chartBars, FvgIndicator);
    const extra = FvgIndicator.prototype.overlayRecomputeExtra(instance, ctx);
    const chartKey = `${baseKey}|${extra}`;
    const liveKey = formingLiveKey(instance, ctx);
    const normalizePatch = (patched) => patched
      ? { output: patched.boxes ?? [], snapshot: patched.snapshot ?? null }
      : null;
    return runIncrementalOverlay({
      chartBars,
      instance,
      runtimeKey: "_overlayRuntime",
      keys: { chart: chartKey, data: htfRecomputeKey(instance, ctx), live: liveKey },
      full: () => {
        const output = super.computeOverlay(utcBars, chartBars, instance, ctx);
        const snapshot = instance._overlaySnapshot ?? null;
        delete instance._overlaySnapshot;
        return { output, snapshot };
      },
      patchData: (snapshot, previous) => normalizePatch(
        FvgIndicator.patchHtfOverlay(utcBars, chartBars, instance, ctx, snapshot, previous),
      ),
      patchAppend: (snapshot, previous) => normalizePatch(
        FvgIndicator.patchAppendOverlay(utcBars, chartBars, instance, ctx, snapshot, previous),
      ),
      patchLive: (snapshot, previous) => normalizePatch(
        FvgIndicator.patchLiveOverlay(utcBars, chartBars, instance, ctx, snapshot, previous),
      ),
    });
  }

  /**
   * @param {object[]} utcBars
   * @param {object[]} chartBars
   * @param {import("../../types.js").IndicatorInstance} instance
   * @param {object} ctx
   * @param {object} snapshot
   * @param {object[]} [previousBoxes]
   */
  static patchLiveOverlay(utcBars, chartBars, instance, ctx, snapshot, previousBoxes = []) {
    return fvgOverlay.runPatch(utcBars, chartBars, instance, ctx, snapshot, previousBoxes, "runLiveTick");
  }

  static patchAppendOverlay(utcBars, chartBars, instance, ctx, snapshot, previousBoxes = []) {
    return fvgOverlay.runPatch(utcBars, chartBars, instance, ctx, snapshot, previousBoxes, "runAppendBar");
  }

  static patchHtfOverlay(utcBars, chartBars, instance, ctx, snapshot, previousBoxes = []) {
    return fvgOverlay.runPatch(utcBars, chartBars, instance, ctx, snapshot, previousBoxes, "runHtfRefresh");
  }

  /** @param {import("../../types.js").IndicatorInstance} instance @param {object} ctx */
  static shouldRefreshOverlayOnCacheHit(instance, ctx) {
    const liveKey = formingLiveKey(instance, ctx);
    const rt = instance._overlayRuntime;
    if (!rt?.snapshot) return Boolean(ctx.formingBar);
    return incrementalOverlayNeedsRefresh(instance, liveKey, "_overlayRuntime");
  }

  /** @param {import("../../types.js").IndicatorInstance} instance */
  needsLiveOverlayRefresh(instance) {
    const inputs = instance.inputs;
    const style = instance.style ?? {};
    if (style.graphicBoxes === false) return false;
    const liveForming = inputs.showLiveForming !== false && inputs.showFvg !== false;
    const liveFill = inputs.deleteOnFill !== false || inputs.showPartial === true;
    if (liveForming || liveFill) return true;
    return inputs.requireCorrelatedFvg === true;
  }

  init() {
    this.state.engine = new FvgEngine(this);
    this.state.engine.init();
  }

  onBar() {
    this.state.engine?.onBar();
  }
}

BarScriptIndicator.define(FvgIndicator);

export default FvgIndicator;

export { fvgHtf } from "./htf.js";
