import test from "node:test";
import assert from "node:assert/strict";
import { createLiveHistoryRecovery } from "../public/js/app/bar/liveRecovery.js";

function fixture({ resolutions = ["1S"], getBars, replay = false } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const requests = [];
  const views = [];
  const restores = [];
  const panes = resolutions.map((resolution, index) => {
    const sec = resolution.endsWith("S") ? Number(resolution.slice(0, -1)) : Number(resolution) * 60;
    const tail = Math.floor((now - 600) / sec) * sec;
    const pane = {
      index, symbol: index ? "ES" : "NQ", resolution, symbolInfo: { ticker: index ? "ES" : "NQ" },
      bars: Array.from({ length: 100 }, (_, offset) => ({ time: tail - (99 - offset) * sec, close: 1 })),
      chart: { timeScale: () => ({ getVisibleLogicalRange: () => ({ from: 70, to: 110 }), setVisibleLogicalRange: (range) => restores.push({ index, range }) }) },
    };
    pane._barSeriesIdentity = { symbol: pane.symbol, resolution };
    return pane;
  });
  const loader = createLiveHistoryRecovery({
    getAllChartPanes: () => panes,
    getBarSecForPane: (pane) => pane.resolution.endsWith("S") ? Number(pane.resolution.slice(0, -1)) : Number(pane.resolution) * 60,
    isReplayLocked: () => replay,
    refreshPaneCandleData: (pane) => views.push(pane.index),
    datafeed: {
      async getBars(info, resolution, params) {
        requests.push({ symbol: info.ticker, resolution, ...params });
        if (getBars) return getBars(info, resolution, params, requests.length);
        const sec = resolution.endsWith("S") ? Number(resolution.slice(0, -1)) : Number(resolution) * 60;
        return { bars: Array.from({ length: params.countBack }, (_, index) => ({ time: params.to - (params.countBack - index - 1) * sec, close: 9 })) };
      },
    },
  });
  return { loader, panes, requests, views, restores, now };
}

test("ten-minute recovery pages the complete 1-second gap from the saved candle despite a newer live tail", async () => {
  const { loader, panes: [pane], requests, views, restores, now } = fixture();
  const snapshot = loader.captureResumeState();
  const first = pane.bars[0].time;
  const oldTail = pane.bars.at(-1).time;
  pane.bars.push({ time: now, close: 77 });
  const result = await loader.recoverLiveHistory({ since: snapshot });
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.refresh && request.requestReason === "chart.resume-gap" && request.countBack <= 500));
  assert.equal(pane.bars[0].time, first);
  assert.equal(pane.bars.find((bar) => bar.time === oldTail).close, 9);
  assert.ok(pane.bars.every((bar, index) => index === 0 || bar.time - pane.bars[index - 1].time === 1));
  assert.ok(result.panes[0].added >= 599);
  assert.deepEqual(views, [0]);
  assert.deepEqual(restores.at(-1).range, { from: 70, to: 110 });
});

test("every pane recovers its own interval while retaining the original history head", async () => {
  const { loader, panes, requests } = fixture({ resolutions: ["1S", "30S", "1"] });
  const snapshot = loader.captureResumeState();
  const heads = panes.map((pane) => pane.bars[0].time);
  await loader.recoverLiveHistory({ since: snapshot });
  assert.deepEqual(panes.map((pane) => pane.bars[0].time), heads);
  assert.deepEqual([...new Set(requests.map((request) => request.resolution))].sort(), ["1", "1S", "30S"]);
  assert.ok(requests.filter((request) => request.resolution === "30S")[0].countBack < 30);
});

test("a failed page rejects without discarding the old series and the same saved anchor can retry", async () => {
  let fail = true;
  const { loader, panes: [pane] } = fixture({ async getBars(_info, _resolution, params, count) {
    if (count === 2 && fail) throw new Error("offline");
    return { bars: Array.from({ length: params.countBack }, (_, index) => ({ time: params.to - (params.countBack - index - 1), close: 9 })) };
  } });
  const snapshot = loader.captureResumeState();
  const original = pane.bars.slice();
  await assert.rejects(loader.recoverLiveHistory({ since: snapshot }), /offline/);
  assert.deepEqual(pane.bars, original);
  fail = false;
  await loader.recoverLiveHistory({ since: snapshot });
  assert.ok(pane.bars.length > original.length + 590);
});

test("canceling recovery cannot mutate a replacement timeframe", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let active = true;
  const { loader, panes: [pane] } = fixture({ async getBars(_info, _resolution, params) {
    await gate;
    return { bars: [{ time: params.to, close: 9 }] };
  } });
  const snapshot = loader.captureResumeState();
  const recovery = loader.recoverLiveHistory({ since: snapshot, shouldContinue: () => active });
  pane.resolution = "5";
  pane.bars = [{ time: 123, close: 77 }];
  pane._barSeriesIdentity = { symbol: pane.symbol, resolution: "5" };
  active = false;
  release();
  await assert.rejects(recovery, { name: "AbortError" });
  assert.deepEqual(pane.bars, [{ time: 123, close: 77 }]);
});

test("recovery keeps host live values that change after the request started", async () => {
  let pane;
  const data = fixture({ resolutions: ["30S"], async getBars(_info, _resolution, params) {
    const last = pane.bars.at(-1);
    pane.bars[pane.bars.length - 1] = { ...last, close: 99 };
    return { bars: Array.from({ length: params.countBack }, (_, index) => ({ time: params.to - (params.countBack - index - 1) * 30, close: 9 })) };
  } });
  pane = data.panes[0];
  const savedTime = pane.bars.at(-1).time;
  await data.loader.recoverLiveHistory({ since: data.loader.captureResumeState() });
  assert.equal(pane.bars.find((bar) => bar.time === savedTime).close, 99);
});

test("replay and snapshots from a different widget never recover a live timeline", async () => {
  const replay = fixture({ replay: true });
  assert.deepEqual((await replay.loader.recoverLiveHistory({ since: replay.loader.captureResumeState() })).panes, []);
  assert.equal(replay.requests.length, 0);
  const first = fixture();
  const second = fixture();
  await assert.rejects(second.loader.recoverLiveHistory({ since: first.loader.captureResumeState() }), /different chart widget/);
});

function captureBeforeSuspension(loader, now) {
  const originalNow = Date.now;
  Date.now = () => (now - 600) * 1000;
  try { return loader.captureResumeState(); }
  finally { Date.now = originalNow; }
}

test("a timeframe loaded while hidden recovers from capture time even after its latest tick jumps", async () => {
  const { loader, panes, requests, now } = fixture({ resolutions: ["1S", "30S"] });
  const snapshot = captureBeforeSuspension(loader, now);
  const tail = Math.floor((now - 600) / 60) * 60;
  panes[0].resolution = "1";
  panes[0]._historyGeneration = 1;
  panes[0]._barSeriesIdentity = { symbol: panes[0].symbol, resolution: "1" };
  panes[0].bars = Array.from({ length: 20 }, (_, index) => ({ time: tail - (19 - index) * 60, close: 1 }));
  const originalHead = panes[0].bars[0].time;
  panes[0].bars.push({ time: Math.floor(now / 60) * 60, close: 77 });
  const result = await loader.recoverLiveHistory({ since: snapshot });
  assert.deepEqual(result.panes.map((pane) => pane.index), [0, 1]);
  assert.equal(panes[0].bars[0].time, originalHead);
  assert.ok(panes[0].bars.every((bar, index) => index === 0 || bar.time - panes[0].bars[index - 1].time === 60));
  const request = requests.find((item) => item.resolution === "1");
  assert.ok(request.countBack >= 12 && request.countBack < 20);
  const normalized = result.recoverySince.panes.find((pane) => pane.index === 0);
  assert.equal(normalized.generation, 1);
  assert.equal(normalized.fromTime, tail - 60);
});

test("a pane unready at capture uses the capture clock after it loads while hidden", async () => {
  const { loader, panes: [pane], now } = fixture();
  pane._barSeriesIdentity = { symbol: pane.symbol, resolution: "5" };
  const snapshot = captureBeforeSuspension(loader, now);
  assert.deepEqual(snapshot.panes, []);
  pane._historyGeneration = 1;
  pane._barSeriesIdentity = { symbol: pane.symbol, resolution: pane.resolution };
  pane.bars.push({ time: now, close: 77 });
  const result = await loader.recoverLiveHistory({ since: snapshot });
  assert.equal(result.panes.length, 1);
  assert.ok(pane.bars.every((bar, index) => index === 0 || bar.time - pane.bars[index - 1].time === 1));
});

test("a replacement that finishes during recovery gets its own fallback repair", async () => {
  let pane;
  let now;
  let replace = true;
  const data = fixture({ async getBars(_info, resolution, params) {
    if (replace) {
      replace = false;
      const tail = Math.floor((now - 600) / 60) * 60;
      pane.resolution = "1";
      pane._historyGeneration = 1;
      pane._barSeriesIdentity = { symbol: pane.symbol, resolution: "1" };
      pane.bars = Array.from({ length: 20 }, (_, index) => ({ time: tail - (19 - index) * 60, close: 1 }));
      pane.bars.push({ time: Math.floor(now / 60) * 60, close: 77 });
    }
    const sec = resolution === "1" ? 60 : 1;
    return { bars: Array.from({ length: params.countBack }, (_, index) => ({ time: params.to - (params.countBack - index - 1) * sec, close: 9 })) };
  } });
  pane = data.panes[0];
  now = data.now;
  const result = await data.loader.recoverLiveHistory({ since: captureBeforeSuspension(data.loader, now) });
  assert.equal(result.panes[0].resolution, "1");
  assert.ok(pane.bars.every((bar, index) => index === 0 || bar.time - pane.bars[index - 1].time === 60));
});

test("replacement CME 4-hour candles retain their two-hour phase and repair the actual forming bucket", async (t) => {
  const originalNow = Date.now;
  t.after(() => { Date.now = originalNow; });
  const day = Date.UTC(2026, 9, 27) / 1000;
  Date.now = () => (day + 13 * 3600) * 1000;
  const { loader, panes: [pane], requests } = fixture();
  const snapshot = loader.captureResumeState();
  Date.now = () => (day + 17 * 3600) * 1000;
  pane.resolution = "240";
  pane._historyGeneration = 1;
  pane._barSeriesIdentity = { symbol: pane.symbol, resolution: "240" };
  pane.bars = [-2, 2, 6, 10, 14].map((hour) => ({ time: day + hour * 3600, close: 1 }));
  const first = pane.bars[0].time;
  const result = await loader.recoverLiveHistory({ since: snapshot });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].to, day + 14 * 3600);
  assert.equal(requests[0].countBack, 3);
  assert.equal(result.panes[0].fromTime, day + 6 * 3600);
  assert.equal(pane.bars[0].time, first);
  assert.equal(pane.bars.find((bar) => bar.time === day + 10 * 3600).close, 9);
  assert.equal(pane.bars.find((bar) => bar.time === day + 14 * 3600).close, 9);
});

test("replacement fallback includes an actual pre-hide tail that lag metadata failed to declare", async (t) => {
  const originalNow = Date.now;
  t.after(() => { Date.now = originalNow; });
  const day = Date.UTC(2026, 9, 27) / 1000;
  const hide = day + 13 * 3600;
  Date.now = () => hide * 1000;
  const { loader, panes: [pane] } = fixture();
  const snapshot = loader.captureResumeState();
  Date.now = () => (hide + 600) * 1000;
  pane.resolution = "1";
  pane._historyGeneration = 1;
  pane._barSeriesIdentity = { symbol: pane.symbol, resolution: "1" };
  const oldTail = hide - 15 * 60;
  pane.bars = Array.from({ length: 100 }, (_, index) => ({ time: oldTail - (99 - index) * 60, close: 1 }));
  pane.bars.push({ time: hide + 600, close: 77 });
  const first = pane.bars[0].time;
  const result = await loader.recoverLiveHistory({ since: snapshot });
  assert.equal(result.panes[0].fromTime, oldTail - 60);
  assert.equal(pane.bars[0].time, first);
  assert.ok(pane.bars.every((bar, index) => index === 0 || bar.time - pane.bars[index - 1].time === 60));
});
