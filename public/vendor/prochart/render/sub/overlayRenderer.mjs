import { LineStyle } from "../../core/enums.mjs";
import { roundRectPath, setCtxLineStyle } from "../../core/utils.mjs";
import { TIME_AXIS_HEIGHT } from "../../core/defaults.mjs";
import { RenderTarget } from "../target.mjs";
import { tickDate } from "./axisRenderer.mjs";
import { seriesLastValueColor } from "./seriesRenderer.mjs";

/** Paint primitive views assigned to the bottom z-order. */
export function renderPaneBottomOverlays(
  model,
  context,
  pane,
  plotX,
  plotWidth,
  dpr,
  primitiveViewGroups = createPanePrimitiveViewGroups(model, pane),
) {
  withPanePlot(
    context,
    pane,
    plotX,
    plotWidth,
    () => renderPrimitiveViews(
      context,
      pane,
      plotWidth,
      dpr,
      primitiveViewGroups.bottom,
    ),
  );
}

/** Paint price lines, markers, and normal/top primitive views for one pane. */
export function renderPaneSeriesOverlays(
  model,
  context,
  pane,
  plotX,
  plotWidth,
  dpr,
  primitiveViewGroups = createPanePrimitiveViewGroups(model, pane),
) {
  withPanePlot(context, pane, plotX, plotWidth, () => {
    for (const series of pane.series) {
      if (!series.options.visible) continue;
      renderSeriesPriceLines(model, context, pane, series, plotWidth);
      if (series.markers.length) {
        renderMarkers(model, context, pane, series);
      }
    }

    renderPrimitiveViews(
      context,
      pane,
      plotWidth,
      dpr,
      primitiveViewGroups.normal,
    );
    renderPrimitiveViews(
      context,
      pane,
      plotWidth,
      dpr,
      primitiveViewGroups.top,
    );
  });
}

/**
 * Classify primitive pane views once so every overlay pass in a frame can
 * consume the same stable view snapshot.
 */
export function createPanePrimitiveViewGroups(model, pane) {
  const groups = {
    bottom: [],
    normal: [],
    top: [],
  };

  for (const series of pane.series) {
    for (const primitive of series.overlays) {
      if (primitive.__pcFrame !== model._frameId) {
        primitive.__pcFrame = model._frameId;
        try {
          primitive.updateAllViews?.();
        } catch {
          // A primitive update must not block the remaining render pipeline.
        }
      }

      const views = typeof primitive.paneViews === "function"
        ? primitive.paneViews()
        : [];
      for (const view of views || []) {
        const zOrder = typeof view.zOrder === "function"
          ? view.zOrder()
          : typeof primitive.zOrder === "function"
            ? primitive.zOrder()
            : "normal";
        const zone = zOrder || "normal";
        if (
          zone === "bottom"
          || zone === "normal"
          || zone === "top"
        ) {
          groups[zone].push(view);
        }
      }
    }
  }

  return groups;
}

function withPanePlot(context, pane, plotX, plotWidth, render) {
  context.save();
  context.beginPath();
  context.rect(plotX, pane.top, plotWidth, pane.height);
  context.clip();
  context.translate(plotX, pane.top);
  render();
  context.restore();
}

function renderPrimitiveViews(
  context,
  pane,
  plotWidth,
  dpr,
  views,
) {
  const target = new RenderTarget(
    context,
    plotWidth,
    pane.height,
    dpr,
  );

  for (const view of views) {
    const renderer = view.renderer?.();
    if (!renderer || typeof renderer.draw !== "function") continue;
    try {
      renderer.draw(target, false);
    } catch (error) {
      console.error("[prochart] overlay draw error", error);
    }
  }
}

function renderSeriesPriceLines(model, context, pane, series, plotWidth) {
  const scale = pane.scale(series.options.priceScaleId);
  if (!scale.priceRange) return;

  if (series.options.priceLineVisible) {
    const last = series.lastValue();
    if (last != null) {
      const y = scale.priceToCoordinate(last);
      if (y != null && y >= 0 && y <= pane.height) {
        const color = series.options.priceLineColor
          || seriesLastValueColor(series);
        context.strokeStyle = color;
        context.lineWidth = series.options.priceLineWidth || 1;
        setCtxLineStyle(
          context,
          series.options.priceLineStyle ?? LineStyle.Dashed,
          1,
        );
        context.beginPath();
        const alignedY = Math.round(y) + 0.5;
        context.moveTo(0, alignedY);
        context.lineTo(plotWidth, alignedY);
        context.stroke();
        context.setLineDash([]);
      }
    }
  }

  for (const line of series.priceLines) {
    const options = line._options;
    if (options.lineVisible === false) continue;

    const y = scale.priceToCoordinate(options.price);
    if (y == null || y < 0 || y > pane.height) continue;
    context.strokeStyle = options.color;
    context.lineWidth = options.lineWidth || 1;
    setCtxLineStyle(
      context,
      options.lineStyle ?? LineStyle.Solid,
      options.lineWidth || 1,
    );
    context.beginPath();
    const alignedY = Math.round(y) + 0.5;
    context.moveTo(0, alignedY);
    context.lineTo(plotWidth, alignedY);
    context.stroke();
    context.setLineDash([]);
  }
}

function renderMarkers(model, context, pane, series) {
  const scale = pane.scale(series.options.priceScaleId);
  if (!scale.priceRange) return;

  const timeScale = model.timeScale;
  const visibleRange = timeScale.visibleLogicalRange();
  const layout = model.options.layout;
  context.font = `${Math.max(9, layout.fontSize - 2)}px ${layout.fontFamily}`;
  context.textAlign = "center";

  for (const marker of series.markers) {
    const logical = timeScale.timeToIndex(marker.time, false);
    if (
      logical == null
      || logical < visibleRange.from - 1
      || logical > visibleRange.to + 1
    ) {
      continue;
    }

    const x = (logical - visibleRange.from) * timeScale.barSpacing;
    const local = series.localByLogical(Math.round(logical));
    if (local < 0) continue;

    const size = (marker.size ?? 1) * 6;
    const y = markerY(series, scale, marker, local, size);
    if (y == null) continue;

    context.fillStyle = marker.color || "#2196f3";
    context.beginPath();
    if (marker.shape === "arrowUp") {
      context.moveTo(x, y - size / 2);
      context.lineTo(x + size / 2, y + size / 2);
      context.lineTo(x - size / 2, y + size / 2);
    } else if (marker.shape === "arrowDown") {
      context.moveTo(x, y + size / 2);
      context.lineTo(x + size / 2, y - size / 2);
      context.lineTo(x - size / 2, y - size / 2);
    } else if (marker.shape === "square") {
      context.rect(x - size / 2, y - size / 2, size, size);
    } else {
      context.arc(x, y, size / 2, 0, Math.PI * 2);
    }
    context.closePath();
    context.fill();

    if (marker.text) {
      context.fillStyle = marker.color || "#2196f3";
      const textY = marker.position === "belowBar"
        ? y + size + 10
        : y - size - 4;
      context.fillText(marker.text, x, textY);
    }
  }
  context.textAlign = "left";
}

function markerY(series, scale, marker, local, size) {
  const valueOffset = series.valueCount === 4 ? local * 4 : local;
  if (marker.position === "aboveBar") {
    const highOffset = series.valueCount === 4 ? valueOffset + 1 : valueOffset;
    return scale.priceToCoordinate(series.packed[highOffset]) - size - 4;
  }
  if (marker.position === "belowBar") {
    const lowOffset = series.valueCount === 4 ? valueOffset + 2 : valueOffset;
    return scale.priceToCoordinate(series.packed[lowOffset]) + size + 4;
  }
  const value = series.valueCount === 4
    ? series.packed[valueOffset + 3]
    : series.packed[valueOffset];
  return scale.priceToCoordinate(value);
}

/** Paint the isolated crosshair canvas. */
export function renderTop(model) {
  const context = model.topCtx;
  const dpr = model.dpr || 1;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(
    0,
    0,
    model.topCanvas.width,
    model.topCanvas.height,
  );
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  const crosshair = model.crosshair;
  const options = model.options.crosshair;
  if (!crosshair.visible || options.mode === 2) return;

  const plotX = model._leftW || 0;
  const plotWidth = model.paneWidth();
  const timeScale = model.timeScale;
  const visibleRange = timeScale.visibleLogicalRange();
  let x = crosshair.x;
  if (crosshair.logical != null) {
    x = (
      Math.round(crosshair.logical) - visibleRange.from
    ) * timeScale.barSpacing;
  }
  const pane = model.panes[crosshair.paneIndex] || model.panes[0];

  context.save();
  renderCrosshairLines(
    model,
    context,
    pane,
    plotX,
    plotWidth,
    x,
    options,
  );
  renderCrosshairTimeLabel(model, context, plotX, x, options);
  renderCrosshairPriceLabels(model, context, pane, options);
  context.restore();
}

function renderCrosshairLines(
  model,
  context,
  pane,
  plotX,
  plotWidth,
  x,
  options,
) {
  if (
    options.vertLine?.visible !== false
    && x >= 0
    && x <= plotWidth
  ) {
    context.strokeStyle = options.vertLine.color;
    context.lineWidth = options.vertLine.width || 1;
    setCtxLineStyle(
      context,
      options.vertLine.style ?? LineStyle.LargeDashed,
      1,
    );
    context.beginPath();
    const alignedX = Math.round(plotX + x) + 0.5;
    context.moveTo(alignedX, 0);
    context.lineTo(
      alignedX,
      model.height - model.timeAxisHeight(),
    );
    context.stroke();
  }

  const crosshair = model.crosshair;
  if (
    options.horzLine?.visible !== false
    && pane
    && crosshair.y >= pane.top
    && crosshair.y <= pane.top + pane.height
  ) {
    context.strokeStyle = options.horzLine.color;
    context.lineWidth = options.horzLine.width || 1;
    setCtxLineStyle(
      context,
      options.horzLine.style ?? LineStyle.LargeDashed,
      1,
    );
    context.beginPath();
    const alignedY = Math.round(crosshair.y) + 0.5;
    context.moveTo(plotX, alignedY);
    context.lineTo(plotX + plotWidth, alignedY);
    context.stroke();
  }
  context.setLineDash([]);
}

function renderCrosshairTimeLabel(model, context, plotX, x, options) {
  const crosshair = model.crosshair;
  if (
    options.vertLine?.labelVisible === false
    || !model.options.timeScale.visible
    || crosshair.logical == null
  ) {
    return;
  }

  const time = model.timeScale.indexToTime(Math.round(crosshair.logical));
  if (time == null) return;

  const formatter = model.options.localization.timeFormatter;
  let label;
  if (typeof formatter === "function") {
    label = String(formatter(time));
  } else {
    const provider = model.options.timeScale.timezoneProvider;
    label = tickDate(model, time, provider)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");
  }

  const layout = model.options.layout;
  context.font = `${layout.fontSize}px ${layout.fontFamily}`;
  const width = context.measureText(label).width + 14;
  const left = Math.min(
    Math.max(plotX + x - width / 2, 0),
    model.width - width,
  );
  const top = model.height - TIME_AXIS_HEIGHT;
  context.fillStyle = options.vertLine.labelBackgroundColor || "#18181B";
  roundRectPath(
    context,
    left,
    top + 1,
    width,
    TIME_AXIS_HEIGHT - 4,
    2,
  );
  context.fill();
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    label,
    left + width / 2,
    top + (TIME_AXIS_HEIGHT - 2) / 2,
  );
}

function renderCrosshairPriceLabels(model, context, pane, options) {
  if (options.horzLine?.labelVisible === false || !pane) return;

  const scale = pane.priceScales.get("right")
    || pane.priceScales.get("left");
  if (!scale?.priceRange) return;

  const price = scale.coordinateToPrice(model.crosshair.y - pane.top);
  if (price == null || !Number.isFinite(price)) return;

  const label = String(scale.formatterForAxis()(price));
  for (const side of ["left", "right"]) {
    const width = side === "left" ? model._leftW : model._rightW;
    if (!width) continue;

    const sideScale = pane.priceScales.get(side);
    if (!sideScale?.options.visible) continue;
    const x = side === "left" ? 0 : model.width - width;
    renderCrosshairAxisLabel(
      model,
      context,
      side,
      x,
      width,
      model.crosshair.y,
      label,
      options.horzLine.labelBackgroundColor || "#18181B",
    );
  }
}

function renderCrosshairAxisLabel(
  model,
  context,
  side,
  x,
  width,
  y,
  text,
  background,
) {
  const layout = model.options.layout;
  const height = layout.fontSize + 8;
  context.fillStyle = background;
  roundRectPath(
    context,
    x + 1,
    y - height / 2,
    width - 2,
    height,
    2,
  );
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = `${layout.fontSize}px ${layout.fontFamily}`;
  context.textBaseline = "middle";
  context.textAlign = side === "left" ? "right" : "left";
  context.fillText(
    text,
    side === "left" ? x + width - 8 : x + 8,
    y + 0.5,
  );
}
