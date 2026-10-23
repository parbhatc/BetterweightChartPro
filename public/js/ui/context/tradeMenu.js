export function getAutoTradeMenuItems(trade) {
  return [
    trade?.onAutoSell ? { id: "trade-auto-sell", label: "Auto - Sell" } : null,
    trade?.onAutoBuy ? { id: "trade-auto-buy", label: "Auto - Buy" } : null,
  ].filter(Boolean);
}
