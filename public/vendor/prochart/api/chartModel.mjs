/** Chart model: chart orchestration, layout, series management, and invalidation. */
import { deepMerge } from "../core/utils.mjs";
import { defaultChartOptions, normalizeChartOptions, TIME_AXIS_HEIGHT, SEPARATOR_H } from "../core/defaults.mjs";
import { pointInRightPriceAxis } from "../utils/hitTest.mjs";

import { TimeScaleModel, TimeScaleApi } from "../scale/time.mjs";
import { PriceScaleApi } from "../scale/price.mjs";
import { SeriesModel, SeriesApi } from "../data/series.mjs";
import { Pane, PaneApi } from "../layout/pane.mjs";
import { CrosshairManager } from "../crosshair/crosshairManager.mjs";

import { GpuRenderer } from "../render/gpu.mjs";
import { renderChart, renderTop } from "../render/renderer.mjs";
import { bindEvents, startKinetic, stopKinetic } from "../input/interactions.mjs";
import { ChartApi } from "./chartApi.mjs";

export { pointInRightPriceAxis } from "../utils/hitTest.mjs";

export class ChartModel {
  constructor(container, options) {
    this.container = container;
    this.options = deepMerge(defaultChartOptions(), normalizeChartOptions(options));
    this._sizeSubs = new Set();
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
    this._crosshairManager = new CrosshairManager(this);
    // Compatibility aliases for renderer, input, and ChartApi consumers.
    this.crosshair = this._crosshairManager.state;
    this._crosshairSubs = this._crosshairManager.subscribers;
    this._raf = 0;
    this._rafTop = 0;
    this._priceAxisHoverFrame = 0;
    this._pendingPriceAxisHover = null;
    this._inputRootRect = null;
    this._inputRootRectFrame = 0;
    this._inputPointCache = new WeakMap();
    this._onRootGeometryChange = () => {
      this.invalidateInputRootRect();
    };
    this._destroyed = false;
    this._kinetic = null;

    this._buildDom();
    globalThis.window?.addEventListener?.("resize", this._onRootGeometryChange, { passive: true });
    globalThis.window?.addEventListener?.("scroll", this._onRootGeometryChange, {
      capture: true,
      passive: true,
    });
    this._ensurePane(0);
    this._disposeInputEvents = bindEvents(this);

    this.width = 0;
    this.height = 0;
    const cw = this.options.width || container.clientWidth || 600;
    const ch = this.options.height || container.clientHeight || 400;
    this._applySize(cw, ch);

    if (this.options.autoSize && typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          this.invalidateInputRootRect();
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
    this._buildLineEndPulse();
    this._buildAxisCorner();
    this._buildPriceAxisModeControls();
    // NOTE: no `desynchronized` hint — it lets the 2D and WebGL layers present on
    // different vsyncs on Windows, which flickers. rAF already runs at display Hz.
    const ctx2d = {};
    this.baseCtx = this.baseCanvas.getContext("2d", ctx2d);
    this.mainCtx = this.mainCanvas.getContext("2d", ctx2d);
    this.topCtx = this.topCanvas.getContext("2d", ctx2d);
    this.gpu = this.options.renderer === "cpu" ? null : new GpuRenderer(this.glCanvas);
    if (this.gpu && !this.gpu.ok) this.gpu = null;
  }

  _buildLineEndPulse() {
    const host = document.createElement("span");
    host.setAttribute("data-prochart-line-end-pulse", "1");
    host.setAttribute("aria-hidden", "true");
    host.hidden = true;
    host.innerHTML = '<span data-prochart-line-end-ring></span><span data-prochart-line-end-dot></span>';
    this.root.appendChild(host);
    this.lineEndPulseHost = host;
  }

  _buildAxisCorner() {
    const host = document.createElement("div");
    host.setAttribute("data-prochart-axis-corner", "1");
    host.setAttribute("role", "button");
    host.setAttribute("aria-label", "Chart settings");
    host.title = "Chart settings";
    host.tabIndex = 0;
    host.style.cssText = "position:absolute;right:0;bottom:0;z-index:5;overflow:hidden;cursor:pointer;outline:none;";

    const canvas = document.createElement("canvas");
    canvas.style.cssText = "user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;position:absolute;left:0;top:0;";
    host.appendChild(canvas);
    this.root.appendChild(host);

    const activate = () => {
      host.dispatchEvent(new CustomEvent("prochart-axis-corner-click", { bubbles: true }));
    };
    host.addEventListener("pointerdown", (event) => event.stopPropagation());
    host.addEventListener("dblclick", (event) => event.stopPropagation());
    host.addEventListener("click", activate);
    host.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate();
    });

    this.axisCornerHost = host;
    this.axisCornerCanvas = canvas;
    this.axisCornerCtx = canvas.getContext("2d");
  }

  _buildPriceAxisModeControls() {
    const host = document.createElement("div");
    host.setAttribute("data-prochart-price-axis-modes", "1");
    host.hidden = true;
    host.style.cssText = "position:absolute;right:1px;z-index:6;width:70px;height:29.6px;align-items:center;justify-content:center;gap:4px;";

    const makeButton = (label, ariaLabel, eventName) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-label", ariaLabel);
      button.setAttribute("aria-pressed", "false");
      button.style.cssText = `width:20px;height:21.6px;border:0;padding:0;margin:0;border-radius:4px;background:transparent;color:inherit;font:400 14px/18px ${this.options.layout.fontFamily};cursor:pointer;`;
      const paint = (hovered = false) => {
        const active = button.getAttribute("aria-pressed") === "true";
        button.style.backgroundColor = active ? "#3B82F6" : hovered ? "rgba(161,161,170,0.18)" : "transparent";
        button.style.color = active ? "#ffffff" : "inherit";
      };
      button.addEventListener("pointerenter", () => paint(true));
      button.addEventListener("pointerleave", () => paint(false));
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        button.dispatchEvent(new CustomEvent(eventName, { bubbles: true }));
      });
      button._paintModeState = paint;
      host.appendChild(button);
      return button;
    };

    this.priceAxisAutoButton = makeButton("A", "Toggle auto scale", "prochart-price-axis-auto-toggle");
    this.priceAxisLogButton = makeButton("L", "Toggle log scale", "prochart-price-axis-log-toggle");
    host.addEventListener("pointerenter", () => {
      host.dispatchEvent(new CustomEvent("prochart-price-axis-modes-show", { bubbles: true }));
    });
    this.root.appendChild(host);
    this.priceAxisModeHost = host;

    const setModesVisible = (visible) => {
      host.hidden = !visible;
      host.style.display = visible ? "flex" : "none";
      if (visible) {
        host.dispatchEvent(new CustomEvent("prochart-price-axis-modes-show", { bubbles: true }));
      }
    };

    const cancelPriceAxisHover = () => {
      this._pendingPriceAxisHover = null;
      if (!this._priceAxisHoverFrame) return;
      cancelAnimationFrame(this._priceAxisHoverFrame);
      this._priceAxisHoverFrame = 0;
    };

    const flushPriceAxisHover = () => {
      this._priceAxisHoverFrame = 0;
      const point = this._pendingPriceAxisHover;
      this._pendingPriceAxisHover = null;
      if (!point || this._destroyed) return;

      const onRightPriceAxis = pointInRightPriceAxis(
        this.width,
        this.height,
        this._rightW || 0,
        this.timeAxisHeight(),
        point.x,
        point.y,
      );
      if (onRightPriceAxis && host.hidden) {
        setModesVisible(true);
      } else if (!onRightPriceAxis && !host.hidden) {
        setModesVisible(false);
      }
    };

    this.root.addEventListener("pointermove", (event) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      // Price-axis mode buttons cannot be hovered while the pointer is held
      // down. Avoid a forced layout read on every high-frequency pan event.
      if (event.buttons) {
        cancelPriceAxisHover();
        if (!host.hidden) setModesVisible(false);
        return;
      }
      this._pendingPriceAxisHover = this.inputPoint(event);
      if (!this._priceAxisHoverFrame) {
        this._priceAxisHoverFrame = requestAnimationFrame(flushPriceAxisHover);
      }
    });
    this.root.addEventListener("pointerup", (event) => {
      if (event.pointerType === "mouse") return;
      if (event.target instanceof Element && event.target.closest("[data-prochart-price-axis-modes] button")) return;
      const point = this.inputPoint(event);
      const onRightPriceAxis = pointInRightPriceAxis(
        this.width,
        this.height,
        this._rightW || 0,
        this.timeAxisHeight(),
        point.x,
        point.y,
      );
      if (onRightPriceAxis) setModesVisible(host.hidden);
    });
    this.root.addEventListener("pointerleave", (event) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      this.invalidateInputRootRect();
      cancelPriceAxisHover();
      setModesVisible(false);
    });
  }

  _makeCanvas(z) {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;left:0;top:0;z-index:${z};`;
    this.root.appendChild(c);
    return c;
  }

  inputRootRect() {
    if (!this._inputRootRect) {
      this._inputRootRect = this.root.getBoundingClientRect();
    }
    if (!this._inputRootRectFrame) {
      this._inputRootRectFrame = requestAnimationFrame(() => {
        this._inputRootRectFrame = 0;
        this._inputRootRect = null;
      });
    }
    return this._inputRootRect;
  }

  inputPoint(event) {
    const cached = this._inputPointCache?.get(event);
    if (cached) return cached;

    const target = event.target;
    const directSurface =
      target === this.root
      || target === this.baseCanvas
      || target === this.glCanvas
      || target === this.mainCanvas
      || target === this.topCanvas;
    let point;
    if (
      directSurface
      && Number.isFinite(event.offsetX)
      && Number.isFinite(event.offsetY)
    ) {
      point = { x: event.offsetX, y: event.offsetY };
    } else {
      const rect = this.inputRootRect();
      point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    }

    this._inputPointCache ??= new WeakMap();
    this._inputPointCache.set(event, point);
    return point;
  }

  invalidateInputRootRect() {
    this._inputRootRect = null;
  }

  _applySize(w, h) {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    this.invalidateInputRootRect();
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
    // Resizing a canvas clears its backing store immediately. Paint the chart
    // background now, then synchronously render the complete frame below so
    // price axes and WebGL series never disappear for a compositor frame.
    const background = this.options.layout?.background || {};
    const resizeFill = background.color || background.bottomColor || background.topColor || "#09090B";
    this.root.style.backgroundColor = resizeFill;
    this.baseCtx.save();
    this.baseCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.baseCtx.fillStyle = resizeFill;
    this.baseCtx.fillRect(0, 0, this.baseCanvas.width, this.baseCanvas.height);
    this.baseCtx.restore();
    // gl backing store is resized in beginFrame; keep CSS size in sync here
    this.glCanvas.style.width = `${w}px`;
    this.glCanvas.style.height = `${h}px`;
    for (const fn of this._sizeSubs) { try { fn({ width: w, height: h }); } catch { /* noop */ } }
    renderChart(this);
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

  isPointInPlot(x, y) {
    return x >= (this._leftW || 0)
      && x < this.width - (this._rightW || 0)
      && y >= 0
      && y < this.height - this.timeAxisHeight();
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

  addPane() {
    const paneIndex = this.panes.length;
    this._ensurePane(paneIndex);
    this.invalidate();
    return this.paneApiAt(paneIndex);
  }

  removePane(paneIndex) {
    const pane = this.panes[paneIndex];
    if (!pane || paneIndex === 0) return;

    for (const series of [...pane.series]) {
      this.removeSeries(this.seriesApiOf(series));
    }
    this.panes.splice(paneIndex, 1);
    this._paneApis.splice(paneIndex, 1);
    this.panes.forEach((remainingPane, index) => {
      remainingPane.index = index;
      for (const series of remainingPane.series) {
        series.paneIndex = index;
      }
    });
    this._paneApis.forEach((paneApi, index) => {
      paneApi._index = index;
    });
    this.invalidate();
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
    return this._crosshairManager.createParam(sourceEvent);
  }

  updateCrosshair(x, y, sourceEvent) {
    this._crosshairManager.update(x, y, sourceEvent);
  }

  clearCrosshair(fire = true) {
    this._crosshairManager.clear(fire);
  }

  setCrosshairPosition(price, time, seriesApi) {
    this._crosshairManager.setPosition(price, time, seriesApi);
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
    if (this._priceAxisHoverFrame) {
      cancelAnimationFrame(this._priceAxisHoverFrame);
      this._priceAxisHoverFrame = 0;
    }
    if (this._inputRootRectFrame) {
      cancelAnimationFrame(this._inputRootRectFrame);
      this._inputRootRectFrame = 0;
    }
    this._inputRootRect = null;
    this._pendingPriceAxisHover = null;
    this._disposeInputEvents?.();
    this._disposeInputEvents = null;
    this._crosshairManager.destroy();
    this._stopKinetic();
    this._ro?.disconnect();
    globalThis.window?.removeEventListener?.("resize", this._onRootGeometryChange);
    globalThis.window?.removeEventListener?.("scroll", this._onRootGeometryChange, true);
    this.root.remove();
    this.panes.length = 0;
    this.seriesApis.clear();
  }
}
