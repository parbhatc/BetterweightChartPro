import {
  DEFAULT_POSITION_DURATION_SEC,
  POSITION_INPUT_DEFAULTS,
  POSITION_STYLE_DEFAULTS,
} from "./constants.js";
import { positionGeometry } from "./geometry.js";
import { computePositionQty } from "./quantity.js";
import { resolvePositionStatsFields } from "./stats.js";

/** @param {import("../../types.js").UserDrawing} drawing */
export function finalizePositionDrawing(drawing) {
  const geom = positionGeometry(drawing);
  if (!geom) return drawing;
  const merged = {
    ...POSITION_INPUT_DEFAULTS,
    ...POSITION_STYLE_DEFAULTS,
    ...drawing,
    positionDurationSec: drawing.positionDurationSec ?? DEFAULT_POSITION_DURATION_SEC,
    showPriceLabels: drawing.showPriceLabels !== false,
    alwaysShowStats: Boolean(drawing.alwaysShowStats),
    compactStatsMode: Boolean(drawing.compactStatsMode),
    statsFields: resolvePositionStatsFields(drawing),
    statsPosition: drawing.statsPosition ?? POSITION_STYLE_DEFAULTS.statsPosition,
    color: drawing.color ?? POSITION_STYLE_DEFAULTS.color,
    colorOpacity: drawing.colorOpacity ?? POSITION_STYLE_DEFAULTS.colorOpacity,
    lineWidth: drawing.lineWidth ?? POSITION_STYLE_DEFAULTS.lineWidth,
    lineStyle: drawing.lineStyle ?? POSITION_STYLE_DEFAULTS.lineStyle,
    profitColor: drawing.profitColor ?? POSITION_STYLE_DEFAULTS.profitColor,
    profitOpacity: drawing.profitOpacity ?? POSITION_STYLE_DEFAULTS.profitOpacity,
    stopColor: drawing.stopColor ?? POSITION_STYLE_DEFAULTS.stopColor,
    stopOpacity: drawing.stopOpacity ?? POSITION_STYLE_DEFAULTS.stopOpacity,
    textColor: drawing.textColor ?? POSITION_STYLE_DEFAULTS.textColor,
    textColorOpacity: drawing.textColorOpacity ?? POSITION_STYLE_DEFAULTS.textColorOpacity,
    fontSize: drawing.fontSize ?? POSITION_STYLE_DEFAULTS.fontSize,
  };
  return {
    ...merged,
    positionEntryPrice: Number.isFinite(Number(drawing.positionEntryPrice))
      ? Number(drawing.positionEntryPrice)
      : geom.entryPrice,
    positionQty: computePositionQty(merged),
  };
}
