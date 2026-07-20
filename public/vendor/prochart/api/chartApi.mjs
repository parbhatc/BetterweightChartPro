/** Public chart API facade. */
import { clone } from "../core/utils.mjs";
import { CandlestickSeries, LineSeries, AreaSeries, HistogramSeries } from "../core/enums.mjs";
import { PriceScaleApi } from "../scale/price.mjs";


export class ChartApi {
  constructor(model) {
    this._model = model;
  }
  addSeries(typeToken, options, paneIndex = 0) { return this._model.addSeries(typeToken, options, paneIndex); }
  addCandlestickSeries(o) { return this.addSeries(CandlestickSeries, o); }
  addLineSeries(o) { return this.addSeries(LineSeries, o); }
  addAreaSeries(o) { return this.addSeries(AreaSeries, o); }
  addHistogramSeries(o) { return this.addSeries(HistogramSeries, o); }
  removeSeries(api) { this._model.removeSeries(api); }
  addPane() {
    const idx = this._model.panes.length;
    this._model._ensurePane(idx);
    this._model.invalidate();
    return this._model.paneApiAt(idx);
  }
  removePane(index) {
    const m = this._model;
    const pane = m.panes[index];
    if (!pane || index === 0) return;
    for (const s of [...pane.series]) m.removeSeries(m.seriesApiOf(s));
    m.panes.splice(index, 1);
    m._paneApis.splice(index, 1);
    m.panes.forEach((p, i) => {
      p.index = i;
      for (const s of p.series) s.paneIndex = i;
    });
    m._paneApis.forEach((pa, i) => { pa._index = i; });
    m.invalidate();
  }
  panes() { return this._model.panes.map((p) => this._model.paneApiAt(p.index)); }
  paneSize(paneIndex = 0) { return this._model.paneSize(paneIndex); }
  timeScale() { return this._model.timeScaleApi; }
  priceScale(id = "right", paneIndex = 0) {
    const pane = this._model._ensurePane(paneIndex);
    return new PriceScaleApi(pane.scale(id));
  }
  applyOptions(o) { this._model.applyOptions(o); }
  options() { return clone(this._model.options); }
  chartElement() { return this._model.root; }
  resize(w, h, _force) { this._model._applySize(w, h); }
  remove() { this._model.destroy(); }
  takeScreenshot() { return this._model.takeScreenshot(); }
  autoSizeActive() { return Boolean(this._model.options.autoSize); }
  subscribeCrosshairMove(fn) { this._model._crosshairSubs.add(fn); }
  unsubscribeCrosshairMove(fn) { this._model._crosshairSubs.delete(fn); }
  subscribeClick(fn) { this._model._clickSubs.add(fn); }
  unsubscribeClick(fn) { this._model._clickSubs.delete(fn); }
  subscribeDblClick(fn) { this._model._dblClickSubs.add(fn); }
  unsubscribeDblClick(fn) { this._model._dblClickSubs.delete(fn); }
  setCrosshairPosition(price, time, series) { this._model.setCrosshairPosition(price, time, series); }
  clearCrosshairPosition() { this._model.clearCrosshair(true); }
}
