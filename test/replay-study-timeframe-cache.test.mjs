import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createIndicatorDataLoader } from "../public/js/app/boot/chart/indicatorDataLoader.js";
import { registerIndicatorDefinition } from "../public/js/indicators/catalog.js";
import { createHistoryRequestCache } from "../public/js/datafeed/historyRequests.js";
import { resolutionSec } from "../public/js/chart/resolutions.js";
import { getSecuritySeries } from "../public/js/indicators/security/htfAccess.js";
import {
  bumpDataEpoch, bumpTimeframeDataEpoch, clearAllHtfBars, getDataEpoch, getHtfBars,
} from "../public/js/app/bar/htfBarCache.js";
import { mountReplayMode } from "../public/js/replay/mode.js";
import { getNewsSettingsStore } from "../public/js/news/settings.js";

const engineImports = registerHooks({ resolve(specifier, context, next) {
  return specifier === "prochart"
    ? { url: new URL("../public/vendor/prochart/index.mjs", import.meta.url).href, shortCircuit: true }
    : next(specifier, context);
} });
const { syncHostReplayViewportAfterTfSwitch } = await import("../public/js/app/boot/chart/timeframeSwitch.js");
const { createReplayResolutionChange } = await import("../public/js/replay/engine/resolutionChange.js");
engineImports.deregister();

const bar = (time) => ({ time, open: 100, high: 102, low: 99, close: 101 });
const rows = (to, count, step) => Array.from({ length: count }, (_, index) => bar(to - (count - index - 1) * step));
function replayMode(hostControlled = true) {
  const element = () => Object.assign(new EventTarget(), { classList: { toggle() {} }, setAttribute() {} });
  const replay = mountReplayMode({ appEl: element(), toggleBtn: element(), hostControlled, lockActive: true });
  replay.enter();
  return replay;
}

test("saved Replay studies keep native HTF and full comparison history across warm interval cycles after broker expiry", async (t) => {
  bumpDataEpoch("saved-study-timeframe-test");
  clearAllHtfBars();
  t.after(clearAllHtfBars);
  getNewsSettingsStore().setEnabled(false);
  let now = 1_800_000_000_000;
  t.mock.method(Date, "now", () => now);
  let rawAnchor = 18_000_240;
  // A minute-based host exposes the final 30s sub-bar when changing to 30s.
  // The authoritative raw cursor itself never moves during these switches.
  const mappedAnchor = (resolution) => {
    const step = resolutionSec(resolution);
    return step < 60 ? Math.floor(rawAnchor / 60) * 60 + 60 - step : Math.floor(rawAnchor / step) * step;
  };
  const requests = [];
  const feed = createHistoryRequestCache({
    resolveSymbol: async (ticker) => ({ name: ticker, ticker }),
    async getBars(info, resolution, params) {
      requests.push({ symbol: info.ticker, resolution, ...params });
      const step = resolutionSec(resolution);
      // Short pages reproduce a CSV provider's older comparison-page chain.
      return { bars: rows(Math.floor(params.to / step) * step, Math.min(1000, params.countBack), step) };
    },
  });
  t.after(() => feed.historyCache.dispose());
  const replay = replayMode();
  replay.setReplayPosition({ selectedBarIndex: 239, currentBarIndex: 239, selectedBarTime: rawAnchor, currentBarTime: rawAnchor });
  const definition = registerIndicatorDefinition({
    id: "saved-replay-study-cache-test", title: "Saved replay history test", overlay: true,
    collectDataNeeds: (_instance, pane) => ({
      htf: ["15", "60", "240"].map((resolution) => ({ symbol: pane.symbol, resolution, countBack: 320 })),
      compare: [{ symbol: "ES", chartCountBack: 1800 }],
    }),
  });
  const instance = definition.createInstance(0);
  const pane = { index: 0, symbol: "NQ", resolution: "1", symbolInfo: { name: "NQ", ticker: "NQ" }, bars: rows(rawAnchor, 240, 60) };
  const ctx = {
    opts: { replayHostControlled: true, getPlaybackAnchorSec: mappedAnchor, getPlaybackAnchorRawSec: () => rawAnchor },
    replay, datafeed: feed, resolutions: [], settingsStore: { get: () => ({ symbol: { timezone: "Etc/UTC" } }) },
    getAllChartPanes: () => [pane], getActivePane: () => pane, chartPanes: new Map([[0, pane]]),
    refreshPaneCandleData() {},
  };
  const loader = createIndicatorDataLoader({
    ctx,
    controller: { indicatorsForPane: () => [instance], invalidateOverlayCacheForPane() {}, refreshOverlaysSilent() {} },
    requestOverlayRefresh() {},
  });
  const assertCappedStudies = () => {
    const cap = mappedAnchor(pane.resolution);
    for (const resolution of ["15", "60", "240"]) {
      const result = getSecuritySeries({
        primarySymbol: "NQ", chartResolution: pane.resolution, utcBars: pane.bars,
        getPlaybackAnchorSec: () => cap, getSecurityBars: (symbol, target) => getHtfBars(symbol, target),
      }, "NQ", resolution);
      assert.ok(result.utcBars.filter((record) => !record.isForming).every((record) => record.time + resolutionSec(resolution) <= cap));
      assert.ok(result.utcBars.every((record) => record.time <= cap));
    }
    const compare = getSecuritySeries({
      primarySymbol: "NQ", chartResolution: pane.resolution, getPlaybackAnchorSec: () => cap,
      getSecurityBars: (symbol, resolution) => getHtfBars(symbol, resolution),
    }, "ES", pane.resolution);
    assert.ok(compare.utcBars.every((record) => record.time <= cap));
    assert.equal(compare.utcBars.length, 1800);
  };
  const changeInterval = async (resolution) => {
    now += 20_000; // Exceed the broker TTL: persistent study caches must do the work.
    bumpTimeframeDataEpoch();
    pane.resolution = resolution;
    pane.bars = rows(mappedAnchor(resolution), 240, resolutionSec(resolution));
    const epoch = getDataEpoch();
    // This is the actual host timeframe epilogue, including replay-position
    // updates that can numerically move backwards when a bucket is coarser.
    syncHostReplayViewportAfterTfSwitch(ctx, pane);
    assert.equal(getDataEpoch(), epoch, "mapping a timeframe must not masquerade as a replay rewind");
    await loader.ensurePaneDataThenOverlay(pane);
    assertCappedStudies();
  };

  await loader.ensurePaneDataThenOverlay(pane);
  assertCappedStudies();
  await changeInterval("5");
  await changeInterval("30S");
  assert.equal(requests.filter((request) => request.symbol === "NQ").length, 3);
  for (const resolution of ["1", "5", "30S"]) {
    const compareRequests = requests.filter((request) => request.symbol === "ES" && request.resolution === resolution);
    assert.equal(compareRequests.length, 5, `${resolution}: one initial and four older comparison pages`);
    assert.equal(getHtfBars("ES", resolution).utcBars.length, 1800);
  }
  const warmRequests = requests.length;
  for (const resolution of ["1", "5", "30S", "1", "5", "30S"]) await changeInterval(resolution);
  assert.equal(requests.length, warmRequests, "two warm cycles must not redownload any HTF or comparison lookback page");
  assert.equal(rawAnchor, 18_000_240);

  // A real host rewind still invalidates every series, including future
  // candle OHLC cached at the later cursor, before any study can reuse it.
  rawAnchor -= 3600;
  replay.setReplayPosition({ selectedBarIndex: 239, currentBarIndex: 239, selectedBarTime: rawAnchor, currentBarTime: rawAnchor });
  assert.equal(getHtfBars("NQ", "15"), null);
  assert.equal(getHtfBars("ES", "30S"), null);
  pane.bars = rows(mappedAnchor(pane.resolution), 240, resolutionSec(pane.resolution));
  await loader.ensurePaneDataThenOverlay(pane);
  assert.ok(requests.length > warmRequests, "actual rewinds request history at their earlier anchor");
  assertCappedStudies();
});

test("the actual host resolution-change engine maps a coarser cursor without evicting native study history", async () => {
  const replay = replayMode();
  replay.setReplayPosition({ selectedBarIndex: 1, currentBarIndex: 1, selectedBarTime: 18_000_240, currentBarTime: 18_000_240 });
  const pane = { index: 0, symbol: "NQ", resolution: "5", bars: rows(18_000_000, 50, 300) };
  const state = { replayBarsByResolution: new Map(), replayCursorAtEntry: new Map() };
  const ctx = {
    opts: { replayHostControlled: true, getPlaybackAnchorRawSec: () => 18_000_240, getPlaybackAnchorSec: () => 18_000_000 },
    getActivePane: () => pane, chartPanes: new Map([[0, pane]]), refreshPaneCandleData() {},
  };
  const engine = createReplayResolutionChange(ctx, replay, state, { clearLtBarsStash() {} });
  const before = getDataEpoch();
  await engine.onChartResolutionChange();
  assert.equal(replay.getState().currentBarTime, 18_000_000);
  assert.equal(getDataEpoch(), before);
});

test("the timeframe mapping exemption does not suppress rewinds in standalone replay", () => {
  const replay = replayMode(false);
  replay.setReplayPosition({ selectedBarIndex: 1, currentBarIndex: 1, selectedBarTime: 200, currentBarTime: 200 });
  const before = getDataEpoch();
  replay.setReplayPosition({ selectedBarIndex: 0, currentBarIndex: 0, selectedBarTime: 100, currentBarTime: 100 }, { timeframeChange: true });
  assert.equal(getDataEpoch(), before + 1);
});
