import { datafeedSupportsQuotes } from "../../datafeed/quotes.js";

/**
 * @param {import("../boot/chart/state.js").BootContext} ctx
 */
export async function attachQuoteManager(ctx) {
  const datafeed = ctx.datafeed;
  if (!datafeedSupportsQuotes(datafeed)) {
    ctx.quotesEnabled = false;
    return;
  }

  try {
    const cfg = await datafeed.onReady();
    const supported =
      Boolean(cfg?.supports_quotes) || Boolean(datafeed.supportsQuotes);
    if (!supported) {
      ctx.quotesEnabled = false;
      return;
    }
  } catch {
    ctx.quotesEnabled = false;
    return;
  }

  ctx.quotesEnabled = true;
  /** @type {Map<string, import("../../datafeed/quotes.js").MarketQuote>} */
  ctx.quotesBySymbol = new Map();

  /** @type {Map<string, { uid: string, refCount: number, listeners: Set<(quote: object) => void> }>} */
  const subs = new Map();

  function refreshPanesForSymbol(symbol) {
    for (const pane of ctx.getAllChartPanes()) {
      if (pane.symbol !== symbol) continue;
      pane.quote = ctx.quotesBySymbol.get(symbol) ?? null;
      pane.bidAskLines?.requestRefresh?.();
      pane.priceLineLabel?.requestRefresh?.();
    }
    ctx.orderLines?.requestRefresh?.();
  }

  /**
   * @param {object} pane
   * @param {import("../../datafeed/types.js").SymbolInfo} [symbolInfo]
   */
  function subscribeSymbolQuote(sym, info, listener) {
    if (!sym || !info) return;

    const existing = subs.get(sym);
    if (existing) {
      existing.refCount += 1;
      if (listener) existing.listeners.add(listener);
      const cached = ctx.quotesBySymbol.get(sym);
      if (cached && listener) queueMicrotask(() => listener(cached));
      let active = true;
      return () => { if (!active) return; active = false; unsubscribeSymbolQuote(sym, listener); };
    }

    const uid = `quote_${sym}_${Date.now()}`;
    const listeners = new Set();
    if (listener) listeners.add(listener);
    datafeed.subscribeQuotes(
      [info],
      (quotes) => {
        const raw = quotes?.[0];
        const v = raw?.v ?? raw;
        const bid = Number(v?.bid);
        const ask = Number(v?.ask);
        if (!Number.isFinite(bid) || !Number.isFinite(ask)) return;
        const q = {
          symbol: raw?.n ?? sym,
          bid,
          ask,
          last: Number.isFinite(Number(v?.lp)) ? Number(v.lp) : undefined,
        };
        ctx.quotesBySymbol.set(sym, q);
        refreshPanesForSymbol(sym);
        for (const notify of listeners) {
          try { notify(q); } catch { /* isolate quote consumers */ }
        }
      },
      uid,
    );
    subs.set(sym, { uid, refCount: 1, listeners });
    let active = true;
    return () => { if (!active) return; active = false; unsubscribeSymbolQuote(sym, listener); };
  }

  function subscribePaneQuotes(pane, symbolInfo) {
    const sym = pane?.symbol;
    const info = symbolInfo ?? pane?.symbolInfo;
    return subscribeSymbolQuote(sym, info);
  }

  /**
   * @param {string} symbol
   */
  function unsubscribeSymbolQuote(symbol, listener) {
    const sub = subs.get(symbol);
    if (!sub) return;
    if (listener) sub.listeners.delete(listener);
    sub.refCount -= 1;
    if (sub.refCount > 0) return;
    datafeed.unsubscribeQuotes?.(sub.uid);
    subs.delete(symbol);
    ctx.quotesBySymbol.delete(symbol);
  }

  ctx.subscribeQuotesForPane = (pane, symbolInfo) => subscribePaneQuotes(pane, symbolInfo);
  ctx.unsubscribeQuotesForPane = (paneOrSymbol) => {
    const symbol =
      typeof paneOrSymbol === "string"
        ? paneOrSymbol
        : paneOrSymbol?.symbol;
    if (symbol) unsubscribeSymbolQuote(symbol);
  };
  ctx.getQuoteForSymbol = (symbol) => ctx.quotesBySymbol.get(symbol) ?? null;
  ctx.subscribeQuote = (symbol, symbolInfo, listener) =>
    subscribeSymbolQuote(symbol, symbolInfo, listener) ?? (() => {});

  for (const pane of ctx.getAllChartPanes()) {
    if (pane.symbolInfo) subscribePaneQuotes(pane, pane.symbolInfo);
  }
}
