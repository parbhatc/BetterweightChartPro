/** Consequent encroachment is the exact 50% price of an FVG. */
export function fvgCePrice(zone) {
  const top = Number(zone?.top);
  const bottom = Number(zone?.bottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  return (top + bottom) / 2;
}
