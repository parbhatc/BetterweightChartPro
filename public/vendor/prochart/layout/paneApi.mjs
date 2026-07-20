import { PriceScaleApi } from "../scale/price.mjs";


export class PaneApi {
  constructor(chart, index) {
    this._chart = chart;
    this._index = index;
  }
  paneIndex() { return this._index; }
  getHeight() { return this._chart.panes[this._index]?.height ?? 0; }
  setHeight(px) {
    const pane = this._chart.panes[this._index];
    if (!pane) return;
    pane.requestedHeight = Math.max(0, px | 0);
    this._chart.invalidate();
  }
  getSeries() {
    const pane = this._chart.panes[this._index];
    return pane ? pane.series.map((s) => this._chart.seriesApiOf(s)) : [];
  }
  getStretchFactor() { return this.getHeight(); }
  setStretchFactor(f) { this.setHeight(f); }
  priceScale(id) {
    const pane = this._chart.panes[this._index];
    return pane ? new PriceScaleApi(pane.scale(id)) : null;
  }
  attachPrimitive(p) {
    const pane = this._chart.panes[this._index];
    const first = pane?.series[0];
    if (first) this._chart.seriesApiOf(first).attachPrimitive(p);
  }
  detachPrimitive(p) {
    const pane = this._chart.panes[this._index];
    for (const s of pane?.series ?? []) this._chart.seriesApiOf(s).detachPrimitive(p);
  }
}
