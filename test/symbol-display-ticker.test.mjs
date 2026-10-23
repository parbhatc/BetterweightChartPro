import test from "node:test";
import assert from "node:assert/strict";

import { symbolDisplayTicker } from "../public/js/app/symbol/ticker.js";

test("continuous futures use their root ticker in user-facing labels", () => {
  assert.equal(symbolDisplayTicker("CME_MINI:NQ1!"), "NQ");
  assert.equal(symbolDisplayTicker("CME_MINI:ES1!"), "ES");
  assert.equal(symbolDisplayTicker("COMEX:GC1!"), "GC");
});

test("ordinary symbols remain unchanged in user-facing labels", () => {
  assert.equal(symbolDisplayTicker("CME:NQ"), "NQ");
  assert.equal(symbolDisplayTicker("NASDAQ:AAPL"), "AAPL");
  assert.equal(symbolDisplayTicker("TEST:A1"), "A1");
});
