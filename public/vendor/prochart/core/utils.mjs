/** Shared helpers for the ProChart engine. */

export const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function deepMerge(dst, src) {
  if (!isObj(src)) return dst;
  for (const k of Object.keys(src)) {
    const sv = src[k];
    if (isObj(sv) && isObj(dst[k])) deepMerge(dst[k], sv);
    else if (isObj(sv)) dst[k] = deepMerge({}, sv);
    else if (sv !== undefined) dst[k] = sv;
  }
  return dst;
}

export function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (isObj(v)) {
    const o = {};
    for (const k of Object.keys(v)) o[k] = clone(v[k]);
    return o;
  }
  return v;
}

/** Normalize any supported time value to unix seconds (number). */
export function toSec(t) {
  if (typeof t === "number") return t;
  if (typeof t === "string") {
    const ms = Date.parse(t.includes("T") ? t : `${t}T00:00:00Z`);
    return Number.isFinite(ms) ? ms / 1000 : NaN;
  }
  if (isObj(t) && t.year != null) return Date.UTC(t.year, (t.month ?? 1) - 1, t.day ?? 1) / 1000;
  return NaN;
}

import { LineStyle } from "./enums.mjs";

export function setCtxLineStyle(ctx, style, width) {
  const w = Math.max(1, width || 1);
  switch (style) {
    case LineStyle.Dotted: ctx.setLineDash([w, w * 2]); break;
    case LineStyle.Dashed: ctx.setLineDash([w * 2, w * 2]); break;
    case LineStyle.LargeDashed: ctx.setLineDash([w * 6, w * 3]); break;
    case LineStyle.SparseDotted: ctx.setLineDash([w, w * 4]); break;
    default: ctx.setLineDash([]);
  }
}

export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

export const lowerBound = (arr, len, v) => {
  let lo = 0, hi = len;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** Parse a CSS color to [r,g,b,a] 0–255 (cached). Handles #rgb(a), #rrggbb(aa), rgb()/rgba(). */
const colorCache = new Map();
export function parseColor(css) {
  let c = colorCache.get(css);
  if (c) return c;
  c = [128, 128, 128, 255];
  if (typeof css === "string") {
    const s = css.trim();
    if (s[0] === "#") {
      const hex = s.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        c = [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16));
        c[3] = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) : 255;
      } else if (hex.length === 6 || hex.length === 8) {
        c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
        c[3] = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
      }
    } else {
      const m = s.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\s*\)/);
      if (m) c = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] !== undefined ? Math.round(Number(m[4]) * (Number(m[4]) <= 1 ? 255 : 1)) : 255];
    }
  }
  colorCache.set(css, c);
  return c;
}
