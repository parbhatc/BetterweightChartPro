import { clone } from "../core/utils.mjs";


export class TimeScaleApi {
  constructor(model, chart) {
    this._m = model;
    this._chart = chart;
  }
  applyOptions(o) { this._m.applyOptions(o); }
  options() { return clone(this._m.options); }
  getVisibleLogicalRange() { return this._m.times.length ? this._m.visibleLogicalRange() : null; }
  setVisibleLogicalRange(r) { this._m.setVisibleLogicalRange(r); }
  getVisibleRange() { return this._m.visibleTimeRange(); }
  setVisibleRange(r) {
    if (!r) return;
    const from = this._m.timeToIndex(r.from, true);
    const to = this._m.timeToIndex(r.to, true);
    if (from == null || to == null) return;
    this._m.setVisibleLogicalRange({ from, to });
  }
  logicalToCoordinate(l) { return l == null ? null : this._m.logicalToCoordinate(Number(l)); }
  coordinateToLogical(x) { return this._m.coordinateToLogical(x); }
  timeToCoordinate(t) { return this._m.timeToCoordinate(t); }
  coordinateToTime(x) { return this._m.coordinateToTime(x); }
  timeToIndex(t, findNearest = true) { return this._m.timeToIndex(t, findNearest); }
  scrollPosition() { return this._m.rightOffset; }
  scrollToPosition(pos, _animated) {
    this._m.rightEdge = this._m.baseIndex + pos;
    this._chart.invalidate();
    this._m.notifyRangeChange();
  }
  scrollToRealTime() { this.scrollToPosition(this._m._defaultRightOffset, false); }
  resetTimeScale() { this._m.reset(); }
  fitContent() { this._m.fitContent(); }
  width() { return this._chart.paneWidth(); }
  height() { return this._chart.timeAxisHeight(); }
  subscribeVisibleLogicalRangeChange(fn) { this._m._rangeSubs.add(fn); }
  unsubscribeVisibleLogicalRangeChange(fn) { this._m._rangeSubs.delete(fn); }
  subscribeVisibleTimeRangeChange(fn) { this._m._timeRangeSubs.add(fn); }
  unsubscribeVisibleTimeRangeChange(fn) { this._m._timeRangeSubs.delete(fn); }
  subscribeSizeChange(fn) { this._chart._sizeSubs.add(fn); }
  unsubscribeSizeChange(fn) { this._chart._sizeSubs.delete(fn); }
  barSpacing() { return this._m.barSpacing; }
}
