import { clone } from "../core/utils.mjs";

/** Public facade for chart time-scale operations. */
export class TimeScaleApi {
  constructor(model, chart) {
    this._m = model;
    this._chart = chart;
  }

  // --- Options ---

  applyOptions(options) {
    this._m.applyOptions(options);
  }

  options() {
    return clone(this._m.options);
  }

  // --- Visibility ---

  getVisibleLogicalRange() {
    return this._m.times.length ? this._m.visibleLogicalRange() : null;
  }

  setVisibleLogicalRange(range) {
    this._m.setVisibleLogicalRange(range);
  }

  getVisibleRange() {
    return this._m.visibleTimeRange();
  }

  setVisibleRange(range) {
    this._m.setVisibleTimeRange(range);
  }

  // --- Coordinate conversion ---

  logicalToCoordinate(logical) {
    return logical == null ? null : this._m.logicalToCoordinate(Number(logical));
  }

  coordinateToLogical(coordinate) {
    return this._m.coordinateToLogical(coordinate);
  }

  timeToCoordinate(time) {
    return this._m.timeToCoordinate(time);
  }

  coordinateToTime(coordinate) {
    return this._m.coordinateToTime(coordinate);
  }

  timeToIndex(time, findNearest = true) {
    return this._m.timeToIndex(time, findNearest);
  }

  // --- Navigation ---

  scrollPosition() {
    return this._m.rightOffset;
  }

  scrollToPosition(position, _animated) {
    this._m.scrollToPosition(position);
  }

  scrollToRealTime() {
    this._m.scrollToPosition(this._m._defaultRightOffset);
  }

  resetTimeScale() {
    this._m.reset();
  }

  fitContent() {
    this._m.fitContent();
  }

  // --- Dimensions ---

  width() {
    return this._chart.paneWidth();
  }

  height() {
    return this._chart.timeAxisHeight();
  }

  barSpacing() {
    return this._m.barSpacing;
  }

  // --- Subscriptions ---

  subscribeVisibleLogicalRangeChange(subscriber) {
    this._m._rangeSubs.add(subscriber);
  }

  unsubscribeVisibleLogicalRangeChange(subscriber) {
    this._m._rangeSubs.delete(subscriber);
  }

  subscribeVisibleTimeRangeChange(subscriber) {
    this._m._timeRangeSubs.add(subscriber);
  }

  unsubscribeVisibleTimeRangeChange(subscriber) {
    this._m._timeRangeSubs.delete(subscriber);
  }

  subscribeSizeChange(subscriber) {
    this._chart._sizeSubs.add(subscriber);
  }

  unsubscribeSizeChange(subscriber) {
    this._chart._sizeSubs.delete(subscriber);
  }
}
