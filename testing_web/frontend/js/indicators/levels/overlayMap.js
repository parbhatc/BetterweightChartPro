import { mapUtcTimeToChartTime } from "/js/indicators/math/barTimeMap.js";
import { buildReleasePlan, resolveNewsLevels } from "/js/news/events.js";
import { tickSizeFromSymbol } from "/js/indicators/symbol.js";
import {
  resolveSessionLevels,
  resolveTimeLevels,
} from "../ui/levelsLayersPanel.js";
import {
  debugLevelsEngineResult,
  debugLevelsOverlayStart,
  debugLevelsPriceSanity,
  debugLevelsReplayStep,
  debugLevelsTimeMapping,
} from "../math/levelsDebug.js";
import {
  LEVEL_REFERENCE_PALETTE,
  LEVEL_SESSION_LABEL_PALETTE,
  levelEnginePalette,
  migrateLegacyLevelColor,
  resolveLevelPalettePreset,
} from "./palette.js";
import { isHtfLevelLabel, levelLabelTextColor } from "./labels.js";

/** @typedef {import("/js/indicators/script/liquidityMatrix.js").LiqLine} LiqLine */

/** @param {LiqLine[]} lines @param {object[]} utcBars @param {object[]} chartBars @param {object} style */
export function levelsToOverlayLines(lines, utcBars, chartBars, style) {
  const showLabels = style.graphicLabels !== false;
  const mapTime = (utc, chartTime) => chartTime ?? mapUtcTimeToChartTime(utc, utcBars, chartBars);

  return lines.map((lvl) => {
    const levelLabelsVisible = showLabels && lvl.showLabel !== false;
    const standaloneSession = Boolean(lvl.sessionTag) && lvl.splitSessionLabel !== true;
    const sessionLabel = lvl.splitSessionLabel
      ? lvl.sessionLabel
      : standaloneSession
        ? `${lvl.sessionTag} ${String(lvl.kind ?? "").toLowerCase()}`
        : "";
    const sessionLabelColor = /\bLondon\b/.test(sessionLabel)
      ? LEVEL_SESSION_LABEL_PALETTE.london
      : /\bAsia\b/.test(sessionLabel)
        ? LEVEL_SESSION_LABEL_PALETTE.asia
        : (lvl.sessionLabelColor ?? lvl.color);
    return {
      timeStart: mapTime(lvl.startTime, lvl.startChartTime),
      timeEnd: mapTime(
        lvl.endTime ?? lvl.startTime,
        lvl.endChartTime ?? lvl.sweepChartTime ?? lvl.startChartTime,
      ),
      priceStart: lvl.price,
      priceEnd: lvl.price,
      color: lvl.color,
      width: lvl.lineWidth ?? 2,
      swept: Boolean(lvl.swept),
      dash: lvl.swept ? [2, 3] : (lvl.lineDash ?? []),
      extendLeft: lvl.extendLeft === true,
      extendRight: lvl.extendRight === true,
      label: levelLabelsVisible && !standaloneSession && lvl.label ? lvl.label : "",
      labelTextColor: levelLabelTextColor(lvl.label, lvl.color),
      labelEmphasis: isHtfLevelLabel(lvl.label),
      labelAnchor: "right",
      sessionLabel: levelLabelsVisible ? sessionLabel : "",
      sessionLabelColor,
      kind: lvl.kind,
    };
  });
}

/** @param {object} inputs @param {object} style @param {object} ctx @param {object} engine @param {import("./htf.js").LevelsHtf} [levelsHtf] */
export function buildLevelsEngineOpts(inputs, style, ctx, engine, levelsHtf) {
  // Preserve the original high-contrast Levels colors unless Gray was
  // explicitly selected. Older saved layouts do not have this input.
  const indicatorPreset = resolveLevelPalettePreset(inputs.indicatorAppearancePreset);
  const presetPalette = levelEnginePalette(
    indicatorPreset,
    engine.htfStyles,
    engine.sessionDefs,
  );
  const newsMasterEnabled = ctx.isNewsEnabled?.() !== false;
  const newsIndicatorEnabled = inputs.newsEnabled !== false;
  const newsRows =
    newsMasterEnabled && newsIndicatorEnabled
      ? resolveNewsLevels(inputs).filter((r) => r.enabled !== false)
      : [];
  const newsByDay =
    newsMasterEnabled && newsIndicatorEnabled ? (ctx.getNewsByDay?.() ?? {}) : {};

  return {
    timeLayers: resolveTimeLevels(inputs),
    sessionLayers: resolveSessionLevels(inputs),
    newsRows,
    newsByDay,
    releasePlan: buildReleasePlan(newsByDay, newsRows),
    pivotLeftBars: inputs.pivotLeftBars,
    pivotRightBars: inputs.pivotRightBars,
    maxUnswept: inputs.maxUnswept,
    maxSwept: inputs.maxSwept,
    sweptHoldBars: inputs.sweptHoldBars,
    maxSessions: inputs.maxSessions,
    tickSize: tickSizeFromSymbol(ctx.symbolInfo),
    chartSec: ctx.barSec ?? 60,
    symbol: ctx.primarySymbol ?? ctx.symbol,
    maxBarsBack: Math.max(10, Number(inputs.maxBarsBack) || 300),
    htfBarsNeeded: levelsHtf?.requiredHtfBars(inputs) ?? Math.max(10, Number(inputs.maxBarsBack) || 300),
    getSecurityBars: ctx.getSecurityBars,
    getBars: ctx.getBars,
    getHtfBars: ctx.getHtfBars,
    requestSecurityBars: ctx.requestSecurityBars,
    requestBars: ctx.requestBars,
    requestHtfBars: ctx.requestHtfBars,
    showLabels: style.graphicLabels !== false,
    showPriceInLabels: inputs.showPriceInLabels !== false,
    preferDatafeedHtf: Boolean(ctx.isReplayLocked?.()),
    replayHostControlled: Boolean(ctx.replayHostControlled),
    mergeConfluence: inputs.mergeConfluence !== false,
    previousDayEnabled: inputs.previousDayEnabled !== false,
    previousDayColor: migrateLegacyLevelColor(inputs.previousDayColor, "#f59e0b", LEVEL_REFERENCE_PALETTE.previousDay, indicatorPreset),
    previousWeekEnabled: inputs.previousWeekEnabled === true,
    previousWeekColor: migrateLegacyLevelColor(inputs.previousWeekColor, "#38bdf8", LEVEL_REFERENCE_PALETTE.previousWeek, indicatorPreset),
    midpointEnabled: inputs.midpointEnabled === true,
    midpointStartTime: String(inputs.midpointStartTime ?? "18:00"),
    midpointLineStyle: String(inputs.midpointLineStyle ?? "dotted"),
    midpointLineWidth: Math.min(5, Math.max(1, Number(inputs.midpointLineWidth) || 1)),
    midpointColor: migrateLegacyLevelColor(
      migrateLegacyLevelColor(inputs.midpointColor, "#a3e635", LEVEL_REFERENCE_PALETTE.midpoint),
      "#71805b",
      LEVEL_REFERENCE_PALETTE.midpoint,
    ),
    htfStyles: presetPalette.htfStyles,
    sessionDefs: presetPalette.sessionDefs,
  };
}

export {
  debugLevelsEngineResult,
  debugLevelsOverlayStart,
  debugLevelsPriceSanity,
  debugLevelsReplayStep,
  debugLevelsTimeMapping,
};
