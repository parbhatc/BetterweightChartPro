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
      const results = await Promise.allSettled(entries.map(async (entry) => {
        if (!isCurrent(entry)) return;
        const countBefore = entry.pane.bars?.length ?? 0;
        const firstBefore = entry.pane.bars?.[0]?.time;
        // Current-window HTF/compare studies should paint while the slower
        // primary candle history is paging. Independent panes also start
        // together so the first pane cannot hold every other pane's studies.
        const currentWindow = Promise.resolve(ctx.ensureIndicatorDataThenOverlay?.(entry.pane));
        const history = Promise.resolve(ctx.ensureIndicatorChartHistory?.(entry.pane, {
          shouldContinue: () => isCurrent(entry),
        }));
        const phases = await Promise.allSettled([currentWindow, history]);
        const phaseFailure = phases.find((phase) => phase.status === "rejected");
        if (phaseFailure) throw phaseFailure.reason;
        if (!isCurrent(entry)) return;
        // Only ask studies for the expanded lookback if history changed.
        if ((entry.pane.bars?.length ?? 0) > countBefore || entry.pane.bars?.[0]?.time !== firstBefore) {
          await ctx.ensureIndicatorDataThenOverlay?.(entry.pane);
        }
        if (!isCurrent(entry)) return;
        if (ctx.indicatorController?.paneHasPlotSeriesIndicators?.(entry.pane.index)) {
          ctx.refreshIndicatorsImmediate?.(entry.pane.index);
        }
      }));
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
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
