/** A visible crosshair selects the candle shown in OHLC.
 * Mobile tracking intentionally remains pinned after pointer release, so this
 * must not depend on whether a finger is still touching the chart. */
export function statusPointerSelectsHover(pane) {
  return Boolean(pane?.crosshairOverChart && !pane?.crosshairOverFuture);
}

/** Touch tracking is reported as a chart drag by the pan-performance guard.
 * Keep OHLC responsive for that gesture without restoring status-line DOM work
 * for ordinary mouse/touch chart pans. */
export function statusPointerRefreshesDuringPan(pane, param) {
  return Boolean(
    statusPointerSelectsHover(pane) &&
      param?.point &&
      param?.sourceEvent?.pointerType === "touch",
  );
}
