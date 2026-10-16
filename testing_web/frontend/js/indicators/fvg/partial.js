/** @param {object} zone @param {object} bar */
export function isPartialClose(zone, bar) {
  if (zone.kind === "bull") return bar.close < zone.bottom;
  return bar.close > zone.top;
}

export function isPartialFvgVisible(zone, showPartial = true) {
  return !zone?.partial || showPartial !== false;
}
