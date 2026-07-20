/** Price formatting. */

export function makePriceFormatter(priceFormat, localizationFormatter) {
  const pf = priceFormat || {};
  if (pf.type === "custom" && typeof pf.formatter === "function") return pf.formatter;
  const minMove = pf.minMove > 0 ? pf.minMove : 0.01;
  let precision = pf.precision;
  if (precision == null) {
    precision = 0;
    for (let m = minMove; m < 0.9999 && precision < 8; m *= 10) precision += 1;
  }
  if (pf.type === "volume") {
    return (p) => {
      const abs = Math.abs(p);
      const sign = p < 0 ? "-" : "";
      if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
      if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
      if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K`;
      return `${sign}${abs.toFixed(Math.min(precision, 2))}`;
    };
  }
  if (typeof localizationFormatter === "function") return localizationFormatter;
  return (p) => {
    if (!Number.isFinite(p)) return "∅";
    const snapped = Math.round(p / minMove) * minMove;
    return snapped.toFixed(precision);
  };
}
