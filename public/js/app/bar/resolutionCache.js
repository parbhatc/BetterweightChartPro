import { chartDebug } from "../../debug/chart/index.js";
import { invalidatePaneChartView } from "../../chart/pane/viewCache.js";

/** Keep bars warm after switching resolution or for another pane. */
export const RESOLUTION_CACHE_TTL_MS = 30 * 60_000;
/** Replay snapshots use the same bounded retention as live intervals. */
export const RESOLUTION_CACHE_REPLAY_TTL_MS = RESOLUTION_CACHE_TTL_MS;
/** Bound retained scrollback even when users visit many symbols/intervals. */
export const RESOLUTION_CACHE_MAX_SERIES_PER_SCOPE = 12;
export const RESOLUTION_CACHE_MAX_BARS_PER_SCOPE = 60_000;
export const RESOLUTION_CACHE_MAX_SERIES = 48;
export const RESOLUTION_CACHE_MAX_BARS = 240_000;

/** @type {boolean} */
let replayExtendedTtl = false;

/** @param {boolean} active */
export function setResolutionCacheReplayTtl(active) {
  replayExtendedTtl = Boolean(active);
}

function cacheTtlMs() {
  return replayExtendedTtl ? RESOLUTION_CACHE_REPLAY_TTL_MS : RESOLUTION_CACHE_TTL_MS;
}

/**
 * @typedef {{
 *   bars: object[],
 *   _historyExhausted: boolean,
 *   _firstDataRequest: boolean,
 * }} ResolutionSnapshot
 */

/**
 * @typedef {{
 *   snapshot: ResolutionSnapshot,
 *   updatedAt: number,
 *   timer: ReturnType<typeof setTimeout> | null,
 * }} CacheEntry
 */

/** @type {Map<string, CacheEntry>} */
const entries = new Map();
/** @type {WeakMap<object, number>} */
const scopeIds = new WeakMap();
let nextScopeId = 1;

/**
 * Resolution snapshots are reusable only inside the chart widget that loaded
 * them. A replay and live widget can use the same symbol/resolution while
 * reading from entirely different timelines.
 * @param {object | null | undefined} scope
 */
function cacheScopeId(scope) {
  if ((typeof scope !== "object" && typeof scope !== "function") || scope === null) {
    return "global";
  }
  let id = scopeIds.get(scope);
  if (id == null) {
    id = nextScopeId;
    nextScopeId += 1;
    scopeIds.set(scope, id);
  }
  return String(id);
}

/**
 * @param {string} symbol
 * @param {string} resolution
 * @param {object} [scope]
 */
export function seriesCacheKey(symbol, resolution, scope) {
  return `${cacheScopeId(scope)}|${symbol}|${resolution}`;
}

/**
 * @param {object} pane
 * @returns {ResolutionSnapshot | null}
 */
function snapshotFromPane(pane) {
  if (!pane.bars?.length) return null;
  const loaded = pane._barSeriesIdentity;
  if (loaded && (loaded.symbol !== pane.symbol || loaded.resolution !== pane.resolution)) return null;
  return {
    bars: pane.bars.slice(),
    _historyExhausted: Boolean(pane._historyExhausted),
    _firstDataRequest: pane._firstDataRequest !== false,
  };
}

/**
 * @param {object} pane
 * @param {ResolutionSnapshot} snapshot
 */
function applySnapshotToPane(pane, snapshot) {
  pane.bars = snapshot.bars.slice();
  pane._barSeriesIdentity = { symbol: pane.symbol, resolution: pane.resolution };
  pane._historyGeneration = (pane._historyGeneration ?? 0) + 1;
  pane._historyRestorePending = false;
  pane._deferredHistoryOlder = null;
  pane._deferredLiveBar = null;
  pane._historyExhausted = snapshot._historyExhausted;
  pane._firstDataRequest = snapshot._firstDataRequest;
  invalidatePaneChartView(pane);
}

/**
 * @param {string} k
 * @param {"ttl" | "expired" | "capacity"} reason
 */
function evict(k, reason) {
  const entry = entries.get(k);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entries.delete(k);
  chartDebug("data", "resolution cache evict", {
    symbol: entry.symbol,
    resolution: entry.resolution,
    reason,
    bars: entry.snapshot.bars.length,
  });
}

/**
 * @param {string} symbol
 * @param {string} resolution
 * @param {ResolutionSnapshot} snapshot
 * @param {object} [scope]
 */
function putEntry(symbol, resolution, snapshot, scope) {
  const k = seriesCacheKey(symbol, resolution, scope);
  const prev = entries.get(k);
  if (prev?.timer) clearTimeout(prev.timer);

  // A peer pane may have loaded only its viewport. Keep previously fetched
  // left-hand scrollback when that shorter pane publishes the same series.
  const older = prev?.snapshot.bars[0]?.time < snapshot.bars[0].time
    ? prev.snapshot.bars.filter((bar) => bar.time < snapshot.bars[0].time)
    : [];
  const retained = older.length ? {
    ...snapshot,
    bars: [...older, ...snapshot.bars],
    _historyExhausted: snapshot._historyExhausted || prev.snapshot._historyExhausted,
  } : snapshot;
  const entry = {
    symbol,
    resolution,
    scopeId: cacheScopeId(scope),
    snapshot: retained,
    updatedAt: Date.now(),
    timer: null,
  };

  // Published entries also expire: a destroyed widget must not retain bars
  // forever simply because no subsequent timeframe switch stashed them.
  entry.timer = setTimeout(() => evict(k, "ttl"), cacheTtlMs());
  entry.timer.unref?.();
  entries.delete(k);
  entries.set(k, entry);
  enforceCapacity(entry.scopeId);
}

function enforceCapacity(scopeId) {
  const trim = (matches, maxSeries, maxBars) => {
    const candidates = [...entries].filter(([, entry]) => matches(entry));
    let count = candidates.length;
    let bars = candidates.reduce((total, [, entry]) => total + entry.snapshot.bars.length, 0);
    for (const [key, entry] of candidates) {
      if (count <= maxSeries && bars <= maxBars) break;
      evict(key, "capacity");
      count -= 1;
      bars -= entry.snapshot.bars.length;
    }
  };
  trim((entry) => entry.scopeId === scopeId, RESOLUTION_CACHE_MAX_SERIES_PER_SCOPE, RESOLUTION_CACHE_MAX_BARS_PER_SCOPE);
  trim(() => true, RESOLUTION_CACHE_MAX_SERIES, RESOLUTION_CACHE_MAX_BARS);
}

function findEntry(symbol, resolution, scope) {
  const key = seriesCacheKey(symbol, resolution, scope);
  const entry = entries.get(key);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > cacheTtlMs()) {
    evict(key, "expired");
    return null;
  }
  // Map order is the LRU order. Reading does not extend data age: a restored
  // live series must still repair its complete tail before publishing anew.
  entries.delete(key);
  entries.set(key, entry);
  return entry;
}

/**
 * Read published bars for symbol+resolution (e.g. reuse 15m if user switched from 15m chart).
 * @param {string} symbol
 * @param {string} resolution
 * @param {object} [scope]
 * @returns {object[] | null}
 */
export function getResolutionCacheBars(symbol, resolution, scope) {
  const entry = findEntry(symbol, resolution, scope);
  if (!entry) return null;
  return entry.snapshot.bars.slice();
}

/**
 * Publish loaded bars so other panes with the same symbol + interval can reuse them.
 * @param {object} pane
 * @param {object} [scope]
 */
export function publishResolutionCache(pane, scope) {
  if (pane._replaySnapshot) return;
  const snapshot = snapshotFromPane(pane);
  if (!snapshot || !pane.symbol || !pane.resolution) return;

  putEntry(pane.symbol, pane.resolution, snapshot, scope);
  chartDebug("data", "resolution cache publish", {
    pane: pane.index,
    symbol: pane.symbol,
    resolution: pane.resolution,
    bars: snapshot.bars.length,
  });
}

export function clearResolutionCache() {
  for (const entry of entries.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  entries.clear();
  chartDebug("data", "resolution cache clear all");
}

/**
 * Snapshot pane bars for a resolution before switching away (starts TTL eviction).
 * @param {object} pane
 * @param {string} resolution — interval being left (not the new one)
 * @param {object} [scope]
 */
export function stashPaneResolutionCache(pane, resolution, scope) {
  if (pane._replaySnapshot) return;
  if (!pane.bars?.length || !pane.symbol || !resolution) return;

  const snapshot = snapshotFromPane(pane);
  if (!snapshot) return;

  putEntry(pane.symbol, resolution, snapshot, scope);
  chartDebug("data", "resolution cache stash", {
    pane: pane.index,
    symbol: pane.symbol,
    resolution,
    bars: snapshot.bars.length,
    ttlMs: cacheTtlMs(),
  });
}

/**
 * Restore pane bars from the shared cache when switching back or opening another pane.
 * @param {object} pane
 * @param {object} [scope]
 * @returns {boolean}
 */
export function tryRestorePaneResolutionCache(pane, scope) {
  if (!pane.symbol || !pane.resolution) return false;

  const entry = findEntry(pane.symbol, pane.resolution, scope);
  if (!entry) return false;

  const ageMs = Date.now() - entry.updatedAt;
  applySnapshotToPane(pane, entry.snapshot);
  chartDebug("data", "resolution cache hit", {
    pane: pane.index,
    symbol: pane.symbol,
    resolution: pane.resolution,
    bars: pane.bars.length,
    ageMs,
    shared: true,
  });
  return true;
}
