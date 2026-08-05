import test from "node:test";
import assert from "node:assert/strict";

import {
  bumpDataEpoch,
  clearHtfCoarserThan,
  getHtfBars,
  seedHtfBars,
} from "../public/js/app/bar/htfBarCache.js";

const bars = [{ time: 1_786_000_000, open: 1, high: 2, low: 0, close: 1 }];

test("live timeframe changes retain datafeed HTF history and discard pane-derived bars", () => {
  const symbol = "CACHE_TEST_NQ";
  seedHtfBars(symbol, "240", bars, bars, "datafeed");
  seedHtfBars(symbol, "60", bars, bars, "timeframe-switch");

  bumpDataEpoch("timeframe-change-test", { preserveStore: true });
  clearHtfCoarserThan(symbol, "30S");

  assert.equal(getHtfBars(symbol, "240")?.source, "datafeed");
  assert.equal(getHtfBars(symbol, "60"), null);
});
