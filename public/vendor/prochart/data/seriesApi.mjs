import { clone } from "../core/utils.mjs";
import { PriceLineApi } from "./priceLineApi.mjs";


export class SeriesApi {
  constructor(model, chart) {
    this._m = model;
    this._chart = chart;
  }
  setData(d) { this._m.setData(d); }
  update(bar, historicalUpdate) { this._m.update(bar, historicalUpdate); }
  data() { return this._m.data; }
  dataByIndex(logical, mismatch) { return this._m.dataByIndex(logical, mismatch); }
  applyOptions(o) { this._m.applyOptions(o); }
  options() { return clone(this._m.options); }
  seriesType() { return this._m.type; }
  priceScale() { return this._chart.priceScaleApiFor(this._m); }
  priceToCoordinate(p) { return this._chart.priceScaleModelFor(this._m).priceToCoordinate(p); }
  coordinateToPrice(y) { return this._chart.priceScaleModelFor(this._m).coordinateToPrice(y); }
  barsInLogicalRange(range) {
    const m = this._m;
    if (!range || !m.times.length) return null;
    const a = Math.max(0, m.localNearestLeft(Math.floor(range.from)));
    let b = m.localNearestLeft(Math.ceil(range.to));
    if (b < 0) b = 0;
    return {
      from: m.times[a],
      to: m.times[b],
      barsBefore: range.from - (m.indices ? m.indices[0] : 0),
      barsAfter: (m.indices ? m.indices[m.times.length - 1] : 0) - range.to,
    };
  }
  attachPrimitive(p) {
    this._m.overlays.add(p);
    if (typeof p.attached === "function") {
      p.attached({
        chart: this._chart.api,
        series: this,
        requestUpdate: () => this._chart.invalidate(),
      });
    }
    this._chart.invalidate();
  }
  detachPrimitive(p) {
    if (!this._m.overlays.delete(p)) return;
    if (typeof p.detached === "function") { try { p.detached(); } catch { /* noop */ } }
    this._chart.invalidate();
  }
  createPriceLine(opts) {
    const line = new PriceLineApi(this._m, this._chart, opts);
    this._m.priceLines.add(line);
    this._chart.invalidate();
    return line;
  }
  removePriceLine(line) {
    this._m.priceLines.delete(line);
    this._chart.invalidate();
  }
  priceLines() { return [...this._m.priceLines]; }
  setMarkers(markers) {
    this._m.markers = Array.isArray(markers) ? markers.slice() : [];
    this._chart.invalidate();
  }
  markers() { return this._m.markers.slice(); }
  subscribeDataChanged(fn) { this._m._dataSubs.add(fn); }
  unsubscribeDataChanged(fn) { this._m._dataSubs.delete(fn); }
  getPane() { return this._chart.paneApiAt(this._m.paneIndex); }
  moveToPane(paneIndex) { this._chart.moveSeriesToPane(this._m, paneIndex); }
  priceFormatter() { return { format: (p) => this._m.priceFormatter()(p) }; }
}
