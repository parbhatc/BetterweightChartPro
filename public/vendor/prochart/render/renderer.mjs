/**
 * ProChart frame coordinator.
 *
 * Canvas pipeline:
 *   base -> background, grid, bottom primitives, pane separators
 *   gl   -> batched candlestick, bar, and histogram geometry
 *   main -> CPU series, price lines, markers, primitives, and axes
 *   top  -> crosshair lines and labels
 */

import {
  renderBackground,
  renderPaneGrid,
  renderPaneSeparators,
} from "./sub/gridRenderer.mjs";
import { renderPaneSeries } from "./sub/seriesRenderer.mjs";
import {
  renderAxisCorner,
  renderPriceAxes,
  renderTimeAxis,
} from "./sub/axisRenderer.mjs";
import {
  createPanePrimitiveViewGroups,
  renderPaneBottomOverlays,
  renderPaneSeriesOverlays,
  renderPaneTopCanvasOverlays,
  renderTop as renderOverlayTop,
} from "./sub/overlayRenderer.mjs";
import { RenderFrameTickCache } from "./frameTickCache.mjs";
import { shouldUseGpu } from "./gpuPolicy.mjs";

const RENDER_PROFILE_ENABLED = (() => {
  try {
    const debug = new URLSearchParams(globalThis.location?.search ?? "").get("debug") ?? "";
    return debug === "1" || debug.split(/[,;\s]+/).some((tag) => tag === "perf");
  } catch {
    return false;
  }
})();

const renderProfileByModel = new WeakMap();

function recordRenderProfile(model, sample) {
  if (!RENDER_PROFILE_ENABLED) return;
  const now = performance.now();
  let profile = renderProfileByModel.get(model);
  if (!profile) {
    profile = { startedAt: now, frames: 0, total: 0, max: 0, layout: 0, pane: 0, axes: 0, top: 0 };
    renderProfileByModel.set(model, profile);
  }
  profile.frames += 1;
  for (const key of ["total", "layout", "pane", "axes", "top"]) profile[key] += sample[key];
  profile.max = Math.max(profile.max, sample.total);
  const elapsed = now - profile.startedAt;
  if (elapsed < 1000) return;
  const divisor = Math.max(1, profile.frames);
  console.log(`[BWC:render] ${JSON.stringify({
    fps: Math.round((profile.frames / elapsed) * 1000),
    avgMs: Number((profile.total / divisor).toFixed(2)),
    maxMs: Number(profile.max.toFixed(2)),
    layoutMs: Number((profile.layout / divisor).toFixed(2)),
    paneMs: Number((profile.pane / divisor).toFixed(2)),
    axesMs: Number((profile.axes / divisor).toFixed(2)),
    topMs: Number((profile.top / divisor).toFixed(2)),
  })}`);
  renderProfileByModel.set(model, {
    startedAt: now,
    frames: 0,
    total: 0,
    max: 0,
    layout: 0,
    pane: 0,
    axes: 0,
    top: 0,
  });
}

export {
  renderSeries2d,
  seriesLastValueColor,
  usesCustomOhlcRenderer,
} from "./sub/seriesRenderer.mjs";
export {
  layoutAxisLabels,
  tickDate,
  timeTicks,
} from "./sub/axisRenderer.mjs";

/** Render a complete chart frame in stable layer order. */
export function renderChart(model) {
  const profileStart = RENDER_PROFILE_ENABLED ? performance.now() : 0;
  model._frameId = (model._frameId || 0) + 1;
  const dpr = model.dpr || 1;
  const mainContext = model.mainCtx;
  if (model.lineEndPulseHost) model.lineEndPulseHost.hidden = true;

  const tickCache = new RenderFrameTickCache(model);
  prepareLayout(model, mainContext, dpr, tickCache);
  const profileLayoutEnd = RENDER_PROFILE_ENABLED ? performance.now() : 0;

  const plotX = model._leftW || 0;
  const plotWidth = model.paneWidth();
  const useGpu = shouldUseGpu(model);
  const backgroundContext = prepareCanvasLayers(model, dpr, useGpu);
  prepareGpuFrame(model, dpr, useGpu);
  renderBackground(model, backgroundContext);

  for (const pane of model.panes) {
    if (pane.height <= 0) continue;

    renderPaneGrid(
      model,
      backgroundContext,
      pane,
      plotX,
      plotWidth,
      tickCache,
    );
    const primitiveViewGroups = createPanePrimitiveViewGroups(model, pane);
    renderPaneBottomOverlays(
      model,
      backgroundContext,
      pane,
      plotX,
      plotWidth,
      dpr,
      primitiveViewGroups,
    );
    renderPaneSeries(
      model,
      mainContext,
      pane,
      plotX,
      plotWidth,
      dpr,
      useGpu,
    );
    renderPaneSeriesOverlays(
      model,
      mainContext,
      pane,
      plotX,
      plotWidth,
      dpr,
      primitiveViewGroups,
    );
  }
  const profilePaneEnd = RENDER_PROFILE_ENABLED ? performance.now() : 0;

  renderPaneSeparators(model, backgroundContext);
  renderPriceAxes(model, mainContext, tickCache);
  renderTimeAxis(model, mainContext, plotX, plotWidth, tickCache);
  renderAxisCorner(model);
  const profileAxesEnd = RENDER_PROFILE_ENABLED ? performance.now() : 0;
  renderTop(model);
  if (RENDER_PROFILE_ENABLED) {
    const profileEnd = performance.now();
    recordRenderProfile(model, {
      total: profileEnd - profileStart,
      layout: profileLayoutEnd - profileStart,
      pane: profilePaneEnd - profileLayoutEnd,
      axes: profileAxesEnd - profilePaneEnd,
      top: profileEnd - profileAxesEnd,
    });
  }
}

/** Render only the isolated crosshair layer. */
export function renderTop(model) {
  const plotX = model._leftW || 0;
  const plotWidth = model.paneWidth();
  const dpr = model.dpr || 1;
  const topGroups = model.panes.map((pane) =>
    createPanePrimitiveViewGroups(model, pane)
  );
  const hasTopCanvasOverlays = topGroups.some((groups) => groups.topCanvas.length > 0);
  const hadTopCanvasOverlays = Boolean(model._hasTopCanvasOverlays);
  model._hasTopCanvasOverlays = hasTopCanvasOverlays;

  if (hasTopCanvasOverlays || hadTopCanvasOverlays) {
    clearLayer(model.topCanvas, model.topCtx, dpr);
  }
  if (hasTopCanvasOverlays) {
    for (let i = 0; i < model.panes.length; i += 1) {
      const pane = model.panes[i];
      if (pane.height <= 0) continue;
      renderPaneTopCanvasOverlays(
        model,
        model.topCtx,
        pane,
        plotX,
        plotWidth,
        dpr,
        topGroups[i],
      );
    }
    model._topDirtyRegions = [];
  }

  renderOverlayTop(model);
}

function prepareLayout(model, context, dpr, tickCache) {
  model._layoutPanes();
  for (const pane of model.panes) {
    for (const scale of pane.priceScales.values()) {
      scale.updateAutoScale();
    }
  }

  let leftWidth = 0;
  let rightWidth = 0;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const pane of model.panes) {
    const rightScale = pane.priceScales.get("right");
    const leftScale = pane.priceScales.get("left");
    if (rightScale) {
      rightWidth = Math.max(
        rightWidth,
        rightScale.measureWidth(
          context,
          tickCache.priceTicks(rightScale),
        ),
      );
    }
    if (leftScale) {
      leftWidth = Math.max(
        leftWidth,
        leftScale.measureWidth(
          context,
          tickCache.priceTicks(leftScale),
        ),
      );
    }
  }
  model._rightW = rightWidth;
  model._leftW = leftWidth;
}

function clearLayer(canvas, context, dpr) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function prepareCanvasLayers(model, dpr, useGpu) {
  const splitLayers = Boolean(useGpu);
  if (model._splitRenderLayers !== splitLayers) {
    model._splitRenderLayers = splitLayers;
    model.baseCanvas.style.display = splitLayers ? "" : "none";
  }

  clearLayer(model.mainCanvas, model.mainCtx, dpr);
  if (!splitLayers) return model.mainCtx;

  clearLayer(model.baseCanvas, model.baseCtx, dpr);
  return model.baseCtx;
}

function prepareGpuFrame(model, dpr, useGpu) {
  const active = Boolean(useGpu && model.gpu?.ok);
  const changed = model._gpuLayerActive !== active;
  model._gpuLayerActive = active;

  if (model.glCanvas && changed) {
    model.glCanvas.style.display = active ? "" : "none";
    if (!active) {
      if (model.gpu?.ok) {
        model.gpu.beginFrame(1, 1);
      } else {
        model.glCanvas.width = 1;
        model.glCanvas.height = 1;
      }
    }
  }

  if (!active) return;
  model.gpu.beginFrame(
    Math.round(model.width * dpr),
    Math.round(model.height * dpr),
  );
}
