export const ATH_RESOLUTION = "D";
// The host datafeeds cap a single request at 4,000 bars. Daily bars provide
// the deepest useful history without making the opt-in ATH level expensive on
// ordinary intraday charts.
export const ATH_HISTORY_BARS = 4000;

/** Highest finite high at or before the chart/replay anchor. */
export function allTimeHighFromBars(bars, anchorUnix = Infinity) {
  let high = -Infinity;
  for (const bar of bars ?? []) {
    if (!bar || Number(bar.time) > anchorUnix) continue;
    const value = Number(bar.high);
    if (Number.isFinite(value)) high = Math.max(high, value);
  }
  return Number.isFinite(high) ? high : null;
}
