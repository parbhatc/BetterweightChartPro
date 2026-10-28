import test from "node:test";
import assert from "node:assert/strict";
import {
  bumpDataEpoch, clearAllHtfBars, ensureHtfBars, extendHtfCacheForAnchor, getHtfBars,
  getHtfSeriesVersion, invalidateHtfBarRequests, seedHtfBars,
  htfCacheStaleForAnchor,
} from "../public/js/app/bar/htfBarCache.js";
import { createIndicatorDataLoader } from "../public/js/app/boot/chart/indicatorDataLoader.js";
import { registerIndicatorDefinition } from "../public/js/indicators/catalog.js";
import { resolutionSec } from "../public/js/chart/resolutions.js";
import { resolveHtfSeries } from "../public/js/indicators/security/htfAccess.js";

const bar = (time, close = 1) => ({ time, open: 1, high: 2, low: 0, close, volume: 1 });
const rows = (to, count, sec) => Array.from({ length: count }, (_, index) => bar(to - (count - index - 1) * sec));
const settingsStore = { get: () => ({ symbol: { timezone: "Etc/UTC" } }) };

function feed(limit = 4000) {
  const calls = [];
  return {
    calls,
    async resolveSymbol(ticker) { return { ticker }; },
    async getBars(info, resolution, params) {
      calls.push({ symbol: info.ticker, resolution, ...params });
      return { bars: rows(params.to, Math.min(limit, params.countBack), resolutionSec(resolution)) };
    },
  };
}

function reset() { bumpDataEpoch("resume-test"); clearAllHtfBars(); }

test("ten-minute recovery fetches 20 missing 30s candles plus overlap and three tiny HTF tails", async () => {
  reset();
  const datafeed = feed();
  const before = 14_100;
  const after = before + 600;
  const pane = { index: 0, symbol: "NQ", resolution: "30S", bars: rows(after, 3620, 30) };
  seedHtfBars("NQ", "30S", rows(before, 3600, 30), null, "datafeed");
  // The first live tick after foregrounding must not hide the missing interval.
  seedHtfBars("NQ", "30S", [bar(after)], null, "datafeed");
  for (const resolution of ["15", "60", "240"]) {
    const sec = resolutionSec(resolution);
    seedHtfBars("NQ", resolution, rows(Math.floor(before / sec) * sec - sec, 320, sec), null, "datafeed");
  }
  await Promise.all(["30S", "15", "60", "240"].map((resolution) => extendHtfCacheForAnchor({
    datafeed, symbolInfo: { ticker: "NQ" }, symbol: "NQ", resolution,
    pane, anchorSec: after, fromSec: before, requestReason: "htf.resume", refresh: true,
  })));
  assert.equal(datafeed.calls.length, 4);
  assert.deepEqual(datafeed.calls.map((call) => call.countBack), [21, 2, 2, 2]);
  assert.ok(datafeed.calls.every((call) => call.firstDataRequest === false));
  assert.ok(datafeed.calls.every((call) => call.refresh === true));
  const primary = getHtfBars("NQ", "30S").utcBars;
  assert.equal(primary.length, 3620);
  assert.equal(primary[0].time, before - 3599 * 30);
  assert.ok(primary.slice(1).every((next, index) => next.time - primary[index].time === 30));
});

test("1s recovery follows short 64-bar provider pages until all 600 missed seconds are recovered", async () => {
  reset();
  const datafeed = feed(64);
  const before = 10_000;
  const after = before + 600;
  seedHtfBars("ES", "1S", rows(before, 50, 1), null, "datafeed");
  seedHtfBars("ES", "1S", [bar(after)], null, "datafeed");
  await extendHtfCacheForAnchor({ datafeed, symbolInfo: { ticker: "ES" }, symbol: "ES", resolution: "1S", pane: { resolution: "1S" }, anchorSec: after, fromSec: before, refresh: true });
  assert.equal(datafeed.calls.length, 10);
  assert.ok(datafeed.calls.every((call) => call.refresh === true), "every older page must bypass completed and stale in-flight history caches");
  const recovered = getHtfBars("ES", "1S").utcBars;
  assert.equal(recovered.length, 650);
  assert.ok(recovered.slice(1).every((next, index) => next.time - recovered[index].time === 1));
});

test("forced recovery spans multiple 4000-bar pages even when the latest live tick is already cached", async () => {
  reset();
  const datafeed = feed();
  seedHtfBars("ES", "1S", rows(10_000, 50, 1), null, "datafeed");
  seedHtfBars("ES", "1S", [bar(15_000)], null, "datafeed");
  await extendHtfCacheForAnchor({ datafeed, symbolInfo: { ticker: "ES" }, symbol: "ES", resolution: "1S", pane: { resolution: "1S" }, anchorSec: 15_000, fromSec: 10_000 });
  assert.equal(datafeed.calls.length, 2);
  assert.equal(getHtfBars("ES", "1S").utcBars.length, 5050);
});

test("overlap recovery publishes corrected closed OHLC even when count and newest candle are unchanged", async () => {
  reset();
  const datafeed = feed();
  const cached = rows(13_500, 50, 900);
  cached[cached.length - 2] = bar(12_600, 9);
  seedHtfBars("ES", "15", cached, null, "datafeed");
  const previous = getHtfSeriesVersion("ES", "15");
  await extendHtfCacheForAnchor({ datafeed, symbolInfo: { ticker: "ES" }, symbol: "ES", resolution: "15", pane: { resolution: "30S" }, anchorSec: 14_700, fromSec: 12_600 });
  assert.equal(getHtfBars("ES", "15").utcBars.at(-2).close, 1);
  assert.ok(getHtfSeriesVersion("ES", "15") > previous);
});

test("a request from before suspension cannot overwrite repaired closed candles", async () => {
  reset();
  const datafeed = feed();
  const before = 14_100;
  const after = before + 600;
  seedHtfBars("ES", "30S", rows(before, 50, 30), null, "datafeed");
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const getBars = datafeed.getBars;
  datafeed.getBars = async (info, resolution, params) => {
    if (!params.firstDataRequest) return getBars(info, resolution, params);
    datafeed.calls.push({ symbol: info.ticker, resolution, ...params });
    await gate;
    return { bars: rows(params.to, params.countBack, 30).map((record) => ({ ...record, close: 9 })) };
  };
  const pane = { symbol: "ES", resolution: "30S", bars: [bar(before)] };
  const pending = ensureHtfBars({ datafeed, symbolInfo: { ticker: "ES" }, symbol: "ES", resolution: "30S", countBack: 320, pane });
  await Promise.resolve();
  const retained = getHtfBars("ES", "30S");
  invalidateHtfBarRequests("ES", "30S");
  assert.strictEqual(getHtfBars("ES", "30S"), retained, "request invalidation must retain history and its version");
  await extendHtfCacheForAnchor({ datafeed, symbolInfo: { ticker: "ES" }, symbol: "ES", resolution: "30S", pane, anchorSec: after, fromSec: before });
  release();
  await pending;
  assert.equal(datafeed.calls.length, 2);
  assert.equal(getHtfBars("ES", "30S").utcBars.find((record) => record.time === before).close, 1);
  assert.equal(getHtfBars("ES", "30S").utcBars.length, 70);
});

function recoveryLoaderFixture() {
  reset();
  const definition = registerIndicatorDefinition({
    id: "resume-test", title: "Resume test", overlay: true,
    collectDataNeeds: () => ({ htf: ["15", "60", "240"].map((resolution) => ({ symbol: "NQ", resolution, countBack: 320 })), compare: [{ symbol: "ES", chartCountBack: 3600 }] }),
  });
  const before = 14_100;
  const after = before + 600;
  const panes = ["NQ", "ES"].map((symbol, index) => ({ index, symbol, resolution: "30S", bars: rows(after, 3620, 30), symbolInfo: { ticker: symbol }, _historyGeneration: 0 }));
  for (const resolution of ["15", "60", "240"]) {
    const sec = resolutionSec(resolution);
    seedHtfBars("NQ", resolution, rows(Math.floor(before / sec) * sec - sec, 320, sec), null, "datafeed");
  }
  seedHtfBars("ES", "30S", rows(before, 3600, 30), null, "datafeed");
  seedHtfBars("ES", "30S", [bar(after)], null, "datafeed");
  const datafeed = feed();
  const invalidated = [];
  const refreshed = [];
  const loader = createIndicatorDataLoader({
    ctx: { datafeed, settingsStore, resolutions: [], opts: {}, getAllChartPanes: () => panes,
      ensureIndicatorChartHistory() { throw new Error("resume must not start full lookback history"); } },
    controller: { indicatorsForPane: (index) => [definition.createInstance(index)], invalidateOverlayCacheForPane: (index) => invalidated.push(index) },
    requestOverlayRefresh: (index) => refreshed.push(index),
  });
  const since = { version: 1, panes: panes.map((pane) => ({ index: pane.index, symbol: pane.symbol, resolution: pane.resolution, generation: 0, lastTime: before, fromTime: before - 30 })) };
  return { loader, panes, since, datafeed, invalidated, refreshed };
}

test("all panes share three HTF resume requests and borrow repaired visible compare history without refetching 3600 bars", async () => {
  const { loader, panes, since, datafeed, invalidated, refreshed } = recoveryLoaderFixture();
  const result = await loader.recoverIndicatorDataForPanes(panes, { since, refresh: false });
  assert.equal(datafeed.calls.length, 3);
  assert.deepEqual(datafeed.calls.map((call) => call.countBack), [2, 2, 2]);
  assert.ok(datafeed.calls.every((call) => call.requestReason === "htf.resume" && !call.firstDataRequest && call.refresh === true));
  assert.equal(getHtfBars("ES", "30S").utcBars.length, 3620);
  assert.equal(result.updatedSeries, 4);
  assert.deepEqual(result.failedSeries, []);
  assert.deepEqual(invalidated.sort(), [0, 1]);
  assert.deepEqual(refreshed, [], "the widget owns one final repaint after primary and indicator recovery");
});

test("an old generation checkpoint skips that pane while other matching panes recover", async () => {
  const { loader, panes, since, datafeed } = recoveryLoaderFixture();
  panes[0]._historyGeneration = 1;
  const result = await loader.recoverIndicatorDataForPanes(panes, { since });
  assert.equal(datafeed.calls.length, 3);
  assert.deepEqual(result.failedSeries, []);
});

test("failed HTF recovery reports the series while preserving successfully recovered dependencies", async () => {
  const { loader, panes, since, datafeed } = recoveryLoaderFixture();
  const getBars = datafeed.getBars;
  datafeed.getBars = async (info, resolution, params) => {
    if (resolution === "60") throw new Error("temporarily unavailable");
    return getBars(info, resolution, params);
  };
  const result = await loader.recoverIndicatorDataForPanes(panes, { since, refresh: false });
  assert.deepEqual(result.failedSeries, ["NQ|60"]);
  assert.equal(result.updatedSeries, 3);
  assert.equal(getHtfBars("ES", "30S").utcBars.length, 3620);
});

test("ordinary HTF tail updates remain cacheable", async () => {
  reset();
  const datafeed = feed();
  seedHtfBars("ES", "1S", rows(10_000, 50, 1), null, "datafeed");
  await extendHtfCacheForAnchor({ datafeed, symbolInfo: { ticker: "ES" }, symbol: "ES", resolution: "1S", pane: { resolution: "1S" }, anchorSec: 10_005 });
  assert.equal(datafeed.calls[0].refresh, undefined);
});

test("empty resumed history rejects without changing the retained cache", async () => {
  reset();
  seedHtfBars("ES", "1S", rows(10_000, 50, 1), null, "datafeed");
  const retained = getHtfBars("ES", "1S");
  await assert.rejects(extendHtfCacheForAnchor({
    datafeed: { async getBars() { return { bars: [], noData: true }; } }, symbolInfo: { ticker: "ES" },
    symbol: "ES", resolution: "1S", pane: { resolution: "1S" }, anchorSec: 10_600, fromSec: 10_000, refresh: true,
  }), /No candles returned/);
  assert.strictEqual(getHtfBars("ES", "1S"), retained);
});

test("a short resumed page followed by an empty older page rejects instead of publishing a partial gap", async () => {
  reset();
  const datafeed = feed(64);
  const getBars = datafeed.getBars;
  let page = 0;
  datafeed.getBars = async (info, resolution, params) => ++page === 1 ? getBars(info, resolution, params) : { bars: [], noData: true };
  seedHtfBars("ES", "1S", rows(10_000, 50, 1), null, "datafeed");
  const retained = getHtfBars("ES", "1S");
  await assert.rejects(extendHtfCacheForAnchor({ datafeed, symbolInfo: { ticker: "ES" }, symbol: "ES", resolution: "1S", pane: { resolution: "1S" }, anchorSec: 10_600, fromSec: 10_000, refresh: true }), /Incomplete candle interval/);
  assert.equal(page, 2);
  assert.strictEqual(getHtfBars("ES", "1S"), retained);
});

test("resumed history ending before the required latest candle rejects even when the head was returned", async () => {
  reset();
  const datafeed = { async getBars() { return { bars: rows(10_599, 600, 1) }; } };
  seedHtfBars("ES", "1S", rows(10_000, 50, 1), null, "datafeed");
  seedHtfBars("ES", "1S", [bar(10_600)], null, "datafeed");
  const retained = getHtfBars("ES", "1S");
  await assert.rejects(extendHtfCacheForAnchor({ datafeed, symbolInfo: { ticker: "ES" }, symbol: "ES", resolution: "1S", pane: { resolution: "1S" }, anchorSec: 10_600, fromSec: 10_000, refresh: true }), /Incomplete candle interval/);
  assert.strictEqual(getHtfBars("ES", "1S"), retained);
});

test("canceling resumed indicator recovery prevents late HTF publication", async () => {
  const { loader, panes, since, datafeed, invalidated } = recoveryLoaderFixture();
  const retained = ["15", "60", "240"].map((resolution) => getHtfBars("NQ", resolution));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const getBars = datafeed.getBars;
  datafeed.getBars = async (...args) => { await gate; return getBars(...args); };
  let active = true;
  const task = loader.recoverIndicatorDataForPanes(panes, { since, shouldContinue: () => active });
  active = false;
  release();
  await task;
  ["15", "60", "240"].forEach((resolution, index) => assert.strictEqual(getHtfBars("NQ", resolution), retained[index]));
  assert.deepEqual(invalidated, []);
});

test("unmounted panes cannot publish an old resumed indicator response", async () => {
  const { loader, panes, since, datafeed, invalidated } = recoveryLoaderFixture();
  const retained = ["15", "60", "240"].map((resolution) => getHtfBars("NQ", resolution));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const getBars = datafeed.getBars;
  datafeed.getBars = async (...args) => { await gate; return getBars(...args); };
  const task = loader.recoverIndicatorDataForPanes(panes, { since });
  panes.splice(0);
  release();
  await task;
  ["15", "60", "240"].forEach((resolution, index) => assert.strictEqual(getHtfBars("NQ", resolution), retained[index]));
  assert.deepEqual(invalidated, []);
});

test("CME 4h retained candles use their exchange bucket phase for freshness and indicator reads", async () => {
  reset();
  const day = Date.UTC(2026, 9, 27) / 1000;
  const sec = 4 * 3600;
  const closed = rows(day + 10 * 3600, 50, sec);
  seedHtfBars("NQ", "240", closed, null, "datafeed");
  const anchor = day + 17 * 3600;
  assert.equal(htfCacheStaleForAnchor("NQ", "240", anchor, { confirmedOnly: true }), false);
  const datafeed = feed();
  await extendHtfCacheForAnchor({ datafeed, symbolInfo: { ticker: "NQ" }, symbol: "NQ", resolution: "240", pane: { resolution: "30S" }, anchorSec: anchor });
  assert.equal(datafeed.calls.length, 0, "the nonexistent 12:00 UTC candle must not trigger repeated tail requests");
  let requested = 0;
  const result = resolveHtfSeries({
    primarySymbol: "NQ", chartResolution: "30S", symbolInfo: { session: "1800-1700", timezone: "America/New_York" },
    utcBars: [bar(anchor - 30), bar(anchor)],
    lookupSecurity: () => ({ utcBars: closed, chartBars: closed }),
    requestSecurityBars: () => { requested++; },
  }, "NQ", "240", 50);
  assert.equal(result.pending, false);
  assert.equal(requested, 0);
  assert.equal(result.utcBars.at(-1).time, day + 14 * 3600);
});

test("CME 4h resumed recovery validates actual 10:00/14:00 buckets instead of UTC 12:00/16:00 buckets", async () => {
  reset();
  const day = Date.UTC(2026, 9, 27) / 1000;
  const sec = 4 * 3600;
  seedHtfBars("NQ", "240", rows(day + 6 * 3600, 50, sec), null, "datafeed");
  const datafeed = feed();
  await extendHtfCacheForAnchor({
    datafeed, symbolInfo: { ticker: "NQ" }, symbol: "NQ", resolution: "240", pane: { resolution: "30S" },
    fromSec: day + 13 * 3600 + 55 * 60, anchorSec: day + 14 * 3600 + 5 * 60, refresh: true,
  });
  assert.equal(datafeed.calls.length, 1);
  assert.equal(datafeed.calls[0].to, day + 14 * 3600);
  assert.equal(datafeed.calls[0].from, day + 10 * 3600);
  assert.equal(datafeed.calls[0].countBack, 2);
  assert.equal(getHtfBars("NQ", "240").utcBars.at(-1).time, day + 10 * 3600);
  await extendHtfCacheForAnchor({
    datafeed, symbolInfo: { ticker: "NQ" }, symbol: "NQ", resolution: "240", pane: { resolution: "30S" },
    fromSec: day + 16 * 3600 + 50 * 60, anchorSec: day + 17 * 3600, refresh: true,
  });
  assert.equal(datafeed.calls.length, 1, "no new closed 4h bucket exists during the later ten-minute interval");
});

test("fresh weekend recovery accepts absent clock buckets and avoids repeated nonexistent 4h requests", async () => {
  reset();
  const friday = Date.UTC(2026, 9, 23) / 1000;
  const sunday = friday + 2 * 86400;
  const sec = 4 * 3600;
  const oldBars = rows(friday + 14 * 3600, 50, sec);
  const finalFriday = bar(friday + 18 * 3600, 3);
  const formingSunday = bar(sunday + 22 * 3600);
  const actual = [...oldBars, finalFriday, formingSunday];
  seedHtfBars("NQ", "240", oldBars, null, "datafeed");
  const calls = [];
  const datafeed = { async getBars(_info, _resolution, params) {
    calls.push(params);
    return { bars: actual.filter((record) => record.time <= params.to).slice(-params.countBack) };
  } };
  const anchor = sunday + 22 * 3600 + 15 * 60;
  await extendHtfCacheForAnchor({ datafeed, symbolInfo: { ticker: "NQ" }, symbol: "NQ", resolution: "240", pane: { resolution: "30S" }, anchorSec: anchor, fromSec: friday + 20 * 3600 + 55 * 60, refresh: true });
  const retained = getHtfBars("NQ", "240");
  assert.equal(retained.utcBars.length, 51);
  assert.equal(retained.utcBars.at(-1).time, finalFriday.time);
  assert.equal(retained.utcBars.at(-1).close, 3);
  assert.equal(htfCacheStaleForAnchor("NQ", "240", anchor + 30, { confirmedOnly: true }), false);
  await extendHtfCacheForAnchor({ datafeed, symbolInfo: { ticker: "NQ" }, symbol: "NQ", resolution: "240", pane: { resolution: "30S" }, anchorSec: anchor + 30 });
  assert.equal(calls.length, 1);
  const resolved = resolveHtfSeries({
    primarySymbol: "NQ", chartResolution: "30S", symbolInfo: { session: "1800-1700", timezone: "America/New_York" },
    utcBars: [bar(anchor - 30), bar(anchor)], lookupSecurity: () => ({ utcBars: retained.utcBars, chartBars: retained.chartBars }),
  }, "NQ", "240", 50);
  assert.equal(resolved.pending, false);
});
