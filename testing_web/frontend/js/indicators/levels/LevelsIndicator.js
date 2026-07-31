import {
  DEFAULT_SESSION_LEVELS,
  DEFAULT_TIME_LEVELS,
  resolveSessionLevels,
  resolveTimeLevels,
} from "../ui/levelsLayersPanel.js";
import { DEFAULT_NEWS_LEVELS } from "../ui/newsLevelsPanel.js";
import { resolveNewsLevels } from "/js/news/events.js";
import { LevelsEngine } from "./LevelsEngine.js";
import { BarScriptIndicator } from "/js/indicators/BarScriptIndicator.js";
import {
  createBool,
  createColor,
  createField,
  createInt,
  createSelect,
} from "/js/indicators/builders.js";
import { levelsHtf } from "./htf.js";
import {
  htfPendingForLayers,
  htfSeriesRecomputeKey,
} from "/js/indicators/security/htfPolicy.js";
import { LEVEL_REFERENCE_PALETTE } from "./palette.js";

const HALF_HOUR_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 ? 30 : 0;
  const id = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const suffix = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 || 12;
  return { id, label: `${hour12}:${String(minute).padStart(2, "0")} ${suffix}` };
});

const MIDPOINT_END_OPTIONS = [
  { id: "current", label: "Current candle" },
  ...HALF_HOUR_OPTIONS,
];

function referencePeriodResolutions(inputs) {
  return inputs.previousDayEnabled === true || inputs.previousWeekEnabled === true
    ? ["60"]
    : [];
}

class LevelsIndicator extends BarScriptIndicator {

  static overlayRecomputeThrottleMs = 100;

  constructor() {
    super("levels", "Levels", "Levels");
    this.setOverlayPrimitive("lines");
    this.setGraphicObjects([
      { styleKey: "graphicLines", label: "Lines", overlay: "lines" },
      { styleKey: "graphicLabels", label: "Labels" },
    ]);
    this.setInputs([
      createField("timeLevels", "timeLevels", DEFAULT_TIME_LEVELS, {
        title: "Time levels",
        section: "Time levels",
      }),
      createField("sessionLevels", "sessionLevels", DEFAULT_SESSION_LEVELS, {
        title: "Sessions",
        section: "Sessions",
      }),
      createBool("previousDayEnabled", "PDH / PDL", false, { section: "Previous periods" }),
      createColor("previousDayColor", "PDH / PDL color", { color: LEVEL_REFERENCE_PALETTE.previousDay, opacity: 100 }, {
        section: "Previous periods",
        disabled: (inputs) => inputs.previousDayEnabled !== true,
      }),
      createBool("previousWeekEnabled", "PWH / PWL", false, { section: "Previous periods" }),
      createColor("previousWeekColor", "PWH / PWL color", { color: LEVEL_REFERENCE_PALETTE.previousWeek, opacity: 100 }, {
        section: "Previous periods",
        disabled: (inputs) => inputs.previousWeekEnabled !== true,
      }),
      createBool("midpointEnabled", "Session midpoint", false, { section: "Session midpoint" }),
      createSelect("midpointStartTime", "Start", "18:00", HALF_HOUR_OPTIONS, {
        section: "Session midpoint",
        inline: true,
        disabled: (inputs) => inputs.midpointEnabled !== true,
      }),
      createSelect("midpointEndTime", "End", "current", MIDPOINT_END_OPTIONS, {
        section: "Session midpoint",
        inline: true,
        disabled: (inputs) => inputs.midpointEnabled !== true,
      }),
      createColor("midpointColor", "Midpoint color", { color: LEVEL_REFERENCE_PALETTE.midpoint, opacity: 100 }, {
        section: "Session midpoint",
        disabled: (inputs) => inputs.midpointEnabled !== true,
      }),
      createBool("newsEnabled", "News", true, { section: "News" }),
      createField("newsLevels", "newsLevels", DEFAULT_NEWS_LEVELS, {
        title: "Event types",
        section: "News",
      }),
      createInt("pivotLeftBars", "Pivot left bars", 1, { min: 1, section: "Pivot", inline: true }),
      createInt("pivotRightBars", "Pivot right bars", 1, { min: 1, section: "Pivot", inline: true }),
      createInt("maxBarsBack", "Max bars to find levels", 300, {
        min: 10,
        section: "Display limits",
      }),
      createInt("maxUnswept", "Max unswept levels", 15, {
        min: 1,
        section: "Display limits",
      }),
      createInt("maxSwept", "Max swept levels", 5, {
        min: 0,
        section: "Display limits",
      }),
      createInt("maxSessions", "Max session instances", 3, { min: 1, section: "Display limits" }),
      createBool("mergeConfluence", "Merge confluence levels", true, { section: "Confluence" }),
      createColor("confHiColor", "Confluence high", { color: LEVEL_REFERENCE_PALETTE.confluenceHigh, opacity: 100 }, {
        section: "Confluence",
        inline: true,
      }),
      createColor("confLoColor", "Confluence low", { color: LEVEL_REFERENCE_PALETTE.confluenceLow, opacity: 100 }, {
        section: "Confluence",
        inline: true,
        disabled: (inputs) => inputs.mergeConfluence === false,
      }),
    ]);
  }

  mergeStyleDefaults(style) {
    return {
      ...style,
      graphicLines: style.graphicLines ?? true,
      graphicLabels: style.graphicLabels ?? true,
    };
  }

  requiredChartBars(inputs, chartResolution) {
    return levelsHtf.requiredChartBars(inputs, chartResolution);
  }

  /** @param {import("../../types.js").IndicatorInstance} instance @param {{ symbol?: string, resolution?: string, bars?: object[] }} pane */
  collectDataNeeds(instance, pane) {
    const inputs = instance.inputs;
    const chartRes = pane.resolution ?? "1";
    const chartBars = pane.bars?.length ?? 300;
    /** @type {import("../../security/indicatorDataNeeds.js").IndicatorDataNeeds} */
    const needs = { htf: [] };
    for (const { tfId, tfSec } of levelsHtf.enabledResolutions(inputs, chartRes)) {
      needs.htf.push({
        symbol: pane.symbol ?? "",
        resolution: tfId,
        countBack: levelsHtf.requiredHtfCountForLayer(inputs, chartBars, chartRes, tfSec),
      });
    }
    for (const tfId of referencePeriodResolutions(inputs)) {
      if (needs.htf.some((need) => need.resolution === tfId)) continue;
      needs.htf.push({
        symbol: pane.symbol ?? "",
        resolution: tfId,
        countBack: 240,
      });
    }
    return needs;
  }

  /** @param {import("../../types.js").IndicatorInstance} instance @param {object} ctx */
  overlayPending(instance, ctx) {
    if (levelsHtf.htfPending(instance.inputs, ctx)) return true;
    const refs = referencePeriodResolutions(instance.inputs);
    if (!refs.length) return false;
    return htfPendingForLayers(
      ctx,
      ctx.primarySymbol ?? ctx.symbol,
      refs,
      240,
      { strict: true },
    );
  }

  legendParams(instance) {
    const enabled = [
      ...resolveTimeLevels(instance.inputs).filter((r) => r.enabled),
      ...resolveSessionLevels(instance.inputs).filter((r) => r.enabled),
    ];
    if (instance.inputs.newsEnabled !== false) {
      enabled.push(...resolveNewsLevels(instance.inputs).filter((r) => r.enabled !== false));
    }
    if (instance.inputs.previousDayEnabled === true) enabled.push({ label: "PDH/PDL" });
    if (instance.inputs.previousWeekEnabled === true) enabled.push({ label: "PWH/PWL" });
    if (instance.inputs.midpointEnabled === true) enabled.push({ label: "Mid" });
    if (!enabled.length) return [];
    return [enabled.map((r) => r.label).join(", ")];
  }

  /** @param {object} instance @param {object} ctx */
  overlayRecomputeExtra(instance, ctx) {
    const time = JSON.stringify(resolveTimeLevels(instance.inputs));
    const sessions = JSON.stringify(resolveSessionLevels(instance.inputs));
    const newsRows = instance.inputs.newsEnabled !== false ? resolveNewsLevels(instance.inputs) : [];
    const news = instance.inputs.newsEnabled !== false ? JSON.stringify(newsRows) : "";
    const newsSource = ctx.newsOpts?.source ?? "forexfactory";
    const newsKey = Object.keys(ctx.getNewsByDay?.() ?? {})
      .sort()
      .join(",");
    const symbol = ctx.primarySymbol ?? ctx.symbol;
    const htfKey = htfSeriesRecomputeKey(
      ctx,
      symbol,
      [
        ...levelsHtf.enabledResolutions(instance.inputs, ctx.chartResolution ?? "1").map(({ tfId }) => tfId),
        ...referencePeriodResolutions(instance.inputs),
      ],
    );
    return `${time}|${sessions}|${news}|${newsSource}|${newsKey}|${htfKey}|${instance.inputs.maxBarsBack}|${instance.inputs.pivotLeftBars}|${instance.inputs.pivotRightBars}|${instance.inputs.maxUnswept}|${instance.inputs.maxSwept}|${instance.inputs.mergeConfluence}|${instance.inputs.confHiColor}|${instance.inputs.confLoColor}|${instance.inputs.previousDayEnabled}|${instance.inputs.previousDayColor}|${instance.inputs.previousWeekEnabled}|${instance.inputs.previousWeekColor}|${instance.inputs.midpointEnabled}|${instance.inputs.midpointStartTime}|${instance.inputs.midpointEndTime}|${instance.inputs.midpointColor}|${instance.style.graphicLabels}`;
  }

  /**
   * @param {object[]} utcBars
   * @param {object[]} chartBars
   * @param {object} inputs
   * @param {object} style
   * @param {object} [ctx]
   */
  overlay(utcBars, chartBars, inputs, style, ctx = {}) {
    return new LevelsEngine().computeOverlay(utcBars, chartBars, inputs, style, ctx, levelsHtf);
  }
}

BarScriptIndicator.define(LevelsIndicator);

export default LevelsIndicator;

export { LevelsHtf, levelsHtf } from "./htf.js";
export { LevelsEngine } from "./LevelsEngine.js";
export { LevelsSessionDefs, levelsSessionDefs } from "./sessionDefs.js";
export { LevelsHtfStyles, levelsHtfStyles } from "./htfStyles.js";
