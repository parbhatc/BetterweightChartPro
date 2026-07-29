/**
 * Subscribe a pane's indicator legends to candle changes without doing any
 * work for panes that have no indicators.
 *
 * @param {object} pane
 * @param {object} deps
 * @param {() => boolean} deps.hasIndicators
 * @param {() => void} deps.refreshMainLegend
 * @param {() => void} deps.refreshStudyLegendValues
 */
export function wireIndicatorLegendCrosshair(
  pane,
  { hasIndicators, refreshMainLegend, refreshStudyLegendValues },
) {
  if (pane._legendCrosshairSub) return;
  pane._legendCrosshairSub = true;

  let lastCrosshairTime = Symbol("unset");
  pane.chart.subscribeCrosshairMove(() => {
    const nextCrosshairTime = pane.hoverBar?.time ?? null;
    if (nextCrosshairTime === lastCrosshairTime) return;
    lastCrosshairTime = nextCrosshairTime;

    if (!hasIndicators()) return;

    refreshMainLegend();
    refreshStudyLegendValues();
  });
}
