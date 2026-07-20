import { parseColor } from "../core/utils.mjs";

export { GpuRenderer } from "./gpuRenderer.mjs";

export function queueSeriesGpu(gpu, s, scale, xOf, bs, dpr, paneTopPx) {
  const type = s.type;
  if (type !== "Candlestick" && type !== "Bar" && type !== "Histogram") return false;
  const r = s.visibleLocalRange();
  if (!r || !scale.priceRange) return true; // handled (nothing to draw)
  const o = s.options;

  if (type === "Histogram") {
    const base = o.base ?? 0;
    const yBase = (paneTopPx + scale.priceToCoordinate(base)) * dpr;
    const colW = Math.max(1, bs * 0.7) * dpr;
    const defaultCol = parseColor(o.color);
    for (let i = r.a; i <= r.b; i++) {
      if (s.whitespace[i]) continue;
      const x = xOf(i) * dpr;
      const y = (paneTopPx + scale.priceToCoordinate(s.packed[i])) * dpr;
      const top = Math.min(y, yBase);
      const hgt = Math.max(1, Math.abs(yBase - y));
      const col = s.colors && s.colors[i] ? parseColor(s.colors[i]) : defaultCol;
      gpu.rect(Math.round(x - colW / 2), Math.round(top), Math.max(1, Math.round(colW)), Math.round(hgt), col);
    }
    return true;
  }

  const bodyW = Math.max(1, Math.min(bs - Math.max(1, Math.floor(bs * 0.24)), bs * 0.8)) * dpr;
  const half = bodyW / 2;
  const wickW = Math.max(1, Math.floor((bs * dpr) / 10));
  const upBody = parseColor(o.upColor);
  const downBody = parseColor(o.downColor);
  const upWick = parseColor(o.wickUpColor || o.upColor);
  const downWick = parseColor(o.wickDownColor || o.downColor);

  for (let i = r.a; i <= r.b; i++) {
    if (s.whitespace[i]) continue;
    const open = s.packed[i * 4], high = s.packed[i * 4 + 1], low = s.packed[i * 4 + 2], close = s.packed[i * 4 + 3];
    const up = close >= open;
    const x = xOf(i) * dpr;
    const yH = (paneTopPx + scale.priceToCoordinate(high)) * dpr;
    const yL = (paneTopPx + scale.priceToCoordinate(low)) * dpr;
    if (type === "Bar") {
      const cw = Math.max(1, o.thinBars ? dpr : Math.floor((bs * dpr) / 6));
      const yO = (paneTopPx + scale.priceToCoordinate(open)) * dpr;
      const yC = (paneTopPx + scale.priceToCoordinate(close)) * dpr;
      const col = up ? upBody : downBody;
      gpu.rect(Math.round(x - cw / 2), Math.round(yH), cw, Math.max(1, Math.round(yL - yH)), col);
      if (o.openVisible !== false) gpu.rect(Math.round(x - half), Math.round(yO), Math.max(1, Math.round(half)), cw, col);
      gpu.rect(Math.round(x), Math.round(yC), Math.max(1, Math.round(half)), cw, col);
      continue;
    }
    // candlestick
    if (o.wickVisible !== false) {
      gpu.rect(Math.round(x - wickW / 2), Math.round(yH), wickW, Math.max(1, Math.round(yL - yH)), up ? upWick : downWick);
    }
    const yO = (paneTopPx + scale.priceToCoordinate(open)) * dpr;
    const yC = (paneTopPx + scale.priceToCoordinate(close)) * dpr;
    const top = Math.min(yO, yC);
    const hgt = Math.max(1, Math.abs(yC - yO));
    gpu.rect(Math.round(x - half), Math.round(top), Math.max(1, Math.round(bodyW)), Math.round(hgt), up ? upBody : downBody);
  }
  return true;
}
