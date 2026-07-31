import { BarScriptIndicator } from "../../BarScriptIndicator.js";
import {
  createBool,
  createColor,
  createInt,
  createSelect,
  createTimeframe,
  inlinePair,
} from "../../builders.js";
import { resolutionSec, resolutionShortLabel } from "../../../chart/resolutions.js";
import { etParts } from "../../../core/etTime.js";
import { resolveHtfSeries } from "../../security/htfAccess.js";
import { alignedHtfBucketOpen } from "../../security/sessionBuckets.js";
import { formatSymbolPrice, tickSizeFromSymbol } from "../../symbol.js";
import { styleColorWithOpacity } from "../../styleColor.js";

const COLORS = {
  bullBody: "#4caf50",
  bearBody: "#000000",
  bullBorder: "#5d606b",
  bearBorder: "#000000",
  bullWick: "#5d606b",
  bearWick: "#5d606b",
  projection: "#787b86",
  priceText: "#d1d4dc",
  infoBg: "#d1d4dc",
  infoText: "#000000",
};

const PRICE_TEXT_SIZES = {
  small: 10,
  medium: 11,
  large: 12,
};

function finiteBar(bar) {
  return bar
    && [bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(Number(value)));
}

function aggregateBucket(utcBars, chartBars, bucketOpen) {
  let first = -1;
  let last = -1;
  for (let i = utcBars.length - 1; i >= 0; i--) {
    const bar = utcBars[i];
    if (bar.time < bucketOpen) break;
    if (!finiteBar(bar)) continue;
    first = i;
    if (last < 0) last = i;
  }
  if (first < 0 || last < 0) return null;
  const slice = utcBars.slice(first, last + 1).filter(finiteBar);
  if (!slice.length) return null;
  return {
    time: utcBars[first].time,
    chartTime: chartBars[first]?.time ?? utcBars[first].time,
    open: Number(slice[0].open),
    high: Math.max(...slice.map((bar) => Number(bar.high))),
    low: Math.min(...slice.map((bar) => Number(bar.low))),
    close: Number(slice.at(-1).close),
    isForming: true,
  };
}

function aggregateNyMidnightDay(utcBars, chartBars) {
  const tail = utcBars.at(-1);
  if (!tail) return null;
  const day = etParts(tail.time).ymd;
  let first = utcBars.length - 1;
  while (first > 0 && etParts(utcBars[first - 1].time).ymd === day) first -= 1;
  return aggregateBucket(utcBars, chartBars, utcBars[first]?.time ?? tail.time);
}

function currentStandardBar(utcBars, chartBars, ctx, timeframe) {
  const series = resolveHtfSeries(ctx, undefined, timeframe, 10);
  const latest = series.utcBars.at(-1);
  if (finiteBar(latest)) {
    const index = series.utcBars.length - 1;
    return {
      ...latest,
      chartTime: series.chartBars[index]?.time ?? latest.time,
    };
  }

  const tfSec = resolutionSec(timeframe);
  const tail = utcBars.at(-1)?.time;
  if (!tfSec || tail == null) return null;
  return aggregateBucket(utcBars, chartBars, alignedHtfBucketOpen(tail, tfSec, ctx.symbolInfo));
}

function currentPo3Bar(utcBars, chartBars, ctx, inputs) {
  const timeframe = String(inputs.htfTimeframe ?? "240");
  if (inputs.useNyMidnight === true && timeframe === "D") {
    return aggregateNyMidnightDay(utcBars, chartBars);
  }
  return currentStandardBar(utcBars, chartBars, ctx, timeframe);
}

function rangeText(range, mode, tickSize, symbolInfo) {
  if (mode === "ticks") {
    return `${Math.round(range / Math.max(tickSize, Number.EPSILON)).toLocaleString()} ticks`;
  }
  if (mode === "pips") {
    const pipSize = tickSize < 0.01 ? tickSize * 10 : tickSize;
    return `${(range / Math.max(pipSize, Number.EPSILON)).toFixed(1)} pips`;
  }
  const currency = symbolInfo?.currency_code ?? symbolInfo?.currencyCode ?? "";
  return `${po3PriceText(range, symbolInfo)}${currency ? ` ${currency}` : ""}`;
}

function po3PriceText(price, symbolInfo) {
  return formatSymbolPrice(price, symbolInfo)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "");
}

function closeAtUnix(bar, timeframe) {
  const tfSec = resolutionSec(timeframe);
  if (!tfSec || !Number.isFinite(Number(bar?.time))) return null;
  return Number(bar.time) + tfSec;
}

function closeTimeText(closeAt, ctx) {
  if (!Number.isFinite(closeAt)) return "";
  const timeZone = String(ctx.chartTimeZone || ctx.symbolInfo?.timezone || "Etc/UTC");
  try {
    const value = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(closeAt * 1000));
    return `Closes: ${value}`;
  } catch {
    return "";
  }
}

function labelItem(time, price, text, color, fontSize) {
  return {
    kind: "label",
    zOrder: "top",
    timeStart: time,
    timeEnd: time,
    priceTop: price,
    priceBottom: price,
    label: text,
    textColor: color,
    fontSize,
    labelAlign: "left",
  };
}

/** Project the current higher-timeframe candle beside the execution chart. */
class HtfPowerOfThreeIndicator extends BarScriptIndicator {

  constructor() {
    super("htf_power_of_three", "HTF Power of Three°", "HTF Power of Three");
    this.setOverlayPrimitive("boxes");
    this.setGraphicObjects([
      { styleKey: "graphicProjection", label: "HTF candle projection", overlay: "boxes" },
    ]);
    this.setInputs([
      createTimeframe("htfTimeframe", "Timeframe", "240", { section: "PO3 Settings" }),
      createBool("useNyMidnight", "Use NY Midnight", false, {
        section: "PO3 Settings",
        disabled: (inputs) => inputs.htfTimeframe !== "D",
      }),
      createInt("offset", "Offset", 0, { section: "HTF PO3 Appearance" }),
      inlinePair(
        "HTF PO3 Appearance",
        createColor("bullBodyColor", "Bull body", { color: COLORS.bullBody, opacity: 100 }, { store: "style" }),
        createColor("bearBodyColor", "Bear body", { color: COLORS.bearBody, opacity: 100 }, { store: "style" }),
        { header: "Body" },
      ),
      inlinePair(
        "HTF PO3 Appearance",
        createColor("bullBorderColor", "Bull border", { color: COLORS.bullBorder, opacity: 100 }, { store: "style" }),
        createColor("bearBorderColor", "Bear border", { color: COLORS.bearBorder, opacity: 100 }, { store: "style" }),
        { header: "Border" },
      ),
      inlinePair(
        "HTF PO3 Appearance",
        createColor("bullWickColor", "Bull wick", { color: COLORS.bullWick, opacity: 100 }, { store: "style" }),
        createColor("bearWickColor", "Bear wick", { color: COLORS.bearWick, opacity: 100 }, { store: "style" }),
        { header: "Wick" },
      ),
      createBool("showOhlc", "OHLC Price", true, { section: "LTF Projections (Live PO3)" }),
      createSelect("priceTextSize", "OHLC text size", "small", [
        { id: "small", label: "Small" },
        { id: "medium", label: "Medium" },
        { id: "large", label: "Large" },
      ], { section: "LTF Projections (Live PO3)" }),
      createColor("priceTextColor", "OHLC text", { color: COLORS.priceText, opacity: 100 }, {
        section: "LTF Projections (Live PO3)",
        store: "style",
      }),
      createBool("showOpenLine", "Open Line", true, { section: "LTF Projections (Live PO3)" }),
      createInt("openLineWidth", "Open line width", 1, {
        min: 1,
        section: "LTF Projections (Live PO3)",
      }),
      createColor("openLineColor", "Open line", { color: COLORS.projection, opacity: 50 }, {
        section: "LTF Projections (Live PO3)",
        store: "style",
      }),
      createBool("showHighLowLines", "L/H Lines", true, { section: "LTF Projections (Live PO3)" }),
      createInt("highLowLineWidth", "L/H line width", 1, {
        min: 1,
        section: "LTF Projections (Live PO3)",
      }),
      createColor("highLowLineColor", "L/H lines", { color: COLORS.projection, opacity: 50 }, {
        section: "LTF Projections (Live PO3)",
        store: "style",
      }),
      createSelect("rangeMode", "Range", "price", [
        { id: "price", label: "Price" },
        { id: "ticks", label: "Ticks" },
        { id: "pips", label: "Pips" },
        { id: "off", label: "Off" },
      ], { section: "PO3 Info Table" }),
      createSelect("infoVertical", "Vertical position", "middle", [
        { id: "top", label: "Top" },
        { id: "middle", label: "Middle" },
        { id: "bottom", label: "Bottom" },
      ], { section: "PO3 Info Table" }),
      createSelect("infoHorizontal", "Horizontal position", "right", [
        { id: "left", label: "Left" },
        { id: "right", label: "Right" },
      ], { section: "PO3 Info Table" }),
      createSelect("closeTimeMode", "Close time", "exact", [
        { id: "exact", label: "Exact time" },
        { id: "countdown", label: "Countdown" },
        { id: "off", label: "Off" },
      ], { section: "PO3 Info Table" }),
      inlinePair(
        "PO3 Info Table",
        createColor("infoBgColor", "Label", { color: COLORS.infoBg, opacity: 100 }, { store: "style" }),
        createColor("infoTextColor", "Text", { color: COLORS.infoText, opacity: 100 }, { store: "style" }),
      ),
    ]);
  }

  mergeStyleDefaults(style) {
    return {
      ...style,
      graphicProjection: style.graphicProjection ?? true,
      bullBodyColor: style.bullBodyColor ?? COLORS.bullBody,
      bullBodyColorOpacity: style.bullBodyColorOpacity ?? 100,
      bearBodyColor: style.bearBodyColor ?? COLORS.bearBody,
      bearBodyColorOpacity: style.bearBodyColorOpacity ?? 100,
      bullBorderColor: style.bullBorderColor ?? COLORS.bullBorder,
      bullBorderColorOpacity: style.bullBorderColorOpacity ?? 100,
      bearBorderColor: style.bearBorderColor ?? COLORS.bearBorder,
      bearBorderColorOpacity: style.bearBorderColorOpacity ?? 100,
      bullWickColor: style.bullWickColor ?? COLORS.bullWick,
      bullWickColorOpacity: style.bullWickColorOpacity ?? 100,
      bearWickColor: style.bearWickColor ?? COLORS.bearWick,
      bearWickColorOpacity: style.bearWickColorOpacity ?? 100,
      openLineColor: style.openLineColor ?? COLORS.projection,
      openLineColorOpacity: style.openLineColorOpacity ?? 50,
      highLowLineColor: style.highLowLineColor ?? COLORS.projection,
      highLowLineColorOpacity: style.highLowLineColorOpacity ?? 50,
      priceTextColor: style.priceTextColor ?? COLORS.priceText,
      priceTextColorOpacity: style.priceTextColorOpacity ?? 100,
      infoBgColor: style.infoBgColor ?? COLORS.infoBg,
      infoBgColorOpacity: style.infoBgColorOpacity ?? 100,
      infoTextColor: style.infoTextColor ?? COLORS.infoText,
      infoTextColorOpacity: style.infoTextColorOpacity ?? 100,
    };
  }

  legendParams(instance) {
    return [
      resolutionShortLabel(instance.inputs?.htfTimeframe ?? "240"),
      `offset ${Math.trunc(Number(instance.inputs?.offset) || 0)}`,
    ];
  }

  needsLiveOverlayRefresh() {
    return true;
  }

  collectDataNeeds(instance, pane) {
    return {
      htf: [{
        symbol: pane.symbol ?? "",
        resolution: String(instance.inputs?.htfTimeframe ?? "240"),
        countBack: 20,
      }],
    };
  }

  overlayPending(instance, ctx) {
    if (instance.inputs?.useNyMidnight === true && instance.inputs?.htfTimeframe === "D") {
      return false;
    }
    // The current projection can always be assembled from the pane's own bars.
    // Do not hide it while confirmed HTF history is still loading.
    if (ctx.utcBars?.length) return false;
    const series = resolveHtfSeries(ctx, undefined, String(instance.inputs?.htfTimeframe ?? "240"), 10);
    return series.pending && series.utcBars.length === 0;
  }

  overlayRecomputeExtra(instance, ctx) {
    const timeframe = String(instance.inputs?.htfTimeframe ?? "240");
    if (instance.inputs?.useNyMidnight === true && timeframe === "D") {
      const tail = ctx.utcBars?.at(-1);
      return `${tail?.time ?? ""}:${tail?.open ?? ""}:${tail?.high ?? ""}:${tail?.low ?? ""}:${tail?.close ?? ""}`;
    }
    const series = resolveHtfSeries(
      ctx,
      ctx.primarySymbol ?? ctx.symbol ?? "",
      timeframe,
      10,
      { request: false },
    );
    const first = series.utcBars[0];
    const last = series.utcBars.at(-1);
    return `${timeframe}:${series.utcBars.length}:${series.source}:${first?.time ?? ""}:${last?.time ?? ""}:${last?.high ?? ""},${last?.low ?? ""},${last?.close ?? ""}`;
  }

  static requiredChartBars(inputs, chartResolution) {
    if (inputs?.useNyMidnight !== true || inputs?.htfTimeframe !== "D") return 0;
    const chartSec = Math.max(1, resolutionSec(chartResolution) || 60);
    return Math.ceil(86400 / chartSec) + 10;
  }

  static computeOverlay(utcBars, chartBars, instance, ctx = {}) {
    const bar = currentPo3Bar(utcBars, chartBars, ctx, instance.inputs ?? {});
    const lastChartTime = chartBars.at(-1)?.time;
    if (!bar || lastChartTime == null) return [];

    const style = instance.style ?? {};
    const inputs = instance.inputs ?? {};
    const chartBarSec = Math.max(1, Number(ctx.barSec) || resolutionSec(ctx.chartResolution) || 60);
    const offset = Math.trunc(Number(inputs.offset) || 0);
    const gapBars = Math.max(1, 4 + offset);
    const bodyWidthBars = 4;
    const bodyStart = lastChartTime + gapBars * chartBarSec;
    const bodyEnd = bodyStart + bodyWidthBars * chartBarSec;
    const wickCenter = bodyStart + (bodyWidthBars / 2) * chartBarSec;
    const labelTime = bodyEnd + chartBarSec;
    const range = Math.max(Number(bar.high) - Number(bar.low), Number.EPSILON);
    const tickSize = tickSizeFromSymbol(ctx.symbolInfo);
    const bullish = Number(bar.close) >= Number(bar.open);
    const bodyTopRaw = Math.max(Number(bar.open), Number(bar.close));
    const bodyBottomRaw = Math.min(Number(bar.open), Number(bar.close));
    const minBody = Math.max(tickSize, range * 0.004);
    const bodyTop = bodyTopRaw === bodyBottomRaw ? bodyTopRaw + minBody : bodyTopRaw;
    const bodyBottom = bodyTopRaw === bodyBottomRaw ? bodyBottomRaw - minBody : bodyBottomRaw;
    const side = bullish ? "bull" : "bear";
    const bodyColor = styleColorWithOpacity(style, `${side}BodyColor`, COLORS[`${side}Body`], 100);
    const borderColor = styleColorWithOpacity(style, `${side}BorderColor`, COLORS[`${side}Border`], 100);
    const wickColor = styleColorWithOpacity(style, `${side}WickColor`, COLORS[`${side}Wick`], 100);
    const openLineColor = styleColorWithOpacity(style, "openLineColor", COLORS.projection, 50);
    const highLowLineColor = styleColorWithOpacity(style, "highLowLineColor", COLORS.projection, 50);
    const priceTextColor = styleColorWithOpacity(style, "priceTextColor", COLORS.priceText, 100);
    const infoBgColor = styleColorWithOpacity(style, "infoBgColor", COLORS.infoBg, 100);
    const infoTextColor = styleColorWithOpacity(style, "infoTextColor", COLORS.infoText, 100);
    const projectionStart = Number(bar.chartTime ?? bar.time);

    const items = [];
    if (inputs.showOpenLine !== false) {
      items.push({
        kind: "line",
        timeStart: projectionStart,
        timeEnd: wickCenter,
        priceTop: Number(bar.open),
        priceBottom: Number(bar.open),
        lineColor: openLineColor,
        lineWidth: Math.max(1, Number(inputs.openLineWidth) || 1),
        lineDash: [4, 4],
      });
    }
    if (inputs.showHighLowLines !== false) {
      for (const price of [Number(bar.high), Number(bar.low)]) {
        items.push({
          kind: "line",
          timeStart: projectionStart,
          timeEnd: wickCenter,
          priceTop: price,
          priceBottom: price,
          lineColor: highLowLineColor,
          lineWidth: Math.max(1, Number(inputs.highLowLineWidth) || 1),
          lineDash: [2, 2],
        });
      }
    }

    if (Number(bar.high) > bodyTop || Number(bar.low) < bodyBottom) {
      items.push({
        kind: "vertical-line",
        timeStart: wickCenter,
        timeEnd: wickCenter,
        priceTop: Number(bar.high),
        priceBottom: Number(bar.low),
        lineColor: wickColor,
        lineWidth: 1,
      });
    }
    items.push({
      timeStart: bodyStart,
      timeEnd: bodyEnd,
      priceTop: bodyTop,
      priceBottom: bodyBottom,
      fillColor: bodyColor,
      borderColor,
      borderWidth: 1,
    });

    if (inputs.showOhlc !== false) {
      const fontSize = PRICE_TEXT_SIZES[inputs.priceTextSize] ?? PRICE_TEXT_SIZES.small;
      const format = (price) => po3PriceText(price, ctx.symbolInfo);
      items.push(
        labelItem(labelTime, Number(bar.high), format(Number(bar.high)), priceTextColor, fontSize),
        labelItem(labelTime, Number(bar.close), format(Number(bar.close)), priceTextColor, fontSize),
        labelItem(labelTime, Number(bar.open), format(Number(bar.open)), priceTextColor, fontSize),
        labelItem(labelTime, Number(bar.low), format(Number(bar.low)), priceTextColor, fontSize),
      );
    }

    if (inputs.rangeMode !== "off") {
      const infoOnRight = inputs.infoHorizontal !== "left";
      const vertical = inputs.infoVertical ?? "middle";
      const tfLabel = resolutionShortLabel(inputs.htfTimeframe ?? "240").toUpperCase();
      const closeMode = inputs.closeTimeMode ?? (inputs.showCloseTime === false ? "off" : "exact");
      const closeAt = closeAtUnix(bar, inputs.htfTimeframe ?? "240");
      const closeRow = closeMode === "countdown" && closeAt != null
        ? { label: "", fontWeight: 400, countdownTo: closeAt }
        : closeMode === "exact" && closeAt != null
          ? { label: closeTimeText(closeAt, ctx), fontWeight: 400 }
          : null;
      const rows = [
        { label: `${tfLabel} CANDLE PO3\u00b0`, fontWeight: 600 },
        { label: `Range: ${rangeText(range, inputs.rangeMode, tickSize, ctx.symbolInfo)}`, fontWeight: 400 },
        ...(closeRow ? [closeRow] : []),
      ];
      const tableBase = {
        kind: "screen-box",
        zOrder: "top",
        screenHorizontal: infoOnRight ? "right" : "left",
        screenVertical: vertical,
        screenWidth: 94,
        screenHeight: 20,
        screenRows: rows.length,
        screenMarginX: 0,
        screenMarginY: 12,
        borderColor: infoTextColor,
        borderWidth: 1,
        showLabel: true,
        labelAlign: "center",
        textColor: infoTextColor,
        fontSize: 10,
      };
      items.push(...rows.map((row, screenRow) => ({
          ...tableBase,
          screenRow,
          fillColor: infoBgColor,
          label: row.label,
          fontWeight: row.fontWeight,
          ...(row.countdownTo != null ? { countdownTo: row.countdownTo } : {}),
        })));
    }

    return items;
  }
}

BarScriptIndicator.define(HtfPowerOfThreeIndicator);

export default HtfPowerOfThreeIndicator;
