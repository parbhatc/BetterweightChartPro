/** Clear retained overlay geometry before detaching its primitive. */
export function clearAndDestroyOverlayPrimitive(overlay) {
  if (!overlay) return;
  // A pane or series can be replaced while an indicator is being removed. If
  // detach then fails, the old primitive must stay empty instead of painting
  // stale lines from an indicator that no longer exists.
  try {
    overlay.setLabels?.([]);
    overlay.setBoxes?.([]);
    overlay.requestRefresh?.();
  } catch {
    /* continue with detach */
  }
  overlay.destroy?.();
}
