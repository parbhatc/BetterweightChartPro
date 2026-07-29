import { clone } from "../core/utils.mjs";
import { PriceLineApi } from "./priceLineApi.mjs";

/** Public facade for a single chart series. */
export class SeriesApi {
  constructor(model, chart) {
    this._m = model;
    this._chart = chart;
  }

  // --- Data ---

  setData(data) {
    this._m.setData(data);
  }

  update(bar, historicalUpdate) {
    this._m.update(bar, historicalUpdate);
  }

  data() {
    return this._m.data;
  }

  dataByIndex(logical, mismatch) {
    return this._m.dataByIndex(logical, mismatch);
  }

  barsInLogicalRange(range) {
    return this._m.barsInLogicalRange(range);
  }

  // --- Options and metadata ---

  applyOptions(options) {
    this._m.applyOptions(options);
  }

  options() {
    return clone(this._m.options);
  }

  seriesType() {
    return this._m.type;
  }

  priceFormatter() {
    return {
      format: (price) => this._m.priceFormatter()(price),
    };
  }

  // --- Price scale and coordinates ---

  priceScale() {
    return this._chart.priceScaleApiFor(this._m);
  }

  priceToCoordinate(price) {
    return this._chart.priceScaleModelFor(this._m).priceToCoordinate(price);
  }

  coordinateToPrice(coordinate) {
    return this._chart.priceScaleModelFor(this._m).coordinateToPrice(coordinate);
  }

  // --- Primitives ---

  attachPrimitive(primitive) {
    this._m.attachPrimitive(primitive, this);
  }

  detachPrimitive(primitive) {
    this._m.detachPrimitive(primitive);
  }

  // --- Price lines ---

  createPriceLine(options) {
    const line = new PriceLineApi(this._m, this._chart, options);
    this._m.priceLines.add(line);
    this._chart.invalidate();
    return line;
  }

  removePriceLine(line) {
    this._m.priceLines.delete(line);
    this._chart.invalidate();
  }

  priceLines() {
    return [...this._m.priceLines];
  }

  // --- Markers ---

  setMarkers(markers) {
    this._m.markers = Array.isArray(markers) ? markers.slice() : [];
    this._chart.invalidate();
  }

  markers() {
    return this._m.markers.slice();
  }

  // --- Subscriptions ---

  subscribeDataChanged(subscriber) {
    this._m._dataSubs.add(subscriber);
  }

  unsubscribeDataChanged(subscriber) {
    this._m._dataSubs.delete(subscriber);
  }

  // --- Pane placement ---

  getPane() {
    return this._chart.paneApiAt(this._m.paneIndex);
  }

  moveToPane(paneIndex) {
    this._chart.moveSeriesToPane(this._m, paneIndex);
  }
}
