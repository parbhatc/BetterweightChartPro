/**
 * @param {import("./state.js").BootContext} ctx
 */
export function buildPaneContextMenuOpts(ctx, pane, wrapEl) {
  return {
    pane,
    wrapEl,
    settingsStore: ctx.settingsStore,
    chartSettings: ctx.mountChartSettingsUi(),
    getChartSettings: () => ctx.mountChartSettingsUi(),
    activePriceScaleId: ctx.activePriceScaleId,
    activatePane: async (index) => {
      ctx.layoutManager?.setActivePane(index);
      ctx.switchActivePane(index);
    },
    formatPrice: ctx.formatPrice,
    ui: ctx.ui,
    getDrawing: () => ctx.drawing,
    getDrawingCount: ctx.getDrawingCountForPane,
    getIndicatorCount: ctx.getIndicatorCountForPane,
    removeIndicators: ctx.removeIndicatorsForPane,
    resetChartView: ctx.resetPaneChartView,
    resetPriceScale: ctx.resetPanePriceScale,
    resetTimeScale: ctx.resetPaneTimeScale,
    contextMenuHiddenActions: ctx.opts.contextMenuHiddenActions ?? [],
  };
}

/**
 * @param {import("./state.js").BootContext} ctx
 */
export function attachContextMenuBoot(ctx) {
  ctx.buildPaneContextMenuOpts = (pane, wrapEl) => buildPaneContextMenuOpts(ctx, pane, wrapEl);
}
