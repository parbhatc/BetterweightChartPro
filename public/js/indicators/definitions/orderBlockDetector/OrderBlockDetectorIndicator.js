import { BarScriptIndicator } from "../../BarScriptIndicator.js";
import {
  createColor,
  createInt,
  createSelect,
} from "../../builders.js";
import { styleColor, styleColorWithOpacity } from "../../styleColor.js";
import { applyColorOpacity } from "../../../ui/color/picker.js";

const COLORS = {
  bull: "#169400",
  bear: "#ff1100",
  average: "#9598a1",
};

const LINE_STYLE_LABELS = {
  solid: "⎯⎯⎯",
  dashed: "----",
  dotted: "····",
};

const LINE_DASHES = {
  solid: [],
  dashed: [6, 4],
  dotted: [2, 3],
};

function finiteBar(bar) {
  return bar && [bar.high, bar.low, bar.close, bar.volume]
    .every((value) => Number.isFinite(Number(value)));
}

/** Pine-compatible pivot-high confirmation: equal highs to the left are allowed; equal highs to the right reject. */
export function isVolumePivotHighAt(bars, confirmIndex, length) {
  const len = Math.max(1, Math.trunc(Number(length) || 1));
  const candidateIndex = confirmIndex - len;
  const first = confirmIndex - len * 2;
  if (first < 0 || confirmIndex >= bars.length || candidateIndex < 0) return false;
  const candidate = Number(bars[candidateIndex]?.volume);
  if (!Number.isFinite(candidate)) return false;

  let lastMaximumIndex = first;
  let maximum = -Infinity;
  for (let i = first; i <= confirmIndex; i += 1) {
    const volume = Number(bars[i]?.volume);
    if (!Number.isFinite(volume)) return false;
    if (volume >= maximum) {
      maximum = volume;
      lastMaximumIndex = i;
    }
  }
  return lastMaximumIndex === candidateIndex;
}

function rollingExtreme(bars, endIndex, length, field, highSide) {
  const first = Math.max(0, endIndex - length + 1);
  let value = highSide ? -Infinity : Infinity;
  for (let i = first; i <= endIndex; i += 1) {
    const current = Number(bars[i]?.[field]);
    if (!Number.isFinite(current)) continue;
    value = highSide ? Math.max(value, current) : Math.min(value, current);
  }
  return Number.isFinite(value) ? value : null;
}

function orderBlock(side, bar, chartTime, index) {
  const high = Number(bar.high);
  const low = Number(bar.low);
  const midpoint = (high + low) / 2;
  const top = side === "bull" ? midpoint : high;
  const bottom = side === "bull" ? low : midpoint;
  return {
    side,
    index,
    time: chartTime,
    top,
    bottom,
    average: (top + bottom) / 2,
  };
}

/**
 * Detect active order blocks from the loaded history.
 * Newest blocks are returned first, matching the indicator's display order.
 */
export function detectOrderBlocks(utcBars, chartBars = utcBars, inputs = {}) {
  const length = Math.max(1, Math.trunc(Number(inputs.volumePivotLength) || 5));
  const mitigation = inputs.mitigation === "wick" ? "wick" : "close";
  const bullish = [];
  const bearish = [];
  let swingState = 0;

  for (let i = 0; i < utcBars.length; i += 1) {
    const bar = utcBars[i];
    if (!finiteBar(bar)) continue;

    const swingIndex = i - length;
    if (swingIndex >= 0 && finiteBar(utcBars[swingIndex])) {
      const upper = rollingExtreme(utcBars, i, length, "high", true);
      const lower = rollingExtreme(utcBars, i, length, "low", false);
      if (upper != null && Number(utcBars[swingIndex].high) > upper) swingState = 0;
      else if (lower != null && Number(utcBars[swingIndex].low) < lower) swingState = 1;
    }

    if (isVolumePivotHighAt(utcBars, i, length)) {
      const pivotIndex = i - length;
      const pivotBar = utcBars[pivotIndex];
      const time = chartBars[pivotIndex]?.time ?? pivotBar?.time;
      if (finiteBar(pivotBar) && Number.isFinite(Number(time))) {
        const side = swingState === 1 ? "bull" : "bear";
        const block = orderBlock(side, pivotBar, Number(time), pivotIndex);
        (side === "bull" ? bullish : bearish).unshift(block);
      }
    }

    const targetField = mitigation === "wick" ? null : "close";
    const bullTarget = targetField
      ? rollingExtreme(utcBars, i, length, targetField, false)
      : rollingExtreme(utcBars, i, length, "low", false);
    const bearTarget = targetField
      ? rollingExtreme(utcBars, i, length, targetField, true)
      : rollingExtreme(utcBars, i, length, "high", true);

    if (bullTarget != null) {
      for (let j = bullish.length - 1; j >= 0; j -= 1) {
        if (bullTarget < bullish[j].bottom) bullish.splice(j, 1);
      }
    }
    if (bearTarget != null) {
      for (let j = bearish.length - 1; j >= 0; j -= 1) {
        if (bearTarget > bearish[j].top) bearish.splice(j, 1);
      }
    }
  }

  return { bullish, bearish };
}

function blockItems(blocks, count, palette, state) {
  const items = [];
  for (const block of blocks.slice(0, count)) {
    if (state.showBoxes) {
      items.push({
        timeStart: block.time,
        timeEnd: block.time,
        extendRight: true,
        priceTop: block.top,
        priceBottom: block.bottom,
        fillColor: palette.fill,
        borderColor: palette.border,
        borderWidth: 1,
      });
    }
    if (state.showLines) {
      items.push({
        kind: "line",
        timeStart: block.time,
        timeEnd: block.time,
        extendRight: true,
        priceTop: block.average,
        priceBottom: block.average,
        lineColor: palette.average,
        lineWidth: state.lineWidth,
        lineDash: state.lineDash,
      });
    }
  }
  return items;
}

class OrderBlockDetectorIndicator extends BarScriptIndicator {
  constructor() {
    super("order_block_detector", "Order Block Detector", "Order Block Detector");
    this.setOverlayPrimitive("boxes");
    this.setGraphicObjects([
      { styleKey: "graphicBoxes", label: "Boxes", overlay: "boxes" },
      { styleKey: "graphicLines", label: "Lines", overlay: "boxes" },
    ]);
    this.setInputs([
      createInt("volumePivotLength", "Volume Pivot Length", 5, { min: 1 }),
      {
        type: "row",
        header: "Bullish OB",
        fields: [
          createInt("bullishCount", "Bullish OB", 3, { min: 1 }),
          createColor("bullFillColor", "Fill", { color: COLORS.bull, opacity: 20 }, { store: "style" }),
          createColor("bullBorderColor", "Border", { color: COLORS.bull, opacity: 100 }, { store: "style" }),
          createColor("bullAverageColor", "Average", { color: COLORS.average, opacity: 63 }, { store: "style" }),
        ],
      },
      {
        type: "row",
        header: "Bearish OB",
        fields: [
          createInt("bearishCount", "Bearish OB", 3, { min: 1 }),
          createColor("bearFillColor", "Fill", { color: COLORS.bear, opacity: 20 }, { store: "style" }),
          createColor("bearBorderColor", "Border", { color: COLORS.bear, opacity: 100 }, { store: "style" }),
          createColor("bearAverageColor", "Average", { color: COLORS.average, opacity: 63 }, { store: "style" }),
        ],
      },
      createSelect("averageLineStyle", "Average Line Style", "solid", [
        { id: "solid", label: LINE_STYLE_LABELS.solid },
        { id: "dashed", label: LINE_STYLE_LABELS.dashed },
        { id: "dotted", label: LINE_STYLE_LABELS.dotted },
      ]),
      createInt("averageLineWidth", "Average Line Width", 1, { min: 1 }),
      createSelect("mitigation", "Mitigation Methods", "close", [
        { id: "wick", label: "Wick" },
        { id: "close", label: "Close" },
      ]),
    ]);
  }

  mergeStyleDefaults(style) {
    return {
      ...style,
      graphicBoxes: style.graphicBoxes ?? true,
      graphicLines: style.graphicLines ?? true,
      bullFillColor: style.bullFillColor ?? COLORS.bull,
      bullFillColorOpacity: style.bullFillColorOpacity ?? 20,
      bullBorderColor: style.bullBorderColor ?? COLORS.bull,
      bullBorderColorOpacity: style.bullBorderColorOpacity ?? 100,
      bullAverageColor: style.bullAverageColor ?? COLORS.average,
      bullAverageColorOpacity: style.bullAverageColorOpacity ?? 63,
      bearFillColor: style.bearFillColor ?? COLORS.bear,
      bearFillColorOpacity: style.bearFillColorOpacity ?? 20,
      bearBorderColor: style.bearBorderColor ?? COLORS.bear,
      bearBorderColorOpacity: style.bearBorderColorOpacity ?? 100,
      bearAverageColor: style.bearAverageColor ?? COLORS.average,
      bearAverageColorOpacity: style.bearAverageColorOpacity ?? 63,
    };
  }

  legendParams(instance) {
    const inputs = instance.inputs ?? {};
    const styleLabel = LINE_STYLE_LABELS[inputs.averageLineStyle] ?? LINE_STYLE_LABELS.solid;
    return [
      String(Math.max(1, Math.trunc(Number(inputs.volumePivotLength) || 5))),
      String(Math.max(1, Math.trunc(Number(inputs.bullishCount) || 3))),
      String(Math.max(1, Math.trunc(Number(inputs.bearishCount) || 3))),
      styleLabel,
      String(Math.max(1, Math.trunc(Number(inputs.averageLineWidth) || 1))),
      inputs.mitigation === "wick" ? "Wick" : "Close",
    ];
  }

  needsLiveOverlayRefresh() {
    return true;
  }

  requiredChartBars(inputs) {
    const length = Math.max(1, Math.trunc(Number(inputs?.volumePivotLength) || 5));
    return Math.max(500, length * 40);
  }

  static computeOverlay(utcBars, chartBars, instance) {
    const inputs = instance.inputs ?? {};
    const style = instance.style ?? {};
    const detected = detectOrderBlocks(utcBars, chartBars, inputs);
    const lineStyle = LINE_DASHES[inputs.averageLineStyle] ? inputs.averageLineStyle : "solid";
    const state = {
      showBoxes: style.graphicBoxes !== false,
      showLines: style.graphicLines !== false,
      lineWidth: Math.max(1, Math.trunc(Number(inputs.averageLineWidth) || 1)),
      lineDash: LINE_DASHES[lineStyle],
    };
    if (!state.showBoxes && !state.showLines) return [];

    const bullishPalette = {
      fill: styleColorWithOpacity(style, "bullFillColor", COLORS.bull, 20),
      border: applyColorOpacity(styleColor(style, "bullBorderColor", COLORS.bull), 30),
      average: styleColorWithOpacity(style, "bullAverageColor", COLORS.average, 63),
    };
    const bearishPalette = {
      fill: styleColorWithOpacity(style, "bearFillColor", COLORS.bear, 20),
      border: applyColorOpacity(styleColor(style, "bearBorderColor", COLORS.bear), 30),
      average: styleColorWithOpacity(style, "bearAverageColor", COLORS.average, 63),
    };

    return [
      ...blockItems(
        detected.bullish,
        Math.max(1, Math.trunc(Number(inputs.bullishCount) || 3)),
        bullishPalette,
        state,
      ),
      ...blockItems(
        detected.bearish,
        Math.max(1, Math.trunc(Number(inputs.bearishCount) || 3)),
        bearishPalette,
        state,
      ),
    ];
  }
}

BarScriptIndicator.define(OrderBlockDetectorIndicator);

export default OrderBlockDetectorIndicator;
