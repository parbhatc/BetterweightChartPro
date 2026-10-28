import test from "node:test";
import assert from "node:assert/strict";

import {
  bumpDataEpoch,
  clearAllHtfBars,
  ensureHtfBars,
  extendHtfCacheForAnchor,
  getHtfBars,
  htfCacheStaleForAnchor,
  prependHtfBars,
  seedHtfBars,
} from "../public/js/app/bar/htfBarCache.js";
import { getSecuritySeries, requestSecuritySeries } from "../public/js/indicators/security/htfAccess.js";
import { lookupSymbolBars } from "../public/js/app/bar/symbolBarCache.js";

const bar = (time, close = 1) => ({ time, open: 1, high: 2, low: 0, close });
const rows = (to, count, sec = 900) =>
  Array.from({ length: count }, (_, index) => bar(to - (count - index - 1) * sec));

test("cross-symbol HTF reads schedule one symbol-aware request without invoking primary-symbol aliases", () => {
  const calls = [];
  requestSecuritySeries({
    requestSecurityBars: (...args) => calls.push(["security", ...args]),
    requestBars: (...args) => calls.push(["primary", ...args]),
    requestHtfBars: (...args) => calls.push(["legacy", ...args]),
  }, "ES", "60", 320);
  assert.deepEqual(calls, [["security", "ES", "60", 320]]);
  const legacy = [];
  requestSecuritySeries({ requestBars: (...args) => legacy.push(args) }, "NQ", "15", 300);
  requestSecuritySeries({ requestHtfBars: (...args) => legacy.push(args) }, "NQ", "15", 300);
  assert.deepEqual(legacy, [["15", 300], ["15", 300]]);
});

test("a missing compare series cannot fall through to primary-symbol candle getters", () => {
  fixture();
  let primaryReads = 0;
  const ctx = {
    primarySymbol: "NQ", chartResolution: "1",
    getSecurityBars: () => null,
    getBars: () => { primaryReads++; return { utcBars: [bar(18_000_000, 9000)] }; },
    getHtfBars: () => { primaryReads++; return { utcBars: [bar(18_000_000, 9000)] }; },
  };
  assert.equal(getSecuritySeries(ctx, "ES", "15"), null);
  assert.equal(primaryReads, 0);
});

test("legacy getters still read the primary symbol and cannot masquerade as compare data", () => {
  fixture();
  const primary = { utcBars: [bar(900, 9000)], chartBars: [bar(900, 9000)] };
  const ctx = { primarySymbol: "NQ", getBars: () => primary };
  assert.deepEqual(getSecuritySeries(ctx, "NQ", "15").utcBars, primary.utcBars);
  assert.equal(getSecuritySeries(ctx, "ES", "15"), null);
  let requests = 0;
  requestSecuritySeries({ primarySymbol: "NQ", requestBars: () => { requests++; } }, "ES", "15", 300);
  assert.equal(requests, 0);
});

test("symbol-aware compare reads remain capped to closed HTF candles at the replay anchor", () => {
  fixture();
  const compare = rows(1800, 3);
  const result = getSecuritySeries({
    primarySymbol: "NQ", chartResolution: "1", getPlaybackAnchorSec: () => 1500,
    getSecurityBars: (symbol) => symbol === "ES" ? { utcBars: compare, chartBars: compare } : null,
    getBars: () => ({ utcBars: [bar(0, 9000)] }),
  }, "ES", "15");
  assert.deepEqual(result.utcBars.map((record) => record.time), [0]);
  assert.equal(result.utcBars[0].close, 1);
});

test("pane lookups skip candle arrays still belonging to the leaving timeframe or symbol", () => {
  fixture();
  const settingsStore = { get: () => ({ symbol: { timezone: "Etc/UTC" } }) };
  const pane = { index: 0, symbol: "NQ", resolution: "1", bars: rows(18_000_000, 50), _barSeriesIdentity: { symbol: "NQ", resolution: "5" } };
  const opts = { symbol: "NQ", resolution: "1", pane, settingsStore, resolutions: [] };
  assert.equal(lookupSymbolBars(opts), null);
  pane._barSeriesIdentity = { symbol: "ES", resolution: "1" };
  assert.equal(lookupSymbolBars(opts), null);
  pane._barSeriesIdentity = { symbol: "NQ", resolution: "1" };
  assert.equal(lookupSymbolBars(opts).utcBars.length, 50);
});

function fixture() {
  bumpDataEpoch("history-request-test");
  clearAllHtfBars();
  const pane = { index: 0, symbol: "HTF_REQUEST_TEST", resolution: "1", bars: [bar(18_000_000)] };
  const calls = [];
  const datafeed = {
    async getBars(_info, resolution, params) {
      calls.push({ resolution, ...params });
      await Promise.resolve();
      return { bars: rows(params.to, params.countBack, Number(resolution) * 60) };
    },
  };
  const opts = { datafeed, symbolInfo: { ticker: pane.symbol }, symbol: pane.symbol, resolution: "15", countBack: 320, pane };
  return { pane, calls, datafeed, opts };
}

test("two panes and overlapping Levels/FVG needs make one request per HTF at the largest depth", async () => {
  const { calls, opts } = fixture();
  const entries = await Promise.all(
    [0, 1].flatMap((index) => ["15", "60", "240"].flatMap((resolution) =>
      [300, 320].map((countBack) => ensureHtfBars({ ...opts, resolution, countBack, pane: { ...opts.pane, index } })),
    )),
  );
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => call.countBack), [321, 321, 321]);
  assert.ok(entries.every((entry) => entry.utcBars.length >= 320));
  assert.ok(calls.every((call) => call.requestReason === "htf.initial"));
  assert.ok(calls.every((call) => call.from <= call.to));
});

test("concurrent panes share one older history page without dropping a concurrent live tail", async () => {
  const { calls, opts } = fixture();
  seedHtfBars(opts.symbol, "15", rows(17_999_100, 50), null, "datafeed");
  const requests = [prependHtfBars({ ...opts, countBack: 200 }), prependHtfBars({ ...opts, countBack: 200 })];
  seedHtfBars(opts.symbol, "15", [bar(18_000_000)], null, "datafeed");
  const entries = await Promise.all(requests);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requestReason, "htf.prepend");
  assert.equal(entries[0].utcBars.length, 251);
  assert.equal(getHtfBars(opts.symbol, "15").utcBars.at(-1).time, 18_000_000);
});

test("exhausted history remains cached across repeated indicator passes", async () => {
  const { calls, opts } = fixture();
  seedHtfBars(opts.symbol, "15", rows(17_999_100, 50), null, "datafeed");
  opts.datafeed = { async getBars(_info, _resolution, params) { calls.push(params); return { bars: [], noData: true }; } };
  await prependHtfBars(opts);
  assert.equal(calls.length, 1);
  for (let index = 0; index < 3; index++) await ensureHtfBars(opts);
  assert.equal(calls.length, 1, "do not refetch the latest page when older history is exhausted");
});

test("tail recovery preserves older history added while the network request was pending", async () => {
  const { opts } = fixture();
  seedHtfBars(opts.symbol, "15", rows(17_999_100, 50), null, "datafeed");
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  opts.datafeed = {
    async getBars(_info, _resolution, params) {
      if (params.requestReason === "htf.tail") await gate;
      return { bars: rows(params.to, params.countBack) };
    },
  };
  const tail = extendHtfCacheForAnchor({ ...opts, anchorSec: 18_000_900 });
  await prependHtfBars({ ...opts, countBack: 200 });
  release();
  await tail;
  const bars = getHtfBars(opts.symbol, "15").utcBars;
  assert.equal(bars.length, 251);
  assert.ok(bars.slice(1).every((next, index) => next.time - bars[index].time === 900));
});

test("a timeframe change never joins an old generation's pending history", async () => {
  const { calls, opts } = fixture();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  opts.datafeed = { async getBars(_info, _resolution, params) { calls.push(params); await gate; return { bars: rows(params.to, params.countBack) }; } };
  const oldRequest = ensureHtfBars(opts);
  await Promise.resolve();
  bumpDataEpoch("timeframe-change", { preserveStore: true });
  const currentRequest = ensureHtfBars(opts);
  release();
  await Promise.all([oldRequest, currentRequest]);
  assert.equal(calls.length, 2);
  assert.equal(getHtfBars(opts.symbol, "15").utcBars.length, 320);
});

test("a larger need arriving after the first request starts receives its full history", async () => {
  const { calls, opts } = fixture();
  const small = ensureHtfBars({ ...opts, countBack: 50 });
  await Promise.resolve();
  const large = ensureHtfBars(opts);
  const [first, second] = await Promise.all([small, large]);
  assert.equal(first.utcBars.length, 50);
  assert.equal(second.utcBars.length, 320);
  assert.equal(calls.length, 2);
});

test("a long suspended-tab interval is recovered without the old 16-bar hole", async () => {
  const { calls, opts } = fixture();
  seedHtfBars(opts.symbol, "15", rows(17_900_100, 50), null, "datafeed");
  await extendHtfCacheForAnchor({ ...opts, anchorSec: 18_000_000 });
  const bars = getHtfBars(opts.symbol, "15").utcBars;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].countBack, 113);
  assert.equal(calls[0].requestReason, "htf.tail");
  assert.ok(bars.slice(1).every((next, index) => next.time - bars[index].time === 900));
  assert.equal(htfCacheStaleForAnchor(opts.symbol, "15", 18_000_000, { confirmedOnly: true }), false);
});

test("resume gaps beyond one request cap are paged until they meet the old tail", async () => {
  const { calls, opts } = fixture();
  seedHtfBars(opts.symbol, "15", rows(18_000_000 - 5000 * 900, 50), null, "datafeed");
  await extendHtfCacheForAnchor({ ...opts, anchorSec: 18_000_000 });
  const bars = getHtfBars(opts.symbol, "15").utcBars;
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.countBack <= 4000));
  assert.ok(bars.slice(1).every((next, index) => next.time - bars[index].time === 900));
});

test("confirmed HTF history contains no forming candle at the replay anchor", async () => {
  const { opts } = fixture();
  const entry = await ensureHtfBars({ ...opts, playbackAnchorSec: 18_000_060 });
  assert.ok(entry.utcBars.every((record) => record.time + 900 <= 18_000_060));
});

test("warm 1m to 5m to 1m switches reuse native HTF history", async () => {
  const { calls, opts } = fixture();
  await ensureHtfBars(opts);
  for (const resolution of ["5", "1"]) {
    bumpDataEpoch("timeframe-change", { preserveStore: true });
    await ensureHtfBars({ ...opts, pane: { ...opts.pane, resolution } });
  }
  assert.equal(calls.length, 1);
  assert.equal(getHtfBars(opts.symbol, "15").source, "datafeed");
});
