import { deepMerge, toSec, lowerBound } from "../core/utils.mjs";
import { MismatchDirection } from "../core/enums.mjs";
import { defaultSeriesOptions } from "../core/defaults.mjs";
import { makePriceFormatter } from "../core/format.mjs";
import { normalizeSeriesOptions } from "./seriesOptions.mjs";

let nextSeriesId = 1;

export class SeriesModel {
  constructor(chart, type, options, paneIndex) {
    this._chart = chart;
    this.id = `series-${nextSeriesId++}`;
    this.type = type;
    this.options = deepMerge(defaultSeriesOptions(type), normalizeSeriesOptions(options));
    this.paneIndex = paneIndex;
    this.data = [];       // original items (sorted by time)
    this.times = [];      // numeric times
    this.indices = null;  // Int32Array: position in the merged time index
    this.packed = null;   // Float64Array [o,h,l,c] * n or [v] * n
    this.colors = null;   // per-point color overrides (histogram / line points)
    this.whitespace = null; // Uint8Array 1 = whitespace point
    this.markers = [];
    this.priceLines = new Set();
    this.overlays = new Set(); // attached primitives
    this._dataSubs = new Set();
    this._fmt = null;
  }

  get valueCount() {
    return this.type === "Candlestick" || this.type === "Bar" ? 4 : 1;
  }

  priceFormatter() {
    if (!this._fmt) this._fmt = makePriceFormatter(this.options.priceFormat, this._chart.options.localization.priceFormatter);
    return this._fmt;
  }

  applyOptions(o) {
    const n = normalizeSeriesOptions(o);
    deepMerge(this.options, n);
    if (n && n.priceFormat) this._fmt = null;
    this._chart.invalidate();
  }

  attachPrimitive(primitive, seriesApi) {
    this.overlays.add(primitive);
    if (typeof primitive.attached === "function") {
      primitive.attached({
        chart: this._chart.api,
        series: seriesApi,
        requestUpdate: () => this._chart.invalidate(),
        requestTopLayerUpdate: () => this._chart.invalidateCrosshairOnly(),
      });
    }
    if (primitive?.useTopCanvas === true) {
      this._chart.invalidateCrosshairOnly();
    } else {
      this._chart.invalidate();
    }
  }

  detachPrimitive(primitive) {
    if (!this.overlays.delete(primitive)) return;
    if (typeof primitive.detached === "function") {
      try {
        primitive.detached();
      } catch {
        // Primitive cleanup must not prevent chart invalidation.
      }
    }
    if (primitive?.useTopCanvas === true) {
      this._chart.invalidateCrosshairOnly();
    } else {
      this._chart.invalidate();
    }
  }

  setData(items) {
    const arr = Array.isArray(items) ? items : [];
    this.data = arr;
    const n = arr.length;
    this.times = new Array(n);
    const vc = this.valueCount;
    this.packed = new Float64Array(n * vc);
    this.whitespace = new Uint8Array(n);
    this.colors = null;
    for (let i = 0; i < n; i++) {
      const it = arr[i];
      this.times[i] = toSec(it.time);
      this._packItem(i, it);
    }
    this._chart.onSeriesDataChanged(this);
    this._notifyDataChanged("full");
  }

  _packItem(i, it) {
    const vc = this.valueCount;
    const o = i * vc;
    if (vc === 4) {
      if (it.open == null) { this.whitespace[i] = 1; return; }
      this.packed[o] = it.open;
      this.packed[o + 1] = it.high;
      this.packed[o + 2] = it.low;
      this.packed[o + 3] = it.close;
    } else {
      if (it.value == null) { this.whitespace[i] = 1; return; }
      this.packed[o] = it.value;
      if (it.color) {
        if (!this.colors) this.colors = new Array(this.times.length);
        this.colors[i] = it.color;
      }
    }
    this.whitespace[i] = 0;
  }

  update(item, historicalUpdate = false) {
    const t = toSec(item.time);
    const n = this.times.length;
    if (!n || t > this.times[n - 1]) {
      // append
      this.data.push(item);
      this.times.push(t);
      const vc = this.valueCount;
      const packed = new Float64Array((n + 1) * vc);
      packed.set(this.packed || []);
      this.packed = packed;
      const ws = new Uint8Array(n + 1);
      if (this.whitespace) ws.set(this.whitespace);
      this.whitespace = ws;
      if (this.colors) this.colors.push(undefined);
      this._packItem(n, item);
      this._chart.onSeriesBarAppended(this, t);
      this._notifyDataChanged("update");
      return;
    }
    let i = n - 1;
    if (this.times[i] !== t) {
      if (!historicalUpdate && t < this.times[i]) {
        i = lowerBound(this.times, n, t);
        if (this.times[i] !== t) { this.setDataMergedPoint(item, t, i); return; }
      }
    }
    this.data[i] = item;
    if (this.colors) this.colors[i] = item.color;
    else if (item.color) { this.colors = new Array(n); this.colors[i] = item.color; }
    this._packItem(i, item);
    this._chart.invalidate();
    this._notifyDataChanged("update");
  }

  setDataMergedPoint(item, t, insertAt) {
    // rare path: insert a new point mid-history
    this.data.splice(insertAt, 0, item);
    this.setData(this.data);
  }

  remapIndices(timeToIndexMap) {
    const n = this.times.length;
    this.indices = new Int32Array(n);
    for (let i = 0; i < n; i++) this.indices[i] = timeToIndexMap.get(this.times[i]) ?? -1;
  }

  /** map merged-logical index -> local position (exact), or -1 */
  localByLogical(logical) {
    const n = this.times.length;
    if (!n || !this.indices) return -1;
    let lo = 0, hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = this.indices[mid];
      if (v === logical) return mid;
      if (v < logical) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  localNearestLeft(logical) {
    const n = this.times.length;
    if (!n || !this.indices) return -1;
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.indices[mid] <= logical) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }

  visibleLocalRange() {
    const r = this._chart.timeScale.visibleLogicalRange();
    const from = Math.floor(r.from) - 1;
    const to = Math.ceil(r.to) + 1;
    const n = this.times.length;
    if (!n || !this.indices) return null;
    let a = this.localNearestLeft(from);
    if (a < 0) a = 0;
    let b = this.localNearestLeft(to);
    if (b < 0) return null;
    if (b < a) return null;
    return { a, b };
  }

  barsInLogicalRange(range) {
    if (!range || !this.times.length) return null;

    const fromIndex = Math.max(0, this.localNearestLeft(Math.floor(range.from)));
    let toIndex = this.localNearestLeft(Math.ceil(range.to));
    if (toIndex < 0) toIndex = 0;
    const firstLogical = this.indices ? this.indices[0] : 0;
    const lastLogical = this.indices ? this.indices[this.times.length - 1] : 0;

    return {
      from: this.times[fromIndex],
      to: this.times[toIndex],
      barsBefore: range.from - firstLogical,
      barsAfter: lastLogical - range.to,
    };
  }

  autoscaleRange() {
    if (!this.options.visible) return null;
    const compute = () => {
      const r = this.visibleLocalRange();
      if (!r) return null;
      const vc = this.valueCount;
      let min = Infinity, max = -Infinity;
      if (vc === 4) {
        for (let i = r.a; i <= r.b; i++) {
          if (this.whitespace[i]) continue;
          const lo = this.packed[i * 4 + 2], hi = this.packed[i * 4 + 1];
          if (lo < min) min = lo;
          if (hi > max) max = hi;
        }
      } else {
        const base = this.type === "Histogram" ? (this.options.base ?? 0) : null;
        for (let i = r.a; i <= r.b; i++) {
          if (this.whitespace[i]) continue;
          const v = this.packed[i];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        if (base != null && Number.isFinite(min)) {
          if (base < min) min = base;
          if (base > max) max = base;
        }
      }
      if (!Number.isFinite(min)) return null;
      return { priceRange: { minValue: min, maxValue: max } };
    };
    let info = null;
    const provider = this.options.autoscaleInfoProvider;
    if (typeof provider === "function") {
      try { info = provider(() => compute()); } catch { info = null; }
    }
    if (!info) info = compute();
    if (!info || !info.priceRange) return null;
    return { minValue: info.priceRange.minValue, maxValue: info.priceRange.maxValue };
  }

  firstVisibleValue() {
    const r = this.visibleLocalRange();
    if (!r) return null;
    for (let i = r.a; i <= r.b; i++) {
      if (this.whitespace[i]) continue;
      return this.valueCount === 4 ? this.packed[i * 4 + 3] : this.packed[i];
    }
    return null;
  }

  lastValue() {
    for (let i = this.times.length - 1; i >= 0; i--) {
      if (this.whitespace[i]) continue;
      return this.valueCount === 4 ? this.packed[i * 4 + 3] : this.packed[i];
    }
    return null;
  }

  lastBar() {
    for (let i = this.times.length - 1; i >= 0; i--) {
      if (!this.whitespace[i]) return this.data[i];
    }
    return null;
  }

  barColorAt(i) {
    if (this.valueCount === 4) {
      const up = this.packed[i * 4 + 3] >= this.packed[i * 4];
      return up ? this.options.upColor : this.options.downColor;
    }
    if (this.colors && this.colors[i]) return this.colors[i];
    return this.options.color || this.options.lineColor || "#2196f3";
  }

  dataByIndex(logical, mismatch = MismatchDirection.None) {
    let local = this.localByLogical(logical);
    if (local < 0) {
      if (mismatch === MismatchDirection.NearestLeft) local = this.localNearestLeft(logical);
      else if (mismatch === MismatchDirection.NearestRight) {
        const left = this.localNearestLeft(logical);
        local = left + 1 < this.times.length ? left + 1 : -1;
      }
    }
    if (local < 0 || local >= this.data.length) return null;
    return this.data[local];
  }

  _notifyDataChanged(scope) {
    for (const fn of this._dataSubs) {
      try { fn(scope); } catch (e) { console.error(e); }
    }
  }
}
