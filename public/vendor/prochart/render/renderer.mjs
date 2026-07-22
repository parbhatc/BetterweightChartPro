/**
 * Frame rendering for ProChart (hybrid CPU + GPU).
 *
 * Canvas stack per chart (bottom → top):
 *   base  (2D) — background, grid, zOrder:"bottom" overlays, pane separators
 *   gl    (WebGL) — bulk rects: candle bodies/wicks, bar ticks, histogram columns
 *   main  (2D) — line/area series (and all series when GL unavailable), price
 *                lines, markers, zOrder:"normal"/"top" overlays, axes + labels
 *   top   (2D) — crosshair lines + crosshair axis labels only
 *
 * Pointer moves invalidate only `top`, so crosshair tracking never re-renders
 * series, indicators or the GPU batch.
 */

import { ColorType, LineStyle, LineType, TickMarkType } from "../core/enums.mjs";
import { setCtxLineStyle, roundRectPath } from "../core/utils.mjs";
import { TIME_AXIS_HEIGHT, SEPARATOR_H } from "../core/defaults.mjs";
import { RenderTarget } from "./target.mjs";
import { queueSeriesGpu } from "./gpu.mjs";

export function usesCustomOhlcRenderer(series) {
  return series?.type === "Candlestick" && (series.options?.chartStyle ?? "candles") !== "candles";
}

export function seriesLastValueColor(series) {
  const options = series?.options ?? {};
  const style = options.chartStyle ?? "candles";
  if (series?.type === "Candlestick" && (style === "line" || style === "area")) {
    return options.chartLineColor || options.upColor || "#089981";
  }
  if (series?.type === "Candlestick" && style === "baseline") {
    return options.upColor || options.chartLineColor || "#089981";
  }
  if (series?.valueCount === 4) {
    return series.barColorAt?.(series.times.length - 1)
      || (series.packed?.[series.packed.length - 1] >= series.packed?.[series.packed.length - 4]
        ? options.upColor
        : options.downColor);
  }
  return options.color || options.lineColor || "#2196f3";
}

/* ------------------------------ full frame ------------------------------ */

export function renderChart(m) {
  m._frameId = (m._frameId || 0) + 1;
  const dpr = m.dpr || 1;
  const baseCtx = m.baseCtx;
  const mainCtx = m.mainCtx;
  if (m.lineEndPulseHost) m.lineEndPulseHost.hidden = true;

  // 1. layout + autoscale + axis width measurement
  m._layoutPanes();
  for (const pane of m.panes) {
    for (const scale of pane.priceScales.values()) scale.updateAutoScale();
  }
  let leftW = 0, rightW = 0;
  mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const pane of m.panes) {
    const r = pane.priceScales.get("right");
    const l = pane.priceScales.get("left");
    if (r) rightW = Math.max(rightW, r.measureWidth(mainCtx));
    if (l) leftW = Math.max(leftW, l.measureWidth(mainCtx));
  }
  m._rightW = rightW;
  m._leftW = leftW;

  // 2. clear layers
  for (const [c, ctx] of [[m.baseCanvas, baseCtx], [m.mainCanvas, mainCtx]]) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // background on base
  const bg = m.options.layout.background || {};
  if (bg.type === ColorType.VerticalGradient && bg.topColor) {
    const g = baseCtx.createLinearGradient(0, 0, 0, m.height);
    g.addColorStop(0, bg.topColor);
    g.addColorStop(1, bg.bottomColor || bg.topColor);
    baseCtx.fillStyle = g;
  } else {
    baseCtx.fillStyle = bg.color || "#09090B";
  }
  baseCtx.fillRect(0, 0, m.width, m.height);

  const plotX = leftW;
  const plotW = m.paneWidth();
  const useGpu = m.gpu && m.gpu.ok && m.options.renderer !== "cpu";
  if (useGpu) m.gpu.beginFrame(Math.round(m.width * dpr), Math.round(m.height * dpr));
  else if (m.gpu && m.gpu.ok) m.gpu.beginFrame(1, 1); // keep GL canvas blank in cpu mode

  for (const pane of m.panes) {
    if (pane.height <= 0) continue;
    renderPaneBase(m, baseCtx, pane, plotX, plotW, dpr);
    renderPaneSeries(m, mainCtx, pane, plotX, plotW, dpr, useGpu);
  }

  // pane separators (on base, under everything drawn in plot areas)
  if (m.panes.length > 1) {
    baseCtx.fillStyle = m.options.layout.panes?.separatorColor || "#27272A";
    for (let i = 1; i < m.panes.length; i++) {
      baseCtx.fillRect(0, m.panes[i].top - SEPARATOR_H, m.width, SEPARATOR_H);
    }
  }

  renderPriceAxes(m, mainCtx, plotX, plotW);
  renderTimeAxis(m, mainCtx, plotX, plotW);
  renderAxisCorner(m);
  renderTop(m);
}

function renderAxisCorner(m) {
  const host = m.axisCornerHost;
  const canvas = m.axisCornerCanvas;
  const ctx = m.axisCornerCtx;
  const width = m._rightW || 0;
  const height = m.timeAxisHeight();
  const visible = width > 0 && height > 0;
  if (!host || !canvas || !ctx) return;
  host.hidden = !visible;
  if (m.priceAxisModeHost) {
    m.priceAxisModeHost.style.bottom = `${height}px`;
    m.priceAxisModeHost.style.color = m.options.layout.textColor || "#A1A1AA";
    const background = m.options.layout.background || {};
    m.priceAxisModeHost.style.backgroundColor = background.color || background.bottomColor || background.topColor || "#09090B";
    m.priceAxisAutoButton?._paintModeState?.(false);
    m.priceAxisLogButton?._paintModeState?.(false);
  }
  if (!visible) return;

  const dpr = m.dpr || 1;
  const bitmapWidth = Math.max(1, Math.round(width * dpr));
  const bitmapHeight = Math.max(1, Math.round(height * dpr));
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
  if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const layout = m.options.layout;
  const background = layout.background || {};
  ctx.fillStyle = background.color || background.bottomColor || background.topColor || "#09090B";
  ctx.fillRect(0, 0, width, height);

  const borderColor = m.options.timeScale.borderColor || m.options.rightPriceScale.borderColor || "#27272A";
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0.5, 0);
  ctx.lineTo(0.5, height);
  ctx.moveTo(0, 0.5);
  ctx.lineTo(width, 0.5);
  ctx.stroke();

  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2) + 1;
  const radius = 8;
  ctx.strokeStyle = layout.textColor || "#A1A1AA";
  ctx.lineWidth = 1.25;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = i * Math.PI / 3;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 2.25, 0, Math.PI * 2);
  ctx.stroke();
}

/* ------------------------- pane: grid + bottom --------------------------- */

function renderPaneBase(m, ctx, pane, plotX, plotW, dpr) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotX, pane.top, plotW, pane.height);
  ctx.clip();
  ctx.translate(plotX, pane.top);
  renderGrid(m, ctx, pane, plotW);
  renderOverlays(m, ctx, pane, plotW, dpr, "bottom");
  ctx.restore();
}

function renderGrid(m, ctx, pane, plotW) {
  const grid = m.options.grid;
  if (grid.vertLines?.visible !== false) {
    ctx.strokeStyle = grid.vertLines.color;
    ctx.lineWidth = 1;
    setCtxLineStyle(ctx, grid.vertLines.style ?? LineStyle.Solid, 1);
    ctx.beginPath();
    for (const tick of timeTicks(m, plotW)) {
      const x = Math.round(tick.x) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, pane.height);
    }
    ctx.stroke();
  }
  if (grid.horzLines?.visible !== false) {
    const scale = pane.priceScales.get("right") || pane.priceScales.get("left");
    if (scale && scale.priceRange) {
      ctx.strokeStyle = grid.horzLines.color;
      ctx.lineWidth = 1;
      setCtxLineStyle(ctx, grid.horzLines.style ?? LineStyle.Solid, 1);
      ctx.beginPath();
      for (const t of scale.ticks()) {
        const y = Math.round(t.y) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
      }
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
}

/* ------------------------ pane: series + overlays ------------------------ */

function renderPaneSeries(m, ctx, pane, plotX, plotW, dpr, useGpu) {
  const ts = m.timeScale;
  const vr = ts.visibleLogicalRange();
  const bs = ts.barSpacing;

  // GPU pass: queue candle/bar/histogram rects, then flush clipped to this pane
  if (useGpu) {
    let queued = false;
    for (const s of pane.series) {
      if (!s.options.visible) continue;
      if (usesCustomOhlcRenderer(s)) continue;
      const scale = pane.scale(s.options.priceScaleId);
      const xOf = (local) => plotX + (s.indices[local] - vr.from) * bs;
      if (queueSeriesGpu(m.gpu, s, scale, xOf, bs, dpr, pane.top)) queued = true;
    }
    if (queued) {
      m.gpu.flushRegion(Math.round(plotX * dpr), Math.round(pane.top * dpr), Math.round(plotW * dpr), Math.round(pane.height * dpr));
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(plotX, pane.top, plotW, pane.height);
  ctx.clip();
  ctx.translate(plotX, pane.top);

  for (const s of pane.series) {
    if (!s.options.visible) continue;
    const customCandleStyle = usesCustomOhlcRenderer(s);
    const gpuHandled = useGpu && !customCandleStyle && (s.type === "Candlestick" || s.type === "Bar" || s.type === "Histogram");
    if (!gpuHandled) renderSeries2d(m, ctx, pane, s, plotW);
  }

  for (const s of pane.series) {
    if (!s.options.visible) continue;
    renderSeriesPriceLines(m, ctx, pane, s, plotW);
    if (s.markers.length) renderMarkers(m, ctx, pane, s);
  }

  renderOverlays(m, ctx, pane, plotW, dpr, "normal");
  renderOverlays(m, ctx, pane, plotW, dpr, "top");
  ctx.restore();
}

function renderOverlays(m, ctx, pane, plotW, dpr, zone) {
  for (const s of pane.series) {
    for (const prim of s.overlays) {
      // update views once per frame, not once per z-order zone
      if (prim.__pcFrame !== m._frameId) {
        prim.__pcFrame = m._frameId;
        try { prim.updateAllViews?.(); } catch { /* noop */ }
      }
      const views = typeof prim.paneViews === "function" ? prim.paneViews() : [];
      for (const view of views || []) {
        const z = typeof view.zOrder === "function" ? view.zOrder() : (typeof prim.zOrder === "function" ? prim.zOrder() : "normal");
        if ((z || "normal") !== zone) continue;
        const renderer = view.renderer?.();
        if (!renderer || typeof renderer.draw !== "function") continue;
        const target = new RenderTarget(ctx, plotW, pane.height, dpr);
        try { renderer.draw(target, false); } catch (e) { console.error("[prochart] overlay draw error", e); }
      }
    }
  }
}

export function renderSeries2d(m, ctx, pane, s, plotW) {
  const scale = pane.scale(s.options.priceScaleId);
  if (!scale.priceRange) return;
  const r = s.visibleLocalRange();
  if (!r) return;
  const ts = m.timeScale;
  const vr = ts.visibleLogicalRange();
  const bs = ts.barSpacing;
  const xOf = (local) => (s.indices[local] - vr.from) * bs;
  const o = s.options;

  if (s.type === "Candlestick" && (o.chartStyle ?? "candles") !== "candles") {
    renderOhlcChartStyle(m, ctx, pane, s, scale, r, xOf, bs, o);
    return;
  }

  if (s.type === "Candlestick" || s.type === "Bar") {
    const bodyW = Math.max(1, Math.min(bs - Math.max(1, Math.floor(bs * 0.24)), bs * 0.8));
    const half = bodyW / 2;
    for (const up of [true, false]) {
      const color = up ? o.upColor : o.downColor;
      const wickColor = up ? (o.wickUpColor || color) : (o.wickDownColor || color);
      if (o.wickVisible !== false && s.type === "Candlestick") {
        ctx.strokeStyle = wickColor;
        ctx.lineWidth = Math.max(1, Math.floor(bs / 10));
        ctx.beginPath();
        for (let i = r.a; i <= r.b; i++) {
          if (s.whitespace[i]) continue;
          const isUp = s.packed[i * 4 + 3] >= s.packed[i * 4];
          if (isUp !== up) continue;
          const x = Math.round(xOf(i)) + 0.5;
          const yH = scale.priceToCoordinate(s.packed[i * 4 + 1]);
          const yL = scale.priceToCoordinate(s.packed[i * 4 + 2]);
          ctx.moveTo(x, yH);
          ctx.lineTo(x, yL);
        }
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = r.a; i <= r.b; i++) {
        if (s.whitespace[i]) continue;
        const open = s.packed[i * 4], close = s.packed[i * 4 + 3];
        const isUp = close >= open;
        if (isUp !== up) continue;
        const x = xOf(i);
        if (s.type === "Bar") {
          const yO = scale.priceToCoordinate(open);
          const yC = scale.priceToCoordinate(close);
          const yH = scale.priceToCoordinate(s.packed[i * 4 + 1]);
          const yL = scale.priceToCoordinate(s.packed[i * 4 + 2]);
          const cw = Math.max(1, o.thinBars ? 1 : Math.floor(bs / 6));
          ctx.rect(Math.round(x - cw / 2), yH, cw, Math.max(1, yL - yH));
          if (o.openVisible !== false) ctx.rect(Math.round(x - half), Math.round(yO), Math.max(1, half), cw);
          ctx.rect(Math.round(x), Math.round(yC), Math.max(1, half), cw);
        } else {
          const yO = scale.priceToCoordinate(open);
          const yC = scale.priceToCoordinate(close);
          const top = Math.min(yO, yC);
          const hgt = Math.max(1, Math.abs(yC - yO));
          ctx.rect(Math.round(x - half), Math.round(top), Math.max(1, Math.round(bodyW)), Math.round(hgt));
        }
      }
      ctx.fill();
    }
    return;
  }

  if (s.type === "Histogram") {
    const base = o.base ?? 0;
    const yBase = scale.priceToCoordinate(base);
    const colW = Math.max(1, bs * 0.7);
    let runColor = null;
    ctx.beginPath();
    for (let i = r.a; i <= r.b; i++) {
      if (s.whitespace[i]) continue;
      const color = (s.colors && s.colors[i]) || o.color;
      if (color !== runColor) {
        if (runColor !== null) { ctx.fillStyle = runColor; ctx.fill(); ctx.beginPath(); }
        runColor = color;
      }
      const x = xOf(i);
      const y = scale.priceToCoordinate(s.packed[i]);
      const top = Math.min(y, yBase);
      const hgt = Math.max(1, Math.abs(yBase - y));
      ctx.rect(Math.round(x - colW / 2), Math.round(top), Math.max(1, Math.round(colW)), Math.round(hgt));
    }
    if (runColor !== null) { ctx.fillStyle = runColor; ctx.fill(); }
    return;
  }

  // Line / Area / Baseline
  const lineColor = s.type === "Area" ? o.lineColor : s.type === "Baseline" ? o.topLineColor : o.color;
  const lineWidth = o.lineWidth ?? 2;
  const lineStyle = o.lineStyle ?? LineStyle.Solid;
  const withSteps = o.lineType === LineType.WithSteps;

  const segs = [];
  let cur = null;
  for (let i = r.a; i <= r.b; i++) {
    if (s.whitespace[i]) { if (cur && cur.length > 1) segs.push(cur); cur = null; continue; }
    const x = xOf(i);
    const y = scale.priceToCoordinate(s.packed[i]);
    if (!cur) cur = [];
    cur.push(x, y);
  }
  if (cur && cur.length > 1) segs.push(cur);
  if (!segs.length) return;

  if (s.type === "Area") {
    const bottomY = pane.height;
    for (const seg of segs) {
      const g = ctx.createLinearGradient(0, 0, 0, pane.height);
      g.addColorStop(0, o.topColor);
      g.addColorStop(1, o.bottomColor);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(seg[0], bottomY);
      for (let k = 0; k < seg.length; k += 2) {
        if (withSteps && k > 0) ctx.lineTo(seg[k], seg[k - 1]);
        ctx.lineTo(seg[k], seg[k + 1]);
      }
      ctx.lineTo(seg[seg.length - 2], bottomY);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (o.lineVisible !== false) {
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    setCtxLineStyle(ctx, lineStyle, lineWidth);
    ctx.beginPath();
    for (const seg of segs) {
      ctx.moveTo(seg[0], seg[1]);
      for (let k = 2; k < seg.length; k += 2) {
        if (withSteps) ctx.lineTo(seg[k], seg[k - 3]);
        ctx.lineTo(seg[k], seg[k + 1]);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (o.pointMarkersVisible) {
    ctx.fillStyle = lineColor;
    for (const seg of segs) {
      for (let k = 0; k < seg.length; k += 2) {
        ctx.beginPath();
        ctx.arc(seg[k], seg[k + 1], o.pointMarkersRadius ?? 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function renderOhlcChartStyle(m, ctx, pane, s, scale, r, xOf, bs, o) {
  const style = o.chartStyle ?? "candles";
  if (style === "hollow-candles" || style === "bars" || style === "heikin-ashi") {
    const bodyW = Math.max(1, Math.min(bs - Math.max(1, Math.floor(bs * 0.24)), bs * 0.8));
    const half = bodyW / 2;
    let haOpen = null;
    let haClose = null;
    for (let i = 0; i <= r.b; i += 1) {
      if (s.whitespace[i]) continue;
      let open = s.packed[i * 4];
      let high = s.packed[i * 4 + 1];
      let low = s.packed[i * 4 + 2];
      let close = s.packed[i * 4 + 3];
      if (style === "heikin-ashi") {
        const nextClose = (open + high + low + close) / 4;
        const nextOpen = haOpen == null ? (open + close) / 2 : (haOpen + haClose) / 2;
        haOpen = nextOpen;
        haClose = nextClose;
        open = nextOpen;
        close = nextClose;
        high = Math.max(high, open, close);
        low = Math.min(low, open, close);
      }
      if (i < r.a) continue;
      const up = close >= open;
      const color = up ? o.upColor : o.downColor;
      const wickColor = up ? (o.wickUpColor || color) : (o.wickDownColor || color);
      const x = xOf(i);
      const yO = scale.priceToCoordinate(open);
      const yH = scale.priceToCoordinate(high);
      const yL = scale.priceToCoordinate(low);
      const yC = scale.priceToCoordinate(close);
      ctx.strokeStyle = wickColor;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(1, Math.floor(bs / 10));
      if (style === "bars") {
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, yH);
        ctx.lineTo(Math.round(x) + 0.5, yL);
        ctx.moveTo(Math.round(x - half), Math.round(yO) + 0.5);
        ctx.lineTo(Math.round(x) + 0.5, Math.round(yO) + 0.5);
        ctx.moveTo(Math.round(x) + 0.5, Math.round(yC) + 0.5);
        ctx.lineTo(Math.round(x + half), Math.round(yC) + 0.5);
        ctx.stroke();
        continue;
      }
      if (o.wickVisible !== false) {
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, yH);
        ctx.lineTo(Math.round(x) + 0.5, yL);
        ctx.stroke();
      }
      const top = Math.min(yO, yC);
      const height = Math.max(1, Math.abs(yC - yO));
      const left = Math.round(x - half);
      const width = Math.max(1, Math.round(bodyW));
      if (style === "hollow-candles" && up) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, Math.round(top) + 0.5, Math.max(1, width - 1), Math.max(1, Math.round(height) - 1));
      } else {
        ctx.fillRect(left, Math.round(top), width, Math.round(height));
      }
    }
    return;
  }

  const points = [];
  for (let i = r.a; i <= r.b; i += 1) {
    if (s.whitespace[i]) continue;
    points.push([xOf(i), scale.priceToCoordinate(s.packed[i * 4 + 3])]);
  }
  if (points.length < 2) return;
  const upColor = o.upColor || "#089981";
  const downColor = o.downColor || "#f23645";
  const lineColor = o.chartLineColor || upColor;
  const baseline = points[0][1];

  if (style === "area" || style === "baseline") {
    const gradient = ctx.createLinearGradient(0, 0, 0, pane.height);
    if (style === "baseline") {
      const stop = Math.max(0, Math.min(1, baseline / Math.max(1, pane.height)));
      gradient.addColorStop(0, colorWithAlpha(upColor, "55"));
      gradient.addColorStop(Math.max(0, stop - 0.001), colorWithAlpha(upColor, "10"));
      gradient.addColorStop(Math.min(1, stop + 0.001), colorWithAlpha(downColor, "10"));
      gradient.addColorStop(1, colorWithAlpha(downColor, "55"));
    } else {
      gradient.addColorStop(0, colorWithAlpha(lineColor, "55"));
      gradient.addColorStop(1, colorWithAlpha(lineColor, "05"));
    }
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(points[0][0], pane.height);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(points.at(-1)[0], pane.height);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = style === "baseline" ? upColor : lineColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();

  if (style === "line" && m.lineEndPulseHost && points.length) {
    const [lastX, lastY] = points.at(-1);
    if (lastX >= 0 && lastX <= m.paneWidth() && lastY >= 0 && lastY <= pane.height) {
      const pulse = m.lineEndPulseHost;
      pulse.hidden = false;
      pulse.style.left = `${(m._leftW || 0) + lastX}px`;
      pulse.style.top = `${pane.top + lastY}px`;
      pulse.style.setProperty("--prochart-line-end-color", lineColor);
    }
  }
}

function colorWithAlpha(color, alpha) {
  const value = String(color || "");
  if (/^#[0-9a-f]{6}$/i.test(value)) return `${value}${alpha}`;
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    const [r, g, b] = value.slice(1).split("");
    return `#${r}${r}${g}${g}${b}${b}${alpha}`;
  }
  return value;
}

function renderSeriesPriceLines(m, ctx, pane, s, plotW) {
  const scale = pane.scale(s.options.priceScaleId);
  if (!scale.priceRange) return;
  if (s.options.priceLineVisible) {
    const last = s.lastValue();
    if (last != null) {
      const y = scale.priceToCoordinate(last);
      if (y != null && y >= 0 && y <= pane.height) {
        const color = s.options.priceLineColor || seriesLastValueColor(s);
        ctx.strokeStyle = color;
        ctx.lineWidth = s.options.priceLineWidth || 1;
        setCtxLineStyle(ctx, s.options.priceLineStyle ?? LineStyle.Dashed, 1);
        ctx.beginPath();
        const yy = Math.round(y) + 0.5;
        ctx.moveTo(0, yy);
        ctx.lineTo(plotW, yy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
  for (const line of s.priceLines) {
    const lo = line._options;
    if (lo.lineVisible === false) continue;
    const y = scale.priceToCoordinate(lo.price);
    if (y == null || y < 0 || y > pane.height) continue;
    ctx.strokeStyle = lo.color;
    ctx.lineWidth = lo.lineWidth || 1;
    setCtxLineStyle(ctx, lo.lineStyle ?? LineStyle.Solid, lo.lineWidth || 1);
    ctx.beginPath();
    const yy = Math.round(y) + 0.5;
    ctx.moveTo(0, yy);
    ctx.lineTo(plotW, yy);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function renderMarkers(m, ctx, pane, s) {
  const scale = pane.scale(s.options.priceScaleId);
  if (!scale.priceRange) return;
  const ts = m.timeScale;
  const vr = ts.visibleLogicalRange();
  const layout = m.options.layout;
  ctx.font = `${Math.max(9, layout.fontSize - 2)}px ${layout.fontFamily}`;
  ctx.textAlign = "center";
  for (const mk of s.markers) {
    const idx = ts.timeToIndex(mk.time, false);
    if (idx == null || idx < vr.from - 1 || idx > vr.to + 1) continue;
    const x = (idx - vr.from) * ts.barSpacing;
    const local = s.localByLogical(Math.round(idx));
    if (local < 0) continue;
    let y;
    const size = (mk.size ?? 1) * 6;
    if (mk.position === "aboveBar") y = scale.priceToCoordinate(s.valueCount === 4 ? s.packed[local * 4 + 1] : s.packed[local]) - size - 4;
    else if (mk.position === "belowBar") y = scale.priceToCoordinate(s.valueCount === 4 ? s.packed[local * 4 + 2] : s.packed[local]) + size + 4;
    else y = scale.priceToCoordinate(s.valueCount === 4 ? s.packed[local * 4 + 3] : s.packed[local]);
    if (y == null) continue;
    ctx.fillStyle = mk.color || "#2196f3";
    ctx.beginPath();
    if (mk.shape === "arrowUp") {
      ctx.moveTo(x, y - size / 2);
      ctx.lineTo(x + size / 2, y + size / 2);
      ctx.lineTo(x - size / 2, y + size / 2);
    } else if (mk.shape === "arrowDown") {
      ctx.moveTo(x, y + size / 2);
      ctx.lineTo(x + size / 2, y - size / 2);
      ctx.lineTo(x - size / 2, y - size / 2);
    } else if (mk.shape === "square") {
      ctx.rect(x - size / 2, y - size / 2, size, size);
    } else {
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    }
    ctx.closePath();
    ctx.fill();
    if (mk.text) {
      ctx.fillStyle = mk.color || "#2196f3";
      const ty = mk.position === "belowBar" ? y + size + 10 : y - size - 4;
      ctx.fillText(mk.text, x, ty);
    }
  }
  ctx.textAlign = "left";
}

/* ------------------------------ time axis ------------------------------- */

export function timeTicks(m, plotW) {
  const ts = m.timeScale;
  const n = ts.times.length;
  if (!n) return [];
  const vr = ts.visibleLogicalRange();
  const bs = ts.barSpacing;
  const targetPx = 84;
  let step = Math.max(1, Math.round(targetPx / bs));
  const mag = Math.pow(10, Math.floor(Math.log10(step)));
  for (const mult of [1, 2, 5, 10]) {
    if (mag * mult >= step) { step = Math.max(1, Math.round(mag * mult)); break; }
  }
  const provider = m.options.timeScale.timezoneProvider;
  const first = Math.max(0, Math.floor(vr.from / step) * step);
  const out = [];
  const start = Math.max(0, first - step);
  let prevDate = start >= 0 && start < n ? tickDate(m, ts.times[Math.min(start, n - 1)], provider) : null;
  // ticks continue into future whitespace with extrapolated times (TV behavior)
  for (let i = first; i <= Math.ceil(vr.to); i += step) {
    const t = ts.indexToTime(i);
    const d = tickDate(m, t, provider);
    let type = TickMarkType.Time;
    if (!prevDate || d.getUTCFullYear() !== prevDate.getUTCFullYear()) type = TickMarkType.Year;
    else if (d.getUTCMonth() !== prevDate.getUTCMonth()) type = TickMarkType.Month;
    else if (d.getUTCDate() !== prevDate.getUTCDate()) type = TickMarkType.DayOfMonth;
    prevDate = d;
    const x = (i - vr.from) * bs;
    if (x < -targetPx || x > plotW + targetPx) continue;
    out.push({ x, time: t, index: i, type, date: d });
  }
  return out;
}

export function tickDate(m, sec, provider) {
  const shifted = provider ? sec + provider.getOffset(sec) : sec;
  return new Date(shifted * 1000);
}

function formatTick(m, tick) {
  const fmt = m.options.timeScale.tickMarkFormatter;
  if (typeof fmt === "function") {
    const label = fmt(tick.time, tick.type, m.options.localization.locale);
    if (label != null) return String(label);
  }
  const d = tick.date;
  switch (tick.type) {
    case TickMarkType.Year: return String(d.getUTCFullYear());
    case TickMarkType.Month: return d.toLocaleDateString(m.options.localization.locale, { month: "short", timeZone: "UTC" });
    case TickMarkType.DayOfMonth: return String(d.getUTCDate());
    default: {
      const h = d.getUTCHours().toString().padStart(2, "0");
      const mm = d.getUTCMinutes().toString().padStart(2, "0");
      if (m.options.timeScale.secondsVisible) return `${h}:${mm}:${d.getUTCSeconds().toString().padStart(2, "0")}`;
      return `${h}:${mm}`;
    }
  }
}

function renderTimeAxis(m, ctx, plotX, plotW) {
  const tsOpts = m.options.timeScale;
  if (!tsOpts.visible) return;
  const layout = m.options.layout;
  const top = m.height - TIME_AXIS_HEIGHT;
  ctx.save();
  if (tsOpts.borderVisible !== false) {
    ctx.strokeStyle = tsOpts.borderColor || "#27272A";
    ctx.beginPath();
    ctx.moveTo(0, top + 0.5);
    ctx.lineTo(m.width, top + 0.5);
    ctx.stroke();
  }
  ctx.fillStyle = layout.textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const y = top + TIME_AXIS_HEIGHT / 2 + 1;
  for (const tick of timeTicks(m, plotW)) {
    const label = formatTick(m, tick);
    if (!label) continue;
    const isMajor = tick.type !== TickMarkType.Time && tick.type !== TickMarkType.TimeWithSeconds;
    ctx.font = `${isMajor ? "600 " : ""}${layout.fontSize}px ${layout.fontFamily}`;
    const halfW = ctx.measureText(label).width / 2;
    const x = plotX + tick.x;
    if (x - halfW < 0 || x + halfW > m.width) continue; // hide clipped edge labels
    ctx.fillText(label, x, y);
  }
  ctx.restore();
}

/* ------------------------------ price axes ------------------------------ */

function renderPriceAxes(m, ctx, plotX, plotW) {
  const layout = m.options.layout;
  for (const pane of m.panes) {
    if (pane.height <= 0) continue;
    for (const side of ["left", "right"]) {
      const scale = pane.priceScales.get(side);
      const w = side === "left" ? m._leftW : m._rightW;
      if (!w) continue;
      const x0 = side === "left" ? 0 : m.width - w;
      ctx.save();
      ctx.beginPath();
      // Price-line titles (Bid/Ask) attach to the outside edge of the scale.
      // Clip vertically to the pane while allowing that small title segment to
      // extend into the plot, like TradingView's quote labels.
      ctx.rect(0, pane.top, m.width, pane.height);
      ctx.clip();

      if (scale && scale.options.visible && scale.priceRange) {
        const pendingAxisLabels = [];
        const fmt = scale.formatterForAxis();
        if (scale.options.borderVisible !== false) {
          ctx.strokeStyle = scale.options.borderColor || "#27272A";
          ctx.beginPath();
          const bx = side === "left" ? x0 + w - 0.5 : x0 + 0.5;
          ctx.moveTo(bx, pane.top);
          ctx.lineTo(bx, pane.top + pane.height);
          ctx.stroke();
        }
        ctx.fillStyle = layout.textColor;
        ctx.font = `${layout.fontSize}px ${layout.fontFamily}`;
        ctx.textBaseline = "middle";
        ctx.textAlign = side === "left" ? "right" : "left";
        const tx = side === "left" ? x0 + w - 8 : x0 + 8;
        for (const t of scale.ticks()) {
          const y = pane.top + t.y;
          // never draw a label the pane clip would cut in half (text is centered on t.y)
          const halfText = layout.fontSize * 0.6;
          if (t.y < halfText || t.y > pane.height - halfText) continue;
          if (scale.options.entireTextOnly && (t.y < layout.fontSize || t.y > pane.height - layout.fontSize)) continue;
          ctx.fillText(String(fmt(t.price)), tx, y);
        }
        for (const s of pane.seriesFor(scale)) {
          if (s.options.lastValueVisible) {
            const last = s.lastValue();
            if (last != null) {
              const yy = scale.priceToCoordinate(last);
              if (yy != null && yy >= 0 && yy <= pane.height) {
                const color = seriesLastValueColor(s);
                pendingAxisLabels.push({
                  y: pane.top + yy,
                  text: s.priceFormatter()(last),
                  bgColor: color,
                  textColor: "#ffffff",
                  subtitle: "",
                  title: "",
                  priority: 0,
                });
              }
            }
          }
          for (const line of s.priceLines) {
            const lo = line._options;
            if (!lo.axisLabelVisible) continue;
            const yy = scale.priceToCoordinate(lo.price);
            if (yy == null || yy < 0 || yy > pane.height) continue;
            const title = lo.axisLabelTitle || "";
            pendingAxisLabels.push({
              y: pane.top + yy,
              text: lo.axisLabelText || s.priceFormatter()(lo.price),
              bgColor: lo.axisLabelColor || lo.color,
              textColor: lo.axisLabelTextColor || "#ffffff",
              subtitle: lo.axisSubtitleText || "",
              title,
              priority: title === "Ask" ? 1 : title === "Bid" ? 2 : 0,
            });
          }
        }
        for (const label of layoutAxisLabels(m, pendingAxisLabels, pane.top, pane.height)) {
          axisLabel(m, ctx, side, x0, w, label, pane.top, pane.height);
        }
      }

      // overlay primitive axis pane views (e.g. study scale labels)
      for (const s of pane.series) {
        for (const prim of s.overlays) {
          const views = typeof prim.priceAxisPaneViews === "function" ? prim.priceAxisPaneViews() : null;
          if (!views) continue;
          for (const view of views) {
            const renderer = view.renderer?.();
            if (!renderer || typeof renderer.draw !== "function") continue;
            ctx.save();
            ctx.translate(x0, pane.top);
            const target = new RenderTarget(ctx, w, pane.height, m.dpr || 1);
            const wrapped = {
              useMediaCoordinateSpace: (fn) => {
                ctx.save();
                try { return fn({ context: ctx, mediaSize: { width: w, height: pane.height } }); }
                finally { ctx.restore(); }
              },
              useBitmapCoordinateSpace: (fn) => target.useBitmapCoordinateSpace(fn),
            };
            try { renderer.draw(wrapped, false); } catch (e) { console.error("[prochart] axis overlay error", e); }
            ctx.restore();
          }
        }
      }
      ctx.restore();
    }
  }
}

export function layoutAxisLabels(m, labels, paneTop, paneH) {
  const layout = m.options.layout;
  const priceH = layout.fontSize + 6;
  const minTop = paneTop + 1;
  const paneBottom = paneTop + paneH - 1;
  const ordered = labels
    .map((label, index) => {
      const subtitleSize = Math.max(10, layout.fontSize - 2);
      const height = priceH + (label.subtitle ? subtitleSize + 4 : 0);
      return { ...label, index, height };
    })
    // Smaller y means a higher price. A stable priority only resolves exact
    // ties: Close, then Ask, then Bid.
    .sort((a, b) => a.y - b.y || a.priority - b.priority || a.index - b.index);
  let cursor = minTop;
  for (const label of ordered) {
    const maxTop = paneBottom - label.height;
    const preferredTop = Math.min(Math.max(label.y - priceH / 2, minTop), maxTop);
    label.top = Math.max(preferredTop, cursor);
    cursor = label.top + label.height + 1;
  }
  // If a packed cluster hits the bottom, walk it upward. This retains price
  // order instead of moving a lower-priced label above a higher-priced one.
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const label = ordered[i];
    const nextTop = i + 1 < ordered.length ? ordered[i + 1].top - label.height - 1 : paneBottom - label.height;
    label.top = Math.min(label.top, nextTop);
  }
  // A very tall cluster may hit the top after the backward pass. Repack it
  // downward once; normal chart panes have ample room for the quote group.
  cursor = minTop;
  for (const label of ordered) {
    label.top = Math.max(label.top, cursor);
    cursor = label.top + label.height + 1;
  }
  return ordered;
}

function axisLabel(m, ctx, side, x0, w, label, paneTop, paneH) {
  const layout = m.options.layout;
  const priceH = layout.fontSize + 6;
  const subtitleSize = Math.max(10, layout.fontSize - 2);
  const subtitleH = label.subtitle ? subtitleSize + 4 : 0;
  const h = priceH + subtitleH;
  const top = label.top;
  const priceY = top + priceH / 2;
  ctx.font = `${layout.fontSize}px ${layout.fontFamily}`;
  ctx.fillStyle = label.bgColor;
  roundRectPath(ctx, x0 + 1, top, w - 2, h, 2);
  ctx.fill();
  ctx.fillStyle = label.textColor;
  ctx.textBaseline = "middle";
  ctx.textAlign = side === "left" ? "right" : "left";
  const textX = side === "left" ? x0 + w - 8 : x0 + 8;
  ctx.fillText(label.text, textX, priceY + 0.5);
  if (label.title) {
    ctx.font = `600 ${Math.max(10, layout.fontSize - 2)}px ${layout.fontFamily}`;
    const titlePad = 6;
    const titleW = Math.ceil(ctx.measureText(label.title).width) + titlePad * 2;
    const titleX = side === "left" ? x0 + w : x0 - titleW;
    ctx.fillStyle = label.bgColor;
    roundRectPath(ctx, titleX, top, titleW, priceH, 2);
    ctx.fill();
    ctx.fillStyle = label.textColor;
    ctx.textAlign = "center";
    ctx.fillText(label.title, titleX + titleW / 2, priceY + 0.5);
  }
  if (label.subtitle) {
    ctx.font = `${subtitleSize}px ${layout.fontFamily}`;
    ctx.fillText(label.subtitle, textX, top + priceH + subtitleH / 2);
  }
}

/* ------------------------------- top layer ------------------------------ */

export function renderTop(m) {
  const ctx = m.topCtx;
  const dpr = m.dpr || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, m.topCanvas.width, m.topCanvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const ch = m.crosshair;
  const opts = m.options.crosshair;
  if (!ch.visible || opts.mode === 2 /* Hidden */) return;

  const plotX = m._leftW || 0;
  const plotW = m.paneWidth();
  const ts = m.timeScale;
  const vr = ts.visibleLogicalRange();

  let x = ch.x;
  if (ch.logical != null) x = (Math.round(ch.logical) - vr.from) * ts.barSpacing;
  const pane = m.panes[ch.paneIndex] || m.panes[0];

  ctx.save();
  if (opts.vertLine?.visible !== false && x >= 0 && x <= plotW) {
    ctx.strokeStyle = opts.vertLine.color;
    ctx.lineWidth = opts.vertLine.width || 1;
    setCtxLineStyle(ctx, opts.vertLine.style ?? LineStyle.LargeDashed, 1);
    ctx.beginPath();
    const xx = Math.round(plotX + x) + 0.5;
    ctx.moveTo(xx, 0);
    ctx.lineTo(xx, m.height - m.timeAxisHeight());
    ctx.stroke();
  }
  if (opts.horzLine?.visible !== false && pane && ch.y >= pane.top && ch.y <= pane.top + pane.height) {
    ctx.strokeStyle = opts.horzLine.color;
    ctx.lineWidth = opts.horzLine.width || 1;
    setCtxLineStyle(ctx, opts.horzLine.style ?? LineStyle.LargeDashed, 1);
    ctx.beginPath();
    const yy = Math.round(ch.y) + 0.5;
    ctx.moveTo(plotX, yy);
    ctx.lineTo(plotX + plotW, yy);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const layout = m.options.layout;
  if (opts.vertLine?.labelVisible !== false && m.options.timeScale.visible && ch.logical != null) {
    const t = ts.indexToTime(Math.round(ch.logical));
    if (t != null) {
      const fmt = m.options.localization.timeFormatter;
      let label;
      if (typeof fmt === "function") label = String(fmt(t));
      else {
        const provider = m.options.timeScale.timezoneProvider;
        const d = tickDate(m, t, provider);
        label = d.toISOString().slice(0, 16).replace("T", " ");
      }
      ctx.font = `${layout.fontSize}px ${layout.fontFamily}`;
      const tw = ctx.measureText(label).width + 14;
      const lx = Math.min(Math.max(plotX + x - tw / 2, 0), m.width - tw);
      const ty = m.height - TIME_AXIS_HEIGHT;
      ctx.fillStyle = opts.vertLine.labelBackgroundColor || "#18181B";
      roundRectPath(ctx, lx, ty + 1, tw, TIME_AXIS_HEIGHT - 4, 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, lx + tw / 2, ty + (TIME_AXIS_HEIGHT - 2) / 2);
    }
  }
  if (opts.horzLine?.labelVisible !== false && pane) {
    const scale = pane.priceScales.get("right") || pane.priceScales.get("left");
    if (scale && scale.priceRange) {
      const price = scale.coordinateToPrice(ch.y - pane.top);
      if (price != null && Number.isFinite(price)) {
        const label = String(scale.formatterForAxis()(price));
        for (const side of ["left", "right"]) {
          const w = side === "left" ? m._leftW : m._rightW;
          if (!w) continue;
          const sScale = pane.priceScales.get(side);
          if (!sScale || !sScale.options.visible) continue;
          const x0 = side === "left" ? 0 : m.width - w;
          crossAxisLabel(m, ctx, side, x0, w, ch.y, label, opts.horzLine.labelBackgroundColor || "#18181B");
        }
      }
    }
  }
  ctx.restore();
}

function crossAxisLabel(m, ctx, side, x0, w, y, text, bg) {
  const layout = m.options.layout;
  const h = layout.fontSize + 8;
  ctx.fillStyle = bg;
  roundRectPath(ctx, x0 + 1, y - h / 2, w - 2, h, 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `${layout.fontSize}px ${layout.fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = side === "left" ? "right" : "left";
  ctx.fillText(text, side === "left" ? x0 + w - 8 : x0 + 8, y + 0.5);
}
