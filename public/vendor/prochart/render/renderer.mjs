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
  renderTop as renderOverlayTop,
} from "./sub/overlayRenderer.mjs";
import { RenderFrameTickCache } from "./frameTickCache.mjs";

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
  model._frameId = (model._frameId || 0) + 1;
  const dpr = model.dpr || 1;
  const baseContext = model.baseCtx;
  const mainContext = model.mainCtx;
  if (model.lineEndPulseHost) model.lineEndPulseHost.hidden = true;

  const tickCache = new RenderFrameTickCache(model);
  prepareLayout(model, mainContext, dpr, tickCache);
  clearLayer(model.baseCanvas, baseContext, dpr);
  clearLayer(model.mainCanvas, mainContext, dpr);
  renderBackground(model, baseContext);

  const plotX = model._leftW || 0;
  const plotWidth = model.paneWidth();
  const useGpu = Boolean(
    model.gpu
    && model.gpu.ok
    && model.options.renderer !== "cpu",
  );
  prepareGpuFrame(model, dpr, useGpu);

  for (const pane of model.panes) {
    if (pane.height <= 0) continue;

    renderPaneGrid(
      model,
      baseContext,
      pane,
      plotX,
      plotWidth,
      tickCache,
    );
    const primitiveViewGroups = createPanePrimitiveViewGroups(model, pane);
    renderPaneBottomOverlays(
      model,
      baseContext,
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

  renderPaneSeparators(model, baseContext);
  renderPriceAxes(model, mainContext, tickCache);
  renderTimeAxis(model, mainContext, plotX, plotWidth, tickCache);
  renderAxisCorner(model);
  renderTop(model);
}

/** Render only the isolated crosshair layer. */
export function renderTop(model) {
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

function prepareGpuFrame(model, dpr, useGpu) {
  if (!model.gpu?.ok) return;
  if (useGpu) {
    model.gpu.beginFrame(
      Math.round(model.width * dpr),
      Math.round(model.height * dpr),
    );
  } else {
    model.gpu.beginFrame(1, 1);
  }
}
