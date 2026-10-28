import test from "node:test";
import assert from "node:assert/strict";
import {
  clearResolutionCache,
  getResolutionCacheBars,
  publishResolutionCache,
  stashPaneResolutionCache,
  tryRestorePaneResolutionCache,
  RESOLUTION_CACHE_TTL_MS,
  RESOLUTION_CACHE_MAX_SERIES_PER_SCOPE,
  RESOLUTION_CACHE_MAX_BARS_PER_SCOPE,
  RESOLUTION_CACHE_MAX_SERIES,
} from "../public/js/app/bar/resolutionCache.js";

const pane = (symbol, bars = [{ time: 100, close: 1 }]) => ({ symbol, resolution: "1", bars });

test("timeframe snapshots survive ordinary 30-second round trips but expire after retention", (t) => {
  t.after(clearResolutionCache);
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  const scope = {};
  stashPaneResolutionCache(pane("NQ"), "1", scope);
  now += 60_000;
  assert.equal(tryRestorePaneResolutionCache(pane("NQ", []), scope), true);
  now += RESOLUTION_CACHE_TTL_MS;
  assert.equal(tryRestorePaneResolutionCache(pane("NQ", []), scope), false);
});

test("per-widget LRU retains recently used intervals within a fixed series count", (t) => {
  t.after(clearResolutionCache);
  const scope = {};
  for (let index = 0; index < RESOLUTION_CACHE_MAX_SERIES_PER_SCOPE; index += 1) {
    publishResolutionCache(pane(`S${index}`), scope);
  }
  assert.ok(getResolutionCacheBars("S0", "1", scope));
  publishResolutionCache(pane("next"), scope);
  assert.equal(getResolutionCacheBars("S1", "1", scope), null);
  assert.ok(getResolutionCacheBars("S0", "1", scope));
});

test("retained candle count evicts whole old snapshots rather than silently truncating scrollback", (t) => {
  t.after(clearResolutionCache);
  const scope = {};
  const bars = Array.from({ length: Math.ceil(RESOLUTION_CACHE_MAX_BARS_PER_SCOPE / 2) + 1 }, (_, time) => ({ time }));
  publishResolutionCache(pane("first", bars), scope);
  publishResolutionCache(pane("second", bars), scope);
  assert.equal(getResolutionCacheBars("first", "1", scope), null);
  assert.equal(getResolutionCacheBars("second", "1", scope).length, bars.length);
});

test("widgets and feeds cannot reuse one another's identically named snapshots", (t) => {
  t.after(clearResolutionCache);
  const firstFeed = {};
  const secondFeed = {};
  publishResolutionCache(pane("NQ", [{ time: 100, close: 10 }]), firstFeed);
  publishResolutionCache(pane("NQ", [{ time: 100, close: 20 }]), secondFeed);
  assert.equal(getResolutionCacheBars("NQ", "1", firstFeed)[0].close, 10);
  assert.equal(getResolutionCacheBars("NQ", "1", secondFeed)[0].close, 20);
});

test("global capacity also bounds caches belonging to abandoned widgets", (t) => {
  t.after(clearResolutionCache);
  const scopes = Array.from({ length: RESOLUTION_CACHE_MAX_SERIES + 1 }, () => ({}));
  for (const scope of scopes) publishResolutionCache(pane("NQ"), scope);
  assert.equal(getResolutionCacheBars("NQ", "1", scopes[0]), null);
  assert.ok(getResolutionCacheBars("NQ", "1", scopes.at(-1)));
});

test("a short peer pane publishes fresh tail candles without discarding retained old history", (t) => {
  t.after(clearResolutionCache);
  const scope = {};
  const original = [100, 160, 220].map((time) => ({ time, close: 1 }));
  publishResolutionCache(pane("NQ", original), scope);
  publishResolutionCache(pane("NQ", [{ time: 220, close: 9 }, { time: 280, close: 10 }]), scope);
  const bars = getResolutionCacheBars("NQ", "1", scope);
  assert.deepEqual(bars.map(({ time }) => time), [100, 160, 220, 280]);
  assert.equal(bars[0], original[0]);
  assert.equal(bars[2].close, 9);
});
