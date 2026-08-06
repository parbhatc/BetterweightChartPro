/**
 * Paint each pane after a synchronized replay interval load, then restore the
 * shared date range from the active pane once every series is current.
 *
 * @param {object} ctx
 * @param {object[]} panes
 * @param {object[]} savedLayouts
 * @param {(ctx: object, pane: object, savedLayout: object | null) => void} paintPane
 */
export function paintSynchronizedReplayPanes(ctx, panes, savedLayouts, paintPane) {
  for (let i = 0; i < panes.length; i += 1) {
    paintPane(ctx, panes[i], savedLayouts[i] ?? null);
  }
  if (!ctx.layoutManager?.getSync().dateRange) return;
  const source = ctx.getActivePane?.() ?? panes[0];
  if (!source?.chart) return;
  requestAnimationFrame(() => ctx.syncLayoutDateRangeFrom?.(source.chart));
}

/**
 * Prepare the active pane's symbol-specific replay stash without allowing a
 * peer pane to overwrite it during a synchronized interval switch.
 */
export function prepareSynchronizedReplayPanesBeforeTimeframeSwitch(ctx, panes, savedLayouts) {
  const activePane = ctx.getActivePane?.() ?? panes[0];
  for (let i = 0; i < panes.length; i += 1) {
    const pane = panes[i];
    if (pane === activePane || pane.index === activePane?.index) {
      ctx.replayEngine?.beforeResolutionChange?.(pane, {
        viewportLayout: savedLayouts[i] ?? null,
      });
    } else if (ctx.opts?.replayHostControlled) {
      // Preserve the per-pane in-flight guard without replacing the active
      // pane's lower-timeframe bars with another symbol's bars.
      pane._hostReplayTfSwitchInFlight = true;
    }
  }
}
