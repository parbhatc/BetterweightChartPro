import { applyColorOpacity } from "../../../ui/color/picker.js";

export const GHOST_FEED_DEFAULTS = {
  ghostBarsCount: 16,
  ghostUpColor: "#089981",
  ghostDownColor: "#F23645",
  ghostOpacity: 45,
  ghostAmplitude: 0.16,
};

/** @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} yOpen @param {number} yHigh @param {number} yLow @param {number} yClose @param {number} width @param {string} color */
function drawGhostCandle(ctx, x, yOpen, yHigh, yLow, yClose, width, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, yHigh);
  ctx.lineTo(x, yLow);
  ctx.stroke();
  ctx.fillRect(x - width / 2, Math.min(yOpen, yClose), width, Math.max(1, Math.abs(yClose - yOpen)));
}

/**
 * Renders a deterministic translucent future feed between two anchors. The
 * endpoint remains exact while intermediate candles preserve a market-like
 * alternating cadence.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("../../types.js").UserDrawing} drawing
 * @param {{ timeToX?: (time: number) => number | null, priceToY?: (price: number) => number | null }} state
 */
export function renderGhostFeed(ctx, drawing, state = {}) {
  const start = drawing.points?.[0];
  const end = drawing.points?.[1];
  const timeToX = state.timeToX;
  const priceToY = state.priceToY;
  if (!start || !end || !timeToX || !priceToY) return;

  const count = Math.max(4, Math.min(100, Math.floor(Number(drawing.ghostBarsCount) || 16)));
  const priceRange = Number(end.price) - Number(start.price);
  const amplitude = Math.max(
    Math.abs(priceRange) * Number(drawing.ghostAmplitude ?? GHOST_FEED_DEFAULTS.ghostAmplitude),
    Math.abs(Number(start.price)) * 0.0005,
  );
  const upColor = applyColorOpacity(
    String(drawing.ghostUpColor ?? GHOST_FEED_DEFAULTS.ghostUpColor),
    Number(drawing.ghostOpacity ?? GHOST_FEED_DEFAULTS.ghostOpacity),
  );
  const downColor = applyColorOpacity(
    String(drawing.ghostDownColor ?? GHOST_FEED_DEFAULTS.ghostDownColor),
    Number(drawing.ghostOpacity ?? GHOST_FEED_DEFAULTS.ghostOpacity),
  );
  const points = [];
  let previousClose = Number(start.price);

  for (let index = 0; index < count; index += 1) {
    const ratio = count === 1 ? 1 : index / (count - 1);
    const time = Number(start.time) + (Number(end.time) - Number(start.time)) * ratio;
    const wave = Math.sin(ratio * Math.PI * 3) * amplitude * Math.sin(Math.PI * ratio);
    const close = Number(start.price) + priceRange * ratio + wave;
    const open = index === 0 ? Number(start.price) : previousClose;
    const wick = amplitude * (0.18 + (index % 3) * 0.06);
    points.push({
      time,
      open,
      close,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
    });
    previousClose = close;
  }

  const x0 = timeToX(points[0].time);
  const x1 = timeToX(points[1].time);
  const width = Math.max(1, Math.min(9, Math.abs(Number(x1) - Number(x0)) * 0.62));
  ctx.save();
  ctx.lineWidth = 1;
  for (const bar of points) {
    const x = timeToX(bar.time);
    const yOpen = priceToY(bar.open);
    const yHigh = priceToY(bar.high);
    const yLow = priceToY(bar.low);
    const yClose = priceToY(bar.close);
    if ([x, yOpen, yHigh, yLow, yClose].some((value) => value == null)) continue;
    drawGhostCandle(
      ctx,
      Number(x),
      Number(yOpen),
      Number(yHigh),
      Number(yLow),
      Number(yClose),
      width,
      bar.close >= bar.open ? upColor : downColor,
    );
  }
  ctx.restore();
}
