import { applyColorOpacity } from "../../../ui/color/picker.js";

export const BARS_PATTERN_DEFAULTS = {
  patternBarsCount: 20,
  patternFlipped: false,
  patternMirrored: false,
  patternScale: 1,
  patternMode: "bars",
  patternUpColor: "#2962FF",
  patternDownColor: "#2962FF",
  patternOpacity: 100,
  lineWidth: 1,
};

/** @param {number[]} values */
function median(values) {
  if (!values.length) return 60;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 60;
}

/** @param {{ time: number }[]} bars @param {number} fallback */
function resolveBarSec(bars, fallback) {
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return median(
    bars
      .slice(1)
      .map((bar, index) => Number(bar.time) - Number(bars[index].time))
      .filter((value) => value > 0),
  );
}

/** @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} yOpen @param {number} yHigh @param {number} yLow @param {number} yClose @param {number} width @param {string} color */
function drawPatternCandle(ctx, x, yOpen, yHigh, yLow, yClose, width, color, mode) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, yHigh);
  ctx.lineTo(x, yLow);
  if (mode === "bars") {
    ctx.moveTo(x - width / 2, yOpen);
    ctx.lineTo(x, yOpen);
    ctx.moveTo(x, yClose);
    ctx.lineTo(x + width / 2, yClose);
  }
  ctx.stroke();
  if (mode === "bars") return;
  const top = Math.min(yOpen, yClose);
  const height = Math.max(1, Math.abs(yClose - yOpen));
  ctx.fillRect(x - width / 2, top, width, height);
}

/**
 * Copies the latest source sequence ending at the first anchor and places its
 * final close at the second anchor.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("../../types.js").UserDrawing} drawing
 * @param {{ bars?: object[], barSec?: number, timeToX?: (time: number) => number | null, priceToY?: (price: number) => number | null }} state
 */
export function renderBarsPattern(ctx, drawing, state = {}) {
  const sourceAnchor = drawing.points?.[0];
  const destination = drawing.points?.[1];
  const bars = Array.isArray(state.bars) ? state.bars : [];
  const timeToX = state.timeToX;
  const priceToY = state.priceToY;
  if (!sourceAnchor || !destination || !bars.length || !timeToX || !priceToY) return;

  const count = Math.max(2, Math.min(200, Math.floor(Number(drawing.patternBarsCount) || 20)));
  let source = bars
    .filter((bar) => Number(bar.time) <= Number(sourceAnchor.time))
    .slice(-count);
  if (drawing.patternFlipped) source = [...source].reverse();
  if (source.length < 2) return;

  const last = source[source.length - 1];
  const sourceBase = Number(last.close);
  const destinationBase = Number(destination.price);
  const scale = Math.max(0.01, Number(drawing.patternScale) || 1);
  const sign = drawing.patternMirrored ? -1 : 1;
  const barSec = resolveBarSec(source, Number(state.barSec));
  const upColor = applyColorOpacity(
    String(drawing.patternUpColor ?? BARS_PATTERN_DEFAULTS.patternUpColor),
    Number(drawing.patternOpacity ?? BARS_PATTERN_DEFAULTS.patternOpacity),
  );
  const downColor = applyColorOpacity(
    String(drawing.patternDownColor ?? BARS_PATTERN_DEFAULTS.patternDownColor),
    Number(drawing.patternOpacity ?? BARS_PATTERN_DEFAULTS.patternOpacity),
  );
  const mode = drawing.patternMode === "candles" ? "candles" : "bars";

  const projected = source.map((bar, index) => {
    const time = Number(destination.time) - (source.length - 1 - index) * barSec;
    const project = (value) => destinationBase + (Number(value) - sourceBase) * scale * sign;
    return {
      time,
      open: project(bar.open),
      high: project(drawing.patternMirrored ? bar.low : bar.high),
      low: project(drawing.patternMirrored ? bar.high : bar.low),
      close: project(bar.close),
    };
  });

  ctx.save();
  const firstX = timeToX(projected[0].time);
  const secondX = timeToX(projected[1].time);
  const candleWidth = Math.max(1, Math.min(10, Math.abs((secondX ?? 0) - (firstX ?? 0)) * 0.65));
  for (const bar of projected) {
    const x = timeToX(bar.time);
    const yOpen = priceToY(bar.open);
    const yHigh = priceToY(bar.high);
    const yLow = priceToY(bar.low);
    const yClose = priceToY(bar.close);
    if ([x, yOpen, yHigh, yLow, yClose].some((value) => value == null)) continue;
    drawPatternCandle(
      ctx,
      Number(x),
      Number(yOpen),
      Number(yHigh),
      Number(yLow),
      Number(yClose),
      candleWidth,
      bar.close >= bar.open ? upColor : downColor,
      mode,
    );
  }
  ctx.restore();
}
