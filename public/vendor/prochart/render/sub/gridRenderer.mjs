import { ColorType, LineStyle } from "../../core/enums.mjs";
import { setCtxLineStyle } from "../../core/utils.mjs";
import { SEPARATOR_H } from "../../core/defaults.mjs";
import { timeTicks } from "./axisRenderer.mjs";

/** Paint the chart-wide background on the base canvas. */
export function renderBackground(model, context) {
  const background = model.options.layout.background || {};
  if (background.type === ColorType.VerticalGradient && background.topColor) {
    const gradient = context.createLinearGradient(0, 0, 0, model.height);
    gradient.addColorStop(0, background.topColor);
    gradient.addColorStop(1, background.bottomColor || background.topColor);
    context.fillStyle = gradient;
  } else {
    context.fillStyle = background.color || "#09090B";
  }
  context.fillRect(0, 0, model.width, model.height);
}

/** Paint gridlines for one pane, clipped to its plot region. */
export function renderPaneGrid(
  model,
  context,
  pane,
  plotX,
  plotWidth,
  tickCache,
) {
  context.save();
  context.beginPath();
  context.rect(plotX, pane.top, plotWidth, pane.height);
  context.clip();
  context.translate(plotX, pane.top);
  renderGrid(model, context, pane, plotWidth, tickCache);
  context.restore();
}

/** Paint separators between laid-out panes. */
export function renderPaneSeparators(model, context) {
  if (model.panes.length <= 1) return;

  context.fillStyle = model.options.layout.panes?.separatorColor || "#27272A";
  for (let index = 1; index < model.panes.length; index += 1) {
    context.fillRect(
      0,
      model.panes[index].top - SEPARATOR_H,
      model.width,
      SEPARATOR_H,
    );
  }
}

function renderGrid(model, context, pane, plotWidth, tickCache) {
  const grid = model.options.grid;
  if (grid.vertLines?.visible !== false) {
    context.strokeStyle = grid.vertLines.color;
    context.lineWidth = 1;
    setCtxLineStyle(
      context,
      grid.vertLines.style ?? LineStyle.Solid,
      1,
    );
    context.beginPath();
    const ticks = tickCache?.timeTicks(plotWidth)
      ?? timeTicks(model, plotWidth);
    for (const tick of ticks) {
      const x = Math.round(tick.x) + 0.5;
      context.moveTo(x, 0);
      context.lineTo(x, pane.height);
    }
    context.stroke();
  }

  if (grid.horzLines?.visible !== false) {
    const scale = pane.priceScales.get("right")
      || pane.priceScales.get("left");
    if (scale && scale.priceRange) {
      context.strokeStyle = grid.horzLines.color;
      context.lineWidth = 1;
      setCtxLineStyle(
        context,
        grid.horzLines.style ?? LineStyle.Solid,
        1,
      );
      context.beginPath();
      const ticks = tickCache?.priceTicks(scale) ?? scale.ticks();
      for (const tick of ticks) {
        const y = Math.round(tick.y) + 0.5;
        context.moveTo(0, y);
        context.lineTo(plotWidth, y);
      }
      context.stroke();
    }
  }

  context.setLineDash([]);
}
