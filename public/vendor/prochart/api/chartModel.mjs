/** Chart model: state, layout, series management, crosshair, invalidation. */
import { deepMerge } from "../core/utils.mjs";
import { MismatchDirection } from "../core/enums.mjs";
import { defaultChartOptions, normalizeChartOptions, TIME_AXIS_HEIGHT, SEPARATOR_H } from "../core/defaults.mjs";
import { TimeScaleModel, TimeScaleApi } from "../scale/time.mjs";
import { PriceScaleApi } from "../scale/price.mjs";
import { SeriesModel, SeriesApi } from "../data/series.mjs";
import { Pane, PaneApi } from "../layout/pane.mjs";
import { GpuRenderer } from "../render/gpu.mjs";
import { renderChart, renderTop } from "../render/renderer.mjs";
import { bindEvents, startKinetic, stopKinetic } from "../input/interactions.mjs";
import { ChartApi } from "./chartApi.mjs";


export class ChartModel {
  constructor(container, options) {
    this.container = container;
    this.options = deepMerge(defaultChartOptions(), normalizeChartOptions(options));
    this._sizeSubs = new Set();
    this._crosshairSubs = new Set();
    this._clickSubs = new Set();
    this._dblClickSubs = new Set();
    /** @type {Pane[]} */
    this.panes = [];
    /** @type {Map<SeriesModel, SeriesApi>} */
    this.seriesApis = new Map();
    this._paneApis = [];
    this.timeScale = new TimeScaleModel(this);
    this.timeScale.applyOptions(this.options.timeScale);
    this.timeScaleApi = new TimeScaleApi(this.timeScale, this);
    this.crosshair = { visible: false, x: -1, y: -1, logical: null, price: null, paneIndex: 0, external: false };
    this._raf = 0;
    this._rafTop = 0;
    this._destroyed = false;
    this._kinetic = null;

    this._buildDom();
    this._ensurePane(0);
    bindEvents(this);

    this.width = 0;
    this.height = 0;
    const cw = this.options.width || container.clientWidth || 600;
    const ch = this.options.height || container.clientHeight || 400;
    this._applySize(cw, ch);

    if (this.options.autoSize && typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          const r = e.contentRect;
          if (r.width > 0 && r.height > 0) this._applySize(r.width, r.height);
        }
      });
      this._ro.observe(container);
    }
    this.api = new ChartApi(this);
    this.invalidate();
  }

  /* ------------------------------- DOM --------------------------------- */

  _buildDom() {
    const root = document.createElement("div");
    root.style.cssText = "position:relative;overflow:hidden;width:100%;height:100%;user-select:none;-webkit-user-select:none;touch-action:none;";
    root.setAttribute("data-prochart", "1");
    this.root = root;
    this.container.appendChild(root);

    // layer order: base (2D) → gl (WebGL bulk) → main (2D) → top (crosshair)
    this.baseCanvas = this._makeCanvas(1);
    this.glCanvas = this._makeCanvas(2);
    this.mainCanvas = this._makeCanvas(3);
    this.topCanvas = this._makeCanvas(4);
    // NOTE: no `desynchronized` hint — it lets the 2D and WebGL layers present on
    // different vsyncs on Windows, which flickers. rAF already runs at display Hz.
    const ctx2d = {};
    this.baseCtx = this.baseCanvas.getContext("2d", ctx2d);
    this.mainCtx = this.mainCanvas.getContext("2d", ctx2d);
    this.topCtx = this.topCanvas.getContext("2d", ctx2d);
    this.gpu = this.options.renderer === "cpu" ? null : new GpuRenderer(this.glCanvas);
    if (this.gpu && !this.gpu.ok) this.gpu = null;
  }

  _makeCanvas(z) {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;left:0;top:0;z-index:${z};`;
    this.root.appendChild(c);
    return c;
  }

  _applySize(w, h) {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    const dpr = Math.max(1, Math.min(4, globalThis.devicePixelRatio || 1));
    this.dpr = dpr;
    for (const c of [this.baseCanvas, this.mainCanvas, this.topCanvas]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    // gl backing store is resized in beginFrame; keep CSS size in sync here
    this.glCanvas.style.width = `${w}px`;
    this.glCanvas.style.height = `${h}px`;
    for (const fn of this._sizeSubs) { try { fn({ width: w, height: h }); } catch { /* noop */ } }
    this.invalidate();
    this.timeScale.notifyRangeChange();
  }

  /* ------------------------------ layout -------------------------------- */

  timeAxisHeight() {
    return this.options.timeScale.visible ? TIME_AXIS_HEIGHT : 0;
  }

  leftAxisWidth() { return this._leftW || 0; }
  rightAxisWidth() { return this._rightW || 0; }

  paneWidth() {
    return Math.max(1, this.width - (this._leftW || 0) - (this._rightW || 0));
  }

  paneSize(paneIndex = 0) {
    const pane = this.panes[paneIndex];
    return { width: this.paneWidth(), height: pane ? pane.height : 0 };
  }

  _layoutPanes() {
    const totalH = this.height - this.timeAxisHeight();
    const seps = Math.max(0, this.panes.length - 1) * SEPARATOR_H;
    let fixed = 0, flexCount = 0;
    for (const p of this.panes) {
      if (p.requestedHeight > 0 && p.index !== 0) fixed += p.requestedHeight;
      else flexCount += 1;
    }
    let avail = Math.max(0, totalH - seps - fixed);
    if (fixed > 0 && avail < 40 && this.panes.length > 1) {
      const scale = Math.max(0, (totalH - seps - 40)) / fixed;
      for (const p of this.panes) if (p.requestedHeight > 0 && p.index !== 0) p.requestedHeight = Math.floor(p.requestedHeight * scale);
      fixed = 0;
      for (const p of this.panes) if (p.requestedHeight > 0 && p.index !== 0) fixed += p.requestedHeight;
      avail = Math.max(0, totalH - seps - fixed);
    }
    let y = 0;
    for (const p of this.panes) {
      const h = p.requestedHeight > 0 && p.index !== 0 ? p.requestedHeight : Math.floor(avail / Math.max(1, flexCount));
      p.top = y;
      p.height = Math.max(0, h);
      y += p.height + SEPARATOR_H;
    }
    const used = this.panes.reduce((a, p) => a + p.height, 0) + seps;
    if (this.panes.length && used < totalH) {
      const extra = totalH - used;
      this.panes[0].height += extra;
      for (let i = 1; i < this.panes.length; i++) this.panes[i].top += extra;
    }
  }

  _ensurePane(i) {
    while (this.panes.length <= i) {
      const pane = new Pane(this, this.panes.length);
      this.panes.push(pane);
      this._paneApis.push(new PaneApi(this, pane.index));
    }
    return this.panes[i];
  }

  paneApiAt(i) { return this._paneApis[i] ?? null; }

  paneIndexAtY(y) {
    for (const p of this.panes) {
      if (y >= p.top && y < p.top + p.height + SEPARATOR_H) return p.index;
    }
    return Math.max(0, this.panes.length - 1);
  }

  /* ------------------------------ series -------------------------------- */

  allSeries() {
    const out = [];
    for (const p of this.panes) for (const s of p.series) out.push(s);
    return out;
  }

  addSeries(typeToken, options, paneIndex = 0) {
    const type = typeToken && typeToken.type ? typeToken.type : String(typeToken || "Line");
    const pane = this._ensurePane(paneIndex);
    const model = new SeriesModel(this, type, options, paneIndex);
    pane.series.push(model);
    pane.scale(model.options.priceScaleId);
    const api = new SeriesApi(model, this);
    this.seriesApis.set(model, api);
    this.invalidate();
    return api;
  }

  removeSeries(api) {
    const model = api && api._m;
    if (!model) return;
    for (const p of model.overlays) { try { p.detached?.(); } catch { /* noop */ } }
    model.overlays.clear();
    const pane = this.panes[model.paneIndex];
    if (pane) {
      const i = pane.series.indexOf(model);
      if (i >= 0) pane.series.splice(i, 1);
    }
    this.seriesApis.delete(model);
    this.timeScale.rebuildIndex();
    this.invalidate();
  }

  moveSeriesToPane(model, paneIndex) {
    const from = this.panes[model.paneIndex];
    if (from) {
      const i = from.series.indexOf(model);
      if (i >= 0) from.series.splice(i, 1);
    }
    const pane = this._ensurePane(paneIndex);
    model.paneIndex = paneIndex;
    pane.series.push(model);
    pane.scale(model.options.priceScaleId);
    this.invalidate();
  }

  seriesApiOf(model) { return this.seriesApis.get(model); }

  priceScaleModelFor(seriesModel) {
    return this.panes[seriesModel.paneIndex].scale(seriesModel.options.priceScaleId);
  }

  priceScaleApiFor(seriesModel) {
    return new PriceScaleApi(this.priceScaleModelFor(seriesModel));
  }

  onSeriesDataChanged() {
    this.timeScale.rebuildIndex();
    this.invalidate();
  }

  onSeriesBarAppended(series, t) {
    this.timeScale.appendTime(t);
    series.remapIndices(this.timeScale.timeToIndexMap);
    this.invalidate();
  }

  /* ---------------------------- invalidation ---------------------------- */

  invalidate() {
    if (this._destroyed || this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (!this._destroyed) renderChart(this);
    });
  }

  invalidateCrosshairOnly() {
    if (this._destroyed || this._rafTop || this._raf) return;
    this._rafTop = requestAnimationFrame(() => {
      this._rafTop = 0;
      if (!this._destroyed) renderTop(this);
    });
  }

  /* ----------------------------- crosshair ------------------------------ */

  _crosshairParam(sourceEvent) {
    const ch = this.crosshair;
    const ts = this.timeScale;
    const param = {
      point: ch.visible ? { x: ch.x, y: ch.y } : undefined,
      logical: ch.visible && ch.logical != null ? ch.logical : undefined,
      time: undefined,
      paneIndex: ch.paneIndex,
      seriesData: new Map(),
      hoveredSeries: undefined,
      hoveredObjectId: undefined,
      sourceEvent: sourceEvent
        ? { clientX: sourceEvent.clientX, clientY: sourceEvent.clientY, pageX: sourceEvent.pageX, pageY: sourceEvent.pageY, screenX: sourceEvent.screenX, screenY: sourceEvent.screenY, localX: ch.x, localY: ch.y, ctrlKey: sourceEvent.ctrlKey, altKey: sourceEvent.altKey, shiftKey: sourceEvent.shiftKey, metaKey: sourceEvent.metaKey }
        : undefined,
    };
    if (ch.visible && ch.logical != null) {
      const rounded = Math.round(ch.logical);
      if (rounded >= 0 && rounded < ts.times.length) param.time = ts.times[rounded];
      for (const [model, api] of this.seriesApis) {
        const item = model.dataByIndex(rounded, MismatchDirection.None);
        if (item) param.seriesData.set(api, item);
      }
      const pane = this.panes[ch.paneIndex];
      if (pane) {
        outer: for (const s of pane.series) {
          for (const prim of s.overlays) {
            if (typeof prim.hitTest !== "function") continue;
            try {
              const hit = prim.hitTest(ch.x, ch.y - pane.top);
              if (hit) {
                param.hoveredObjectId = hit.externalId ?? hit;
                break outer;
              }
            } catch { /* noop */ }
          }
        }
      }
    }
    return param;
  }

  updateCrosshair(x, y, sourceEvent) {
    const ts = this.timeScale;
    this.crosshair.visible = true;
    this.crosshair.external = false;
    this.crosshair.x = x;
    this.crosshair.y = y;
    this.crosshair.logical = ts.coordinateToLogical(x);
    this.crosshair.paneIndex = this.paneIndexAtY(y);
    this.invalidateCrosshairOnly();
    // Coalesce subscriber notification to one per frame: pointermove can fire at
    // mouse polling rate (500–1000 Hz) and each notification triggers app-side
    // DOM work (legend renders). State above is always current; only the fan-out
    // is deferred.
    this._pendingCrosshairEvent = sourceEvent ?? null;
    if (this._chRaf) return;
    this._chRaf = requestAnimationFrame(() => {
      this._chRaf = 0;
      if (this._destroyed) return;
      const ev = this._pendingCrosshairEvent;
      this._pendingCrosshairEvent = null;
      this._fireCrosshair(ev);
    });
  }

  clearCrosshair(fire = true) {
    if (!this.crosshair.visible) return;
    this.crosshair.visible = false;
    this.crosshair.logical = null;
    this.invalidateCrosshairOnly();
    if (fire) this._fireCrosshair(null);
  }

  setCrosshairPosition(price, time, seriesApi) {
    const ts = this.timeScale;
    const idx = ts.timeToIndex(time, true);
    if (idx == null) return;
    const model = seriesApi && seriesApi._m ? seriesApi._m : null;
    const pane = model ? this.panes[model.paneIndex] : this.panes[0];
    const scale = model ? this.priceScaleModelFor(model) : pane?.priceScales.get("right");
    const yLocal = scale ? scale.priceToCoordinate(price) : 0;
    this.crosshair.visible = true;
    this.crosshair.external = true;
    this.crosshair.logical = idx;
    this.crosshair.x = ts.logicalToCoordinate(idx);
    this.crosshair.y = (pane ? pane.top : 0) + (yLocal ?? 0);
    this.crosshair.paneIndex = pane ? pane.index : 0;
    this.invalidateCrosshairOnly();
    this._fireCrosshair(null);
  }

  _fireCrosshair(sourceEvent) {
    if (!this._crosshairSubs.size) return;
    const param = this._crosshairParam(sourceEvent);
    for (const fn of this._crosshairSubs) {
      try { fn(param); } catch (e) { console.error(e); }
    }
  }

  /* ------------------------------- misc --------------------------------- */

  _startKinetic(vx) { startKinetic(this, vx); }
  _stopKinetic() { stopKinetic(this); }

  applyOptions(opts) {
    const n = normalizeChartOptions(opts);
    deepMerge(this.options, n);
    if (n.timeScale) this.timeScale.applyOptions(n.timeScale);
    if (n.rightPriceScale) for (const p of this.panes) p.priceScales.get("right")?.applyOptions(n.rightPriceScale);
    if (n.leftPriceScale) for (const p of this.panes) p.priceScales.get("left")?.applyOptions(n.leftPriceScale);
    if (!this.options.autoSize && (n.width || n.height)) {
      this._applySize(n.width || this.width, n.height || this.height);
    }
    this.invalidate();
  }

  takeScreenshot() {
    const out = document.createElement("canvas");
    out.width = this.baseCanvas.width;
    out.height = this.baseCanvas.height;
    const ctx = out.getContext("2d");
    ctx.drawImage(this.baseCanvas, 0, 0);
    if (this.gpu && this.gpu.ok && this.glCanvas.width > 1) {
      ctx.drawImage(this.glCanvas, 0, 0, out.width, out.height);
    }
    ctx.drawImage(this.mainCanvas, 0, 0);
    ctx.drawImage(this.topCanvas, 0, 0);
    return out;
  }

  destroy() {
    this._destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._rafTop) cancelAnimationFrame(this._rafTop);
    if (this._chRaf) cancelAnimationFrame(this._chRaf);
    this._stopKinetic();
    this._ro?.disconnect();
    this.root.remove();
    this.panes.length = 0;
    this.seriesApis.clear();
  }
}
