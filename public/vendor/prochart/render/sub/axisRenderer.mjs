import { TickMarkType } from "../../core/enums.mjs";
import { roundRectPath } from "../../core/utils.mjs";
import { TIME_AXIS_HEIGHT } from "../../core/defaults.mjs";
import { RenderTarget } from "../target.mjs";
import { seriesLastValueColor } from "./seriesRenderer.mjs";

/** Paint the interactive bottom-right axis corner. */
export function renderAxisCorner(model) {
  const host = model.axisCornerHost;
  const canvas = model.axisCornerCanvas;
  const context = model.axisCornerCtx;
  const width = model._rightW || 0;
  const height = model.timeAxisHeight();
  const visible = width > 0 && height > 0;
  if (!host || !canvas || !context) return;

  host.hidden = !visible;
  updatePriceAxisControls(model, height);
  if (!visible) return;

  const dpr = model.dpr || 1;
  const bitmapWidth = Math.max(1, Math.round(width * dpr));
  const bitmapHeight = Math.max(1, Math.round(height * dpr));
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
  if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  const layout = model.options.layout;
  const background = layout.background || {};
  context.fillStyle = background.color
    || background.bottomColor
    || background.topColor
    || "#09090B";
  context.fillRect(0, 0, width, height);

  const borderColor = model.options.timeScale.borderColor
    || model.options.rightPriceScale.borderColor
    || "#27272A";
  context.strokeStyle = borderColor;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0.5, 0);
  context.lineTo(0.5, height);
  context.moveTo(0, 0.5);
  context.lineTo(width, 0.5);
  context.stroke();

  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2) + 1;
  const radius = 8;
  context.strokeStyle = layout.textColor || "#A1A1AA";
  context.lineWidth = 1.25;
  context.lineJoin = "round";
  context.beginPath();
  for (let index = 0; index < 6; index += 1) {
    const angle = index * Math.PI / 3;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.stroke();
  context.beginPath();
  context.arc(centerX, centerY, 2.25, 0, Math.PI * 2);
  context.stroke();
}

function updatePriceAxisControls(model, timeAxisHeight) {
  const host = model.priceAxisModeHost;
  if (!host) return;

  host.style.bottom = `${timeAxisHeight}px`;
  host.style.color = model.options.layout.textColor || "#A1A1AA";
  const background = model.options.layout.background || {};
  host.style.backgroundColor = background.color
    || background.bottomColor
    || background.topColor
    || "#09090B";
  model.priceAxisAutoButton?._paintModeState?.(false);
  model.priceAxisLogButton?._paintModeState?.(false);
}

export function timeTicks(model, plotWidth) {
  const timeScale = model.timeScale;
  const timeCount = timeScale.times.length;
  if (!timeCount) return [];

  const visibleRange = timeScale.visibleLogicalRange();
  const barSpacing = timeScale.barSpacing;
  const targetPixels = 84;
  let step = Math.max(1, Math.round(targetPixels / barSpacing));
  const magnitude = 10 ** Math.floor(Math.log10(step));
  for (const multiplier of [1, 2, 5, 10]) {
    if (magnitude * multiplier >= step) {
      step = Math.max(1, Math.round(magnitude * multiplier));
      break;
    }
  }

  const provider = model.options.timeScale.timezoneProvider;
  const first = Math.max(0, Math.floor(visibleRange.from / step) * step);
  const ticks = [];
  const start = Math.max(0, first - step);
  let previousDate = start >= 0 && start < timeCount
    ? tickDate(
      model,
      timeScale.times[Math.min(start, timeCount - 1)],
      provider,
    )
    : null;

  // Continue into future whitespace with extrapolated times.
  for (
    let logical = first;
    logical <= Math.ceil(visibleRange.to);
    logical += step
  ) {
    const time = timeScale.indexToTime(logical);
    const date = tickDate(model, time, provider);
    let type = TickMarkType.Time;
    if (
      !previousDate
      || date.getUTCFullYear() !== previousDate.getUTCFullYear()
    ) {
      type = TickMarkType.Year;
    } else if (date.getUTCMonth() !== previousDate.getUTCMonth()) {
      type = TickMarkType.Month;
    } else if (date.getUTCDate() !== previousDate.getUTCDate()) {
      type = TickMarkType.DayOfMonth;
    }
    previousDate = date;

    const x = (logical - visibleRange.from) * barSpacing;
    if (x < -targetPixels || x > plotWidth + targetPixels) continue;
    ticks.push({
      x,
      time,
      index: logical,
      type,
      date,
    });
  }
  return ticks;
}

export function tickDate(_model, seconds, provider) {
  const shifted = provider
    ? seconds + provider.getOffset(seconds)
    : seconds;
  return new Date(shifted * 1000);
}

export function renderTimeAxis(model, context, plotX, plotWidth) {
  const timeScaleOptions = model.options.timeScale;
  if (!timeScaleOptions.visible) return;

  const layout = model.options.layout;
  const top = model.height - TIME_AXIS_HEIGHT;
  context.save();
  if (timeScaleOptions.borderVisible !== false) {
    context.strokeStyle = timeScaleOptions.borderColor || "#27272A";
    context.beginPath();
    context.moveTo(0, top + 0.5);
    context.lineTo(model.width, top + 0.5);
    context.stroke();
  }

  context.fillStyle = layout.textColor;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const y = top + TIME_AXIS_HEIGHT / 2 + 1;
  for (const tick of timeTicks(model, plotWidth)) {
    const label = formatTick(model, tick);
    if (!label) continue;

    const major = tick.type !== TickMarkType.Time
      && tick.type !== TickMarkType.TimeWithSeconds;
    context.font = `${major ? "600 " : ""}${layout.fontSize}px ${layout.fontFamily}`;
    const halfWidth = context.measureText(label).width / 2;
    const x = plotX + tick.x;
    if (x - halfWidth < 0 || x + halfWidth > model.width) continue;
    context.fillText(label, x, y);
  }
  context.restore();
}

function formatTick(model, tick) {
  const formatter = model.options.timeScale.tickMarkFormatter;
  if (typeof formatter === "function") {
    const label = formatter(
      tick.time,
      tick.type,
      model.options.localization.locale,
    );
    if (label != null) return String(label);
  }

  const date = tick.date;
  switch (tick.type) {
    case TickMarkType.Year:
      return String(date.getUTCFullYear());
    case TickMarkType.Month:
      return date.toLocaleDateString(
        model.options.localization.locale,
        { month: "short", timeZone: "UTC" },
      );
    case TickMarkType.DayOfMonth:
      return String(date.getUTCDate());
    default: {
      const hours = date.getUTCHours().toString().padStart(2, "0");
      const minutes = date.getUTCMinutes().toString().padStart(2, "0");
      if (model.options.timeScale.secondsVisible) {
        const seconds = date.getUTCSeconds().toString().padStart(2, "0");
        return `${hours}:${minutes}:${seconds}`;
      }
      return `${hours}:${minutes}`;
    }
  }
}

export function renderPriceAxes(model, context) {
  const layout = model.options.layout;
  for (const pane of model.panes) {
    if (pane.height <= 0) continue;

    for (const side of ["left", "right"]) {
      const scale = pane.priceScales.get(side);
      const width = side === "left" ? model._leftW : model._rightW;
      if (!width) continue;

      const x = side === "left" ? 0 : model.width - width;
      context.save();
      context.beginPath();
      context.rect(0, pane.top, model.width, pane.height);
      context.clip();

      if (scale?.options.visible && scale.priceRange) {
        renderPriceScale(
          model,
          context,
          pane,
          scale,
          side,
          x,
          width,
          layout,
        );
      }
      renderPriceAxisPrimitiveViews(
        model,
        context,
        pane,
        side,
        x,
        width,
      );
      context.restore();
    }
  }
}

function renderPriceScale(
  model,
  context,
  pane,
  scale,
  side,
  x,
  width,
  layout,
) {
  const pendingLabels = [];
  const formatter = scale.formatterForAxis();
  if (scale.options.borderVisible !== false) {
    context.strokeStyle = scale.options.borderColor || "#27272A";
    context.beginPath();
    const borderX = side === "left" ? x + width - 0.5 : x + 0.5;
    context.moveTo(borderX, pane.top);
    context.lineTo(borderX, pane.top + pane.height);
    context.stroke();
  }

  context.fillStyle = layout.textColor;
  context.font = `${layout.fontSize}px ${layout.fontFamily}`;
  context.textBaseline = "middle";
  context.textAlign = side === "left" ? "right" : "left";
  const textX = side === "left" ? x + width - 8 : x + 8;
  for (const tick of scale.ticks()) {
    const y = pane.top + tick.y;
    const halfText = layout.fontSize * 0.6;
    if (tick.y < halfText || tick.y > pane.height - halfText) continue;
    if (
      scale.options.entireTextOnly
      && (
        tick.y < layout.fontSize
        || tick.y > pane.height - layout.fontSize
      )
    ) {
      continue;
    }
    context.fillText(String(formatter(tick.price)), textX, y);
  }

  collectSeriesAxisLabels(pane, scale, pendingLabels);
  for (
    const label of layoutAxisLabels(
      model,
      pendingLabels,
      pane.top,
      pane.height,
    )
  ) {
    renderAxisLabel(
      model,
      context,
      side,
      x,
      width,
      label,
    );
  }
}

function collectSeriesAxisLabels(pane, scale, labels) {
  for (const series of pane.seriesFor(scale)) {
    if (series.options.lastValueVisible) {
      const last = series.lastValue();
      if (last != null) {
        const y = scale.priceToCoordinate(last);
        if (y != null && y >= 0 && y <= pane.height) {
          labels.push({
            y: pane.top + y,
            text: series.priceFormatter()(last),
            bgColor: seriesLastValueColor(series),
            textColor: "#ffffff",
            subtitle: "",
            title: "",
            priority: 0,
          });
        }
      }
    }

    for (const line of series.priceLines) {
      const options = line._options;
      if (!options.axisLabelVisible) continue;

      const y = scale.priceToCoordinate(options.price);
      if (y == null || y < 0 || y > pane.height) continue;
      const title = options.axisLabelTitle || "";
      labels.push({
        y: pane.top + y,
        text: options.axisLabelText
          || series.priceFormatter()(options.price),
        bgColor: options.axisLabelColor || options.color,
        textColor: options.axisLabelTextColor || "#ffffff",
        subtitle: options.axisSubtitleText || "",
        title,
        priority: title === "Ask" ? 1 : title === "Bid" ? 2 : 0,
      });
    }
  }
}

function renderPriceAxisPrimitiveViews(
  model,
  context,
  pane,
  _side,
  x,
  width,
) {
  for (const series of pane.series) {
    for (const primitive of series.overlays) {
      const views = typeof primitive.priceAxisPaneViews === "function"
        ? primitive.priceAxisPaneViews()
        : null;
      if (!views) continue;

      for (const view of views) {
        const renderer = view.renderer?.();
        if (!renderer || typeof renderer.draw !== "function") continue;

        context.save();
        context.translate(x, pane.top);
        const target = new RenderTarget(
          context,
          width,
          pane.height,
          model.dpr || 1,
        );
        const wrappedTarget = {
          useMediaCoordinateSpace: (callback) => {
            context.save();
            try {
              return callback({
                context,
                mediaSize: { width, height: pane.height },
              });
            } finally {
              context.restore();
            }
          },
          useBitmapCoordinateSpace: (callback) => (
            target.useBitmapCoordinateSpace(callback)
          ),
        };
        try {
          renderer.draw(wrappedTarget, false);
        } catch (error) {
          console.error("[prochart] axis overlay error", error);
        }
        context.restore();
      }
    }
  }
}

export function layoutAxisLabels(model, labels, paneTop, paneHeight) {
  const layout = model.options.layout;
  const priceHeight = layout.fontSize + 6;
  const minimumTop = paneTop + 1;
  const paneBottom = paneTop + paneHeight - 1;
  const ordered = labels
    .map((label, index) => {
      const subtitleSize = Math.max(10, layout.fontSize - 2);
      const height = priceHeight
        + (label.subtitle ? subtitleSize + 4 : 0);
      return {
        ...label,
        index,
        height,
      };
    })
    .sort(
      (left, right) => (
        left.y - right.y
        || left.priority - right.priority
        || left.index - right.index
      ),
    );

  let cursor = minimumTop;
  for (const label of ordered) {
    const maximumTop = paneBottom - label.height;
    const preferredTop = Math.min(
      Math.max(label.y - priceHeight / 2, minimumTop),
      maximumTop,
    );
    label.top = Math.max(preferredTop, cursor);
    cursor = label.top + label.height + 1;
  }

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const label = ordered[index];
    const nextTop = index + 1 < ordered.length
      ? ordered[index + 1].top - label.height - 1
      : paneBottom - label.height;
    label.top = Math.min(label.top, nextTop);
  }

  cursor = minimumTop;
  for (const label of ordered) {
    label.top = Math.max(label.top, cursor);
    cursor = label.top + label.height + 1;
  }
  return ordered;
}

function renderAxisLabel(model, context, side, x, width, label) {
  const layout = model.options.layout;
  const priceHeight = layout.fontSize + 6;
  const subtitleSize = Math.max(10, layout.fontSize - 2);
  const subtitleHeight = label.subtitle ? subtitleSize + 4 : 0;
  const height = priceHeight + subtitleHeight;
  const top = label.top;
  const priceY = top + priceHeight / 2;

  context.font = `${layout.fontSize}px ${layout.fontFamily}`;
  context.fillStyle = label.bgColor;
  roundRectPath(context, x + 1, top, width - 2, height, 2);
  context.fill();
  context.fillStyle = label.textColor;
  context.textBaseline = "middle";
  context.textAlign = side === "left" ? "right" : "left";
  const textX = side === "left" ? x + width - 8 : x + 8;
  context.fillText(label.text, textX, priceY + 0.5);

  if (label.title) {
    context.font = `600 ${Math.max(10, layout.fontSize - 2)}px ${layout.fontFamily}`;
    const titlePadding = 6;
    const titleWidth = Math.ceil(context.measureText(label.title).width)
      + titlePadding * 2;
    const titleX = side === "left" ? x + width : x - titleWidth;
    context.fillStyle = label.bgColor;
    roundRectPath(
      context,
      titleX,
      top,
      titleWidth,
      priceHeight,
      2,
    );
    context.fill();
    context.fillStyle = label.textColor;
    context.textAlign = "center";
    context.fillText(
      label.title,
      titleX + titleWidth / 2,
      priceY + 0.5,
    );
  }

  if (label.subtitle) {
    context.font = `${subtitleSize}px ${layout.fontFamily}`;
    context.fillText(
      label.subtitle,
      textX,
      top + priceHeight + subtitleHeight / 2,
    );
  }
}
