/**
 * A deliberate price-axis or vertical plot gesture changes the scale mode for
 * the whole layout. Each instrument keeps its own price range and zoom.
 * Linked plot gestures move each peer by the same pixel distance on its own
 * scale. Linked axis gestures apply the same zoom factor around each peer's
 * center, so instruments keep independent prices while moving together.
 * Persist the preference after release so the settings subscriber cannot
 * rebuild the workspace during a drag.
 *
 * @param {{ settingsStore: object, getPanes: () => object[], isPanning: () => boolean,
 *   isLinked?: () => boolean, onViewportChange?: () => void }} deps
 */
export function createManualPriceScaleSync({ settingsStore, getPanes, isPanning, isLinked = () => false, onViewportChange }) {
  let settingsPending = false;

  function flushPending() {
    if (!settingsPending || isPanning()) return false;
    settingsPending = false;
    if (settingsStore.get().scales?.autoScale === false) return false;
    settingsStore.set("scales", "autoScale", false, { skipHistory: true });
    return true;
  }

  function handleManualScale(event) {
    // Indicator subpanes have independent axes and must retain their own mode.
    if (event?.detail?.paneIndex !== 0) return false;
    const zone = event.detail.zone;
    if (zone !== "plot" && zone !== "left" && zone !== "right") return false;
    const scaleId = settingsStore.get().scales?.scalesPlacement === "left" ? "left" : "right";
    for (const pane of getPanes()) {
      if (!pane?.chart || !pane?.series) continue;
      const applyManual = (scale) => {
        if (scale?.options?.().autoScale !== false) scale?.applyOptions?.({ autoScale: false });
      };
      applyManual(pane.series.priceScale());
      applyManual(pane.chart.priceScale(scaleId));
      pane._manualScaleLocked = true;
    }
    settingsPending = true;
    flushPending();
    return true;
  }

  function handlePlotPan(sourcePane, event) {
    const detail = event?.detail;
    if (detail?.paneIndex !== 0 || !Number.isFinite(detail.dy) || detail.dy === 0) return false;
    if (isLinked()) {
      for (const pane of getPanes()) {
        if (!pane?.series || pane === sourcePane || pane.chart === sourcePane.chart || !pane.bars?.length) continue;
        // Never copy NQ prices onto ES (or overwrite a peer's zoom). Let each
        // price scale translate the shared screen displacement independently.
        pane.series.priceScale().panByPixels(-detail.dy);
      }
    }
    // Pure vertical pans emit no time-range change. Still save their final
    // viewport through the same deferred path as horizontal pans.
    onViewportChange?.();
    return true;
  }

  function handleAxisScale(sourcePane, event) {
    const detail = event?.detail;
    if (detail?.paneIndex !== 0 || (detail.zone !== "left" && detail.zone !== "right")) return false;
    if (!Number.isFinite(detail.factor) || detail.factor <= 0) return false;
    if (isLinked()) {
      for (const pane of getPanes()) {
        if (!pane?.series || pane === sourcePane || pane.chart === sourcePane.chart || !pane.bars?.length) continue;
        pane.series.priceScale().scaleAroundCenter(detail.factor);
      }
    }
    onViewportChange?.();
    return true;
  }

  return { handleManualScale, handlePlotPan, handleAxisScale, flushPending };
}
