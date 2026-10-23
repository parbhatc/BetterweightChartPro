/** @param {string} symbol */
export function symbolTicker(symbol) {
  const raw = String(symbol ?? "");
  const colon = raw.indexOf(":");
  const ticker = colon >= 0 ? raw.slice(colon + 1) : raw;
  return ticker.replace(/!$/, "") || ticker;
}

/** User-facing ticker without TradingView's continuous-contract suffix. */
export function symbolDisplayTicker(symbol) {
  const raw = String(symbol ?? "").trim();
  const colon = raw.lastIndexOf(":");
  const ticker = colon >= 0 ? raw.slice(colon + 1) : raw;
  return /1!$/i.test(ticker) ? ticker.slice(0, -2) : symbolTicker(symbol);
}
