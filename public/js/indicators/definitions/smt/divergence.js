export function isStrictSmtDivergence(nextChart, lastChart, nextCompare, lastCompare) {
  return (nextChart - lastChart) * (nextCompare - lastCompare) < 0;
}

/**
 * Last bar that can be used to confirm an SMT pivot.
 *
 * A host-controlled replay reveals complete historical candles one step at a
 * time, so its tail candle is already closed. On a live chart the tail candle
 * is still forming and must remain excluded when wait-for-close is enabled.
 */
export function lastSmtConfirmationIndex(lastIndex, waitClose, replayHostControlled) {
  return waitClose && replayHostControlled !== true ? lastIndex - 1 : lastIndex;
}

export function isSmtCompareTemporarilyUnavailable(ctx, compare) {
  return ctx?.isCompareDataUnavailable?.(compare, ctx.chartResolution) === true;
}
