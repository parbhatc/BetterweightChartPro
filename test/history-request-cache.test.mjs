import test from "node:test";
import assert from "node:assert/strict";
import { createHistoryRequestCache, resolveDatafeed } from "../public/js/datafeed/index.js";

const info = { ticker: "CME_MINI:ES1!", broker_symbol: "ES", session: "24x7" };
const bars = Array.from({ length: 20 }, (_, i) => ({
  time: (i + 1) * 60, open: i, high: i + 1, low: i - 1, close: i + 0.5,
}));
const period = { from: 60, to: 1200, countBack: 20, firstDataRequest: false };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(options = {}) {
  let calls = 0;
  const source = {
    getBars(_info, _resolution, params) {
      calls += 1;
      let result = bars.filter((bar) => bar.time >= params.from && bar.time <= params.to);
      if (params.countBack) result = result.slice(-params.countBack);
      return Promise.resolve({ bars: result });
    },
  };
  return { source, feed: createHistoryRequestCache(source, options), calls: () => calls };
}

test("a 12-consumer history burst sends one upstream request and copies each result", async () => {
  const pending = deferred();
  let calls = 0;
  const source = { getBars() { calls += 1; return pending.promise; } };
  const feed = resolveDatafeed({ datafeed: source });
  const requests = Array.from({ length: 12 }, () => feed.getBars(info, "1", period));
  await Promise.resolve();
  assert.equal(calls, 1, "before the broker the same burst called the source 12 times");
  pending.resolve({ bars, meta: { noData: false } });
  const results = await Promise.all(requests);
  results[0].bars[0].close = 999;
  results[0].bars.push({ ...bars[0] });
  results[0].meta.noData = true;
  assert.equal(results[1].bars[0].close, 0.5);
  assert.equal(results[1].bars.length, 20);
  assert.equal(results[1].meta.noData, false);
  const cached = await feed.getBars(info, "1", period);
  assert.equal(cached.bars[0].close, 0.5);
  assert.equal(calls, 1);
  assert.deepEqual(feed.historyCache.stats(), {
    requests: 13, upstreamRequests: 1, cacheHits: 1, coveringHits: 0,
    inflightJoins: 11, invalidations: 0, entries: 1, cachedBars: 20, pending: 0,
  });
});

test("a larger response serves overlapping smaller windows with exact bounds", async () => {
  const { feed, calls } = fixture();
  await feed.getBars(info, "1", period);
  const result = await feed.getBars(info, "1", { ...period, from: 600, to: 1080, countBack: 3 });
  assert.deepEqual(result.bars.map((bar) => bar.time), [960, 1020, 1080]);
  assert.equal(calls(), 1);
  assert.equal(feed.historyCache.stats().coveringHits, 1);
  assert.equal(result.noData, false);
});

test("overlapping requests join a larger pending request only after proving actual coverage", async () => {
  const pending = deferred();
  let calls = 0;
  const feed = createHistoryRequestCache({ getBars() { calls += 1; return pending.promise; } });
  const large = feed.getBars(info, "1", period);
  const small = feed.getBars(info, "1", { ...period, from: 900, countBack: 4 });
  pending.resolve({ bars });
  assert.equal((await large).bars.length, 20);
  assert.equal((await small).bars.length, 4);
  assert.equal(calls, 1);
  assert.equal(feed.historyCache.stats().inflightJoins, 1);
});

test("session gaps and short responses cannot suppress a required countBack request", async () => {
  let calls = 0;
  const feed = createHistoryRequestCache({
    getBars() {
      calls += 1;
      return { bars: calls === 1 ? [bars[0], bars[19]] : bars.slice(-4) };
    },
  });
  await feed.getBars(info, "1", period);
  const result = await feed.getBars(info, "1", { ...period, from: 900, countBack: 4 });
  assert.equal(calls, 2);
  assert.equal(result.bars.length, 4);
});

test("older page cursors, larger depth, symbol sessions and host period flags stay isolated", async () => {
  const { feed, calls } = fixture();
  await feed.getBars(info, "1", { ...period, from: 660, countBack: 10 });
  await feed.getBars(info, "1", period);
  await feed.getBars(info, "1", { ...period, to: 0, from: -600 });
  await feed.getBars({ ...info, broker_symbol: "MES" }, "1", period);
  await feed.getBars({ ...info, session: "0930-1600" }, "1", period);
  await feed.getBars(info, "5", period);
  await feed.getBars(info, "1", { ...period, firstDataRequest: true });
  await feed.getBars(info, "1", { ...period, replayCursor: 600 });
  assert.equal(calls(), 8);
});

test("diagnostic request reasons do not defeat chart and indicator sharing", async () => {
  const { feed, calls } = fixture();
  const [chart, indicator] = await Promise.all([
    feed.getBars(info, "1", { ...period, requestReason: "chart.history" }),
    feed.getBars(info, "1", { ...period, requestReason: "htf.prepend" }),
  ]);
  assert.equal(chart.bars.length, indicator.bars.length);
  assert.equal(calls(), 1);
  await feed.getBars(info, "1", { ...period, requestReason: "compare.history" });
  assert.equal(calls(), 1);
});

test("refresh bypasses settled exact and covering responses and forwards its flag", async () => {
  let calls = 0;
  const forwarded = [];
  const feed = createHistoryRequestCache({
    getBars(_info, _resolution, params) {
      forwarded.push(params);
      calls += 1;
      return { bars: bars.map((bar) => ({ ...bar, close: calls })) };
    },
  });
  await feed.getBars(info, "1", period);
  const fresh = await feed.getBars(info, "1", { ...period, refresh: true });
  assert.equal(fresh.bars[0].close, 2);
  const smaller = await feed.getBars(info, "1", { ...period, from: 900, countBack: 3, refresh: true });
  assert.equal(smaller.bars[0].close, 3);
  const repeated = await feed.getBars(info, "1", { ...period, refresh: true });
  assert.equal(repeated.bars[0].close, 4);
  assert.equal(calls, 4);
  assert.equal(forwarded[1].refresh, true);
  assert.equal(feed.historyCache.stats().cacheHits, 0);
});

test("refresh detaches older overlapping work while concurrent refreshes share a fresh call", async () => {
  const old = deferred();
  const fresh = deferred();
  let calls = 0;
  const feed = createHistoryRequestCache({
    getBars() {
      calls += 1;
      if (calls === 1) return old.promise;
      if (calls === 2) return fresh.promise;
      return { bars: [{ ...bars[19], close: 9 }] };
    },
  });
  const stale = feed.getBars(info, "1", period);
  await Promise.resolve();
  const resumed = feed.getBars(info, "1", { ...period, refresh: true });
  const joined = feed.getBars(info, "1", { ...period, refresh: true, requestReason: "chart.resume" });
  await Promise.resolve();
  assert.equal(calls, 2);
  fresh.resolve({ bars: [{ ...bars[19], close: 9 }] });
  assert.equal((await resumed).bars[0].close, 9);
  assert.equal((await joined).bars[0].close, 9);
  old.resolve({ bars: [{ ...bars[19], close: 1 }] });
  await stale;
  assert.equal((await feed.getBars(info, "1", period)).bars[0].close, 9);
  assert.equal(calls, 3, "the old completion must not repopulate settled cache");
  assert.equal(feed.historyCache.stats().inflightJoins, 1);
});

test("optional diagnostics publish numeric counters on changes without exposing source metadata", async () => {
  const snapshots = [];
  const { feed } = fixture({ onStatsChange: (stats) => snapshots.push(stats) });
  await feed.getBars(info, "1", period);
  await feed.getBars(info, "1", period);
  const last = snapshots.at(-1);
  assert.equal(last.requests, 2);
  assert.equal(last.upstreamRequests, 1);
  assert.equal(last.cacheHits, 1);
  assert.equal(last.pending, 0);
  assert.ok(Object.values(last).every((value) => typeof value === "number"));
  const throwing = fixture({ onStatsChange: () => { throw new Error("diagnostic failure"); } });
  assert.equal((await throwing.feed.getBars(info, "1", period)).bars.length, 20);
});

test("stats subscriptions publish immediately, survive listener errors and stop on unsubscribe/dispose", async () => {
  const { feed } = fixture();
  const snapshots = [];
  const stop = feed.historyCache.subscribe((stats) => snapshots.push(stats));
  feed.historyCache.subscribe(() => { throw new Error("listener failure"); });
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].requests, 0);
  await feed.getBars(info, "1", period);
  assert.equal(snapshots.at(-1).pending, 0);
  assert.equal(snapshots.at(-1).upstreamRequests, 1);
  assert.equal(snapshots.at(-1).entries, 1);
  feed.historyCache.clear();
  assert.equal(snapshots.at(-1).entries, 0);
  stop();
  const stoppedCount = snapshots.length;
  await feed.getBars(info, "1", period);
  assert.equal(snapshots.length, stoppedCount);
  const disposed = [];
  feed.historyCache.subscribe((stats) => disposed.push(stats));
  feed.historyCache.dispose();
  assert.equal(disposed.at(-1).entries, 0);
  const disposedCount = disposed.length;
  await feed.getBars(info, "1", period);
  assert.equal(disposed.length, disposedCount);
});

test("widgets, source accounts and replay adapters never share history responses", async () => {
  let calls = 0;
  const source = Object.freeze({
    getBars() { calls += 1; return { bars }; },
    get label() { return "source"; },
  });
  const live = resolveDatafeed({ datafeed: source });
  const replay = resolveDatafeed({ datafeed: source });
  const anotherAccount = resolveDatafeed({ datafeed: { getBars() { calls += 1; return { bars }; } } });
  assert.notEqual(live, source);
  assert.equal(live.label, "source");
  await live.getBars(info, "1", period);
  await replay.getBars(info, "1", period);
  await anotherAccount.getBars(info, "1", period);
  assert.equal(calls, 3);
  assert.equal(resolveDatafeed({ datafeed: source, historyCache: false }), source);
  const original = source.getBars;
  live.getBars = async () => ({ bars: [] });
  assert.equal(source.getBars, original, "debug wrappers do not mutate the shared source");
  assert.equal((await replay.getBars(info, "1", period)).bars.length, 20);
});

test("clear detaches stale inflight work and allows reconnect to refetch immediately", async () => {
  const old = deferred();
  const fresh = deferred();
  let calls = 0;
  const feed = createHistoryRequestCache({ getBars() { return ++calls === 1 ? old.promise : fresh.promise; } });
  const stale = feed.getBars(info, "1", period);
  await Promise.resolve();
  feed.historyCache.clear();
  const reconnected = feed.getBars(info, "1", period);
  await Promise.resolve();
  assert.equal(calls, 2);
  fresh.resolve({ bars: [{ ...bars[19], close: 123 }] });
  await reconnected;
  old.resolve({ bars });
  await stale;
  const result = await feed.getBars(info, "1", period);
  assert.equal(result.bars.length, 1);
  assert.equal(result.bars[0].close, 123);
  assert.equal(calls, 2, "old completion cannot overwrite the reconnect result");
});

test("live ticks invalidate current candles while preserving historical pages", async () => {
  let tick;
  let calls = 0;
  const source = {
    getBars() { calls += 1; return { bars }; },
    subscribeBars(_info, _resolution, callback) { tick = callback; },
  };
  const feed = createHistoryRequestCache(source);
  let delivered;
  feed.subscribeBars(info, "1", (bar) => { delivered = bar; }, "pane-0");
  const historical = { ...period, to: 600 };
  await feed.getBars(info, "1", historical);
  await feed.getBars(info, "1", period);
  tick({ ...bars[19], close: 456 });
  assert.equal(delivered.close, 456);
  await feed.getBars(info, "1", historical);
  assert.equal(calls, 2);
  await feed.getBars(info, "1", period);
  assert.equal(calls, 3);
});

test("a timed-out consumer's retry starts fresh instead of rejoining hung source work", async () => {
  const old = deferred();
  let time = 0;
  let calls = 0;
  const feed = createHistoryRequestCache({
    getBars() {
      calls += 1;
      return calls === 1 ? old.promise : { bars: [bars[19]] };
    },
  }, { pendingTtlMs: 20_000, now: () => time });
  const stale = feed.getBars(info, "1", period);
  await Promise.resolve();
  time = 20_000;
  assert.equal((await feed.getBars(info, "1", period)).bars.length, 1);
  assert.equal(calls, 2);
  old.resolve({ bars });
  await stale;
  assert.equal((await feed.getBars(info, "1", period)).bars.length, 1);
  assert.equal(calls, 2);
});

test("expiry, rejected requests, and empty responses remain retryable", async () => {
  let time = 0;
  const { feed, calls } = fixture({ ttlMs: 10, now: () => time });
  await feed.getBars(info, "1", period);
  time = 9;
  await feed.getBars(info, "1", period);
  assert.equal(calls(), 1);
  time = 10;
  await feed.getBars(info, "1", period);
  assert.equal(calls(), 2);
  let tries = 0;
  const transient = createHistoryRequestCache({
    getBars() {
      tries += 1;
      if (tries === 1) throw new Error("offline");
      return { bars: [], noData: true };
    },
  });
  await assert.rejects(transient.getBars(info, "1", period), /offline/);
  await transient.getBars(info, "1", period);
  await transient.getBars(info, "1", period);
  assert.equal(tries, 3);
});

test("cache bounds, static updates, source method receivers and disposal are respected", async () => {
  const { feed } = fixture({ maxEntries: 2, maxBars: 30 });
  await feed.getBars(info, "1", period);
  await feed.getBars(info, "5", period);
  assert.equal(feed.historyCache.stats().cachedBars, 20);
  assert.equal(feed.historyCache.stats().entries, 1);
  class Source {
    #rows = bars;
    getBars() { return { bars: this.#rows }; }
    setBars(_symbol, rows) { this.#rows = rows; }
  }
  const original = new Source();
  const receiverSafe = createHistoryRequestCache(original);
  await receiverSafe.getBars(info, "1", period);
  receiverSafe.setBars("ES", [bars[0]]);
  assert.equal((await receiverSafe.getBars(info, "1", period)).bars.length, 1);
  receiverSafe.historyCache.dispose();
  assert.equal(receiverSafe.historyCache.stats().entries, 0);
  assert.equal(receiverSafe.historyCache.stats().pending, 0);
  assert.equal((await receiverSafe.getBars(info, "1", period)).bars.length, 0);
  assert.equal((await original.getBars()).bars.length, 1, "disposal does not destroy the account source");
});
