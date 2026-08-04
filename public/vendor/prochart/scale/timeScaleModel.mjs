import { clone, deepMerge, toSec } from "../core/utils.mjs";
import { defaultChartOptions } from "../core/defaults.mjs";

const STEP_SAMPLE_LIMIT = 2_048;

/**
 * Infer the candle interval without letting overnight/weekend session gaps
 * stretch future-whitespace labels. Candle series produce a dominant repeated
 * delta; for irregular data, use the median positive delta as a safe fallback.
 */
function inferBarStep(times, fallback = 60) {
  if (times.length < 2) return fallback;
  const start = Math.max(1, times.length - STEP_SAMPLE_LIMIT);
  const deltas = [];
  const frequencies = new Map();
  for (let i = start; i < times.length; i += 1) {
    const delta = Math.round(times[i] - times[i - 1]);
    if (!Number.isFinite(delta) || delta <= 0) continue;
    deltas.push(delta);
    frequencies.set(delta, (frequencies.get(delta) ?? 0) + 1);
  }
  if (!deltas.length) return fallback;

  let dominant = deltas[0];
  let dominantCount = 0;
  for (const [delta, count] of frequencies) {
    if (count > dominantCount || (count === dominantCount && delta < dominant)) {
      dominant = delta;
      dominantCount = count;
    }
  }
  if (dominantCount > 1) return dominant;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)] ?? fallback;
}


export class TimeScaleModel {
  constructor(chart) {
    this._chart = chart;
    this.options = clone(defaultChartOptions().timeScale);
    /** merged, sorted unique times across all series (unix sec) */
    this.times = [];
    this.timeToIndexMap = new Map();
    /** absolute logical index at the right edge of the plot (LWC-compatible semantics) */
    this.rightEdge = 0;
    this._hadData = false;
    this.barSpacing = 6;
    this._defaultRightOffset = 0;
    this._defaultBarSpacing = 6;
    this._rangeSubs = new Set();
    this._timeRangeSubs = new Set();
    this._avgStep = 60;
  }

  applyOptions(opts) {
    if (!opts) return;
    if (opts.rightOffset !== undefined) this.rightEdge = this.baseIndex + opts.rightOffset;
    if (opts.barSpacing !== undefined) this.barSpacing = opts.barSpacing;
    deepMerge(this.options, opts);
    if (opts.rightOffset !== undefined) this._defaultRightOffset = opts.rightOffset;
    if (opts.barSpacing !== undefined) this._defaultBarSpacing = opts.barSpacing;
    this.clampBarSpacing();
    this._chart.invalidate();
  }

  clampBarSpacing() {
    const o = this.options;
    this.barSpacing = Math.min(Math.max(this.barSpacing, o.minBarSpacing || 0.5), o.maxBarSpacing || 120);
  }

  get baseIndex() {
    return Math.max(0, this.times.length - 1);
  }

  get rightOffset() {
    return this.rightEdge - this.baseIndex;
  }

  plotWidth() {
    return Math.max(1, this._chart.paneWidth());
  }

  /** rebuild merged time index from all series (k-way merge of sorted arrays) */
  rebuildIndex() {
    const lists = [];
    for (const s of this._chart.allSeries()) if (s.times.length) lists.push(s.times);
    const merged = [];
    if (lists.length === 1) {
      const src = lists[0];
      for (let i = 0; i < src.length; i++) merged.push(src[i]);
    } else if (lists.length > 1) {
      const idx = new Array(lists.length).fill(0);
      let last = -Infinity;
      for (;;) {
        let best = -1, bestVal = Infinity;
        for (let i = 0; i < lists.length; i++) {
          if (idx[i] < lists[i].length && lists[i][idx[i]] < bestVal) {
            bestVal = lists[i][idx[i]];
            best = i;
          }
        }
        if (best < 0) break;
        idx[best] += 1;
        if (bestVal !== last) {
          merged.push(bestVal);
          last = bestVal;
        }
      }
    }
    this.times = merged;
    this.timeToIndexMap.clear();
    for (let i = 0; i < merged.length; i++) this.timeToIndexMap.set(merged[i], i);
    if (merged.length > 1) this._avgStep = inferBarStep(merged, this._avgStep);
    for (const s of this._chart.allSeries()) s.remapIndices(this.timeToIndexMap);
    if (!this._hadData && merged.length) {
      // first real data: land the default view (latest bars + configured future offset)
      this._hadData = true;
      this.rightEdge = this.baseIndex + this._defaultRightOffset;
    } else if (!merged.length) {
      this._hadData = false;
    }
    this.notifyRangeChange();
  }

  /** append single time (fast path for series.update) */
  appendTime(t) {
    const last = this.times.length ? this.times[this.times.length - 1] : -Infinity;
    if (t === last || this.timeToIndexMap.has(t)) return false;
    if (t > last) {
      const oldBase = this.baseIndex;
      this.times.push(t);
      this.timeToIndexMap.set(t, this.times.length - 1);
      if (this.times.length > 1) this._avgStep = inferBarStep(this.times, this._avgStep);
      // follow the newest bar if the right edge was at/past it (LWC shiftVisibleRangeOnNewBar)
      if (this.options.shiftVisibleRangeOnNewBar !== false && this._hadData && this.rightEdge >= oldBase) {
        this.rightEdge += 1;
      }
      if (!this._hadData) {
        this._hadData = true;
        this.rightEdge = this.baseIndex + this._defaultRightOffset;
      }
      return true;
    }
    this.rebuildIndex();
    return true;
  }

  visibleLogicalRange() {
    const w = this.plotWidth();
    const to = this.rightEdge;
    return { from: to - w / this.barSpacing, to };
  }

  setVisibleLogicalRange(range) {
    if (!range) return;
    const w = this.plotWidth();
    const span = Math.max(0.5, range.to - range.from);
    this.barSpacing = w / span;
    this.clampBarSpacing();
    this.rightEdge = range.to;
    this._chart.invalidate();
    this.notifyRangeChange();
  }

  setVisibleTimeRange(range) {
    if (!range) return;

    const from = this.timeToIndex(range.from, true);
    const to = this.timeToIndex(range.to, true);
    if (from == null || to == null) return;
    this.setVisibleLogicalRange({ from, to });
  }

  logicalToCoordinate(logical) {
    const r = this.visibleLogicalRange();
    return (logical - r.from) * this.barSpacing;
  }

  coordinateToLogical(x) {
    const r = this.visibleLogicalRange();
    return r.from + x / this.barSpacing;
  }

  indexToTime(i) {
    const n = this.times.length;
    if (!n) return null;
    const ri = Math.round(i);
    if (ri >= 0 && ri < n) return this.times[ri];
    // Extrapolate into whitespace using the inferred candle interval. A global
    // average includes closed-session gaps and produces incorrect future times.
    if (ri >= n) return this.times[n - 1] + (ri - (n - 1)) * this._avgStep;
    return this.times[0] + ri * this._avgStep;
  }

  timeToIndex(t, extrapolate = true) {
    const sec = toSec(t);
    if (!Number.isFinite(sec)) return null;
    const hit = this.timeToIndexMap.get(sec);
    if (hit !== undefined) return hit;
    const n = this.times.length;
    if (!n) return null;
    if (sec > this.times[n - 1]) {
      if (!extrapolate) return null;
      return n - 1 + (sec - this.times[n - 1]) / this._avgStep;
    }
    if (sec < this.times[0]) {
      if (!extrapolate) return null;
      return (sec - this.times[0]) / this._avgStep;
    }
    // interpolate between neighbours
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] <= sec) lo = mid;
      else hi = mid;
    }
    const span = this.times[hi] - this.times[lo] || 1;
    return lo + (sec - this.times[lo]) / span;
  }

  timeToCoordinate(t) {
    const idx = this.timeToIndex(t, true);
    if (idx == null) return null;
    return this.logicalToCoordinate(idx);
  }

  coordinateToTime(x) {
    const logical = this.coordinateToLogical(x);
    return this.indexToTime(Math.round(logical));
  }

  scrollBy(pixels) {
    this.rightEdge += pixels / this.barSpacing;
    this._applyEdgeLimits();
    this._chart.invalidate();
    this.notifyRangeChange();
  }

  scrollToPosition(position) {
    this.rightEdge = this.baseIndex + position;
    this._chart.invalidate();
    this.notifyRangeChange();
  }

  _applyEdgeLimits() {
    const w = this.plotWidth() / this.barSpacing;
    // scrolling back: leftmost bar can reach the right side minus a couple bars
    const minEdge = 2 - w;
    if (this.rightEdge < minEdge) this.rightEdge = minEdge;
    // scrolling into the future: stop when the last bar reaches the left edge
    // (TradingView behavior — no infinite whitespace scroll)
    if (this._hadData) {
      const maxEdge = this.baseIndex + w - 5; // keep ~5 bars of data visible
      if (this.rightEdge > maxEdge) this.rightEdge = Math.max(this._defaultRightOffset + this.baseIndex, maxEdge);
    }
  }

  zoomAt(x, factor) {
    const logicalAtX = this.coordinateToLogical(x);
    const prev = this.barSpacing;
    this.barSpacing = prev * factor;
    this.clampBarSpacing();
    // keep the bar under the cursor fixed
    const w = this.plotWidth();
    this.rightEdge = logicalAtX + (w - x) / this.barSpacing;
    this._applyEdgeLimits();
    this._chart.invalidate();
    this.notifyRangeChange();
  }

  fitContent() {
    const n = this.times.length;
    if (!n) return;
    const w = this.plotWidth();
    this.barSpacing = Math.max(this.options.minBarSpacing || 0.5, w / (n + 2));
    this.clampBarSpacing();
    this.rightEdge = this.baseIndex + 1;
    this._chart.invalidate();
    this.notifyRangeChange();
  }

  reset() {
    this.rightEdge = this.baseIndex + this._defaultRightOffset;
    this.barSpacing = this._defaultBarSpacing;
    this.clampBarSpacing();
    this._chart.invalidate();
    this.notifyRangeChange();
  }

  notifyRangeChange() {
    const r = this.visibleLogicalRange();
    for (const fn of this._rangeSubs) {
      try { fn(r); } catch (e) { console.error(e); }
    }
    if (this._timeRangeSubs.size) {
      const tr = this.visibleTimeRange();
      for (const fn of this._timeRangeSubs) {
        try { fn(tr); } catch (e) { console.error(e); }
      }
    }
  }

  visibleTimeRange() {
    const n = this.times.length;
    if (!n) return null;
    const r = this.visibleLogicalRange();
    // extrapolated into whitespace so capture→restore round-trips keep the future offset
    return { from: this.fractionalIndexToTime(r.from), to: this.fractionalIndexToTime(r.to) };
  }

  /** continuous (interpolated/extrapolated) index → time, inverse of timeToIndex */
  fractionalIndexToTime(i) {
    const n = this.times.length;
    if (!n) return null;
    if (i <= 0) return this.times[0] + i * this._avgStep;
    if (i >= n - 1) return this.times[n - 1] + (i - (n - 1)) * this._avgStep;
    const lo = Math.floor(i);
    const frac = i - lo;
    return this.times[lo] + frac * (this.times[lo + 1] - this.times[lo]);
  }
}
