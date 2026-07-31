import { BarScriptIndicator } from "../../BarScriptIndicator.js";
import {
  createBool,
  createColor,
  createInt,
  createSelect,
  inlinePair,
} from "../../builders.js";
import {
  pivotBarIndex,
  pivotHighStrictAt,
  pivotLens,
  pivotLowStrictAt,
} from "../../math/pivots.js";
import { styleColor } from "../../styleColor.js";
import { tickSizeFromSymbol } from "../../symbol.js";

const COLORS = {
  lrlr: "#089981",
  hrlr: "#f23645",
};

function confirmedPivots(bars, chartBars, left, right, waitClose, liveFormingTime = null) {
  const highs = [];
  const lows = [];
  for (let confirmIndex = left + right; confirmIndex < bars.length; confirmIndex += 1) {
    const isLiveConfirmation = confirmIndex === bars.length - 1 && (
      bars[confirmIndex]?.isForming === true ||
      (liveFormingTime != null && bars[confirmIndex]?.time === liveFormingTime)
    );
    if (waitClose && isLiveConfirmation) continue;
    const pivotIndex = pivotBarIndex(confirmIndex, right);
    const time = chartBars[pivotIndex]?.time ?? bars[pivotIndex]?.time;
    if (time == null) continue;

    const high = pivotHighStrictAt(bars, confirmIndex, left, right);
    if (high != null) highs.push({ index: pivotIndex, time, price: Number(high) });

    const low = pivotLowStrictAt(bars, confirmIndex, left, right);
    if (low != null) lows.push({ index: pivotIndex, time, price: Number(low) });
  }
  return { highs, lows };
}

function hasOpposingFvg(bars, fromIndex, toIndex, highSide) {
  const start = Math.max(2, fromIndex + 1);
  const end = Math.min(bars.length - 1, toIndex + 1);
  for (let i = start; i <= end; i += 1) {
    if (highSide && Number(bars[i].high) < Number(bars[i - 2].low)) return true;
    if (!highSide && Number(bars[i].low) > Number(bars[i - 2].high)) return true;
  }
  return false;
}

function isLrlr(previous, current, highSide, tolerance) {
  return highSide
    ? current.price <= previous.price + tolerance
    : current.price >= previous.price - tolerance;
}

function lineForPair(previous, current, type, highSide, state, count = 2) {
  const lrlr = type === "LRLR";
  const label = state.showLabels
    ? state.mode === "stacked" && lrlr
      ? `LRLR ×${count}`
      : type
    : "";
  return {
    timeStart: previous.time,
    priceStart: previous.price,
    timeEnd: current.time,
    priceEnd: current.price,
    color: lrlr ? state.lrlrColor : state.hrlrColor,
    width: state.lineWidth,
    dash: lrlr ? [] : [3, 3],
    swept: !lrlr,
    label,
    labelPlain: true,
    labelTextColor: lrlr ? state.lrlrColor : state.hrlrColor,
    labelStyle: highSide ? "up" : "down",
  };
}

function failureSwingLines(pivots, highSide, state) {
  const lines = [];
  for (let i = 1; i < pivots.length; i += 1) {
    const previous = pivots[i - 1];
    const current = pivots[i];
    const lrlr = isLrlr(previous, current, highSide, state.tolerance);
    if (lrlr && state.showLrlr) {
      lines.push(lineForPair(previous, current, "LRLR", highSide, state));
    } else if (!lrlr && state.showHrlr) {
      lines.push(lineForPair(previous, current, "HRLR", highSide, state));
    }
  }
  return lines;
}

function stackedRunLines(pivots, bars, highSide, state) {
  const lines = [];
  let run = [];

  for (let i = 1; i < pivots.length; i += 1) {
    const previous = pivots[i - 1];
    const current = pivots[i];
    const lrlr = isLrlr(previous, current, highSide, state.tolerance);
    const blocked =
      state.requireCleanPath &&
      hasOpposingFvg(bars, previous.index, current.index, highSide);

    if (lrlr && !blocked) {
      if (!run.length || run.at(-1) !== previous) run = [previous];
      run.push(current);
      // Preserve every closed-bar milestone. Extending a confirmed ×4 run to
      // ×5 appends a new line instead of replacing historical output.
      if (state.showLrlr && run.length >= state.minimumPivots) {
        lines.push(lineForPair(run[0], current, "LRLR", highSide, state, run.length));
      }
      continue;
    }

    run = [];
    if (!lrlr && state.showHrlr) {
      lines.push(lineForPair(previous, current, "HRLR", highSide, state));
    }
  }
  return lines;
}

class LiquidityRunsIndicator extends BarScriptIndicator {
  constructor() {
    super("lrlr_hrlr", "LRLR / HRLR", "LRLR / HRLR Liquidity Runs");
    this.setOverlayPrimitive("lines");
    this.setGraphicObjects([
      { styleKey: "graphicLines", label: "Liquidity-run lines", overlay: "lines" },
    ]);
    this.setInputs([
      createSelect("mode", "Detection mode", "failure", [
        { id: "failure", label: "Failure swings" },
        { id: "stacked", label: "Stacked runs" },
      ], { section: "Detection" }),
      createInt("leftLen", "Pivot left", 3, { min: 1, section: "Pivots", inline: true }),
      createInt("rightLen", "Pivot right", 3, { min: 1, section: "Pivots", inline: true }),
      createInt("toleranceTicks", "Sweep tolerance (ticks)", 0, { min: 0, section: "Detection" }),
      createBool("waitClose", "Wait for confirmation close", true, { section: "Detection" }),
      createBool("showHighs", "High-side liquidity", true, { section: "Visibility" }),
      createBool("showLows", "Low-side liquidity", true, { section: "Visibility" }),
      createBool("showLrlr", "Show LRLR", true, { section: "Visibility" }),
      createBool("showHrlr", "Show HRLR", false, { section: "Visibility" }),
      createBool("showLabels", "Show labels", true, { section: "Visibility" }),
      createInt("minimumPivots", "Minimum pivots", 4, {
        min: 3,
        section: "Stacked runs",
        disabled: (inputs) => inputs.mode !== "stacked",
      }),
      createBool("requireCleanPath", "Require no opposing FVG", true, {
        section: "Stacked runs",
        disabled: (inputs) => inputs.mode !== "stacked",
      }),
      createInt("maxPatterns", "Maximum patterns", 100, { min: 1, section: "Limits" }),
      inlinePair(
        "Style",
        createColor("lrlrColor", "LRLR", { color: COLORS.lrlr, opacity: 100 }, { store: "style" }),
        createColor("hrlrColor", "HRLR", { color: COLORS.hrlr, opacity: 100 }, { store: "style" }),
      ),
      createInt("lineWidth", "Line width", 2, { min: 1, section: "Style", store: "style" }),
    ]);
  }

  mergeStyleDefaults(style) {
    return {
      ...style,
      graphicLines: style.graphicLines ?? true,
      lrlrColor: style.lrlrColor ?? COLORS.lrlr,
      hrlrColor: style.hrlrColor ?? COLORS.hrlr,
      lineWidth: style.lineWidth ?? 2,
    };
  }

  legendParams(instance) {
    const [left, right] = pivotLens(instance.inputs, "leftLen", "rightLen", 3);
    return [
      instance.inputs?.mode === "stacked" ? "Stacked" : "Failure swings",
      `${left}/${right}`,
    ];
  }

  needsLiveOverlayRefresh(instance) {
    return instance.inputs?.waitClose === false;
  }

  static computeOverlay(utcBars, chartBars, instance, ctx = {}) {
    const inputs = instance.inputs ?? {};
    const style = instance.style ?? {};
    const [left, right] = pivotLens(inputs, "leftLen", "rightLen", 3);
    const state = {
      mode: inputs.mode === "stacked" ? "stacked" : "failure",
      tolerance: Math.max(0, Number(inputs.toleranceTicks) || 0) * tickSizeFromSymbol(ctx.symbolInfo),
      minimumPivots: Math.max(3, Math.trunc(Number(inputs.minimumPivots) || 4)),
      requireCleanPath: inputs.requireCleanPath !== false,
      showLrlr: inputs.showLrlr !== false,
      showHrlr: inputs.showHrlr === true,
      showLabels: inputs.showLabels !== false,
      lrlrColor: styleColor(style, "lrlrColor", COLORS.lrlr),
      hrlrColor: styleColor(style, "hrlrColor", COLORS.hrlr),
      lineWidth: Math.max(1, Number(style.lineWidth) || 2),
    };
    const pivots = confirmedPivots(
      utcBars,
      chartBars,
      left,
      right,
      inputs.waitClose !== false,
      ctx.formingBar?.time ?? null,
    );
    const collect = (series, highSide) => state.mode === "stacked"
      ? stackedRunLines(series, utcBars, highSide, state)
      : failureSwingLines(series, highSide, state);
    const lines = [];
    if (inputs.showHighs !== false) {
      lines.push(...collect(pivots.highs, true));
    }
    if (inputs.showLows !== false) {
      lines.push(...collect(pivots.lows, false));
    }
    lines.sort((a, b) => a.timeEnd - b.timeEnd || a.timeStart - b.timeStart);
    const maxPatterns = Math.max(1, Math.trunc(Number(inputs.maxPatterns) || 100));
    return lines.slice(-maxPatterns);
  }
}

BarScriptIndicator.define(LiquidityRunsIndicator);

export default LiquidityRunsIndicator;
