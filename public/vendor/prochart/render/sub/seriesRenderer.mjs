import { LineStyle, LineType } from "../../core/enums.mjs";
import { setCtxLineStyle } from "../../core/utils.mjs";
import { queueSeriesGpu } from "../gpu.mjs";

export function usesCustomOhlcRenderer(series) {
  return series?.type === "Candlestick"
    && (series.options?.chartStyle ?? "candles") !== "candles";
}

export function seriesLastValueColor(series) {
  const options = series?.options ?? {};
  const style = options.chartStyle ?? "candles";
  if (
    series?.type === "Candlestick"
    && (style === "line" || style === "area")
  ) {
    return options.chartLineColor || options.upColor || "#089981";
  }
  if (series?.type === "Candlestick" && style === "baseline") {
    return options.upColor || options.chartLineColor || "#089981";
  }
  if (series?.valueCount === 4) {
    return series.barColorAt?.(series.times.length - 1)
      || (
        series.packed?.[series.packed.length - 1]
          >= series.packed?.[series.packed.length - 4]
          ? options.upColor
          : options.downColor
      );
  }
  return options.color || options.lineColor || "#2196f3";
}

/** Paint all series geometry for one pane. */
export function renderPaneSeries(
  model,
  context,
  pane,
  plotX,
  plotWidth,
  dpr,
  useGpu,
) {
  const timeScale = model.timeScale;
  const visibleRange = timeScale.visibleLogicalRange();
  const barSpacing = timeScale.barSpacing;

  if (useGpu) {
    let queued = false;
    for (const series of pane.series) {
      if (!series.options.visible || usesCustomOhlcRenderer(series)) continue;

      const scale = pane.scale(series.options.priceScaleId);
      const xOf = (local) => (
        plotX
        + (series.indices[local] - visibleRange.from) * barSpacing
      );
      if (
        queueSeriesGpu(
          model.gpu,
          series,
          scale,
          xOf,
          barSpacing,
          dpr,
          pane.top,
        )
      ) {
        queued = true;
      }
    }
    if (queued) {
      model.gpu.flushRegion(
        Math.round(plotX * dpr),
        Math.round(pane.top * dpr),
        Math.round(plotWidth * dpr),
        Math.round(pane.height * dpr),
      );
    }
  }

  context.save();
  context.beginPath();
  context.rect(plotX, pane.top, plotWidth, pane.height);
  context.clip();
  context.translate(plotX, pane.top);

  for (const series of pane.series) {
    if (!series.options.visible) continue;

    const customCandleStyle = usesCustomOhlcRenderer(series);
    const gpuHandled = useGpu
      && !customCandleStyle
      && (
        series.type === "Candlestick"
        || series.type === "Bar"
        || series.type === "Histogram"
      );
    if (!gpuHandled) {
      renderSeries2d(model, context, pane, series, plotWidth);
    }
  }

  context.restore();
}

export function renderSeries2d(model, context, pane, series, _plotWidth) {
  const scale = pane.scale(series.options.priceScaleId);
  if (!scale.priceRange) return;

  const range = series.visibleLocalRange();
  if (!range) return;

  const timeScale = model.timeScale;
  const visibleRange = timeScale.visibleLogicalRange();
  const barSpacing = timeScale.barSpacing;
  const xOf = (local) => (
    series.indices[local] - visibleRange.from
  ) * barSpacing;
  const options = series.options;

  if (
    series.type === "Candlestick"
    && (options.chartStyle ?? "candles") !== "candles"
  ) {
    renderOhlcChartStyle(
      model,
      context,
      pane,
      series,
      scale,
      range,
      xOf,
      barSpacing,
      options,
    );
    return;
  }

  if (series.type === "Candlestick" || series.type === "Bar") {
    renderBarsOrCandles(
      context,
      series,
      scale,
      range,
      xOf,
      barSpacing,
      options,
      model.dpr ?? globalThis.devicePixelRatio ?? 1,
    );
    return;
  }

  if (series.type === "Histogram") {
    renderHistogram(
      context,
      series,
      scale,
      range,
      xOf,
      barSpacing,
      options,
    );
    return;
  }

  renderLineSeries(context, pane, series, scale, range, xOf, options);
}

function renderBarsOrCandles(
  context,
  series,
  scale,
  range,
  xOf,
  barSpacing,
  options,
  dpr = 1,
) {
  const bodyWidth = Math.max(
    1,
    Math.min(
      barSpacing - Math.max(1, Math.floor(barSpacing * 0.24)),
      barSpacing * 0.8,
    ),
  );
  const halfWidth = bodyWidth / 2;

  for (const up of [true, false]) {
    const color = up ? options.upColor : options.downColor;
    const wickColor = up
      ? options.wickUpColor || color
      : options.wickDownColor || color;

    if (options.wickVisible !== false && series.type === "Candlestick") {
      const wickWidthPx = Math.max(1, Math.floor((barSpacing * dpr) / 10));
      context.fillStyle = wickColor;
      context.beginPath();
      for (let index = range.a; index <= range.b; index += 1) {
        if (series.whitespace[index]) continue;

        const isUp = (
          series.packed[index * 4 + 3] >= series.packed[index * 4]
        );
        if (isUp !== up) continue;

        const xPx = Math.round(xOf(index) * dpr);
        const highY = scale.priceToCoordinate(series.packed[index * 4 + 1]);
        const lowY = scale.priceToCoordinate(series.packed[index * 4 + 2]);
        const topPx = Math.round(Math.min(highY, lowY) * dpr);
        const bottomPx = Math.round(Math.max(highY, lowY) * dpr);
        context.rect(
          (xPx - Math.floor(wickWidthPx / 2)) / dpr,
          topPx / dpr,
          wickWidthPx / dpr,
          Math.max(1, bottomPx - topPx) / dpr,
        );
      }
      context.fill();
    }

    context.fillStyle = color;
    context.beginPath();
    for (let index = range.a; index <= range.b; index += 1) {
      if (series.whitespace[index]) continue;

      const open = series.packed[index * 4];
      const close = series.packed[index * 4 + 3];
      const isUp = close >= open;
      if (isUp !== up) continue;

      const x = xOf(index);
      if (series.type === "Bar") {
        const openY = scale.priceToCoordinate(open);
        const closeY = scale.priceToCoordinate(close);
        const highY = scale.priceToCoordinate(series.packed[index * 4 + 1]);
        const lowY = scale.priceToCoordinate(series.packed[index * 4 + 2]);
        const columnWidth = Math.max(
          1,
          options.thinBars ? 1 : Math.floor(barSpacing / 6),
        );
        context.rect(
          Math.round(x - columnWidth / 2),
          highY,
          columnWidth,
          Math.max(1, lowY - highY),
        );
        if (options.openVisible !== false) {
          context.rect(
            Math.round(x - halfWidth),
            Math.round(openY),
            Math.max(1, halfWidth),
            columnWidth,
          );
        }
        context.rect(
          Math.round(x),
          Math.round(closeY),
          Math.max(1, halfWidth),
          columnWidth,
        );
      } else {
        const openY = scale.priceToCoordinate(open);
        const closeY = scale.priceToCoordinate(close);
        const leftPx = Math.round((x - halfWidth) * dpr);
        const rightPx = Math.max(leftPx + 1, Math.round((x + halfWidth) * dpr));
        const topPx = Math.round(Math.min(openY, closeY) * dpr);
        const bottomPx = Math.max(topPx + 1, Math.round(Math.max(openY, closeY) * dpr));
        context.rect(
          leftPx / dpr,
          topPx / dpr,
          (rightPx - leftPx) / dpr,
          (bottomPx - topPx) / dpr,
        );
      }
    }
    context.fill();

    if (series.type === "Candlestick" && options.borderVisible !== false) {
      const borderColor = up
        ? options.borderUpColor || color
        : options.borderDownColor || color;
      context.fillStyle = borderColor;
      context.beginPath();
      for (let index = range.a; index <= range.b; index += 1) {
        if (series.whitespace[index]) continue;
        const open = series.packed[index * 4];
        const close = series.packed[index * 4 + 3];
        if ((close >= open) !== up) continue;

        const x = xOf(index);
        const openY = scale.priceToCoordinate(open);
        const closeY = scale.priceToCoordinate(close);
        const leftPx = Math.round((x - halfWidth) * dpr);
        const rightPx = Math.max(leftPx + 1, Math.round((x + halfWidth) * dpr));
        const topPx = Math.round(Math.min(openY, closeY) * dpr);
        const bottomPx = Math.max(topPx + 1, Math.round(Math.max(openY, closeY) * dpr));
        const widthPx = rightPx - leftPx;
        const heightPx = bottomPx - topPx;
        if (widthPx <= 2 || heightPx <= 2) {
          context.rect(leftPx / dpr, topPx / dpr, widthPx / dpr, heightPx / dpr);
        } else {
          const px = 1 / dpr;
          const left = leftPx / dpr;
          const top = topPx / dpr;
          const width = widthPx / dpr;
          const height = heightPx / dpr;
          context.rect(left, top, width, px);
          context.rect(left, top + height - px, width, px);
          context.rect(left, top + px, px, height - 2 * px);
          context.rect(left + width - px, top + px, px, height - 2 * px);
        }
      }
      context.fill();
    }
  }
}

function renderHistogram(
  context,
  series,
  scale,
  range,
  xOf,
  barSpacing,
  options,
) {
  const base = options.base ?? 0;
  const baseY = scale.priceToCoordinate(base);
  const columnWidth = Math.max(1, barSpacing * 0.7);
  let runColor = null;

  context.beginPath();
  for (let index = range.a; index <= range.b; index += 1) {
    if (series.whitespace[index]) continue;

    const color = series.colors?.[index] || options.color;
    if (color !== runColor) {
      if (runColor !== null) {
        context.fillStyle = runColor;
        context.fill();
        context.beginPath();
      }
      runColor = color;
    }
    const x = xOf(index);
    const y = scale.priceToCoordinate(series.packed[index]);
    const top = Math.min(y, baseY);
    const height = Math.max(1, Math.abs(baseY - y));
    context.rect(
      Math.round(x - columnWidth / 2),
      Math.round(top),
      Math.max(1, Math.round(columnWidth)),
      Math.round(height),
    );
  }
  if (runColor !== null) {
    context.fillStyle = runColor;
    context.fill();
  }
}

function renderLineSeries(
  context,
  pane,
  series,
  scale,
  range,
  xOf,
  options,
) {
  const lineColor = series.type === "Area"
    ? options.lineColor
    : series.type === "Baseline"
      ? options.topLineColor
      : options.color;
  const lineWidth = options.lineWidth ?? 2;
  const lineStyle = options.lineStyle ?? LineStyle.Solid;
  const withSteps = options.lineType === LineType.WithSteps;
  const segments = buildLineSegments(series, scale, range, xOf);
  if (!segments.length) return;

  if (series.type === "Area") {
    const bottomY = pane.height;
    for (const segment of segments) {
      const gradient = context.createLinearGradient(0, 0, 0, pane.height);
      gradient.addColorStop(0, options.topColor);
      gradient.addColorStop(1, options.bottomColor);
      context.fillStyle = gradient;
      context.beginPath();
      context.moveTo(segment[0], bottomY);
      for (let index = 0; index < segment.length; index += 2) {
        if (withSteps && index > 0) {
          context.lineTo(segment[index], segment[index - 1]);
        }
        context.lineTo(segment[index], segment[index + 1]);
      }
      context.lineTo(segment[segment.length - 2], bottomY);
      context.closePath();
      context.fill();
    }
  }

  if (options.lineVisible !== false) {
    context.strokeStyle = lineColor;
    context.lineWidth = lineWidth;
    context.lineJoin = "round";
    context.lineCap = "round";
    setCtxLineStyle(context, lineStyle, lineWidth);
    context.beginPath();
    for (const segment of segments) {
      context.moveTo(segment[0], segment[1]);
      for (let index = 2; index < segment.length; index += 2) {
        if (withSteps) {
          context.lineTo(segment[index], segment[index - 3]);
        }
        context.lineTo(segment[index], segment[index + 1]);
      }
    }
    context.stroke();
    context.setLineDash([]);
  }

  if (options.pointMarkersVisible) {
    context.fillStyle = lineColor;
    for (const segment of segments) {
      for (let index = 0; index < segment.length; index += 2) {
        context.beginPath();
        context.arc(
          segment[index],
          segment[index + 1],
          options.pointMarkersRadius ?? 4,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    }
  }
}

function buildLineSegments(series, scale, range, xOf) {
  const segments = [];
  let current = null;
  for (let index = range.a; index <= range.b; index += 1) {
    if (series.whitespace[index]) {
      if (current && current.length > 1) segments.push(current);
      current = null;
      continue;
    }
    if (!current) current = [];
    current.push(
      xOf(index),
      scale.priceToCoordinate(series.packed[index]),
    );
  }
  if (current && current.length > 1) segments.push(current);
  return segments;
}

function renderOhlcChartStyle(
  model,
  context,
  pane,
  series,
  scale,
  range,
  xOf,
  barSpacing,
  options,
) {
  const style = options.chartStyle ?? "candles";
  if (
    style === "hollow-candles"
    || style === "bars"
    || style === "heikin-ashi"
  ) {
    renderAlternativeCandles(
      context,
      series,
      scale,
      range,
      xOf,
      barSpacing,
      options,
      style,
    );
    return;
  }

  const points = [];
  for (let index = range.a; index <= range.b; index += 1) {
    if (series.whitespace[index]) continue;
    points.push([
      xOf(index),
      scale.priceToCoordinate(series.packed[index * 4 + 3]),
    ]);
  }
  if (points.length < 2) return;

  const upColor = options.upColor || "#089981";
  const downColor = options.downColor || "#f23645";
  const lineColor = options.chartLineColor || upColor;
  const baseline = points[0][1];

  if (style === "area" || style === "baseline") {
    const gradient = context.createLinearGradient(0, 0, 0, pane.height);
    if (style === "baseline") {
      const stop = Math.max(
        0,
        Math.min(1, baseline / Math.max(1, pane.height)),
      );
      gradient.addColorStop(0, colorWithAlpha(upColor, "55"));
      gradient.addColorStop(
        Math.max(0, stop - 0.001),
        colorWithAlpha(upColor, "10"),
      );
      gradient.addColorStop(
        Math.min(1, stop + 0.001),
        colorWithAlpha(downColor, "10"),
      );
      gradient.addColorStop(1, colorWithAlpha(downColor, "55"));
    } else {
      gradient.addColorStop(0, colorWithAlpha(lineColor, "55"));
      gradient.addColorStop(1, colorWithAlpha(lineColor, "05"));
    }
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(points[0][0], pane.height);
    for (const [x, y] of points) context.lineTo(x, y);
    context.lineTo(points.at(-1)[0], pane.height);
    context.closePath();
    context.fill();
  }

  context.strokeStyle = style === "baseline" ? upColor : lineColor;
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index][0], points[index][1]);
  }
  context.stroke();

  if (style === "line" && model.lineEndPulseHost && points.length) {
    const [lastX, lastY] = points.at(-1);
    if (
      lastX >= 0
      && lastX <= model.paneWidth()
      && lastY >= 0
      && lastY <= pane.height
    ) {
      const pulse = model.lineEndPulseHost;
      pulse.hidden = false;
      pulse.style.left = `${(model._leftW || 0) + lastX}px`;
      pulse.style.top = `${pane.top + lastY}px`;
      pulse.style.setProperty("--prochart-line-end-color", lineColor);
    }
  }
}

function renderAlternativeCandles(
  context,
  series,
  scale,
  range,
  xOf,
  barSpacing,
  options,
  style,
) {
  const bodyWidth = Math.max(
    1,
    Math.min(
      barSpacing - Math.max(1, Math.floor(barSpacing * 0.24)),
      barSpacing * 0.8,
    ),
  );
  const halfWidth = bodyWidth / 2;
  let heikinAshiOpen = null;
  let heikinAshiClose = null;

  for (let index = 0; index <= range.b; index += 1) {
    if (series.whitespace[index]) continue;

    let open = series.packed[index * 4];
    let high = series.packed[index * 4 + 1];
    let low = series.packed[index * 4 + 2];
    let close = series.packed[index * 4 + 3];
    if (style === "heikin-ashi") {
      const nextClose = (open + high + low + close) / 4;
      const nextOpen = heikinAshiOpen == null
        ? (open + close) / 2
        : (heikinAshiOpen + heikinAshiClose) / 2;
      heikinAshiOpen = nextOpen;
      heikinAshiClose = nextClose;
      open = nextOpen;
      close = nextClose;
      high = Math.max(high, open, close);
      low = Math.min(low, open, close);
    }
    if (index < range.a) continue;

    const up = close >= open;
    const color = up ? options.upColor : options.downColor;
    const wickColor = up
      ? options.wickUpColor || color
      : options.wickDownColor || color;
    const x = xOf(index);
    const openY = scale.priceToCoordinate(open);
    const highY = scale.priceToCoordinate(high);
    const lowY = scale.priceToCoordinate(low);
    const closeY = scale.priceToCoordinate(close);

    context.strokeStyle = wickColor;
    context.fillStyle = color;
    context.lineWidth = Math.max(1, Math.floor(barSpacing / 10));
    if (style === "bars") {
      context.beginPath();
      context.moveTo(Math.round(x) + 0.5, highY);
      context.lineTo(Math.round(x) + 0.5, lowY);
      context.moveTo(Math.round(x - halfWidth), Math.round(openY) + 0.5);
      context.lineTo(Math.round(x) + 0.5, Math.round(openY) + 0.5);
      context.moveTo(Math.round(x) + 0.5, Math.round(closeY) + 0.5);
      context.lineTo(Math.round(x + halfWidth), Math.round(closeY) + 0.5);
      context.stroke();
      continue;
    }
    if (options.wickVisible !== false) {
      context.beginPath();
      context.moveTo(Math.round(x) + 0.5, highY);
      context.lineTo(Math.round(x) + 0.5, lowY);
      context.stroke();
    }

    const top = Math.min(openY, closeY);
    const height = Math.max(1, Math.abs(closeY - openY));
    const left = Math.round(x - halfWidth);
    const width = Math.max(1, Math.round(bodyWidth));
    if (style === "hollow-candles" && up) {
      context.strokeStyle = color;
      context.lineWidth = 1;
      context.strokeRect(
        left + 0.5,
        Math.round(top) + 0.5,
        Math.max(1, width - 1),
        Math.max(1, Math.round(height) - 1),
      );
    } else {
      context.fillRect(left, Math.round(top), width, Math.round(height));
      if (options.borderVisible !== false) {
        const borderColor = up
          ? options.borderUpColor || color
          : options.borderDownColor || color;
        context.strokeStyle = borderColor;
        context.fillStyle = borderColor;
        context.lineWidth = 1;
        const roundedTop = Math.round(top);
        const roundedHeight = Math.max(1, Math.round(height));
        if (width <= 1 || roundedHeight <= 1) {
          context.fillRect(left, roundedTop, width, roundedHeight);
        } else {
          context.strokeRect(
            left + 0.5,
            roundedTop + 0.5,
            width - 1,
            roundedHeight - 1,
          );
        }
      }
    }
  }
}

function colorWithAlpha(color, alpha) {
  const value = String(color || "");
  if (/^#[0-9a-f]{6}$/i.test(value)) return `${value}${alpha}`;
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    const [red, green, blue] = value.slice(1).split("");
    return `#${red}${red}${green}${green}${blue}${blue}${alpha}`;
  }
  return value;
}
