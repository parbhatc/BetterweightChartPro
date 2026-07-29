/**
 * Resolve hover bar index / bar for status line + indicator values.
 * Matches the values-tooltip nearest-bar behavior.
 */

/** @param {ReturnType<import("../time/timeAdapter.js").createTimeAdapter> | null | undefined} ta @param {number} time */
export function resolveUtcBarTime(ta, time) {
  if (time == null || !Number.isFinite(time)) return time;
  if (ta?.index?.utc?.(time) != null) return time;
  return ta?.time?.toUtc?.(time) ?? time;
}

/** @param {{ time: number }[]} bars @param {number} utcTime */
export function barIndexAtTime(bars, utcTime) {
  let low = 0;
  let high = bars?.length ?? 0;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (bars[middle].time < utcTime) low = middle + 1;
    else high = middle;
  }
  return low < (bars?.length ?? 0) && bars[low].time === utcTime ? low : -1;
}

/** @param {{ time: number }[]} bars @param {number} utcTime */
export function barAtTime(bars, utcTime) {
  const index = barIndexAtTime(bars, utcTime);
  return index >= 0 ? bars[index] : undefined;
}

/** @param {{ time: number }[]} bars @param {number} utcTime */
export function nearestBarIndex(bars, utcTime) {
  if (!bars?.length || utcTime == null || !Number.isFinite(utcTime)) {
    return Math.max(0, (bars?.length ?? 1) - 1);
  }

  let low = 0;
  let high = bars.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (bars[middle].time < utcTime) low = middle + 1;
    else high = middle;
  }

  if (low === 0) return 0;
  if (low === bars.length) return bars.length - 1;
  const before = low - 1;
  return utcTime - bars[before].time <= bars[low].time - utcTime
    ? before
    : low;
}

/**
 * @param {object} pane
 * @param {object | null | undefined} bar
 * @param {(pane: object) => object[]} barsForPane
 */
export function normalizeHoverBar(pane, bar, barsForPane) {
  if (!bar?.time) return undefined;
  const ta = pane.timeAdapter;
  const utcTime = resolveUtcBarTime(ta, bar.time);
  const fromIndex = ta?.index?.utcBarByUtcTime?.(utcTime);
  if (fromIndex) return fromIndex;
  const bars = barsForPane(pane);
  const idx = nearestBarIndex(bars, utcTime);
  return bars[idx] ?? bar;
}

/**
 * @param {object} pane
 * @param {object | null | undefined} bar
 * @param {object[]} utcBars
 * @param {(pane: object) => object[]} barsForPane
 */
export function barIndexForHover(pane, bar, utcBars, barsForPane) {
  if (!utcBars.length) return 0;
  const normalized = bar ? normalizeHoverBar(pane, bar, barsForPane) : null;
  const utcTime = normalized?.time ?? bar?.time;
  if (utcTime == null) return utcBars.length - 1;
  const exact = barIndexAtTime(utcBars, utcTime);
  if (exact >= 0) return exact;
  return nearestBarIndex(utcBars, utcTime);
}
