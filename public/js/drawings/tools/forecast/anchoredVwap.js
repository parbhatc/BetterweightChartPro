import { applyColorOpacity } from "../../../ui/color/picker.js";

export const ANCHORED_VWAP_DEFAULTS = {
  color: "#2962FF",
  colorOpacity: 100,
  lineWidth: 2,
  lineStyle: 0,
  vwapShowBands: false,
  vwapBandMultiplier: 1,
  vwapBandColor: "#787B86",
  vwapBandOpacity: 60,
};

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ time: number, value: number }[]} values
 * @param {(time: number) => number | null} timeToX
 * @param {(price: number) => number | null} priceToY
 */
function strokeSeries(ctx, values, timeToX, priceToY) {
  let started = false;
  ctx.beginPath();
  for (const point of values) {
    const x = timeToX(point.time);
    const y = priceToY(point.value);
    if (x == null || y == null) continue;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  if (started) ctx.stroke();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("../../types.js").UserDrawing} drawing
 * @param {{ bars?: object[], timeToX?: (time: number) => number | null, priceToY?: (price: number) => number | null }} state
 */
export function renderAnchoredVwap(ctx, drawing, state = {}) {
  const anchor = drawing.points?.[0];
  const bars = Array.isArray(state.bars) ? state.bars : [];
  const timeToX = state.timeToX;
  const priceToY = state.priceToY;
  if (!anchor || !bars.length || !timeToX || !priceToY) return;

  const selected = bars.filter((bar) => Number(bar.time) >= Number(anchor.time));
  if (!selected.length) return;

  let cumulativeVolume = 0;
  let cumulativePriceVolume = 0;
  let cumulativeVarianceVolume = 0;
  const vwap = [];
  const upper = [];
  const lower = [];
  const multiplier = Math.max(0, Number(drawing.vwapBandMultiplier) || 1);

  for (const bar of selected) {
    const typical = (Number(bar.high) + Number(bar.low) + Number(bar.close)) / 3;
    const volume = Math.max(0, Number(bar.volume) || 1);
    cumulativeVolume += volume;
    cumulativePriceVolume += typical * volume;
    const value = cumulativePriceVolume / cumulativeVolume;
    cumulativeVarianceVolume += (typical - value) ** 2 * volume;
    const deviation = Math.sqrt(cumulativeVarianceVolume / cumulativeVolume);
    vwap.push({ time: Number(bar.time), value });
    upper.push({ time: Number(bar.time), value: value + deviation * multiplier });
    lower.push({ time: Number(bar.time), value: value - deviation * multiplier });
  }

  ctx.save();
  ctx.strokeStyle = applyColorOpacity(
    String(drawing.color ?? ANCHORED_VWAP_DEFAULTS.color),
    Number(drawing.colorOpacity ?? ANCHORED_VWAP_DEFAULTS.colorOpacity),
  );
  ctx.lineWidth = Number(drawing.lineWidth ?? ANCHORED_VWAP_DEFAULTS.lineWidth);
  ctx.setLineDash(drawing.lineStyle === 1 ? [2, 3] : drawing.lineStyle === 2 ? [6, 4] : []);
  strokeSeries(ctx, vwap, timeToX, priceToY);
  if (drawing.vwapShowBands) {
    ctx.strokeStyle = applyColorOpacity(
      String(drawing.vwapBandColor ?? ANCHORED_VWAP_DEFAULTS.vwapBandColor),
      Number(drawing.vwapBandOpacity ?? ANCHORED_VWAP_DEFAULTS.vwapBandOpacity),
    );
    ctx.lineWidth = 1;
    strokeSeries(ctx, upper, timeToX, priceToY);
    strokeSeries(ctx, lower, timeToX, priceToY);
  }
  ctx.restore();
}
