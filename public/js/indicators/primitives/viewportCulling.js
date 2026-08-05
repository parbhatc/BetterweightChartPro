/**
 * True when a vertical point or segment can affect the visible pane.
 * Crossing segments remain visible even when both endpoints are outside.
 * @param {number | null | undefined} y1
 * @param {number | null | undefined} y2
 * @param {number} height
 * @param {number} [pad]
 */
export function verticalSegmentIntersectsViewport(y1, y2, height, pad = 4) {
  if (![y1, y2, height].every(Number.isFinite) || height <= 0) return false;
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return bottom >= -pad && top <= height + pad;
}
