import { toDate } from "../format.js";

const DATE_TIME_FORMATTER_CACHE_LIMIT = 128;
const CHART_TIME_LABEL_CACHE_LIMIT = 1024;
/** @type {Map<string, Intl.DateTimeFormat>} */
const dateTimeFormatters = new Map();
/** @type {Map<string, string>} */
const chartTimeLabels = new Map();

/** @param {string} key @param {() => Intl.DateTimeFormatOptions} options */
function dateTimeFormatter(key, options) {
  const cached = dateTimeFormatters.get(key);
  if (cached) return cached;
  if (dateTimeFormatters.size >= DATE_TIME_FORMATTER_CACHE_LIMIT) {
    dateTimeFormatters.clear();
  }
  const formatter = new Intl.DateTimeFormat("en-US", options());
  dateTimeFormatters.set(key, formatter);
  return formatter;
}

/** @param {string | undefined} format */
export function normalizeDateFormat(format) {
  switch (format) {
    case "d_mmm_yy":
    case "dd_mm_yy":
      return "dd_mmm_yy";
    case "mm_dd":
      return "mmm_dd";
    case "yy_mm_dd":
      return "yy_mm_dd_dash";
    default:
      return format ?? "dd_mmm_yy";
  }
}

/** @param {Date} d @param {string} timeZone */
function weekdayShort(d, timeZone) {
  return dateTimeFormatter(
    `weekday|${timeZone}`,
    () => ({ timeZone, weekday: "short" }),
  ).format(d);
}

/** @param {Date} d @param {string} timeZone */
function dateParts(d, timeZone) {
  const fmt = dateTimeFormatter(
    `named-date|${timeZone}`,
    () => ({
      timeZone,
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
  );
  /** @type {Record<string, string>} */
  const out = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out;
}

/** @param {Date} d @param {string} timeZone */
function numericParts(d, timeZone) {
  const fmt = dateTimeFormatter(
    `numeric-date|${timeZone}`,
    () => ({
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
  );
  /** @type {Record<string, string>} */
  const out = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out;
}

/** @param {string} year */
function shortYear(year) {
  return `'${String(year).slice(-2)}`;
}

/** @param {Date} d @param {string} timeZone */
function quarterLabel(d, timeZone) {
  const month = Number(
    dateTimeFormatter(
      `quarter-month|${timeZone}`,
      () => ({ timeZone, month: "numeric" }),
    ).format(d),
  );
  return `Q${Math.floor((month - 1) / 3) + 1}`;
}

/**
 * @param {Date} d
 * @param {string} format
 * @param {string} timeZone
 */
export function formatDateBody(d, format, timeZone) {
  const key = normalizeDateFormat(format);
  const named = dateParts(d, timeZone);
  const numeric = numericParts(d, timeZone);
  const day = named.day ?? numeric.day;
  const month = named.month ?? "";
  const year = named.year ?? numeric.year;

  switch (key) {
    case "qq_yy":
      return `${quarterLabel(d, timeZone)} ${shortYear(year)}`;
    case "qq_yyyy":
      return `${quarterLabel(d, timeZone)} ${year}`;
    case "dd_mmm_yy":
      return `${day} ${month} ${shortYear(year)}`;
    case "mmm_yy":
      return `${month} ${shortYear(year)}`;
    case "mmm_dd_yyyy":
      return `${month} ${day}, ${year}`;
    case "mmm_d_yyyy":
      return `${month} ${Number(day)} ${year}`;
    case "mmm_yyyy":
      return `${month} ${year}`;
    case "mmm_dd":
      return `${month} ${day}`;
    case "dd_mmm":
      return `${day} ${month}`;
    case "yyyy_mm_dd":
      return `${year}-${numeric.month}-${numeric.day}`;
    case "yy_mm_dd_dash":
      return `${String(year).slice(-2)}-${numeric.month}-${numeric.day}`;
    case "yy_mm_dd_slash":
      return `${String(year).slice(-2)}/${numeric.month}/${numeric.day}`;
    case "yyyy_mm_dd_slash":
      return `${year}/${numeric.month}/${numeric.day}`;
    case "dd_mm_yyyy_dash":
      return `${numeric.day}-${numeric.month}-${year}`;
    case "dd_mm_yy_dash":
      return `${numeric.day}-${numeric.month}-${String(year).slice(-2)}`;
    case "dd_mm_yy_slash":
      return `${numeric.day}/${numeric.month}/${String(year).slice(-2)}`;
    case "dd_mm_yyyy_slash":
      return `${numeric.day}/${numeric.month}/${year}`;
    case "mm_dd_yy_slash":
      return `${numeric.month}/${numeric.day}/${String(year).slice(-2)}`;
    case "mm_dd_yyyy_slash":
      return `${numeric.month}/${numeric.day}/${year}`;
    default:
      return `${day} ${month} ${shortYear(year)}`;
  }
}

/**
 * Day-of-month tick on the time axis — day number only (e.g. 14).
 * @param {number | { year: number, month: number, day: number }} t
 * @param {object} [_scales]
 * @param {string} timeZone
 */
export function formatAxisDateTick(t, _scales, timeZone) {
  const d = toDate(t);
  const day = dateParts(d, timeZone).day ?? numericParts(d, timeZone).day ?? "";
  return String(Number(day));
}

/**
 * Month tick on the time axis, e.g. Jun 2026
 * @param {number | { year: number, month: number, day: number }} t
 * @param {object} [_scales]
 * @param {string} timeZone
 */
export function formatAxisMonthTick(t, _scales, timeZone) {
  const d = toDate(t);
  const named = dateParts(d, timeZone);
  const month = named.month ?? "";
  const year = named.year ?? "";
  return `${month} ${year}`;
}

/**
 * Time-axis tick labels — 12-hour format (e.g. 03:30 PM); respects 24-hours setting.
 * @param {Date} d
 * @param {string} timeZone
 * @param {object} [scales]
 * @param {boolean} [withSeconds]
 */
export function formatAxisTimeTick(d, timeZone, scales = {}, withSeconds = false) {
  const hour12 = scales.timeHoursFormat !== "24-hours";
  const formatter = dateTimeFormatter(
    `axis-time|${timeZone}|${hour12 ? 1 : 0}|${withSeconds ? 1 : 0}`,
    () => ({
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: withSeconds ? "2-digit" : undefined,
      hour12,
    }),
  );
  if (!hour12) {
    return formatter.format(d);
  }
  const parts = formatter.formatToParts(d);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  const second = withSeconds ? parts.find((p) => p.type === "second")?.value ?? "" : "";
  const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toUpperCase();
  if (withSeconds) return `${hour}:${minute}:${second} ${period}`;
  return `${hour}:${minute} ${period}`;
}

export function formatTimePart(d, timeZone, hour12, withSeconds = false) {
  const formatter = dateTimeFormatter(
    `time-part|${timeZone}|${hour12 ? 1 : 0}|${withSeconds ? 1 : 0}`,
    () => ({
      timeZone,
      hour: hour12 ? "numeric" : "2-digit",
      minute: "2-digit",
      second: withSeconds ? "2-digit" : undefined,
      hour12,
    }),
  );
  if (hour12) {
    const parts = formatter.formatToParts(d);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "";
    const second = withSeconds ? parts.find((p) => p.type === "second")?.value ?? "" : "";
    const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase();
    if (withSeconds) return `${hour}:${minute}:${second}${period}`;
    return `${hour}:${minute}${period}`;
  }
  return formatter.format(d);
}

/**
 * @param {number | { year: number, month: number, day: number }} t
 * @param {object} scales
 * @param {string} timeZone
 * @param {{ includeTime?: boolean, withSeconds?: boolean }} [opts]
 */
/** TradingView replay cut label: `Re: Thu 18 Jun '26 03:17 PM` */
export function formatReplayCutTimeLabel(utcSec, timeZone) {
  const d = new Date(utcSec * 1000);
  const parts = dateTimeFormatter(
    `replay-cut|${timeZone}`,
    () => ({
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
  ).formatToParts(d);
  /** @param {string} type */
  const pick = (type) => parts.find((p) => p.type === type)?.value ?? "";
  const year = pick("year");
  const period = pick("dayPeriod").toUpperCase();
  return `Re: ${pick("weekday")} ${pick("day")} ${pick("month")} '${year.slice(-2)} ${pick("hour")}:${pick("minute")} ${period}`;
}

export function formatChartTimeLabel(t, scales, timeZone, opts = {}) {
  const timeKey =
    typeof t === "number"
      ? String(t)
      : `${t?.year ?? ""}-${t?.month ?? ""}-${t?.day ?? ""}`;
  const cacheKey = [
    timeKey,
    timeZone,
    scales.dayOfWeekOnLabels !== false ? 1 : 0,
    scales.dateFormat ?? "",
    scales.timeHoursFormat ?? "",
    opts.includeTime ? 1 : 0,
    opts.withSeconds ? 1 : 0,
  ].join("\0");
  const cached = chartTimeLabels.get(cacheKey);
  if (cached != null) return cached;

  const d = toDate(t);
  const showDow = scales.dayOfWeekOnLabels !== false;
  const dow = showDow ? `${weekdayShort(d, timeZone)} ` : "";
  const datePart = formatDateBody(d, scales.dateFormat, timeZone);
  let label = `${dow}${datePart}`;
  if (opts.includeTime) {
    const hour12 = scales.timeHoursFormat !== "24-hours";
    const timePart = formatTimePart(
      d,
      timeZone,
      hour12,
      Boolean(opts.withSeconds),
    );
    label = `${label} ${timePart}`;
  }
  if (chartTimeLabels.size >= CHART_TIME_LABEL_CACHE_LIMIT) {
    chartTimeLabels.clear();
  }
  chartTimeLabels.set(cacheKey, label);
  return label;
}
