/**
 * Keep shared active-pane consumers aligned when focus moves between charts.
 *
 * @param {object} ui
 * @param {object | null | undefined} pane
 */
export function syncActivePaneHoverState(ui, pane) {
  ui.hoverBar = pane?.hoverBar;
  ui.hoverPrev = pane?.hoverPrev;
}
