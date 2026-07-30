import { createDrawingController } from "./controller/index.js";
import { mountMainToolbar } from "./toolbars/main/index.js";
import { mountEditToolbar } from "./toolbars/edit/index.js";
import { createMultiPaneDrawingHub } from "./multi/paneHub.js";

export { createDrawingController } from "./controller/index.js";
export { createMultiPaneDrawingHub } from "./multi/paneHub.js";
export { mountMainToolbar, mountDrawingToolbar } from "./toolbars/main/index.js";
export { mountEditToolbar } from "./toolbars/edit/index.js";
export { createFavoriteToolbar } from "./toolbars/favorite/index.js";
export * from "./catalog/tools.js";
export * from "./catalog/icons.js";
export * from "./registry/tools.js";
export * from "./constants.js";
export {
  POSITION_INPUT_DEFAULTS,
  POSITION_QTY_PRECISION_ITEMS,
  POSITION_RISK_UNIT_ITEMS,
  POSITION_STATS_FIELD_ITEMS,
  POSITION_STYLE_DEFAULTS,
} from "./types/position/index.js";
export {
  ANCHORED_VWAP_DEFAULTS,
  BARS_PATTERN_DEFAULTS,
  FORECAST_STYLE_DEFAULTS,
  GHOST_FEED_DEFAULTS,
} from "./tools/forecast/index.js";
export { MEASURE_STYLE_DEFAULTS } from "./tools/measure/index.js";
export { VOLUME_PROFILE_DEFAULTS } from "./tools/volumeProfile/index.js";

/**
 * One-call setup: drawing controller + left toolbar + floating edit toolbar.
 *
 * @param {object} opts
 * @param {import("prochart").IChartApi} opts.chart
 * @param {import("prochart").ISeriesApi} opts.series
 * @param {HTMLElement} opts.container Chart pane element (receives pointer events).
 * @param {HTMLElement} opts.toolbarEl Left drawing toolbar mount node.
 * @param {() => object} opts.getContext Bars + barSec for magnet snap and labels.
 * @returns {{ controller: ReturnType<typeof createDrawingController>, mainToolbar: object, editToolbar: object }}
 */
export function mountDrawings(opts) {
  const { chart, series, container, toolbarEl, getContext } = opts;

  const controller = createDrawingController({ chart, series, container, getContext });
  const mainToolbar = mountMainToolbar({ controller, toolbarEl });
  const editToolbar = mountEditToolbar({ controller, chart, getContext });

  return { controller, mainToolbar, editToolbar };
}
