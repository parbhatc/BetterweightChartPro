/**
 * True when a later, fully completed HTF bucket swept a pivot before the
 * lower-timeframe chart history begins. The bucket overlapping the chart
 * window is excluded so its exact crossing remains available on chart bars.
 * @param {object[]} agg @param {number} confirmationIdx @param {number} tfSec
 * @param {number | undefined} chartStartUtc @param {"high"|"low"} kind @param {number} price
 */
export function liquidityTakenBeforeChartWindow(
  agg,
  confirmationIdx,
  tfSec,
  chartStartUtc,
  kind,
  price,
) {
  if (!Number.isFinite(chartStartUtc)) return false;
  for (let j = confirmationIdx + 1; j < agg.length; j++) {
    const bar = agg[j];
    if (!bar) continue;
    if (bar.time + tfSec > chartStartUtc) break;
    const swept = kind === "high" ? bar.high >= price : bar.low <= price;
    if (swept) return true;
  }
  return false;
}
