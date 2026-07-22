import { LineStyle } from "../../../vendor/prochart/core/enums.mjs";
import {
  formatOrderLinePrice,
  resolveOrderLineFontFamily,
  resolveOrderLineFontSize,
  resolveOrderLineFontWeight,
  DEFAULT_ORDER_LINE_PILL_OFFSET,
  drawOrderLineRow,
  layoutOrderLineGeometry,
} from "./rowLayout.js";

function orderLineDrawState(options) {
  const pills = options?.pills ?? {};
  const body = pills.body ?? {};
  const quantity = pills.quantity ?? {};
  const cancel = pills.cancel ?? {};
  return {
    id: String(options?.id ?? ""), price: Number(options?.price), lineColor: options?.color,
    pillSide: pills.side === "left" ? "left" : "right",
    pillOffset: Number(pills.offset) || DEFAULT_ORDER_LINE_PILL_OFFSET,
    isMoving: Boolean(pills.moving), text: String(body.text ?? ""),
    bodyBackgroundColor: body.backgroundColor, bodyTextColor: body.textColor,
    bodyBorderColor: body.borderColor, bodyFontSize: body.fontSize,
    bodyFontWeight: body.fontWeight, bodyFontFamily: body.fontFamily,
    quantity: String(quantity.text ?? ""), quantityBackgroundColor: quantity.backgroundColor,
    quantityTextColor: quantity.textColor, quantityBorderColor: quantity.borderColor,
    quantityFontSize: quantity.fontSize, quantityFontWeight: quantity.fontWeight,
    quantityFontFamily: quantity.fontFamily, cancelButtonBackgroundColor: cancel.backgroundColor,
    cancelButtonBorderColor: cancel.borderColor, cancelButtonIconColor: cancel.iconColor,
  };
}

class OrderLinePillPrimitive {
  constructor(priceLine) {
    this._priceLine = priceLine;
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._view = { zOrder: () => "top", renderer: () => ({ draw: (target) => this._draw(target) }) };
  }
  attached(param) { this._chart = param.chart; this._series = param.series; this._requestUpdate = param.requestUpdate; }
  detached() { this._chart = null; this._series = null; this._requestUpdate = null; }
  paneViews() { return [this._view]; }
  requestRefresh() { this._requestUpdate?.(); }
  _draw(target) {
    const options = this._priceLine.options();
    if (options?.pills?.visible === false || !this._chart || !this._series) return;
    const y = this._series.priceToCoordinate(Number(options.price));
    if (y == null || !Number.isFinite(y)) return;
    const state = orderLineDrawState(options);
    const { rowLeft } = layoutOrderLineGeometry(state, this._chart.paneSize().width, 0);
    target.useMediaCoordinateSpace(({ context }) => drawOrderLineRow(context, state, rowLeft, y));
  }
}

function createCompatOrderLine(series, options) {
  const priceLine = series.createPriceLine(options);
  const primitive = new OrderLinePillPrimitive(priceLine);
  series.attachPrimitive(primitive);
  return {
    applyOptions(patch) { priceLine.applyOptions(patch); primitive.requestRefresh(); },
    options() { return priceLine.options(); },
    _remove() { series.detachPrimitive(primitive); series.removePriceLine(priceLine); },
  };
}

function removeCompatOrderLine(series, line) {
  if (typeof line?._remove === "function") line._remove();
  else series.removeOrderLine?.(line);
}

/** @param {number} lineStyle */
function mapOrderLineStyle(lineStyle) {
  if (lineStyle === 2) return LineStyle.Dotted;
  if (lineStyle === 1) return LineStyle.Dashed;
  return LineStyle.Solid;
}

/** @param {import("./types.js").OrderLineState} state */
export function stateToOrderLineOptions(state) {
  const color = state.lineColor || state.bodyBackgroundColor || "#089981";
  const qtyText = state.quantity?.trim() ?? "";

  return {
    id: state.id,
    price: state.price,
    color,
    lineVisible: true,
    axisLabelVisible: false,
    axisLabelColor: color,
    axisLabelTextColor: "#ffffff",
    axisLabelText: formatOrderLinePrice(state.price),
    lineWidth: 1,
    lineStyle: mapOrderLineStyle(state.lineStyle),
    pills: {
      visible: true,
      side: state.pillSide === "left" ? "left" : "right",
      offset: Math.max(4, Number(state.pillOffset) || DEFAULT_ORDER_LINE_PILL_OFFSET),
      moving: Boolean(state.isMoving),
      body: {
        text: state.text ?? "",
        backgroundColor: state.bodyBackgroundColor || color,
        textColor: state.bodyTextColor || "#ffffff",
        borderColor: state.bodyBorderColor || "transparent",
        tooltip: state.bodyTooltip ?? "",
        fontSize: resolveOrderLineFontSize(state.bodyFontSize),
        fontWeight: resolveOrderLineFontWeight(state.bodyFontWeight),
        fontFamily: resolveOrderLineFontFamily(state.bodyFontFamily),
        visible: true,
      },
      quantity: {
        text: qtyText,
        backgroundColor: state.quantityBackgroundColor || color,
        textColor: state.quantityTextColor || "#ffffff",
        borderColor: state.quantityBorderColor || "transparent",
        tooltip: state.quantityTooltip ?? "",
        fontSize: resolveOrderLineFontSize(state.quantityFontSize),
        fontWeight: resolveOrderLineFontWeight(state.quantityFontWeight),
        fontFamily: resolveOrderLineFontFamily(state.quantityFontFamily),
        visible: Boolean(qtyText),
      },
      cancel: {
        visible: true,
        backgroundColor: state.cancelButtonBackgroundColor ?? "rgba(255, 255, 255, 0.96)",
        borderColor: state.cancelButtonBorderColor ?? "rgba(0, 0, 0, 0.1)",
        iconColor: state.cancelButtonIconColor ?? "rgba(0, 0, 0, 0.55)",
        tooltip: state.cancelTooltip ?? "",
      },
    },
  };
}

/**
 * Sync TradingView order lines to native series.createOrderLine().
 * @param {() => object | null | undefined} getActivePane
 */
export function createOrderLinePriceLineSync(getActivePane) {
  /** @type {import("prochart").ISeriesApi | null} */
  let seriesRef = null;
  /** @type {Map<string, import("prochart").IOrderLine>} */
  const lines = new Map();

  /**
   * @param {import("./types.js").OrderLineState[]} states
   * @param {Map<string, ReturnType<import("./createOrderLineAdapter.js").createOrderLineAdapter>>} [adapters]
   */
  function sync(states, adapters) {
    const pane = getActivePane();
    if (!pane?.series) {
      destroy();
      return;
    }

    if (seriesRef !== pane.series) {
      destroy();
      seriesRef = pane.series;
    }

    /** @type {Set<string>} */
    const activeIds = new Set();

    for (const state of states) {
      if (state.removed || !Number.isFinite(state.price)) continue;
      activeIds.add(state.id);

      const options = stateToOrderLineOptions(state);
      const existing = lines.get(state.id);
      let handle = existing;
      if (handle) {
        handle.applyOptions(options);
      } else {
        handle = pane.series.createOrderLine
          ? pane.series.createOrderLine(options)
          : createCompatOrderLine(pane.series, options);
        lines.set(state.id, handle);
      }

      const adapter = adapters?.get(state.id);
      if (adapter?._state) {
        adapter._state._nativeLine = handle;
      }
    }

    for (const [id, line] of lines) {
      if (activeIds.has(id)) continue;
      try {
        removeCompatOrderLine(pane.series, line);
      } catch {
        /* ignore */
      }
      lines.delete(id);
      const adapter = adapters?.get(id);
      if (adapter?._state) adapter._state._nativeLine = null;
    }
  }

  function destroy() {
    if (seriesRef) {
      for (const line of lines.values()) {
        try {
          removeCompatOrderLine(seriesRef, line);
        } catch {
          /* ignore */
        }
      }
    }
    lines.clear();
    seriesRef = null;
  }

  return { sync, destroy };
}

/** @param {import("./types.js").OrderLineState} state */
export function orderLineOverlayState(state) {
  return state;
}

/** @param {Record<string, unknown> | undefined} base @param {Record<string, unknown>} patch */
function mergeOrderLinePatch(base, patch) {
  const out = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      out[key] &&
      typeof out[key] === "object" &&
      !Array.isArray(out[key])
    ) {
      out[key] = mergeOrderLinePatch(/** @type {Record<string, unknown>} */ (out[key]), /** @type {Record<string, unknown>} */ (value));
    } else {
      out[key] = value;
    }
  }
  return out;
}

let getIsChartPanning = () => false;
/** @type {Map<string, Record<string, unknown>>} */
const deferredPatchesById = new Map();

/** @param {{ getIsPanning?: () => boolean }} hooks */
export function setOrderLinePanHooks(hooks) {
  getIsChartPanning = hooks.getIsPanning ?? (() => false);
}

/**
 * @param {Map<string, ReturnType<import("./createOrderLineAdapter.js").createOrderLineAdapter>>} adapters
 */
export function flushDeferredOrderLinePatches(adapters) {
  if (!deferredPatchesById.size) return;
  for (const [id, patch] of deferredPatchesById) {
    const native = adapters.get(id)?._state?._nativeLine;
    if (native?.applyOptions) {
      native.applyOptions(patch);
    }
  }
  deferredPatchesById.clear();
}

/** @param {import("./types.js").OrderLineState} state */
export function applyNativeOrderLinePatch(state, patch) {
  if (getIsChartPanning()) {
    deferredPatchesById.set(
      state.id,
      mergeOrderLinePatch(deferredPatchesById.get(state.id), patch),
    );
    return true;
  }

  const native = state._nativeLine;
  if (!native?.applyOptions) return false;
  native.applyOptions(patch);
  return true;
}
