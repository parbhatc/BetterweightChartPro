import test from "node:test";
import assert from "node:assert/strict";

import { getAutoTradeMenuItems } from "../public/js/ui/context/tradeMenu.js";

test("chart auto trade actions are direct sell and buy menu items", () => {
  const onAutoSell = () => {};
  const onAutoBuy = () => {};

  assert.deepEqual(getAutoTradeMenuItems({ onAutoSell, onAutoBuy }), [
    { id: "trade-auto-sell", label: "Auto - Sell" },
    { id: "trade-auto-buy", label: "Auto - Buy" },
  ]);
});

test("chart auto trade menu only includes registered sides", () => {
  assert.deepEqual(getAutoTradeMenuItems({ onAutoBuy: () => {} }), [
    { id: "trade-auto-buy", label: "Auto - Buy" },
  ]);
  assert.deepEqual(getAutoTradeMenuItems(null), []);
});
