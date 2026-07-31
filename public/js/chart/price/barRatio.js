/**
 * @param {import("prochart").IChartApi} chart
 * @param {import("prochart").ISeriesApi} series
 */
export function measurePriceBarRatio(chart, series) {
  const paneH = chart.paneSize().height;
  if (paneH <= 0) return null;
  const barSpacing = chart.timeScale().options().barSpacing ?? 8;
  if (!Number.isFinite(barSpacing) || barSpacing <= 0) return null;
  const center = paneH / 2;
  const p0 = series.coordinateToPrice(center - barSpacing / 2);
  const p1 = series.coordinateToPrice(center + barSpacing / 2);
  if (p0 == null || p1 == null || !Number.isFinite(p0) || !Number.isFinite(p1)) return null;
  const pricePerBar = Math.abs(p1 - p0);
  return pricePerBar > 0 ? pricePerBar : null;
}

/**
 * @param {import("prochart").IChartApi} chart
 * @param {import("prochart").ISeriesApi} series
 * @param {"left" | "right"} priceScaleId
 * @param {number} targetRatio
 */
export function enforcePriceBarRatio(chart, series, priceScaleId, targetRatio) {
  if (!Number.isFinite(targetRatio) || targetRatio <= 0) return null;
  const measured = measurePriceBarRatio(chart, series);
  if (measured == null) return null;
  const factor = targetRatio / measured;
  if (Math.abs(factor - 1) < 0.001) return measured;

  const ps = chart.priceScale(priceScaleId);
  ps.applyOptions({ autoScale: false });
  ps.scaleAroundCenter(factor);
  return measurePriceBarRatio(chart, series);
}

/**
 * @param {import("prochart").IChartApi} chart
 * @param {import("prochart").ISeriesApi} series
 * @param {number} targetRatio
 */
export function enforcePriceBarRatioOnPriceZoom(chart, series, targetRatio) {
  const measured = measurePriceBarRatio(chart, series);
  if (measured == null || !Number.isFinite(targetRatio) || targetRatio <= 0) return;
  const ts = chart.timeScale();
  const barSpacing = ts.options().barSpacing ?? 8;
  const minSpacing = ts.options().minBarSpacing ?? 3;
  const next = barSpacing * (targetRatio / measured);
  ts.applyOptions({ barSpacing: Math.max(minSpacing, next) });
}
