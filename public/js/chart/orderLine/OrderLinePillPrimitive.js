import {
  clearOrderLineMeasurementCache,
  DEFAULT_ORDER_LINE_PILL_OFFSET,
  drawOrderLineRow,
  layoutOrderLineGeometry,
  measureOrderLineRow,
} from "./rowLayout.js";
import { deepMerge } from "../../../vendor/prochart/core/utils.mjs";

/**
 * ProChart primitive that paints the interactive pills for a compatibility
 * price line. Its immutable drawing inputs are rebuilt only when options
 * change, never during a chart frame.
 */
export class OrderLinePillPrimitive {
  constructor(options) {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._options = deepMerge({}, options ?? {});
    this._state = this._normalizeOptions(this._options);
    this._measurement = null;
    this._measurementKey = this._measurementSignature(this._state);
    this._onFontsLoaded = () => {
      clearOrderLineMeasurementCache();
      this._measurement = null;
      this._requestUpdate?.();
    };

    this._renderer = {
      draw: (target) => this._draw(target),
    };
    this._view = {
      zOrder: () => "top",
      renderer: () => this._renderer,
    };
    this._paneViews = [this._view];
  }

  attached(param) {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    globalThis.document?.fonts?.addEventListener?.("loadingdone", this._onFontsLoaded);
  }

  detached() {
    globalThis.document?.fonts?.removeEventListener?.("loadingdone", this._onFontsLoaded);
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  paneViews() {
    return this._paneViews;
  }

  applyOptions(patch) {
    deepMerge(this._options, patch ?? {});
    const nextState = this._normalizeOptions(this._options);
    const nextMeasurementKey = this._measurementSignature(nextState);
    if (nextMeasurementKey !== this._measurementKey) {
      this._measurement = null;
      this._measurementKey = nextMeasurementKey;
    }
    this._state = nextState;
    this._requestUpdate?.();
  }

  _measurementSignature(state) {
    return [
      state.text,
      state.quantity,
      state.bodyFontSize,
      state.bodyFontWeight,
      state.bodyFontFamily,
      state.quantityFontSize,
      state.quantityFontWeight,
      state.quantityFontFamily,
    ].join("\u0000");
  }

  _normalizeOptions(options) {
    const pills = options?.pills ?? {};
    const body = pills.body ?? {};
    const quantity = pills.quantity ?? {};
    const cancel = pills.cancel ?? {};

    return {
      visible: pills.visible !== false,
      id: String(options?.id ?? ""),
      price: Number(options?.price),
      lineColor: options?.color,
      pillSide: pills.side === "left" ? "left" : "right",
      pillOffset: Number(pills.offset) || DEFAULT_ORDER_LINE_PILL_OFFSET,
      isMoving: Boolean(pills.moving),
      text: String(body.text ?? ""),
      bodyBackgroundColor: body.backgroundColor,
      bodyTextColor: body.textColor,
      bodyBorderColor: body.borderColor,
      bodyFontSize: body.fontSize,
      bodyFontWeight: body.fontWeight,
      bodyFontFamily: body.fontFamily,
      quantity: String(quantity.text ?? ""),
      quantityBackgroundColor: quantity.backgroundColor,
      quantityTextColor: quantity.textColor,
      quantityBorderColor: quantity.borderColor,
      quantityFontSize: quantity.fontSize,
      quantityFontWeight: quantity.fontWeight,
      quantityFontFamily: quantity.fontFamily,
      cancelButtonBackgroundColor: cancel.backgroundColor,
      cancelButtonBorderColor: cancel.borderColor,
      cancelButtonIconColor: cancel.iconColor,
    };
  }

  _draw(target) {
    const state = this._state;
    if (!state.visible || !this._chart || !this._series) return;

    const y = this._series.priceToCoordinate(state.price);
    if (y == null || !Number.isFinite(y)) return;

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const measurement =
        this._measurement ??
        (this._measurement = measureOrderLineRow(state, context));
      const { rowLeft } = layoutOrderLineGeometry(
        state,
        mediaSize.width,
        0,
        measurement,
      );
      drawOrderLineRow(context, state, rowLeft, y, measurement);
    });
  }
}
