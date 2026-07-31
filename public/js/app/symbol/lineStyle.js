import { isBarUp } from "../../chart/bar/style.js";
import { barsForPane } from "../../chart/pane/data.js";

/** @param {object} sc @param {object} sym @param {object} [bar] @param {object} [prevBar] */
export function resolveSymbolLineColor(sc, sym, bar, prevBar) {
  const followBodyColors = sc.symbolLabelLineFollowBodyColors !== false;
  const up = followBodyColors
    ? sym.bodyUpColor ?? "#089981"
    : sc.symbolLabelLineUpColor ?? sym.bodyUpColor ?? "#089981";
  const down = followBodyColors
    ? sym.bodyDownColor ?? "#f23645"
    : sc.symbolLabelLineDownColor ?? sym.bodyDownColor ?? "#f23645";
  if (!bar) return up;
  return isBarUp(bar, prevBar, sym.colorBarsOnPrevClose) ? up : down;
}

function parseRgb(color) {
  const value = String(color ?? "").trim();
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return [1, 2, 3].map((index) => Number.parseInt(value[index] + value[index], 16));
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  }
  const match = value.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function relativeLuminance(rgb) {
  const channels = rgb.map((channel) => {
    const value = Math.max(0, Math.min(255, channel)) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function colorContrastRatio(first, second) {
  const a = parseRgb(first);
  const b = parseRgb(second);
  if (!a || !b) return Infinity;
  const light = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (light + 0.05) / (dark + 0.05);
}

/** Keep the label color exact while making a low-contrast chart line legible. */
export function ensureVisiblePriceLineColor(color, background, minimumContrast = 1.8) {
  const source = parseRgb(color);
  const bg = parseRgb(background);
  if (!source || !bg || colorContrastRatio(color, background) >= minimumContrast) return color;

  const darkTarget = [19, 23, 34];
  const lightTarget = [255, 255, 255];
  const target = colorContrastRatio("#131722", background)
    >= colorContrastRatio("#ffffff", background)
    ? darkTarget
    : lightTarget;
  for (let amount = 0.15; amount <= 0.75; amount += 0.05) {
    const mixed = source.map((channel, index) => Math.round(channel + (target[index] - channel) * amount));
    const candidate = `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
    if (colorContrastRatio(candidate, background) >= minimumContrast) return candidate;
  }
  return `rgb(${target[0]}, ${target[1]}, ${target[2]})`;
}

export function resolveChartStyleLineColor(seriesOptions = {}) {
  const style = seriesOptions.chartStyle ?? "candles";
  if (style === "line" || style === "area") {
    return seriesOptions.chartLineColor || seriesOptions.upColor || "#089981";
  }
  if (style === "baseline") {
    return seriesOptions.upColor || seriesOptions.chartLineColor || "#089981";
  }
  return null;
}

/**
 * Bar used for custom price-line color — always the forming candle, not crosshair hover.
 * @param {object} pane
 * @param {ReturnType<import("../../ui/chart/settings.js").createChartSettings>} settingsStore
 * @param {object | null} symbolInfo
 */
export function priceLineBarForPane(pane, settingsStore, symbolInfo) {
  const visible = barsForPane(pane, settingsStore, symbolInfo);
  const bar = visible.at(-1);
  const prevBar = visible.length > 1 ? visible.at(-2) : undefined;
  return { bar, prevBar, close: bar?.close ?? null };
}

/**
 * @param {object} pane
 * @param {ReturnType<import("../../ui/chart/settings.js").createChartSettings>} settingsStore
 * @param {object | null} symbolInfo
 */
export function resolvePriceLineColorForPane(pane, settingsStore, symbolInfo) {
  const chartStyleColor = resolveChartStyleLineColor(pane?.series?.options?.());
  if (chartStyleColor) return chartStyleColor;
  const sc = settingsStore.get().scales ?? {};
  const sym = settingsStore.get().symbol ?? {};
  const { bar, prevBar } = priceLineBarForPane(pane, settingsStore, symbolInfo);
  return resolveSymbolLineColor(sc, sym, bar, prevBar);
}

export function resolvePriceLineStrokeColorForPane(pane, settingsStore, symbolInfo) {
  const color = resolvePriceLineColorForPane(pane, settingsStore, symbolInfo);
  const canvas = settingsStore.get().canvas ?? {};
  const background = canvas.backgroundColor
    ?? canvas.backgroundGradientTopColor
    ?? "#09090b";
  return ensureVisiblePriceLineColor(color, background);
}

/** @type {Map<number, string>} */
const paneStyleKeys = new Map();
let applyingSymbolLineStyle = false;

/**
 * @param {object} opts
 * @param {ReturnType<import("../../ui/chart/settings.js").createChartSettings>} opts.settingsStore
 * @param {() => object[]} opts.getAllChartPanes
 * @param {object | null} opts.symbolInfo
 */
export function applySymbolLineStyle(opts) {
  if (applyingSymbolLineStyle) return;
  applyingSymbolLineStyle = true;
  try {
    const { settingsStore, getAllChartPanes, symbolInfo } = opts;
    const sc = settingsStore.get().scales ?? {};
    const sym = settingsStore.get().symbol ?? {};
    for (const pane of getAllChartPanes()) {
      const visible = barsForPane(pane, settingsStore, symbolInfo);
      const { bar, prevBar } = priceLineBarForPane(pane, settingsStore, symbolInfo);
      const lineStyle = Number(sc.symbolLabelLineStyle ?? 2);
      const options = {
        lastValueVisible: false,
        priceLineVisible: false,
        priceLineColor: resolveSymbolLineColor(sc, sym, bar, prevBar),
        priceLineWidth: Number(sc.symbolLabelLineWidth) || 1,
        priceLineStyle: lineStyle,
        title: "",
      };
      const key = `${options.priceLineColor}|${options.priceLineWidth}|${lineStyle}`;
      if (paneStyleKeys.get(pane.index) === key) continue;
      paneStyleKeys.set(pane.index, key);
      pane.series.applyOptions(options);
      pane.priceLineLabel?.requestRefresh?.();
    }
  } finally {
    applyingSymbolLineStyle = false;
  }
}

/** Clear cached keys when settings change materially (e.g. symbol switch). */
export function resetSymbolLineStyleCache() {
  paneStyleKeys.clear();
}
