import { clone } from "../core/utils.mjs";

/** Public facade for a price scale. */
export class PriceScaleApi {
  constructor(model) {
    this._m = model;
  }

  // --- Options ---

  applyOptions(options) {
    this._m.applyOptions(options);
  }

  options() {
    return clone(this._m.options);
  }

  setAutoScale(enabled) {
    this._m.applyOptions({ autoScale: enabled });
  }

  getMode() {
    return this._m.options.mode;
  }

  setMode(mode) {
    this._m.applyOptions({ mode });
  }

  // --- Coordinates and dimensions ---

  priceToCoordinate(price) {
    return this._m.priceToCoordinate(price);
  }

  coordinateToPrice(coordinate) {
    return this._m.coordinateToPrice(coordinate);
  }

  /** Scale the visible price range around its center without changing margins. */
  scaleAroundCenter(factor) {
    this._m.scaleAroundCenter(factor);
  }

  width() {
    return this._m.width();
  }
}
