/**
 * Convert a logical pan delta between panes with different bar cadences.
 * @param {{ from: number, to: number }} delta
 * @param {number | null | undefined} sourceBarSec
 * @param {number | null | undefined} targetBarSec
 */
export function scaleLogicalPanDelta(delta, sourceBarSec, targetBarSec) {
  if (
    !Number.isFinite(sourceBarSec) ||
    !Number.isFinite(targetBarSec) ||
    sourceBarSec <= 0 ||
    targetBarSec <= 0
  ) {
    return delta;
  }
  const ratio = sourceBarSec / targetBarSec;
  return { from: delta.from * ratio, to: delta.to * ratio };
}

/**
 * Layout sync helpers for multi-pane charts.
 * @param {object} deps
 */
export function createLayoutSync(deps) {
  /** Chart currently driving a date-range update to its peers. */
  let dateRangeSyncSource = null;
  /** Latest source update received before the current animation frame ends. */
  let pendingDateRangeRequest = null;
  let dateRangeReleaseRaf = null;
  let crosshairSyncing = false;
  const lastSyncedLogicalRange = new WeakMap();

  function layoutPanes() {
    return deps.getLayoutPanes?.() ?? deps.getLayoutCharts?.() ?? [];
  }

  /** @param {{ from?: unknown, to?: unknown } | null | undefined} range */
  function isValidTimeRange(range) {
    return (
      range != null &&
      range.from != null &&
      range.to != null &&
      Number.isFinite(range.from) &&
      Number.isFinite(range.to)
    );
  }

  /** @param {{ from?: unknown, to?: unknown } | null | undefined} range */
  function isValidLogicalRange(range) {
    return (
      range != null &&
      range.from != null &&
      range.to != null &&
      Number.isFinite(range.from) &&
      Number.isFinite(range.to)
    );
  }

  function syncLayoutDateRangeFrom(sourceChart, liveLogicalRange) {
    const layoutManager = deps.getLayoutManager?.() ?? deps.layoutManager;
    if (!layoutManager?.getSync().dateRange) return;
    const panes = layoutPanes();
    // A single-pane layout has no peer to synchronize. Returning here also
    // avoids an otherwise-empty release rAF on every pan frame.
    if (panes.length < 2) return;
    if (dateRangeSyncSource) {
      // Ignore callbacks caused by updating a peer, but retain newer movement
      // from the chart the user is actively panning instead of dropping it.
      if (sourceChart === dateRangeSyncSource) {
        pendingDateRangeRequest = { sourceChart, liveLogicalRange };
      }
      return;
    }
    const sourcePane = panes.find((p) => p.chart === sourceChart);
    if (!sourcePane?.bars?.length) return;

    const ts = sourceChart.timeScale();
    const timeRange = ts.getVisibleRange?.();
    const logicalRange = isValidLogicalRange(liveLogicalRange)
      ? liveLogicalRange
      : ts.getVisibleLogicalRange();
    const previousLogicalRange = lastSyncedLogicalRange.get(sourceChart);
    if (deps.isBarsLoading?.() || deps.isHistoryRestorePending?.()) {
      if (isValidLogicalRange(logicalRange)) lastSyncedLogicalRange.set(sourceChart, logicalRange);
      return;
    }

    const isPanning = Boolean(deps.isChartPanning?.());
    const activePane = deps.getActivePane?.();
    if (isPanning && activePane?.chart && activePane.chart !== sourceChart) return;

    const logicalDelta =
      isPanning && isValidLogicalRange(previousLogicalRange) && isValidLogicalRange(logicalRange)
        ? {
            from: logicalRange.from - previousLogicalRange.from,
            to: logicalRange.to - previousLogicalRange.to,
          }
        : null;
    // The first live range event establishes a baseline. Copying its absolute
    // logical indexes would jump peers whose history length or interval differs.
    if (isPanning && !logicalDelta) {
      if (isValidLogicalRange(logicalRange)) lastSyncedLogicalRange.set(sourceChart, logicalRange);
      return;
    }
    // Lightweight Charts can report a stale time range until pointer-up. Use
    // the event's live logical movement while dragging, then exact time sync
    // resumes automatically after the gesture ends.
    const useTime = !isPanning && isValidTimeRange(timeRange);
    const useLogical = isValidLogicalRange(logicalRange);
    if (!useTime && !useLogical) return;

    dateRangeSyncSource = sourceChart;
    try {
      for (const pane of panes) {
        if (pane.chart === sourceChart || !pane.bars?.length) continue;
        const targetTs = pane.chart.timeScale();
        try {
          const targetLogical = targetTs.getVisibleLogicalRange();
          if (logicalDelta && isValidLogicalRange(targetLogical)) {
            const targetDelta = scaleLogicalPanDelta(
              logicalDelta,
              sourcePane.barSec,
              pane.barSec,
            );
            const nextLogical = {
              from: targetLogical.from + targetDelta.from,
              to: targetLogical.to + targetDelta.to,
            };
            targetTs.setVisibleLogicalRange(nextLogical);
            lastSyncedLogicalRange.set(pane.chart, nextLogical);
          } else if (useTime && targetTs.setVisibleRange) {
            targetTs.setVisibleRange(timeRange);
            const applied = targetTs.getVisibleLogicalRange();
            if (isValidLogicalRange(applied)) {
              lastSyncedLogicalRange.set(pane.chart, applied);
            }
          } else if (useLogical && sourcePane.barSec === pane.barSec) {
            targetTs.setVisibleLogicalRange(logicalRange);
            lastSyncedLogicalRange.set(pane.chart, logicalRange);
          }
        } catch {
          if (useLogical && sourcePane.barSec === pane.barSec) {
            try {
              targetTs.setVisibleLogicalRange(logicalRange);
            } catch {
              /* chart not ready */
            }
          }
        }
      }
      if (useLogical) lastSyncedLogicalRange.set(sourceChart, logicalRange);
    } finally {
      if (dateRangeReleaseRaf == null) {
        dateRangeReleaseRaf = requestAnimationFrame(() => {
          dateRangeReleaseRaf = null;
          const pending = pendingDateRangeRequest;
          pendingDateRangeRequest = null;
          dateRangeSyncSource = null;
          if (pending) {
            syncLayoutDateRangeFrom(pending.sourceChart, pending.liveLogicalRange);
          }
        });
      }
    }
  }

  /**
   * @param {import("prochart").IChartApi} sourceChart
   * @param {import("prochart").ISeriesApi} sourceSeries
   * @param {import("prochart").MouseEventParams} param
   */
  function syncLayoutCrosshairFrom(sourceChart, sourceSeries, param) {
    const layoutManager = deps.getLayoutManager?.() ?? deps.layoutManager;
    if (crosshairSyncing || !layoutManager?.getSync().crosshair) return;
    crosshairSyncing = true;
    try {
      for (const pane of layoutPanes()) {
        if (pane.chart === sourceChart) continue;
        if (param?.time != null && param.point) {
          const price = sourceSeries.coordinateToPrice(param.point.y);
          if (price != null) pane.chart.setCrosshairPosition(price, param.time, pane.series);
        } else {
          pane.chart.clearCrosshairPosition();
        }
      }
    } finally {
      requestAnimationFrame(() => {
        crosshairSyncing = false;
      });
    }
  }

  /** @param {import("prochart").IChartApi} paneChart */
  function wireLayoutPaneSync(paneChart) {
    const timeScale = paneChart.timeScale();
    const initialRange = timeScale.getVisibleLogicalRange();
    if (isValidLogicalRange(initialRange)) {
      lastSyncedLogicalRange.set(paneChart, initialRange);
    }
    timeScale.subscribeVisibleLogicalRangeChange((logicalRange) => {
      syncLayoutDateRangeFrom(paneChart, logicalRange);
    });
  }

  return { syncLayoutDateRangeFrom, syncLayoutCrosshairFrom, wireLayoutPaneSync };
}
