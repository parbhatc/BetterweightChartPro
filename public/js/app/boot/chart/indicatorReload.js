/** @param {object[]} panes */
export function invalidateIndicatorReloads(panes) {
  for (const pane of panes) {
    pane._indicatorReloadToken = null;
    delete pane._indicatorHistoryBulkLoad;
  }
}

/**
 * Start the slower indicator-history phase after candles have been painted.
 * A token and symbol/resolution snapshot prevent superseded timeframe work
 * from touching the newly selected series.
 *
 * @param {import("./state.js").BootContext} ctx
 * @param {object[]} panes
 */
export function startIndicatorReload(ctx, panes) {
  const entries = panes.map((pane) => ({
    pane,
    token: {},
    symbol: pane.symbol,
    resolution: pane.resolution,
  }));

  for (const entry of entries) {
    entry.pane._indicatorReloadToken = entry.token;
    entry.pane._indicatorHistoryBulkLoad = true;
  }

  const isCurrent = (entry) =>
    entry.pane._indicatorReloadToken === entry.token &&
    entry.pane.symbol === entry.symbol &&
    entry.pane.resolution === entry.resolution;

  return (async () => {
    try {
      for (const entry of entries) {
        if (!isCurrent(entry)) continue;
        await ctx.ensureIndicatorChartHistory?.(entry.pane, {
          shouldContinue: () => isCurrent(entry),
        });
      }
      for (const entry of entries) {
        if (!isCurrent(entry)) continue;
        await ctx.ensureIndicatorDataThenOverlay?.(entry.pane);
      }
      for (const entry of entries) {
        if (!isCurrent(entry)) continue;
        if (ctx.indicatorController?.paneHasPlotSeriesIndicators?.(entry.pane.index)) {
          ctx.refreshIndicatorsImmediate?.(entry.pane.index);
        }
      }
    } finally {
      for (const entry of entries) {
        if (entry.pane._indicatorReloadToken !== entry.token) continue;
        delete entry.pane._indicatorReloadToken;
        delete entry.pane._indicatorHistoryBulkLoad;
      }
    }
  })();
}

/**
 * Paint the initial candle viewport before paging the deeper history requested
 * by studies. This keeps remote-feed latency off the blocking boot path while
 * retaining the same token-based stale-work protection as timeframe changes.
 * @param {import("./state.js").BootContext} ctx
 * @param {object[]} panes
 * @param {(callback: FrameRequestCallback) => number} [raf]
 */
export function scheduleIndicatorReloadAfterPaint(
  ctx,
  panes,
  raf = globalThis.requestAnimationFrame,
) {
  const run = () => {
    void startIndicatorReload(ctx, panes).catch((err) => {
      console.warn("[BWC] Initial indicator history reload failed:", err);
    });
  };
  if (typeof raf !== "function") {
    queueMicrotask(run);
    return;
  }
  raf(() => raf(run));
}
