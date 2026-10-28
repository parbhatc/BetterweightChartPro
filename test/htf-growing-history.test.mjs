import test from "node:test";
import assert from "node:assert/strict";
import {
  bumpDataEpoch, clearAllHtfBars, ensureHtfBars, getHtfBars,
  invalidateHtfBarRequests, seedHtfBars,
} from "../public/js/app/bar/htfBarCache.js";
import { getPaneChartView } from "../public/js/chart/pane/viewCache.js";

const bar = (time, close = 1) => ({ time, open: 1, high: 2, low: 0, close });
const rows = (to, count, sec = 30) => Array.from({ length: count }, (_, index) =>
  bar(to - (count - index - 1) * sec));
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  bumpDataEpoch("growing-history-test");
  clearAllHtfBars();
  const calls = [];
  const pane = { index: 0, symbol: "NQ", resolution: "30S", bars: [bar(18_000_000)] };
  const datafeed = { async getBars(_info, resolution, params) {
    calls.push({ resolution, ...params });
    return { bars: rows(params.to, params.countBack, resolution === "30S" ? 30 : Number(resolution) * 60) };
  } };
  const opts = { datafeed, symbolInfo: { ticker: "ES" }, symbol: "ES", resolution: "30S", countBack: 500, pane };
  return { calls, pane, opts };
}

test("500 to 1000 to 1500 growing compare needs fetch disjoint older windows instead of repeating latest history", async () => {
  const { calls, opts } = fixture();
  const first = await ensureHtfBars(opts);
  const originalTail = first.utcBars.slice();
  for (const countBack of [1000, 1500, 1878, 2378]) {
    const entry = await ensureHtfBars({ ...opts, countBack });
    assert.equal(entry.utcBars.length, countBack);
    assert.ok(entry.utcBars.slice(1).every((next, index) => next.time - entry.utcBars[index].time === 30));
  }
  assert.deepEqual(calls.map((call) => call.countBack), [500, 500, 500, 378, 500]);
  assert.deepEqual(calls.map((call) => call.requestReason), ["htf.initial", "htf.prepend", "htf.prepend", "htf.prepend", "htf.prepend"]);
  assert.equal(calls.reduce((sum, call) => sum + call.countBack, 0), 2378);
  for (let index = 1; index < calls.length; index++) {
    assert.ok(calls[index].to < calls[index - 1].from, "a larger need must not redownload any previous request window");
    assert.equal(calls[index].firstDataRequest, false);
  }
  const final = getHtfBars("ES", "30S");
  assert.deepEqual(final.utcBars.slice(-500), originalTail);
  assert.equal(final.utcBars.at(-1), originalTail.at(-1), "older growth cannot replace the current candle");
  await ensureHtfBars({ ...opts, countBack: 2378 });
  assert.equal(calls.length, 5);
});

test("growing confirmed HTF depth prepends native closed candles without a forming bucket or new initial window", async () => {
  const { calls, opts } = fixture();
  const htf = { ...opts, resolution: "15", pane: { ...opts.pane, resolution: "1" } };
  const initial = await ensureHtfBars(htf);
  assert.equal(initial.utcBars.length, 500);
  const tail = initial.utcBars.at(-1);
  const grown = await ensureHtfBars({ ...htf, countBack: 1500 });
  assert.equal(grown.utcBars.length, 1500);
  assert.deepEqual(calls.map((call) => call.countBack), [501, 500, 500]);
  assert.equal(calls.filter((call) => call.requestReason === "htf.initial").length, 1);
  assert.ok(grown.utcBars.every((record) => record.time + 900 <= opts.pane.bars.at(-1).time));
  assert.equal(grown.utcBars.at(-1), tail);
  for (let index = 1; index < calls.length; index++) assert.ok(calls[index].to < calls[index - 1].from);
});

test("a larger need first repairs an advanced live tail and then downloads only the missing older depth", async () => {
  const { calls, pane, opts } = fixture();
  await ensureHtfBars(opts);
  pane.bars.push(bar(18_000_030));
  const grown = await ensureHtfBars({ ...opts, countBack: 1000 });
  assert.equal(grown.utcBars.length, 1000);
  assert.equal(grown.utcBars.at(-1).time, 18_000_030);
  assert.deepEqual(calls.map((call) => call.requestReason), ["htf.initial", "htf.tail", "htf.prepend"]);
  assert.equal(calls[2].countBack, 499);
  assert.ok(calls[2].to < calls[0].from);
});

test("a concurrent live candle survives an older-depth request", async () => {
  const { calls, opts } = fixture();
  await ensureHtfBars(opts);
  const gate = deferred();
  const growing = ensureHtfBars({ ...opts, countBack: 1000, datafeed: {
    async getBars(_info, _resolution, params) {
      calls.push(params);
      await gate.promise;
      return { bars: rows(params.to, params.countBack) };
    },
  } });
  await flush();
  const live = bar(18_000_030, 5);
  seedHtfBars("ES", "30S", [live], null, "datafeed");
  gate.resolve();
  const entry = await growing;
  assert.equal(entry.utcBars.length, 1001);
  assert.equal(entry.utcBars.at(-1), live);
  assert.equal(calls.at(-1).requestReason, "htf.prepend");
});

test("growing depth borrows a peer pane before requesting only the remaining older candles", async () => {
  const { calls, opts } = fixture();
  await ensureHtfBars(opts);
  const peer = { index: 1, symbol: "ES", resolution: "30S", bars: rows(18_000_000, 700) };
  const settingsStore = { get: () => ({ symbol: { timezone: "Etc/UTC" } }) };
  const peerView = getPaneChartView(peer, settingsStore, null, []);
  // Preserve paired records supplied by a view, even if a host still applies
  // its own chart-time projection instead of the engine's current UTC view.
  peerView.chartBars = peerView.utcBars.map((record) => ({ ...record, time: record.time + 3600 }));
  const entry = await ensureHtfBars({ ...opts, countBack: 1000,
    getAllChartPanes: () => [opts.pane, peer],
    settingsStore,
  });
  assert.equal(entry.utcBars.length, 1000);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].countBack, 300);
  assert.ok(calls[1].to < peer.bars[0].time);
  assert.equal(entry.chartBars.at(-1), peerView.chartBars.at(-1));
});

test("short older pages across market gaps continue from their actual oldest candle and only empty pages exhaust history", async () => {
  const { calls, opts } = fixture();
  await ensureHtfBars(opts);
  const head = getHtfBars("ES", "30S").utcBars[0].time;
  let page = 0;
  const entry = await ensureHtfBars({ ...opts, countBack: 1000, datafeed: {
    async getBars(_info, _resolution, params) {
      calls.push(params);
      page += 1;
      return { bars: page === 1 ? rows(params.to - 2 * 86_400, 100) : [], noData: page > 1 };
    },
  } });
  assert.equal(entry.utcBars.length, 600);
  assert.equal(entry.historyExhausted, true);
  assert.equal(calls[1].to, head - 30);
  assert.equal(calls[2].to, entry.utcBars[0].time - 30);
  assert.equal(calls[2].countBack, 400);
  assert.ok(entry.utcBars.slice(100).every((record, index) => record.time === head + index * 30));
  await ensureHtfBars({ ...opts, countBack: 1500 });
  assert.equal(calls.length, 3, "confirmed exhaustion suppresses repeated latest-history requests");
});

test("replay retains its anchor-depth policy and never fetches future buckets while indicator needs grow", async () => {
  const { calls, opts } = fixture();
  const replay = { ...opts, resolution: "15", pane: { ...opts.pane, resolution: "1" }, playbackAnchorSec: 18_000_060 };
  const entry = await ensureHtfBars(replay);
  const grown = await ensureHtfBars({ ...replay, countBack: 1500 });
  assert.equal(grown, entry);
  assert.equal(calls.length, 1);
  assert.ok(entry.utcBars.every((record) => record.time + 900 <= replay.playbackAnchorSec));
  bumpDataEpoch("replay-rewind");
  const earlierAnchor = 17_991_060;
  const rewound = await ensureHtfBars({ ...replay, playbackAnchorSec: earlierAnchor });
  assert.equal(calls.length, 2);
  assert.ok(rewound.utcBars.every((record) => record.time + 900 <= earlierAnchor));
});

for (const [reason, invalidate] of [
  ["data epoch", () => bumpDataEpoch("timeframe-changed", { preserveStore: true })],
  ["request generation", () => invalidateHtfBarRequests("ES", "30S")],
]) {
  test(`a ${reason} change discards late older-depth results`, async () => {
    const { opts } = fixture();
    const first = await ensureHtfBars(opts);
    const gate = deferred();
    const pending = ensureHtfBars({ ...opts, countBack: 1000, datafeed: {
      async getBars(_info, _resolution, params) {
        await gate.promise;
        return { bars: rows(params.to, params.countBack) };
      },
    } });
    await flush();
    invalidate();
    gate.resolve();
    await pending;
    assert.equal(getHtfBars("ES", "30S").utcBars.length, 500);
    assert.equal(getHtfBars("ES", "30S").utcBars[0], first.utcBars[0]);
  });
}

test("an older-depth timeout releases the flight and ignores its late response before a successful retry", async (t) => {
  const { opts } = fixture();
  await ensureHtfBars(opts);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const gate = deferred();
  const pending = ensureHtfBars({ ...opts, countBack: 1000, datafeed: {
    async getBars(_info, _resolution, params) {
      await gate.promise;
      return { bars: rows(params.to, params.countBack) };
    },
  } });
  const rejected = assert.rejects(pending, /timed out/);
  await flush();
  t.mock.timers.tick(20_000);
  await rejected;
  gate.resolve();
  await flush();
  assert.equal(getHtfBars("ES", "30S").utcBars.length, 500);
  const retried = await ensureHtfBars({ ...opts, countBack: 1000 });
  assert.equal(retried.utcBars.length, 1000);
});
