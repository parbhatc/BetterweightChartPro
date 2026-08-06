/**
 * Coalesce status work by pane without letting the last crosshair echo replace
 * the source pane's update in the same animation frame.
 *
 * @param {(pane: object) => void} refreshPane
 * @param {(callback: FrameRequestCallback) => number} [requestFrame]
 */
export function createPaneStatusScheduler(
  refreshPane,
  requestFrame = requestAnimationFrame,
) {
  const pending = new Map();
  let frame = null;

  function flush() {
    frame = null;
    for (const pane of pending.values()) refreshPane(pane);
    pending.clear();
  }

  function schedule(pane) {
    if (!pane) return;
    pending.set(pane.index, pane);
    if (frame == null) frame = requestFrame(flush);
  }

  return { schedule, flush };
}
