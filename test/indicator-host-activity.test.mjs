import test from "node:test";
import assert from "node:assert/strict";
import { createIndicatorDataLoader } from "../public/js/app/boot/chart/indicatorDataLoader.js";
import { registerIndicatorDefinition } from "../public/js/indicators/catalog.js";
import { bumpDataEpoch, clearAllHtfBars, getHtfBars, seedHtfBars } from "../public/js/app/bar/htfBarCache.js";
import { resolutionSec } from "../public/js/chart/resolutions.js";
import { getNewsSettingsStore } from "../public/js/news/settings.js";

const START = 1_800_000_000;
const flush = async () => { for (let index = 0; index < 64; index += 1) await Promise.resolve(); };
const bars = (count, seconds, to) => Array.from({ length: count }, (_, index) => ({
  time: to - (count - index - 1) * seconds, open: 100, high: 102, low: 99, close: 101,
}));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
let definitionId = 0;

function fixture(t, { compare = false, getBars, resolveSymbol } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: START * 1000 });
  getNewsSettingsStore().setEnabled(false);
  bumpDataEpoch("host-activity-test");
  clearAllHtfBars();
  const route = {
    inert: false, parentElement: null, attributes: new Map(),
    hasAttribute(name) { return this.attributes.has(name); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
  };
  const host = { parentElement: route, isConnected: true, matches: (selector) => selector === ".tv-app" };
  const page = { visibilityState: "visible" };
  const el = { parentElement: host, isConnected: true, matches: () => false, ownerDocument: page };
  const pane = {
    index: 0, symbol: "NQ", resolution: "30S", bars: bars(3, 30, START),
    symbolInfo: { ticker: "NQ" }, _barSeriesIdentity: { symbol: "NQ", resolution: "30S" },
  };
  const definition = registerIndicatorDefinition({
    id: `host-activity-${++definitionId}`, title: "Host activity test", overlay: true,
    collectDataNeeds: () => compare
      ? { compare: [{ symbol: "ES", chartCountBack: 50 }] }
      : { htf: [{ symbol: "ES", resolution: "15", countBack: 50 }] },
  });
  const instance = definition.createInstance(0);
  const requests = [];
  const metadata = [];
  const refreshed = [];
  const ctx = {
    el, opts: {}, resolutions: [], settingsStore: { get: () => ({ symbol: { timezone: "Etc/UTC" } }) },
    getAllChartPanes: () => [pane], ensureIndicatorChartHistory: async () => {},
    datafeed: {
      async resolveSymbol(symbol) { metadata.push(symbol); return resolveSymbol ? resolveSymbol(symbol) : { ticker: symbol }; },
      async getBars(info, resolution, params) {
        requests.push({ symbol: info.ticker, resolution, ...params });
        return getBars ? getBars(info, resolution, params) : { bars: bars(params.countBack, resolutionSec(resolution), params.to) };
      },
    },
  };
  const loader = createIndicatorDataLoader({
    ctx,
    controller: { indicatorsForPane: () => [instance], invalidateOverlayCacheForPane() {}, refreshOverlaysSilent() {} },
    requestOverlayRefresh: (index) => refreshed.push(index),
  });
  const hide = (mode = "aria") => {
    if (mode === "aria") route.attributes.set("aria-hidden", "true");
    if (mode === "inert") route.inert = true;
    if (mode === "page") page.visibilityState = "hidden";
  };
  const show = () => { route.attributes.clear(); route.inert = false; page.visibilityState = "visible"; };
  return { loader, pane, requests, metadata, refreshed, hide, show };
}

test("retained hosts pause optional work for aria-hidden, inert and background documents without clearing cached candles", async (t) => {
  const f = fixture(t, { compare: true });
  seedHtfBars("ES", "30S", bars(100, 30, START));
  const cached = getHtfBars("ES", "30S");
  for (const mode of ["aria", "inert", "page"]) {
    f.hide(mode);
    // Primary stream ticks can keep arriving; only optional indicator work is
    // paused. These public methods are the same paths called by those ticks.
    f.pane.bars.push({ ...f.pane.bars.at(-1), time: f.pane.bars.at(-1).time + 30 });
    f.loader.ensureNow();
    f.loader.scheduleHtfBarsFetch(f.pane, "ES", "15", 50);
    f.loader.scheduleCompareBarsFetch(f.pane, "ES", "30S", 50);
    await f.loader.ensurePaneDataThenOverlay(f.pane);
    t.mock.timers.tick(31_000);
    await flush();
    assert.equal(f.requests.length, 0);
    assert.equal(f.metadata.length, 0);
    assert.equal(getHtfBars("ES", "30S"), cached);
    assert.equal(cached.historyExhausted, false);
    assert.equal(f.loader.isCompareDataUnavailable("ES", "30S"), false);
    f.show();
  }
  assert.equal(f.pane.bars.length, 6, "retained primary ticks remain available");
});

test("work queued before route hiding rechecks host activity before fetching", async (t) => {
  const f = fixture(t);
  f.loader.ensureNow();
  f.loader.scheduleHtfBarsFetch(f.pane, "ES", "15", 50);
  f.loader.scheduleCompareBarsFetch(f.pane, "ES", "30S", 50);
  f.hide();
  t.mock.timers.tick(300);
  await flush();
  assert.equal(f.requests.length, 0);
  assert.equal(f.metadata.length, 0);
  f.show();
  f.loader.scheduleHtfBarsFetch(f.pane, "ES", "15", 50);
  await flush();
  assert.equal(f.requests.length, 1, "showing the host releases normal indicator loading");
});

test("an outstanding symbol lookup cannot start history after its host becomes hidden", async (t) => {
  const metadata = deferred();
  const f = fixture(t, { resolveSymbol: () => metadata.promise });
  f.loader.scheduleHtfBarsFetch(f.pane, "ES", "15", 50);
  await flush();
  assert.equal(f.metadata.length, 1);
  f.hide();
  metadata.resolve({ ticker: "ES" });
  await flush();
  assert.equal(f.requests.length, 0);
  assert.equal(getHtfBars("ES", "15"), null);
});

test("a visible request finishing after hide cannot launch more optional history pages", async (t) => {
  const first = deferred();
  let sourceReads = 0;
  const f = fixture(t, { getBars: (_info, resolution, params) => ++sourceReads === 1
    ? first.promise : { bars: bars(params.countBack, resolutionSec(resolution), params.to) } });
  const pending = f.loader.ensurePaneDataThenOverlay(f.pane);
  await flush();
  assert.equal(f.requests.length, 1);
  const request = f.requests[0];
  f.hide();
  first.resolve({ bars: bars(2, 900, request.to) });
  await pending;
  assert.equal(f.requests.length, 1);
  assert.equal(getHtfBars("ES", "15").historyExhausted, false);
  assert.deepEqual(f.refreshed, []);
  f.show();
  await f.loader.ensurePaneDataThenOverlay(f.pane);
  assert.equal(f.requests.length, 2);
  assert.ok(getHtfBars("ES", "15").utcBars.length >= 50);
});

test("compare retry timers stay quiet after route hiding", async (t) => {
  const f = fixture(t, { compare: true, getBars: async () => ({ bars: [], noData: true }) });
  f.loader.scheduleCompareBarsFetch(f.pane, "ES", "30S", 50);
  await flush();
  assert.equal(f.requests.length, 1);
  assert.equal(f.loader.isCompareDataUnavailable("ES", "30S"), true);
  f.hide();
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(f.requests.length, 1);
  f.show();
  f.loader.scheduleCompareBarsFetch(f.pane, "ES", "30S", 50);
  await flush();
  assert.equal(f.requests.length, 2);
});

test("visible recovery repairs retained comparison tails without reloading their history", async (t) => {
  const f = fixture(t, { compare: true });
  const original = bars(100, 30, START);
  seedHtfBars("ES", "30S", original);
  f.hide();
  t.mock.timers.tick(10 * 60_000);
  f.pane.bars.push({ ...f.pane.bars.at(-1), time: START + 600 });
  f.loader.ensureNow();
  await flush();
  assert.equal(f.requests.length, 0);
  f.show();
  const report = await f.loader.recoverIndicatorDataForPanes([f.pane], { since: { panes: [{
    index: 0, symbol: "NQ", resolution: "30S", generation: 0, lastTime: START, fromTime: START - 30,
  }] } });
  assert.deepEqual(report.failedSeries, []);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].refresh, true);
  assert.equal(f.requests[0].requestReason, "htf.resume");
  assert.ok(f.requests[0].countBack <= 24, "only the missing tail is downloaded");
  const repaired = getHtfBars("ES", "30S");
  assert.equal(repaired.utcBars[0].time, original[0].time);
  assert.equal(repaired.utcBars.at(-1).time, START + 600);
  await f.loader.ensurePaneDataThenOverlay(f.pane);
  assert.equal(f.requests.length, 1, "normal visible indicators reuse the recovered tail");
});

test("a pause cancellation handled after rapid reactivation cannot mark comparison or recovery unavailable", async (t) => {
  let f;
  let reactivations = 0;
  f = fixture(t, { compare: true, getBars: async () => {
    f.hide();
    queueMicrotask(() => { f.show(); reactivations += 1; });
    const error = new Error("Optional history paused");
    error.name = "AbortError";
    throw error;
  } });
  f.loader.scheduleCompareBarsFetch(f.pane, "ES", "30S", 50);
  await flush();
  assert.equal(reactivations, 1);
  assert.equal(f.loader.isCompareDataUnavailable("ES", "30S"), false);
  assert.deepEqual(f.refreshed, []);
  seedHtfBars("ES", "30S", bars(100, 30, START));
  const cached = getHtfBars("ES", "30S");
  f.pane.bars.push({ ...f.pane.bars.at(-1), time: START + 600 });
  const report = await f.loader.recoverIndicatorDataForPanes([f.pane], { since: { panes: [{
    index: 0, symbol: "NQ", resolution: "30S", generation: 0, lastTime: START, fromTime: START - 30,
  }] } });
  assert.equal(reactivations, 2);
  assert.deepEqual(report.failedSeries, []);
  assert.equal(getHtfBars("ES", "30S"), cached);
  assert.equal(cached.historyExhausted, false);
});

test("genuine visible source failures still report comparison cooldowns and failed recovery series", async (t) => {
  const f = fixture(t, { compare: true, getBars: async () => { throw new Error("Source offline"); } });
  f.loader.scheduleCompareBarsFetch(f.pane, "ES", "30S", 50);
  await flush();
  assert.equal(f.loader.isCompareDataUnavailable("ES", "30S"), true);
  seedHtfBars("ES", "30S", bars(100, 30, START));
  f.pane.bars.push({ ...f.pane.bars.at(-1), time: START + 600 });
  const report = await f.loader.recoverIndicatorDataForPanes([f.pane], { since: { panes: [{
    index: 0, symbol: "NQ", resolution: "30S", generation: 0, lastTime: START, fromTime: START - 30,
  }] } });
  assert.deepEqual(report.failedSeries, ["ES|30S"]);
});
