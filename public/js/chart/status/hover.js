/** A visible crosshair selects the candle shown in OHLC.
 * Mobile tracking intentionally remains pinned after pointer release, so this
 * must not depend on whether a finger is still touching the chart. */
export function statusPointerSelectsHover(pane) {
  return Boolean(pane?.crosshairOverChart && !pane?.crosshairOverFuture);
}
