import { clone } from "../core/utils.mjs";
import {
  AreaSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from "../core/enums.mjs";
import { PriceScaleApi } from "../scale/price.mjs";

/** Public facade for chart-level operations. */
export class ChartApi {
  constructor(model) {
    this._model = model;
  }

  // --- Series ---

  addSeries(typeToken, options, paneIndex = 0) {
    return this._model.addSeries(typeToken, options, paneIndex);
  }

  addCandlestickSeries(options) {
    return this.addSeries(CandlestickSeries, options);
  }

  addLineSeries(options) {
    return this.addSeries(LineSeries, options);
  }

  addAreaSeries(options) {
    return this.addSeries(AreaSeries, options);
  }

  addHistogramSeries(options) {
    return this.addSeries(HistogramSeries, options);
  }

  removeSeries(seriesApi) {
    this._model.removeSeries(seriesApi);
  }

  // --- Panes and scales ---

  addPane() {
    return this._model.addPane();
  }

  removePane(paneIndex) {
    this._model.removePane(paneIndex);
  }

  panes() {
    return this._model.panes.map(
      (pane) => this._model.paneApiAt(pane.index),
    );
  }

  paneSize(paneIndex = 0) {
    return this._model.paneSize(paneIndex);
  }

  timeScale() {
    return this._model.timeScaleApi;
  }

  priceScale(id = "right", paneIndex = 0) {
    const pane = this._model._ensurePane(paneIndex);
    return new PriceScaleApi(pane.scale(id));
  }

  // --- Options and sizing ---

  applyOptions(options) {
    this._model.applyOptions(options);
  }

  options() {
    return clone(this._model.options);
  }

  resize(width, height, _force) {
    this._model._applySize(width, height);
  }

  autoSizeActive() {
    return Boolean(this._model.options.autoSize);
  }

  // --- Output and lifecycle ---

  chartElement() {
    return this._model.root;
  }

  takeScreenshot() {
    return this._model.takeScreenshot();
  }

  remove() {
    this._model.destroy();
  }

  // --- Pointer subscriptions ---

  subscribeCrosshairMove(subscriber) {
    this._model._crosshairSubs.add(subscriber);
  }

  unsubscribeCrosshairMove(subscriber) {
    this._model._crosshairSubs.delete(subscriber);
  }

  subscribeClick(subscriber) {
    this._model._clickSubs.add(subscriber);
  }

  unsubscribeClick(subscriber) {
    this._model._clickSubs.delete(subscriber);
  }

  subscribeDblClick(subscriber) {
    this._model._dblClickSubs.add(subscriber);
  }

  unsubscribeDblClick(subscriber) {
    this._model._dblClickSubs.delete(subscriber);
  }

  // --- Crosshair control ---

  setCrosshairPosition(price, time, series) {
    this._model.setCrosshairPosition(price, time, series);
  }

  clearCrosshairPosition() {
    this._model.clearCrosshair(true);
  }
}
