/** Return whether a chart-local point is inside the visible right price axis. */
export function pointInRightPriceAxis(
  width,
  height,
  rightAxisWidth,
  timeAxisHeight,
  x,
  y,
) {
  return rightAxisWidth > 0
    && x >= width - rightAxisWidth
    && x < width
    && y >= 0
    && y < height - timeAxisHeight;
}
