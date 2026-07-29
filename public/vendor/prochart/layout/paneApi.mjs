import { PriceScaleApi } from "../scale/price.mjs";

/** Public facade for a chart pane. */
export class PaneApi {
  constructor(chart, index) {
    this._chart = chart;
    this._index = index;
  }

  // --- Identity and sizing ---

  paneIndex() {
    return this._index;
  }

  getHeight() {
    return this._pane()?.height ?? 0;
  }

  setHeight(height) {
    this._pane()?.setRequestedHeight(height);
  }

  getStretchFactor() {
    return this.getHeight();
  }

  setStretchFactor(factor) {
    this.setHeight(factor);
  }

  // --- Series and scales ---

  getSeries() {
    const pane = this._pane();
    return pane
      ? pane.series.map((series) => this._chart.seriesApiOf(series))
      : [];
  }

  priceScale(id) {
    const pane = this._pane();
    return pane ? new PriceScaleApi(pane.scale(id)) : null;
  }

  // --- Primitives ---

  attachPrimitive(primitive) {
    const firstSeries = this._pane()?.series[0];
    if (firstSeries) {
      this._chart.seriesApiOf(firstSeries).attachPrimitive(primitive);
    }
  }

  detachPrimitive(primitive) {
    for (const series of this._pane()?.series ?? []) {
      this._chart.seriesApiOf(series).detachPrimitive(primitive);
    }
  }

  _pane() {
    return this._chart.panes[this._index];
  }
}
