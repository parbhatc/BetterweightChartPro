export function isStrictSmtDivergence(nextChart, lastChart, nextCompare, lastCompare) {
  return (nextChart - lastChart) * (nextCompare - lastCompare) < 0;
}

export function isSmtCompareTemporarilyUnavailable(ctx, compare) {
  return ctx?.isCompareDataUnavailable?.(compare, ctx.chartResolution) === true;
}
