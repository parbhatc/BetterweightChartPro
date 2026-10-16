const TRAILING_PRICE = /\s+\(-?[\d,.]+\)$/;
const HTF_LABEL = /(?:^|\s|&)(?:4H|1H|15m|10m|5m)(?=\s|&|$)/;
export const HTF_LABEL_TEXT_COLOR = "#ffffff";

export function isHtfLevelLabel(label) {
  return HTF_LABEL.test(String(label ?? ""));
}

/** Format a level label while allowing its numeric price suffix to be hidden. */
export function formatLevelLabel(label, price, showPrice = true) {
  const base = String(label ?? "").replace(TRAILING_PRICE, "").trim();
  if (!base || showPrice === false) return base;
  const value = Number(price);
  return Number.isFinite(value) ? `${base} (${value.toFixed(2)})` : base;
}

/** Keep timeframe labels readable without changing their level line color. */
export function levelLabelTextColor(label, fallback) {
  return isHtfLevelLabel(label) ? HTF_LABEL_TEXT_COLOR : fallback;
}
