import { clone } from "../core/utils.mjs";


export class PriceScaleApi {
  constructor(model) { this._m = model; }
  applyOptions(o) { this._m.applyOptions(o); }
  options() { return clone(this._m.options); }
  width() { return this._m.width(); }
  setAutoScale(on) { this._m.applyOptions({ autoScale: on }); }
  priceToCoordinate(p) { return this._m.priceToCoordinate(p); }
  coordinateToPrice(y) { return this._m.coordinateToPrice(y); }
  getMode() { return this._m.options.mode; }
  setMode(mode) { this._m.applyOptions({ mode }); }
}
