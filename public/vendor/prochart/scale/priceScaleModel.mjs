import { clone, deepMerge } from "../core/utils.mjs";
import { PriceScaleMode } from "../core/enums.mjs";
import { defaultPriceScaleOptions } from "../core/defaults.mjs";
import { makePriceFormatter } from "../core/format.mjs";


export class PriceScaleModel {
  constructor(chart, pane, id, options) {
    this._chart = chart;
    this.pane = pane;
    this.id = id;
    this.options = deepMerge(clone(defaultPriceScaleOptions(id === "right")), options || {});
    if (id !== "right" && id !== "left") this.options.visible = false;
    this.priceRange = null; // {min,max} in *internal* space (log space when log mode)
    this._manual = false;
    this._width = 0;
  }

  isOverlay() {
    return this.id !== "right" && this.id !== "left";
  }

  applyOptions(o) {
    if (!o) return;
    const hadAuto = this.options.autoScale;
    const modeChanged = o.mode !== undefined && o.mode !== this.options.mode;
    const visiblePriceRange = modeChanged && this.priceRange
      ? {
          min: this.fromScale(this.priceRange.min),
          max: this.fromScale(this.priceRange.max),
        }
      : null;
    deepMerge(this.options, o);
    if (visiblePriceRange) {
      const min = this.toScale(visiblePriceRange.min);
      const max = this.toScale(visiblePriceRange.max);
      if (Number.isFinite(min) && Number.isFinite(max) && min !== max) {
        this.priceRange = {
          min: Math.min(min, max),
          max: Math.max(min, max),
        };
      } else {
        // Let the next render fit the data if a mode cannot represent the
        // previous range (for example, a non-positive logarithmic range).
        this.priceRange = null;
        this._manual = false;
      }
    }
    if (this.isOverlay()) this.options.visible = false;
    if (o.autoScale === true) this._manual = false;
    if (o.autoScale === false && hadAuto) this._manual = this.priceRange != null;
    this._chart.invalidate();
  }

  /* internal transform: price -> scale space */
  toScale(p) {
    const m = this.options.mode;
    if (m === PriceScaleMode.Logarithmic) return Math.sign(p) * Math.log10(Math.abs(p) + 1e-10);
    if (m === PriceScaleMode.Percentage || m === PriceScaleMode.IndexedTo100) {
      const base = this._baseValue();
      if (!base) return p;
      return m === PriceScaleMode.Percentage ? ((p - base) / Math.abs(base)) * 100 : (p / base) * 100;
    }
    return p;
  }

  fromScale(v) {
    const m = this.options.mode;
    if (m === PriceScaleMode.Logarithmic) return Math.sign(v) * (Math.pow(10, Math.abs(v)) - 1e-10);
    if (m === PriceScaleMode.Percentage || m === PriceScaleMode.IndexedTo100) {
      const base = this._baseValue();
      if (!base) return v;
      return m === PriceScaleMode.Percentage ? base + (v / 100) * Math.abs(base) : (v / 100) * base;
    }
    return v;
  }

  _baseValue() {
    for (const s of this.pane.seriesFor(this)) {
      const v = s.firstVisibleValue();
      if (v != null) return v;
    }
    return null;
  }

  updateAutoScale() {
    if (!this.options.autoScale && (this._manual || this.priceRange)) return;
    let min = Infinity, max = -Infinity;
    for (const s of this.pane.seriesFor(this)) {
      const r = s.autoscaleRange();
      if (!r) continue;
      if (r.minValue < min) min = r.minValue;
      if (r.maxValue > max) max = r.maxValue;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    if (min === max) { min -= 0.5; max += 0.5; }
    this.priceRange = { min: this.toScale(min), max: this.toScale(max) };
  }

  paneHeight() {
    return Math.max(1, this.pane.height);
  }

  _innerMetrics() {
    const h = this.paneHeight();
    const m = this.options.scaleMargins || { top: 0.2, bottom: 0.1 };
    const topPx = h * (m.top ?? 0.2);
    const bottomPx = h * (m.bottom ?? 0.1);
    return { h, topPx, bottomPx, innerH: Math.max(1, h - topPx - bottomPx) };
  }

  priceToCoordinate(price) {
    if (!this.priceRange) return null;
    const { topPx, innerH, h } = this._innerMetrics();
    const { min, max } = this.priceRange;
    const span = max - min || 1;
    const v = this.toScale(price);
    let y = topPx + ((max - v) / span) * innerH;
    if (this.options.invertScale) y = h - y;
    return y;
  }

  coordinateToPrice(y) {
    if (!this.priceRange) return null;
    const { topPx, innerH, h } = this._innerMetrics();
    let yy = this.options.invertScale ? h - y : y;
    const { min, max } = this.priceRange;
    const span = max - min || 1;
    const v = max - ((yy - topPx) / innerH) * span;
    return this.fromScale(v);
  }

  /** vertical pan by pixels (manual range) */
  panByPixels(dy) {
    if (!this.priceRange) return;
    const { innerH } = this._innerMetrics();
    const span = this.priceRange.max - this.priceRange.min || 1;
    const delta = (dy / innerH) * span;
    this.priceRange = { min: this.priceRange.min - delta, max: this.priceRange.max - delta };
    this._manual = true;
    this.options.autoScale = false;
    this._chart.invalidate();
  }

  /** scale around center by factor (axis drag / wheel) */
  scaleAroundCenter(factor) {
    if (!this.priceRange) return;
    const { min, max } = this.priceRange;
    const mid = (min + max) / 2;
    const half = ((max - min) / 2) * factor;
    if (half <= 0 || !Number.isFinite(half)) return;
    this.priceRange = { min: mid - half, max: mid + half };
    this._manual = true;
    this.options.autoScale = false;
    this._chart.invalidate();
  }

  resetScale() {
    this._manual = false;
    this.priceRange = null;
    this.options.autoScale = true;
    this._chart.invalidate();
  }

  formatterForAxis() {
    const series = this.pane.seriesFor(this);
    const s = series.length ? series[0] : null;
    const locFmt = this._chart.options.localization.priceFormatter;
    if (this.options.mode === PriceScaleMode.Percentage) return (p) => `${p.toFixed(2)}%`;
    return s ? s.priceFormatter() : makePriceFormatter({ type: "price", precision: 2, minMove: 0.01 }, locFmt);
  }

  /** tick positions in scale space -> [{y, price}] */
  ticks() {
    if (!this.priceRange) return [];
    const { topPx, innerH, h, bottomPx } = this._innerMetrics();
    const { min, max } = this.priceRange;
    const span = max - min || 1;
    // TradingView keeps price marks relatively dense (about 30px before the
    // nice-number rounding pass). A 42px target skipped useful half-steps on
    // futures charts, producing 100-point gaps where TradingView shows 50.
    const target = Math.max(1, Math.floor(innerH / 30) + 1);
    const rawStep = span / target;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    let step = mag;
    for (const mult of [1, 2, 2.5, 5, 10]) {
      if (mag * mult >= rawStep) { step = mag * mult; break; }
    }
    const out = [];
    const start = Math.ceil((min - (topPx / innerH) * span) / step) * step;
    const end = max + (bottomPx / innerH) * span;
    for (let v = start; v <= end + step * 0.001; v += step) {
      const price = this.fromScale(v);
      let y = topPx + ((max - v) / span) * innerH;
      if (this.options.invertScale) y = h - y;
      if (y < 4 || y > h - 4) continue;
      const majorStep = step * 5;
      const majorMultiple = v / majorStep;
      const major = Math.abs(majorMultiple - Math.round(majorMultiple)) < 1e-7;
      out.push({ y, price, major });
    }
    return out;
  }

  width() {
    if (!this.options.visible || this.isOverlay()) return 0;
    return this._width;
  }

  measureWidth(ctx, tickSnapshot) {
    if (!this.options.visible || this.isOverlay()) { this._width = 0; return 0; }
    const fmt = this.formatterForAxis();
    const layout = this._chart.options.layout;
    ctx.font = `${layout.fontSize}px ${layout.fontFamily}`;
    let maxW = 0;
    if (this.priceRange) {
      const ticks = tickSnapshot ?? this.ticks();
      for (const t of ticks) {
        ctx.font = `${t.major ? "600 " : ""}${layout.fontSize}px ${layout.fontFamily}`;
        const w = ctx.measureText(String(fmt(t.price))).width;
        if (w > maxW) maxW = w;
      }
      ctx.font = `${layout.fontSize}px ${layout.fontFamily}`;
      for (const s of this.pane.seriesFor(this)) {
        if (!s.options.lastValueVisible) continue;
        const last = s.lastValue();
        if (last != null) {
          const w = ctx.measureText(String(s.priceFormatter()(last))).width;
          if (w > maxW) maxW = w;
        }
      }
    }
    const w = Math.max(this.options.minimumWidth || 0, Math.ceil(maxW) + 14);
    // hysteresis: grow immediately, shrink only when clearly smaller
    if (w > this._width || w < this._width - 12) this._width = w;
    return this._width;
  }
}
