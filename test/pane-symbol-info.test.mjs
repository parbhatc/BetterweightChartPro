import test from "node:test";
import assert from "node:assert/strict";

import { symbolInfoMatchesSymbol } from "../public/js/app/bar/loader.js";

test("pane symbol metadata matches common datafeed identifiers", () => {
  assert.equal(symbolInfoMatchesSymbol({ name: "NQ" }, "NQ"), true);
  assert.equal(symbolInfoMatchesSymbol({ ticker: "CME_MINI:NQ1!" }, "CME_MINI:NQ1!"), true);
  assert.equal(symbolInfoMatchesSymbol({ ticker: "CME_MINI:NQ1!" }, "NQ"), true);
  assert.equal(symbolInfoMatchesSymbol({ full_name: "CME_MINI:NQ1!" }, "NQ1!"), true);
  assert.equal(symbolInfoMatchesSymbol({ streamTicker: "CME_MINI:NQ1!" }, "NQ1!"), true);
});

test("pane symbol metadata rejects bars from a different symbol", () => {
  assert.equal(symbolInfoMatchesSymbol({ name: "ES", ticker: "ES" }, "NQ"), false);
  assert.equal(symbolInfoMatchesSymbol(null, "NQ"), false);
  assert.equal(symbolInfoMatchesSymbol({ name: "NQ" }, ""), false);
});
