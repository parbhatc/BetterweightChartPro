import { getIndicatorClass } from "../../../indicators/catalog.js";
import {
  collectPaneDataNeeds,
  instanceUsesCompareSymbols,
  instanceUsesHtfKeys,
  paneDataNeedsEmpty,
} from "../../../indicators/security/indicatorDataNeeds.js";
import {
  ensureHtfBars,
  extendHtfCacheForAnchor,
  getDataEpoch,
  getHtfBars,
  getHtfSeriesVersion,
  htfCacheStaleForAnchor,
  invalidateHtfBarRequests,
  noteReplayAnchor,
  prependHtfBars,
  seedHtfBars,
} from "../../bar/htfBarCache.js";
import { resolutionSec } from "../../../chart/resolutions.js";
import { ensureSymbolBars, lookupSymbolBars, paneBarsMatchCurrentSeries, symbolsMatch } from "../../bar/symbolBarCache.js";
import { getPaneChartView } from "../../../chart/pane/viewCache.js";
import { uniqueEtDaysFromBars } from "../../../core/etTime.js";
import {
  fetchNewsCalendarDay,
  getCachedNewsDay,
  newsDaysReady,
} from "../../news/newsCache.js";
import { getNewsSettingsStore } from "../../../news/settings.js";
import { enabledNewsTypeIds } from "../../../news/events.js";
import { indicatorDebug } from "../../../debug/chart/indicators.js";
import { isChartHostInteractive } from "../../../ui/chart/hostInteraction.js";

const HTF_FETCH_IDLE_MS = 200;
const PREPEND_GUARD = 8;
const PREPEND_CHUNK = 200;
const COMPARE_RETRY_MS = 10_000;

export function shouldPublishCompareProgress({
  hasBars,
  versionBefore,
  versionAfter,
  anchorSec,
  tailStale,
}) {
  return Boolean(
    hasBars &&
      versionAfter !== versionBefore &&
      (anchorSec == null || tailStale === false),
  );
}

export function mergeCountBackNeeds(...needMaps) {
  const merged = new Map();
  for (const needs of needMaps) {
    for (const [key, countBack] of needs ?? []) {
      merged.set(key, Math.max(merged.get(key) ?? 0, Number(countBack) || 0));
    }
  }
  return merged;
}

/** @param {string} symbol @param {string} resolution */
function htfStoreBarCount(symbol, resolution) {
  return getHtfBars(symbol, resolution)?.utcBars?.length ?? 0;
}

/**
 * Snapshot store VERSIONS (not bar counts) — an equal-length write that
 * corrects values (finalized forming bucket, range replace) must still
 * invalidate overlay caches.
 * @param {import("../../../indicators/security/indicatorDataNeeds.js").PaneDataNeeds} needs @param {object} pane
 */
function snapshotPaneBarCounts(needs, pane) {
  const htf = new Map();
  for (const key of new Set([...needs.htf.keys(), ...needs.compareHtf.keys()])) {
    const sep = key.indexOf("|");
    htf.set(key, getHtfSeriesVersion(key.slice(0, sep), key.slice(sep + 1)));
  }
  const compare = new Map();
  for (const symbol of needs.compareChart.keys()) {
    compare.set(symbol, getHtfSeriesVersion(symbol, pane.resolution));
  }
  return { htf, compare };
}

/** @param {import("../../../indicators/security/indicatorDataNeeds.js").PaneDataNeeds} needs @param {object} pane @param {{ htf: Map<string, number>, compare: Map<string, number> }} before */
function paneBarCountsChanged(needs, pane, before) {
  for (const key of new Set([...needs.htf.keys(), ...needs.compareHtf.keys()])) {
    const sep = key.indexOf("|");
    const next = getHtfSeriesVersion(key.slice(0, sep), key.slice(sep + 1));
    if (next !== (before.htf.get(key) ?? 0)) return true;
  }
  for (const symbol of needs.compareChart.keys()) {
    const next = getHtfSeriesVersion(symbol, pane.resolution);
    if (next !== (before.compare.get(symbol) ?? 0)) return true;
  }
  return false;
}

/**
 * @param {object} opts
 * @param {import("./state.js").BootContext} opts.ctx
 * @param {import("../../../indicators/controller.js").IndicatorController} opts.controller
 * @param {() => boolean} [opts.isChartPanning]
 * @param {(paneIndex: number) => void} [opts.requestOverlayRefresh]
 * @param {() => void} [opts.deferHeavyWork]
 */
export function createIndicatorDataLoader({
  ctx,
  controller,
  isChartPanning = () => false,
  requestOverlayRefresh = (paneIndex) => controller.refreshOverlaysSilent(paneIndex),
  deferHeavyWork = () => {},
  /** @type {(pane: object) => object[] | undefined} */
  paneBarsForNeeds = null,
}) {
  // Retained Trade charts keep their primary stream alive while another route
  // is visible. Those ticks must not start optional indicator history work.
  const hostIsActive = () => !ctx.el ||
    (ctx.el.ownerDocument?.visibilityState !== "hidden" && isChartHostInteractive(ctx.el));
  const indicatorDatafeed = {
    getBars(...args) {
      // Check at the actual fetch boundary too: a timer, metadata resolution or
      // previous history page may have started before the host was hidden.
      if (!hostIsActive()) {
        const error = new Error("Indicator history paused while its chart is hidden");
        error.name = "AbortError";
        throw error;
      }
      return ctx.datafeed.getBars(...args);
    },
    async resolveSymbol(...args) {
      if (!hostIsActive()) return null;
      const info = await ctx.datafeed.resolveSymbol(...args);
      return hostIsActive() ? info : null;
    },
  };
  /** @type {ReturnType<typeof setTimeout> | null} */
  let loadTimer = null;
  /** @type {Map<string, Promise<void>>} */
  const paneInFlight = new Map();
  /** @type {Map<string, { want: number }>} */
  const htfFetchInFlight = new Map();
  /** @type {Set<string>} */
  const compareFetchInFlight = new Set();
  /** @type {Map<string, number>} */
  const compareUnavailableUntil = new Map();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const compareRetryTimers = new Map();
  const paneOverlayInFlight = new Map();

  const compareKey = (symbol, resolution) => `${symbol}|${resolution}`;

  function clearCompareUnavailable(symbol, resolution) {
    const key = compareKey(symbol, resolution);
    const timer = compareRetryTimers.get(key);
    if (timer != null) clearTimeout(timer);
    compareRetryTimers.delete(key);
    compareUnavailableUntil.delete(key);
  }

  function markCompareUnavailable(pane, symbol, resolution, countBack, err) {
    // A pause rejection may reach this handler after rapid route reactivation.
    // Cancellation is not missing market data and must not start a cooldown.
    if (!hostIsActive() || err?.name === "AbortError") return;
    const key = compareKey(symbol, resolution);
    const startEpoch = getDataEpoch();
    const retryAt = Date.now() + COMPARE_RETRY_MS;
    compareUnavailableUntil.set(key, retryAt);
    indicatorDebug("data.compare unavailable", {
      pane: pane?.index,
      symbol,
      resolution,
      retryMs: COMPARE_RETRY_MS,
      error: err ? String(err) : "no bars",
    });
    requestOverlayRefresh(pane.index);
    const previous = compareRetryTimers.get(key);
    if (previous != null) clearTimeout(previous);
    compareRetryTimers.set(key, setTimeout(() => {
      compareRetryTimers.delete(key);
      compareUnavailableUntil.delete(key);
      if (!hostIsActive() || getDataEpoch() !== startEpoch) return;
      requestOverlayRefresh(pane.index);
      scheduleCompareBarsFetch(pane, symbol, resolution, countBack);
    }, COMPARE_RETRY_MS));
  }

  function isCompareDataUnavailable(symbol, resolution) {
    const retryAt = compareUnavailableUntil.get(compareKey(symbol, resolution));
    return retryAt != null && retryAt > Date.now();
  }

  /**
   * Replay anchor for the pane, or null. Also feeds rewind detection — a
   * backward anchor move bumps the data epoch (drops stale anchored caches).
   * @param {object} pane
   */
  function paneAnchorSec(pane) {
    const a =
      typeof ctx.opts?.getPlaybackAnchorSec === "function"
        ? ctx.opts.getPlaybackAnchorSec(pane.resolution)
        : null;
    if (a != null && Number.isFinite(a)) {
      noteReplayAnchor(pane.resolution, a);
      return a;
    }
    return null;
  }

  /** True when `resolution` is coarser than the pane chart (store holds closed buckets only). */
  function confirmedOnlyFor(pane, resolution) {
    const tf = resolutionSec(resolution);
    const chart = resolutionSec(pane?.resolution ?? "");
    return tf != null && chart != null && tf > chart;
  }

  /** @param {object} pane @param {string} symbol @param {string} resolution @param {number} countBack @param {object} [symbolInfo] */
  function htfEnsureOpts(pane, symbol, resolution, countBack, symbolInfo) {
    const info = symbolInfo ?? pane.symbolInfo ?? ctx.symbolInfo;
    const playbackAnchorSec = paneAnchorSec(pane);
    return {
      datafeed: indicatorDatafeed,
      symbolInfo: info,
      symbol,
      resolution,
      countBack,
      pane,
      settingsStore: ctx.settingsStore,
      symbolInfoExtra: info,
      playbackAnchorSec,
      getAllChartPanes: ctx.getAllChartPanes,
      resolutions: ctx.resolutions,
    };
  }

  /** @param {object} pane @returns {Promise<boolean>} true when any HTF tail was extended */
  async function extendHtfTailForReplay(pane) {
    if (!hostIsActive() || !pane?.symbol || !ctx.datafeed) return false;
    if (!paneBarsMatchCurrentSeries(pane)) return false;
    const anchorSec = paneAnchorSec(pane);
    if (anchorSec == null) return false;
    const startEpoch = getDataEpoch();

    const view = getPaneChartView(
      pane,
      ctx.settingsStore,
      pane.symbolInfo ?? ctx.symbolInfo,
      ctx.resolutions,
    );
    const bars =
      (typeof paneBarsForNeeds === "function" ? paneBarsForNeeds(pane) : null) ??
      view?.utcBars ??
      [];
    const needs = collectPaneDataNeeds(
      controller.indicatorsForPane(pane.index),
      { ...pane, bars },
      getIndicatorClass,
    );
    let extended = false;
    for (const key of needs.htf.keys()) {
      const sep = key.indexOf("|");
      const symbol = key.slice(0, sep);
      const resolution = key.slice(sep + 1);
      const confirmedOnly = confirmedOnlyFor(pane, resolution);
      if (!htfCacheStaleForAnchor(symbol, resolution, anchorSec, { confirmedOnly })) continue;
      const symbolInfo =
        symbol === pane.symbol
          ? pane.symbolInfo ?? ctx.symbolInfo
          : await indicatorDatafeed.resolveSymbol(symbol);
      if (!symbolInfo) continue;
      await extendHtfCacheForAnchor({
        ...htfEnsureOpts(pane, symbol, resolution, 16, symbolInfo),
        anchorSec,
        symbolInfo,
      });
      if (getDataEpoch() !== startEpoch) return false;
      extended = true;
      controller.invalidateOverlayCacheForPane(pane.index, { htfKeys: new Set([key]) });
    }
    // Compare-chart series (e.g. SMT's ES at chart resolution) need the same
    // anchor-based tail extension, or they go stale as soon as replay steps
    // past their cached tail (count-based sufficiency never notices).
    for (const symbol of needs.compareChart.keys()) {
      if (!symbol || symbol === pane.symbol) continue;
      if (!htfCacheStaleForAnchor(symbol, pane.resolution, anchorSec)) continue;
      const symbolInfo = await indicatorDatafeed.resolveSymbol(symbol);
      if (!symbolInfo) continue;
      await extendHtfCacheForAnchor({
        ...htfEnsureOpts(pane, symbol, pane.resolution, 16, symbolInfo),
        anchorSec,
        symbolInfo,
      });
      if (getDataEpoch() !== startEpoch) return false;
      extended = true;
      controller.invalidateOverlayCacheForPane(pane.index, {
        htfKeys: new Set([`${symbol}|${pane.resolution}`]),
      });
    }
    return extended;
  }

  /** Repair only retained dependency tails after primary panes recover from suspension. */
  async function recoverIndicatorDataForPanes(panes, options = {}) {
    const shouldContinue = typeof options.shouldContinue === "function" ? options.shouldContinue : () => true;
    if (!hostIsActive() || !shouldContinue() || !ctx.datafeed || ctx.opts?.replayHostControlled || ctx.replayEngine?.isReplayLocked?.()) {
      return { series: 0, updatedSeries: 0, failedSeries: [] };
    }
    const startEpoch = getDataEpoch();
    const captures = options.since?.panes ?? [];
    const jobs = new Map();
    for (const pane of panes) {
      if (!pane?.symbol || !paneBarsMatchCurrentSeries(pane)) continue;
      const capture = captures.find((entry) => entry.index === pane.index &&
        entry.symbol === pane.symbol && entry.resolution === pane.resolution);
      if (captures.length && !capture) continue;
      if (capture && Number.isFinite(capture.generation) && capture.generation !== (pane._historyGeneration ?? 0)) continue;
      const view = getPaneChartView(pane, ctx.settingsStore, pane.symbolInfo ?? ctx.symbolInfo, ctx.resolutions);
      const needs = collectPaneDataNeeds(controller.indicatorsForPane(pane.index), { ...pane, bars: view.utcBars }, getIndicatorClass);
      const seriesNeeds = mergeCountBackNeeds(needs.htf, needs.compareHtf);
      for (const [symbol, countBack] of needs.compareChart) {
        const key = `${symbol}|${pane.resolution}`;
        seriesNeeds.set(key, Math.max(seriesNeeds.get(key) ?? 0, countBack));
      }
      const anchorSec = pane.bars?.at(-1)?.time;
      if (!Number.isFinite(anchorSec)) continue;
      for (const key of seriesNeeds.keys()) {
        const sep = key.indexOf("|");
        const symbol = key.slice(0, sep);
        const resolution = key.slice(sep + 1);
        const stored = getHtfBars(symbol, resolution);
        const fromSec = Number.isFinite(capture?.fromTime) ? capture.fromTime
          : Number.isFinite(capture?.lastTime) ? capture.lastTime
            : stored?.utcBars?.at(-1)?.time;
        const previous = jobs.get(key);
        const owner = { pane, symbol: pane.symbol, resolution: pane.resolution, generation: pane._historyGeneration ?? 0 };
        if (previous) {
          previous.anchorSec = Math.max(previous.anchorSec, anchorSec);
          if (Number.isFinite(fromSec)) previous.fromSec = Math.min(previous.fromSec ?? fromSec, fromSec);
          previous.owners.push(owner);
        } else {
          jobs.set(key, { key, symbol, resolution, pane: { ...pane }, anchorSec, fromSec, owners: [owner] });
        }
      }
    }
    const changed = new Map();
    const failedSeries = [];
    for (const job of jobs.values()) invalidateHtfBarRequests(job.symbol, job.resolution);
    const currentOwner = (owner) => hostIsActive() && shouldContinue() &&
      (ctx.getAllChartPanes?.() ?? panes).includes(owner.pane) &&
      owner.pane.symbol === owner.symbol && owner.pane.resolution === owner.resolution &&
      (owner.pane._historyGeneration ?? 0) === owner.generation && paneBarsMatchCurrentSeries(owner.pane);
    await Promise.all([...jobs.values()].map(async (job) => {
      try {
        if (getDataEpoch() !== startEpoch || !job.owners.some(currentOwner)) return;
        const versionBefore = getHtfSeriesVersion(job.symbol, job.resolution);
        const peer = ctx.getAllChartPanes?.().find((candidate) => candidate.resolution === job.resolution &&
          panes.includes(candidate) && symbolsMatch(candidate.symbol ?? "", job.symbol) && paneBarsMatchCurrentSeries(candidate));
        if (peer?.bars?.length) {
          // Primary recovery already filled this exact visible series. Share
          // its repaired bars; never start another indicator lookback here.
          const shared = lookupSymbolBars({ ...symbolBarLookupOpts(peer, job.symbol), resolution: job.resolution });
          if (shared?.utcBars?.length) {
            seedHtfBars(job.symbol, job.resolution, shared.utcBars, shared.chartBars, shared.source, { verifyRange: true });
          }
        } else if (getHtfBars(job.symbol, job.resolution)?.utcBars?.length) {
          const info = job.symbol === job.pane.symbol ? job.pane.symbolInfo ?? ctx.symbolInfo : await indicatorDatafeed.resolveSymbol(job.symbol);
          if (!info || getDataEpoch() !== startEpoch || !job.owners.some(currentOwner)) return;
          await extendHtfCacheForAnchor({
            datafeed: indicatorDatafeed, symbolInfo: info, symbol: job.symbol, resolution: job.resolution,
            pane: job.pane, anchorSec: job.anchorSec, fromSec: job.fromSec, requestReason: "htf.resume",
            refresh: true, shouldContinue: () => getDataEpoch() === startEpoch && job.owners.some(currentOwner),
          });
        }
        if (getDataEpoch() === startEpoch && getHtfSeriesVersion(job.symbol, job.resolution) !== versionBefore) changed.set(job.key, job);
      } catch (error) {
        if (!hostIsActive() || error?.name === "AbortError") return;
        failedSeries.push(job.key);
        indicatorDebug("data.resume failed", { key: job.key, error: String(error) });
      }
    }));
    if (getDataEpoch() === startEpoch) {
      const affected = new Map();
      for (const job of changed.values()) {
        for (const owner of job.owners) {
          if (!currentOwner(owner)) continue;
          if (!affected.has(owner.pane.index)) affected.set(owner.pane.index, { keys: new Set(), symbols: new Set() });
          affected.get(owner.pane.index).keys.add(job.key);
          affected.get(owner.pane.index).symbols.add(job.symbol);
        }
      }
      for (const [index, dependencies] of affected) {
        controller.invalidateOverlayCacheForPane(index, { htfKeys: dependencies.keys, compareSymbols: dependencies.symbols });
        if (options.refresh !== false) requestOverlayRefresh(index);
      }
    }
    return { series: jobs.size, updatedSeries: changed.size, failedSeries };
  }

  function symbolBarLookupOpts(pane, symbol) {
    return {
      symbol,
      resolution: pane.resolution,
      pane,
      getAllChartPanes: ctx.getAllChartPanes,
      settingsStore: ctx.settingsStore,
      symbolInfoExtra: pane.symbolInfo ?? ctx.symbolInfo,
      resolutions: ctx.resolutions,
    };
  }

  async function borrowVisiblePaneHistory(pane, symbol, resolution, countBack) {
    if (!hostIsActive() || !ctx.ensureIndicatorChartHistory) return;
    const sourcePane = ctx.getAllChartPanes?.().find((candidate) =>
      candidate.resolution === resolution && symbolsMatch(candidate.symbol ?? "", symbol) &&
      paneBarsMatchCurrentSeries(candidate),
    );
    if (!sourcePane) return;
    const startEpoch = getDataEpoch();
    const sourceSymbol = sourcePane.symbol;
    // Join only the primary candle loader, whose promise is independent of
    // indicator completion. Waiting for the whole indicator phase would let
    // mutually comparing panes deadlock each other.
    await ctx.ensureIndicatorChartHistory(sourcePane, {
      countBack,
      shouldContinue: () => hostIsActive() && getDataEpoch() === startEpoch &&
        sourcePane.symbol === sourceSymbol && sourcePane.resolution === resolution,
    });
    if (!hostIsActive() || getDataEpoch() !== startEpoch) return;
    const shared = lookupSymbolBars({ ...symbolBarLookupOpts(pane, symbol), resolution });
    if (shared?.utcBars?.length) {
      seedHtfBars(symbol, resolution, shared.utcBars, shared.chartBars, shared.source);
    }
  }

  /** @param {object} pane @param {string} symbol @param {string} resolution @param {number} countBack @param {object} [symbolInfo] */
  async function fillHtfHistory(pane, symbol, resolution, countBack) {
    if (!hostIsActive()) return;
    const startEpoch = getDataEpoch();
    await borrowVisiblePaneHistory(pane, symbol, resolution, countBack);
    if (!hostIsActive() || getDataEpoch() !== startEpoch) return;
    let symbolInfo;
    if (symbol === pane.symbol) {
      symbolInfo = pane.symbolInfo ?? ctx.symbolInfo;
      if (!symbolInfo) return;
    } else {
      symbolInfo = await indicatorDatafeed.resolveSymbol(symbol);
      if (!symbolInfo) return;
    }
    const ensureOpts = htfEnsureOpts(pane, symbol, resolution, countBack, symbolInfo);
    const anchorSec = ensureOpts.playbackAnchorSec;
    const confirmedOnly = confirmedOnlyFor(pane, resolution);
    if (anchorSec != null && ctx.opts?.replayHostControlled) {
      const stored = getHtfBars(symbol, resolution);
      const stale = htfCacheStaleForAnchor(symbol, resolution, anchorSec, { confirmedOnly });
      if (stored?.utcBars?.length && !stale) {
        return;
      }
      if (stored?.utcBars?.length && stale) {
        await extendHtfCacheForAnchor({
          ...ensureOpts,
          anchorSec,
          symbolInfo,
        });
        return;
      }
      // ponytail: empty store still needs one initial fetch; tail-only path is for Next steps
      await ensureHtfBars(ensureOpts);
      return;
    }
    if (anchorSec != null && htfCacheStaleForAnchor(symbol, resolution, anchorSec, { confirmedOnly })) {
      await extendHtfCacheForAnchor({
        ...ensureOpts,
        anchorSec,
        symbolInfo,
      });
    }
    let entry = await ensureHtfBars(ensureOpts);
    let guard = 0;
    while (hostIsActive() && entry && entry.utcBars.length < countBack && !entry.historyExhausted && guard < PREPEND_GUARD) {
      entry = await prependHtfBars({
        datafeed: indicatorDatafeed,
        symbolInfo,
        symbol,
        resolution,
        countBack: PREPEND_CHUNK,
        pane,
        settingsStore: ctx.settingsStore,
        symbolInfoExtra: symbolInfo,
      });
      guard += 1;
    }
  }

  /** @param {object} pane @param {string} symbol @param {number} countBack */
  async function fillCompareChart(pane, symbol, countBack) {
    if (!hostIsActive()) return false;
    const anchorSec = paneAnchorSec(pane);
    const startEpoch = getDataEpoch();
    const tailCap = anchorSec ?? pane.bars?.at(-1)?.time ?? null;
    const versionBeforeInitialPage = getHtfSeriesVersion(symbol, pane.resolution);
    await borrowVisiblePaneHistory(pane, symbol, pane.resolution, countBack);
    if (!hostIsActive() || getDataEpoch() !== startEpoch) return false;
    let hit = lookupSymbolBars({ ...symbolBarLookupOpts(pane, symbol), resolution: pane.resolution });
    const tailStale =
      tailCap != null && htfCacheStaleForAnchor(symbol, pane.resolution, tailCap);
    if (!hit || hit.utcBars.length < countBack || tailStale) {
      const symbolInfo = await indicatorDatafeed.resolveSymbol(symbol);
      if (!symbolInfo) return false;
      if (tailStale && htfStoreBarCount(symbol, pane.resolution) > 0) {
        await extendHtfCacheForAnchor({
          ...htfEnsureOpts(pane, symbol, pane.resolution, 16, symbolInfo),
          anchorSec: tailCap,
          symbolInfo,
        });
      } else {
        hit = await ensureSymbolBars({
          datafeed: indicatorDatafeed,
          symbolInfo,
          symbol,
          resolution: pane.resolution,
          countBack,
          pane,
          settingsStore: ctx.settingsStore,
          symbolInfoExtra: symbolInfo,
          getAllChartPanes: ctx.getAllChartPanes,
          resolutions: ctx.resolutions,
          playbackAnchorSec: anchorSec,
        });
      }
    }
    let entry = getHtfBars(symbol, pane.resolution);
    // A replay chart can require thousands of compare bars, which are fetched
    // in multiple pages. Publish the first tail-aligned page immediately so
    // SMT can leave its loading state and paint recent divergences while the
    // remaining historical pages continue backfilling below.
    if (shouldPublishCompareProgress({
      hasBars: Boolean(entry?.utcBars?.length),
      versionBefore: versionBeforeInitialPage,
      versionAfter: getHtfSeriesVersion(symbol, pane.resolution),
      anchorSec: tailCap,
      tailStale:
        tailCap == null
          ? false
          : htfCacheStaleForAnchor(symbol, pane.resolution, tailCap),
    })) {
      refreshPanesUsingCompareSymbol(symbol);
    }
    let guard = 0;
    const symbolInfo = await indicatorDatafeed.resolveSymbol(symbol);
    if (!symbolInfo) return false;
    while (hostIsActive() && entry && entry.utcBars.length < countBack && !entry.historyExhausted && guard < PREPEND_GUARD) {
      entry = await prependHtfBars({
        datafeed: indicatorDatafeed,
        symbolInfo,
        symbol,
        resolution: pane.resolution,
        countBack: PREPEND_CHUNK,
        pane,
        settingsStore: ctx.settingsStore,
        symbolInfoExtra: symbolInfo,
      });
      guard += 1;
    }
    return Boolean(hit?.utcBars?.length || entry?.utcBars?.length);
  }

  /** @param {import("../../../indicators/security/indicatorDataNeeds.js").NewsNeed} newsNeed */
  async function fillNewsCalendar(newsNeed) {
    if (!newsNeed?.days?.length) return;
    const opts = { source: newsNeed.source, types: newsNeed.types };
    await Promise.all(
      newsNeed.days.map(async (day) => {
        if (getCachedNewsDay(day, opts)) return;
        await fetchNewsCalendarDay(day, opts);
      }),
    );
  }

  /** @param {object} pane */
  function newsContextForPane(pane) {
    const view = getPaneChartView(
      pane,
      ctx.settingsStore,
      pane.symbolInfo ?? ctx.symbolInfo,
      ctx.resolutions,
    );
    const newsStore = getNewsSettingsStore();
    const days = uniqueEtDaysFromBars(view.utcBars);
    const enabled = newsStore.isEnabled();
    const settings = newsStore.get();
    const opts = {
      source: settings.source ?? "forexfactory",
      // Always fetch full day events; filter client-side for release levels.
      types: [],
    };
    return {
      newsOpts: opts,
      days,
      isNewsEnabled: () => enabled,
      getNewsRows: () =>
        enabled ? (settings.eventTypes ?? []).filter((r) => r.enabled !== false) : [],
      newsPending: () =>
        Boolean(enabled && days.length && !newsDaysReady(days, opts)),
      getNewsByDay: () => {
        if (!enabled) return {};
        /** @type {Record<string, object>} */
        const out = {};
        for (const day of days) {
          const hit = getCachedNewsDay(day, opts);
          if (hit) out[day] = hit;
        }
        return out;
      },
    };
  }

  /** @param {object} pane */
  async function ensureGlobalNews(pane) {
    const newsStore = getNewsSettingsStore();
    if (!newsStore.isEnabled()) return false;
    const view = getPaneChartView(
      pane,
      ctx.settingsStore,
      pane.symbolInfo ?? ctx.symbolInfo,
      ctx.resolutions,
    );
    const days = uniqueEtDaysFromBars(view.utcBars);
    const settings = newsStore.get();
    const source = settings.source ?? "forexfactory";
    const missingDays = days.filter((day) => !getCachedNewsDay(day, { source, types: [] }));
    if (!missingDays.length) return false;
    await fillNewsCalendar({ source, types: [], days: missingDays });
    return true;
  }

  /** @param {object} pane @param {{ skipRefresh?: boolean }} [opts] */
  function ensurePaneData(pane, opts = {}) {
    if (!hostIsActive()) return Promise.resolve();
    if (!pane?.symbol) return Promise.resolve();
    if (!paneBarsMatchCurrentSeries(pane)) return Promise.resolve();
    const key = `${getDataEpoch()}|${pane.index}|${pane.symbol}|${pane.resolution}|${pane._historyGeneration ?? 0}`;
    const pending = paneInFlight.get(key);
    if (pending) return pending;
    const task = loadPaneData(pane, opts).finally(() => paneInFlight.delete(key));
    paneInFlight.set(key, task);
    return task;
  }

  async function loadPaneData(pane, opts = {}) {
    if (!hostIsActive()) return;
    if (!pane?.symbol) return;
    if (!paneBarsMatchCurrentSeries(pane)) return;
    if (isChartPanning()) {
      deferHeavyWork();
      return;
    }
    const startEpoch = getDataEpoch();
    const generation = pane._historyGeneration ?? 0;
    const currentPane = () => hostIsActive() && getDataEpoch() === startEpoch &&
      (pane._historyGeneration ?? 0) === generation && paneBarsMatchCurrentSeries(pane);

    // Do not queue current-window indicator data behind the slower primary
    // candle backfill. Initial boot already owns that backfill through
    // `_indicatorHistoryBulkLoad`; later indicator changes start it here in
    // the background and schedule one deeper pass only when bars were added.
    if (!pane._indicatorHistoryBulkLoad) {
      const chartBarsBefore = pane.bars?.length ?? 0;
      void Promise.resolve(ctx.ensureIndicatorChartHistory?.(pane, { shouldContinue: currentPane }))
        .then(() => {
          if (
            currentPane() &&
            (pane.bars?.length ?? 0) > chartBarsBefore
          ) {
            scheduleLoad(0);
          }
        })
        .catch((err) => {
          indicatorDebug("data.chart history failed", {
            pane: pane.index,
            error: String(err),
          });
        });
    }

    const view = getPaneChartView(
      pane,
      ctx.settingsStore,
      pane.symbolInfo ?? ctx.symbolInfo,
      ctx.resolutions,
    );
    const bars =
      (typeof paneBarsForNeeds === "function" ? paneBarsForNeeds(pane) : null) ??
      view?.utcBars ??
      [];
    const needs = collectPaneDataNeeds(
      controller.indicatorsForPane(pane.index),
      { ...pane, bars },
      getIndicatorClass,
    );
    for (const key of needs.htf.keys()) {
      const sep = key.indexOf("|");
      const storedLen = htfStoreBarCount(key.slice(0, sep), key.slice(sep + 1));
      if (storedLen > (needs.htf.get(key) ?? 0)) needs.htf.set(key, storedLen);
    }
    for (const key of needs.compareHtf.keys()) {
      const sep = key.indexOf("|");
      const storedLen = htfStoreBarCount(key.slice(0, sep), key.slice(sep + 1));
      if (storedLen > (needs.compareHtf.get(key) ?? 0)) needs.compareHtf.set(key, storedLen);
    }
    if (paneDataNeedsEmpty(needs)) return;

    const visibleIds = controller
      .indicatorsForPane(pane.index)
      .filter((inst) => !inst.hidden)
      .map((inst) => inst.defId);
    indicatorDebug("data.ensure", {
      pane: pane.index,
      visibleInstances: visibleIds,
      htf: Object.fromEntries(needs.htf),
      compareChart: Object.fromEntries(needs.compareChart),
      compareHtf: Object.fromEntries(needs.compareHtf),
    });

    // Calendar latency must not delay independent candle/compare history.
    void ensureGlobalNews(pane)
      .then((changed) => {
          if (!changed || !currentPane()) return;
        controller.invalidateOverlayCacheForPane(pane.index);
        requestOverlayRefresh(pane.index);
      })
      .catch((err) => indicatorDebug("data.news failed", { pane: pane.index, error: String(err) }));
    if (!currentPane()) return;
    if (!ctx.datafeed) {
      controller.invalidateOverlayCacheForPane(pane.index);
      requestOverlayRefresh(pane.index);
      return;
    }
    const barCountsBefore = snapshotPaneBarCounts(needs, pane);
    if (isChartPanning()) {
      deferHeavyWork();
      return;
    }

    // HTF and compare-symbol series are independent. Loading them in a
    // single serial chain made later indicators inherit the latency of every
    // earlier indicator (Levels could block SMT for several seconds).
    // Per-series stores still deduplicate identical symbol/resolution work.
    const htfNeeds = mergeCountBackNeeds(needs.htf, needs.compareHtf);
    const seriesTasks = [];
    const seriesPane = { ...pane };
    for (const [key, countBack] of htfNeeds) {
      const sep = key.indexOf("|");
      const symbol = key.slice(0, sep);
      const resolution = key.slice(sep + 1);
      seriesTasks.push(fillHtfHistory(seriesPane, symbol, resolution, countBack));
    }
    for (const [symbol, countBack] of needs.compareChart) {
      // Do not let routine loader passes continuously restart the cooldown;
      // the retry timer below owns the next attempt after an empty/error run.
      if (isCompareDataUnavailable(symbol, pane.resolution)) continue;
      seriesTasks.push((async () => {
        try {
          const loaded = await fillCompareChart(seriesPane, symbol, countBack);
          if (getDataEpoch() !== startEpoch) return;
          if (loaded) clearCompareUnavailable(symbol, pane.resolution);
          else markCompareUnavailable(pane, symbol, pane.resolution, countBack);
        } catch (err) {
          if (getDataEpoch() === startEpoch) {
            markCompareUnavailable(seriesPane, symbol, seriesPane.resolution, countBack, err);
          }
        }
      })());
    }
    const seriesResults = await Promise.allSettled(seriesTasks);
    for (const result of seriesResults) {
      if (result.status === "rejected") {
        indicatorDebug("data.series failed", { pane: pane.index, error: String(result.reason) });
      }
    }
    // A symbol/TF/replay transition happened mid-load: results were dropped
    // by the store, and pane state may no longer match — skip refresh.
    if (!currentPane()) return;
    if (!paneBarCountsChanged(needs, pane, barCountsBefore)) return;
    controller.invalidateOverlayCacheForPane(pane.index, {
      htfKeys: new Set([...needs.htf.keys(), ...needs.compareHtf.keys()]),
      compareSymbols: new Set(needs.compareChart.keys()),
    });
    if (!opts.skipRefresh) requestOverlayRefresh(pane.index);
    for (const sym of needs.compareChart.keys()) {
      refreshPanesUsingCompareSymbol(sym);
    }
  }

  /** @param {number} [delayMs] */
  function scheduleLoad(delayMs = HTF_FETCH_IDLE_MS) {
    if (loadTimer != null) clearTimeout(loadTimer);
    loadTimer = null;
    if (!hostIsActive()) return;
    loadTimer = setTimeout(() => {
      loadTimer = null;
      if (!hostIsActive()) return;
      if (isChartPanning()) {
        deferHeavyWork();
        return;
      }
      for (const pane of ctx.getAllChartPanes()) {
        void ensurePaneData(pane);
      }
    }, delayMs);
  }

  /** @param {string} compareSymbol */
  function refreshPanesUsingCompareSymbol(compareSymbol) {
    if (!compareSymbol) return;
    const compareSet = new Set([compareSymbol]);
    for (const pane of ctx.getAllChartPanes()) {
      controller.invalidateOverlayCacheForPane(pane.index, { compareSymbols: compareSet });
      const instances = controller.indicatorsForPane(pane.index) ?? [];
      const paneCtx = { symbol: pane.symbol, bars: pane.bars };
      if (
        instances.some((inst) =>
          instanceUsesCompareSymbols(inst, paneCtx, getIndicatorClass, compareSet),
        )
      ) {
        requestOverlayRefresh(pane.index);
      }
    }
  }

  function refreshPanesUsingHtfKey(key) {
    const keys = new Set([key]);
    for (const pane of ctx.getAllChartPanes()) {
      const instances = controller.indicatorsForPane(pane.index) ?? [];
      if (!instances.some((instance) => instanceUsesHtfKeys(instance, pane, getIndicatorClass, keys))) continue;
      controller.invalidateOverlayCacheForPane(pane.index, { htfKeys: keys });
      requestOverlayRefresh(pane.index);
    }
  }

  /** @param {object} pane @param {string} symbol @param {string} resolution @param {number} countBack */
  function scheduleCompareBarsFetch(pane, symbol, resolution, countBack) {
    if (!hostIsActive()) return;
    if (!pane || !ctx.datafeed || !symbol || !resolution) return;
    if (!paneBarsMatchCurrentSeries(pane)) return;
    if (isChartPanning()) {
      deferHeavyWork();
      return;
    }
    const want = Math.max(50, Number(countBack) || 300);
    const key = `${getDataEpoch()}|${compareKey(symbol, resolution)}`;
    if (compareFetchInFlight.has(key)) return;

    const hit = lookupSymbolBars({
      symbol,
      resolution,
      pane,
      getAllChartPanes: ctx.getAllChartPanes,
      settingsStore: ctx.settingsStore,
      symbolInfoExtra: pane.symbolInfo ?? ctx.symbolInfo,
      resolutions: ctx.resolutions,
    });
    const anchorSec = paneAnchorSec(pane);
    // Sufficiency must be time-based too: a long-but-stale cache (tail ends
    // before the replay cursor) still needs a tail top-up, or SMT-style
    // compares freeze at the last covered pivot.
    const tailCap = anchorSec ?? pane.bars?.at(-1)?.time ?? null;
    const tailStale =
      tailCap != null && htfCacheStaleForAnchor(symbol, resolution, tailCap);
    if (hit && hit.utcBars.length >= want && !tailStale) {
      clearCompareUnavailable(symbol, resolution);
      return;
    }
    if (isCompareDataUnavailable(symbol, resolution)) return;

    compareFetchInFlight.add(key);
    const startEpoch = getDataEpoch();
    const beforeVersion = getHtfSeriesVersion(symbol, resolution);
    const snapshot = { ...pane, resolution };
    void Promise.resolve().then(async () => {
      if (!hostIsActive()) return;
      const loaded = await fillCompareChart(snapshot, symbol, want);
      if (getDataEpoch() !== startEpoch) return;
      if (!loaded) {
        markCompareUnavailable(snapshot, symbol, resolution, want);
        return;
      }
      clearCompareUnavailable(symbol, resolution);
      if (getHtfSeriesVersion(symbol, resolution) === beforeVersion) return;
      refreshPanesUsingCompareSymbol(symbol);
    })
      .catch((err) => {
        if (getDataEpoch() === startEpoch) markCompareUnavailable(snapshot, symbol, resolution, want, err);
      })
      .finally(() => compareFetchInFlight.delete(key));
  }

  /** @param {object} pane @param {string} [symbol] @param {string} resId @param {number} countBack */
  function scheduleHtfBarsFetch(pane, symbol, resId, countBack) {
    if (!hostIsActive()) return;
    const sym = symbol ?? pane?.symbol;
    if (!sym || !pane || !ctx.datafeed) return;
    if (!paneBarsMatchCurrentSeries(pane)) return;
    if (isChartPanning()) {
      deferHeavyWork();
      return;
    }
    const startEpoch = getDataEpoch();
    const key = sym + "|" + resId;
    const flightKey = startEpoch + "|" + key;
    const want = Math.max(50, Number(countBack) || 300);
    const pending = htfFetchInFlight.get(flightKey);
    if (pending) {
      pending.want = Math.max(pending.want, want);
      return;
    }
    const request = { want };
    const snapshot = { ...pane };
    const beforeVersion = getHtfSeriesVersion(sym, resId);
    htfFetchInFlight.set(flightKey, request);
    // Coalesce all requirements from this render before sending the first
    // request. A larger study arriving during I/O receives one deeper pass.
    void Promise.resolve().then(async () => {
      let requested;
      do {
        if (!hostIsActive() || getDataEpoch() !== startEpoch) return;
        requested = request.want;
        await fillHtfHistory(snapshot, sym, resId, requested);
      } while (getDataEpoch() === startEpoch && request.want > requested);
      if (getDataEpoch() !== startEpoch) return;
      if (getHtfSeriesVersion(sym, resId) === beforeVersion) return;
      refreshPanesUsingHtfKey(key);
    })
      .catch((err) => indicatorDebug("data.htf failed", { key, error: String(err) }))
      .finally(() => htfFetchInFlight.delete(flightKey));
  }

  /** @param {object} pane — host replay: load HTF then paint overlay once (no short-series flash). */
  function ensurePaneDataThenOverlay(pane) {
    if (!hostIsActive()) return Promise.resolve();
    if (!pane?.symbol) return Promise.resolve();
    if (!paneBarsMatchCurrentSeries(pane)) return Promise.resolve();
    if (isChartPanning()) {
      deferHeavyWork();
      return Promise.resolve();
    }
    const epoch = getDataEpoch();
    const symbol = pane.symbol;
    const resolution = pane.resolution;
    const generation = pane._historyGeneration ?? 0;
    const key = epoch + "|" + pane.index + "|" + symbol + "|" + resolution + "|" + generation;
    const pending = paneOverlayInFlight.get(key);
    if (pending) return pending;
    const task = (async () => {
      await ensurePaneData(pane, { skipRefresh: true });
      if (!hostIsActive() || getDataEpoch() !== epoch || pane.symbol !== symbol || pane.resolution !== resolution ||
        (pane._historyGeneration ?? 0) !== generation || !paneBarsMatchCurrentSeries(pane)) return;
      requestOverlayRefresh(pane.index);
    })().finally(() => paneOverlayInFlight.delete(key));
    paneOverlayInFlight.set(key, task);
    return task;
  }

  return {
    scheduleLoad,
    ensureNow: () => scheduleLoad(0),
    ensurePaneDataThenOverlay,
    extendHtfTailForReplay,
    recoverIndicatorDataForPanes,
    scheduleCompareBarsFetch,
    scheduleHtfBarsFetch,
    isCompareDataUnavailable,
    newsContextForPane,
  };
}
