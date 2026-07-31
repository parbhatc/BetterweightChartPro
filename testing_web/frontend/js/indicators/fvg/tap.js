/** A tap begins when a later candle first enters the FVG from either edge. */
export function isFvgTapped(zone, bar) {
  if (!zone || !bar) return false;
  if (zone.kind === "bull") return Number(bar.low) <= Number(zone.top);
  return Number(bar.high) >= Number(zone.bottom);
}
