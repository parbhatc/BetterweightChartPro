import { etParts } from "/js/core/etTime.js";
import { resolveHtfSeries } from "/js/indicators/security/htfAccess.js";

const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_SESSION_START = "18:00";

/** @param {unknown} value @param {number} fallback */
function hmMinutes(value, fallback) {
  const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return hour * 60 + minute;
}

/** ET calendar-day ordinal, safe across DST because it represents a date, not elapsed seconds. */
function etDayOrdinal(unix) {
  const parts = etParts(unix);
  return Math.floor(Date.UTC(parts.y, parts.m - 1, parts.d) / 86_400_000);
}

/** Trading day is named by the ET date on which its evening session opens. */
function tradingDayOrdinal(unix, startMinutes) {
  const parts = etParts(unix);
  return etDayOrdinal(unix) - (parts.mod < startMinutes ? 1 : 0);
}

function minutesFromSessionStart(unix, startMinutes) {
  const minutes = etParts(unix).mod;
  return minutes >= startMinutes
    ? minutes - startMinutes
    : MINUTES_PER_DAY - startMinutes + minutes;
}

function tradingWeekOrdinal(dayOrdinal) {
  // 1970-01-04 was Sunday. Futures weeks open Sunday at 6:00 PM ET.
  return Math.floor((dayOrdinal - 3) / 7);
}

function aggregatePeriodBars(bars, anchorUnix, keyForTime, currentKey) {
  const periods = new Map();
  for (const bar of bars ?? []) {
    if (!bar || bar.time > anchorUnix) continue;
    const key = keyForTime(bar.time);
    if (key >= currentKey) continue;
    let period = periods.get(key);
    if (!period) {
      period = { high: -Infinity, low: Infinity };
      periods.set(key, period);
    }
    period.high = Math.max(period.high, Number(bar.high));
    period.low = Math.min(period.low, Number(bar.low));
  }
  const priorKey = [...periods.keys()].sort((a, b) => b - a)[0];
  const period = priorKey == null ? null : periods.get(priorKey);
  return period && Number.isFinite(period.high) && Number.isFinite(period.low)
    ? period
    : null;
}

function previousTradingDayBar(bars, anchorUnix, startMinutes) {
  const currentDay = tradingDayOrdinal(anchorUnix, startMinutes);
  return aggregatePeriodBars(
    bars,
    anchorUnix,
    (time) => tradingDayOrdinal(time, startMinutes),
    currentDay,
  );
}

function previousTradingWeekBar(bars, anchorUnix, startMinutes) {
  const currentWeek = tradingWeekOrdinal(tradingDayOrdinal(anchorUnix, startMinutes));
  return aggregatePeriodBars(
    bars,
    anchorUnix,
    (time) => tradingWeekOrdinal(tradingDayOrdinal(time, startMinutes)),
    currentWeek,
  );
}

function currentSessionRange(utcBars, chartBars, anchorUnix, startMinutes) {
  const tradingDay = tradingDayOrdinal(anchorUnix, startMinutes);
  let first = -1;
  let last = -1;
  for (let i = 0; i < utcBars.length; i += 1) {
    const bar = utcBars[i];
    if (bar.time > anchorUnix) break;
    if (tradingDayOrdinal(bar.time, startMinutes) !== tradingDay) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0 || last < first) return null;
  return {
    first,
    last,
    startTime: utcBars[first].time,
    startChartTime: chartBars[first]?.time ?? utcBars[first].time,
    endTime: utcBars[last].time,
    endChartTime: chartBars[last]?.time ?? utcBars[last].time,
  };
}

function makeReferenceLine(price, label, color, kind, range, showLabels) {
  return {
    price,
    startTime: range.startTime,
    startChartTime: range.startChartTime,
    bornTime: range.startTime,
    endTime: range.endTime,
    endChartTime: range.endChartTime,
    label: showLabels ? `${label} (${Number(price).toFixed(2)})` : "",
    color,
    lineWidth: 2,
    kind,
    swept: false,
    showLabel: showLabels,
    referenceLevel: true,
    referenceTag: label,
  };
}

function addPreviousPeriodLines(out, bar, highLabel, lowLabel, color, range, showLabels) {
  if (!bar || !range || !Number.isFinite(bar.high) || !Number.isFinite(bar.low)) return;
  out.push(
    makeReferenceLine(bar.high, highLabel, color, "high", range, showLabels),
    makeReferenceLine(bar.low, lowLabel, color, "low", range, showLabels),
  );
}

function addMidpointLine(out, utcBars, chartBars, anchorUnix, opts, sessionRange) {
  if (!opts.midpointEnabled || !sessionRange) return;
  const startMinutes = hmMinutes(opts.midpointStartTime, 18 * 60);
  const endValue = String(opts.midpointEndTime ?? "current");
  const endMinutes =
    endValue === "current" ? null : hmMinutes(endValue, null);
  const endOffset =
    endMinutes == null
      ? minutesFromSessionStart(anchorUnix, startMinutes)
      : (endMinutes - startMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;

  let high = -Infinity;
  let low = Infinity;
  let first = -1;
  let last = -1;
  for (let i = sessionRange.first; i <= sessionRange.last; i += 1) {
    const bar = utcBars[i];
    const offset = minutesFromSessionStart(bar.time, startMinutes);
    // A fixed 09:30 end means the completed range through 09:29.
    if (endMinutes != null ? offset >= endOffset : offset > endOffset) continue;
    if (first < 0) first = i;
    last = i;
    high = Math.max(high, Number(bar.high));
    low = Math.min(low, Number(bar.low));
  }
  if (first < 0 || last < first || !Number.isFinite(high) || !Number.isFinite(low)) return;

  const range = {
    startTime: utcBars[first].time,
    startChartTime: chartBars[first]?.time ?? utcBars[first].time,
    endTime: utcBars[last].time,
    endChartTime: chartBars[last]?.time ?? utcBars[last].time,
  };
  out.push(
    makeReferenceLine(
      (high + low) / 2,
      "Mid",
      opts.midpointColor,
      "mid",
      range,
      opts.showLabels,
    ),
  );
}

/**
 * Build opt-in PDH/PDL, PWH/PWL, and session midpoint reference lines.
 * Previous periods aggregate supported hourly history into futures trading
 * days/weeks (6:00 PM ET boundaries); midpoint uses pane bars so it updates on
 * every forming candle and remains replay-safe.
 */
export function buildReferenceLevelLines(utcBars, chartBars, anchorUnix, opts, ctx) {
  if (!utcBars?.length || anchorUnix == null) return [];
  const referenceRange = currentSessionRange(utcBars, chartBars, anchorUnix, 18 * 60);
  const midpointStartMinutes = hmMinutes(
    opts.midpointStartTime ?? DEFAULT_SESSION_START,
    18 * 60,
  );
  const midpointRange = currentSessionRange(
    utcBars,
    chartBars,
    anchorUnix,
    midpointStartMinutes,
  );
  if (!referenceRange && !midpointRange) return [];

  const out = [];
  const symbol = ctx.primarySymbol ?? ctx.symbol;
  const hourly =
    opts.previousDayEnabled || opts.previousWeekEnabled
      ? resolveHtfSeries(ctx, symbol, "60", 240, { request: false }).utcBars
      : [];
  if (opts.previousDayEnabled) {
    addPreviousPeriodLines(
      out,
      previousTradingDayBar(hourly, anchorUnix, 18 * 60),
      "PDH",
      "PDL",
      opts.previousDayColor,
      referenceRange,
      opts.showLabels,
    );
  }
  if (opts.previousWeekEnabled) {
    addPreviousPeriodLines(
      out,
      previousTradingWeekBar(hourly, anchorUnix, 18 * 60),
      "PWH",
      "PWL",
      opts.previousWeekColor,
      referenceRange,
      opts.showLabels,
    );
  }
  addMidpointLine(out, utcBars, chartBars, anchorUnix, opts, midpointRange);
  return out;
}
