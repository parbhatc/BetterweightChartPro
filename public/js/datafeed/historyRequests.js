/**
 * Per-widget history broker. Chart panes and indicator caches all use this
 * boundary, including host-supplied datafeeds. Never share account/source or
 * replay history through a module-global response cache.
 */
export const HISTORY_CACHE_TTL_MS = 10_000;
const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_MAX_BARS = 100_000;
const DEFAULT_PENDING_TTL_MS = 20_000;

function copyResult(result) {
  return {
    ...result,
    bars: (result?.bars ?? []).map((bar) => ({ ...bar })),
    ...(result?.meta ? { meta: { ...result.meta } } : {}),
  };
}

/**
 * Preserve host-specific SymbolInfo/period fields in the key. Two aliases can
 * have the same ticker while selecting different broker accounts or sessions.
 */
function createKeyEncoder() {
  const identities = new WeakMap();
  let nextId = 0;
  const identity = (value) => {
    if (!identities.has(value)) identities.set(value, ++nextId);
    return identities.get(value);
  };
  function encode(value, seen = new Set()) {
    if (value === undefined) return "undefined";
    if (typeof value === "number" && !Number.isFinite(value)) return String(value);
    if (typeof value === "bigint") return `bigint:${value}`;
    if (typeof value === "function") return `function:${identity(value)}`;
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== null && prototype !== Object.prototype) {
      return `object:${identity(value)}`;
    }
    if (seen.has(value)) return `reference:${identity(value)}`;
    seen.add(value);
    const out = Array.isArray(value)
      ? `[${value.map((item) => encode(item, seen)).join(",")}]`
      : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${encode(value[key], seen)}`).join(",")}}`;
    seen.delete(value);
    return out;
  }
  return encode;
}

/**
 * Reuse a larger response only when its actual bars prove coverage. Calendar
 * ranges alone cannot prove countBack coverage across market closures, and a
 * short provider response must never hide a missing older page.
 */
function samePeriodSemantics(a, b, encode) {
  const fields = (params) => {
    const { from: _from, to: _to, countBack: _countBack, requestReason: _reason, ...rest } = params;
    return rest;
  };
  return encode(fields(a)) === encode(fields(b));
}

function coveredResult(entry, period, encode) {
  const request = entry.period;
  const to = Number(period.to);
  const from = Number(period.from);
  const count = Number(period.countBack);
  if (!Number.isFinite(to) || !Number.isFinite(from) || !(count > 0)) return null;
  if (!Number.isFinite(Number(request.to)) || to > Number(request.to)) return null;
  if (!samePeriodSemantics(request, period, encode)) return null;
  const bars = entry.result.bars.filter((bar) => bar.time >= from && bar.time <= to);
  if (bars.length < count) return null;
  const selected = bars.slice(-Math.ceil(count));
  // Exhaustion at the beginning of the larger page does not mean a smaller,
  // later slice has exhausted the source's older history.
  const noData = Boolean(entry.result.noData && selected[0]?.time === entry.result.bars[0]?.time);
  return {
    ...entry.result,
    bars: selected,
    noData,
    ...(entry.result.meta ? { meta: { ...entry.result.meta, noData } } : {}),
  };
}

/**
 * Wrap without mutating the host's shared source or changing method receivers.
 * `historyCache.clear()` detaches pending work as well as settled responses;
 * a reconnect/reset must not join or republish pre-reset history.
 *
 * @param {object} datafeed
 * @param {{ ttlMs?: number, maxEntries?: number, maxBars?: number, pendingTtlMs?: number, now?: () => number, onStatsChange?: (stats: object) => void }} [options]
 */
export function createHistoryRequestCache(datafeed, options = {}) {
  if (!datafeed || typeof datafeed.getBars !== "function") return datafeed;
  options ??= {};
  const ttlMs = Math.max(0, options.ttlMs ?? HISTORY_CACHE_TTL_MS);
  const maxEntries = Math.max(0, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const maxBars = Math.max(0, options.maxBars ?? DEFAULT_MAX_BARS);
  const pendingTtlMs = Math.max(1, options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS);
  const now = options.now ?? Date.now;
  const onStatsChange = typeof options.onStatsChange === "function" ? options.onStatsChange : null;
  const encode = createKeyEncoder();
  const entries = new Map();
  const pending = new Map();
  const subscribers = new Set();
  const overrides = new Map();
  const bound = new Map();
  let cachedBars = 0;
  let disposed = false;
  const counts = { requests: 0, upstreamRequests: 0, cacheHits: 0, coveringHits: 0, inflightJoins: 0, invalidations: 0 };

  const seriesKey = (info, resolution) => encode([info, String(resolution)]);
  const snapshotStats = () => ({ ...counts, entries: entries.size, cachedBars, pending: pending.size });
  function notify(listener, snapshot) {
    try {
      listener(snapshot);
    } catch {
      // Diagnostic listeners must never interrupt chart loading.
    }
  }
  function publishStats() {
    if (!onStatsChange && !subscribers.size) return;
    // Only numeric counters are published, never account/symbol metadata.
    const snapshot = Object.freeze(snapshotStats());
    if (onStatsChange) notify(onStatsChange, snapshot);
    for (const listener of subscribers) notify(listener, snapshot);
  }
  function removeEntry(key) {
    const entry = entries.get(key);
    if (!entry) return;
    cachedBars -= entry.result.bars.length;
    entries.delete(key);
  }
  function trim() {
    const time = now();
    for (const [key, entry] of entries) {
      if (time - entry.createdAt >= ttlMs) removeEntry(key);
    }
    // Consumers such as HTF loaders have their own deadlines. Once that wait
    // ends, a retry must not keep joining an underlying request that hung.
    for (const [key, entry] of pending) {
      if (time - entry.createdAt < pendingTtlMs) continue;
      entry.invalidated = true;
      pending.delete(key);
    }
    while (entries.size > maxEntries || cachedBars > maxBars) {
      removeEntry(entries.keys().next().value);
    }
  }
  function invalidate(predicate = () => true, notifyEmpty = false) {
    counts.invalidations += 1;
    let changed = false;
    for (const [key, entry] of entries) {
      if (!predicate(entry)) continue;
      removeEntry(key);
      changed = true;
    }
    for (const [key, entry] of pending) {
      if (!predicate(entry)) continue;
      entry.invalidated = true;
      pending.delete(key);
      changed = true;
    }
    if (changed || notifyEmpty) publishStats();
  }

  const historyCache = {
    clear: () => invalidate(undefined, true),
    dispose() {
      disposed = true;
      invalidate(undefined, true);
      subscribers.clear();
    },
    stats() {
      trim();
      return snapshotStats();
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      notify(listener, Object.freeze(snapshotStats()));
      if (!disposed) subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  };

  async function getBars(info, resolution, period = {}, retry = false) {
    if (!retry) counts.requests += 1;
    if (disposed) {
      publishStats();
      return { bars: [], noData: true };
    }
    trim();
    const series = seriesKey(info, resolution);
    // requestReason describes the caller for diagnostics; it never changes the
    // market data requested and must not defeat chart/indicator deduplication.
    const { requestReason: _reason, ...keyPeriod } = period;
    const key = encode([series, keyPeriod]);
    const refresh = period.refresh === true;
    if (refresh) {
      // Refresh is an explicit freshness boundary. Keep concurrent refresh
      // work shareable, but never rejoin or republish an older ordinary fetch.
      invalidate((entry) => {
        if (entry.series !== series || entry.period.refresh === true) return false;
        const from = Number(period.from);
        const to = Number(period.to);
        const entryFrom = Number(entry.period.from);
        const entryTo = Number(entry.period.to);
        return ![from, to, entryFrom, entryTo].every(Number.isFinite) ||
          (entryFrom <= to && from <= entryTo);
      });
    }
    const exact = refresh ? null : entries.get(key);
    if (exact) {
      counts.cacheHits += 1;
      entries.delete(key);
      entries.set(key, exact);
      publishStats();
      return copyResult(exact.result);
    }
    const existing = pending.get(key);
    if (existing) {
      counts.inflightJoins += 1;
      publishStats();
      return copyResult(await existing.promise);
    }
    for (const entry of refresh ? [] : entries.values()) {
      if (entry.series !== series) continue;
      const result = coveredResult(entry, period, encode);
      if (!result) continue;
      counts.cacheHits += 1;
      counts.coveringHits += 1;
      publishStats();
      return copyResult(result);
    }

    for (const entry of pending.values()) {
      if (entry.series !== series || !samePeriodSemantics(entry.period, period, encode)) continue;
      if (!Number.isFinite(Number(period.from)) || !Number.isFinite(Number(period.to)) || !(Number(period.countBack) > 0)) continue;
      if (!Number.isFinite(Number(entry.period.from)) || !Number.isFinite(Number(entry.period.to))) continue;
      if (Number(entry.period.from) > Number(period.from) || Number(entry.period.to) < Number(period.to) ||
          !(Number(entry.period.countBack) >= Number(period.countBack))) continue;
      publishStats();
      try {
        const response = await entry.promise;
        if (!entry.invalidated) {
          const result = coveredResult({ ...entry, result: response }, period, encode);
          if (result) {
            counts.inflightJoins += 1;
            counts.coveringHits += 1;
            publishStats();
            return copyResult(result);
          }
        }
      } catch {
        // A different range's failure must not poison this request's retry.
      }
      // A short/overlapping provider result cannot prove coverage; recheck the
      // maps before making the required request, in case another caller did.
      return getBars(info, resolution, period, true);
    }

    const entry = { series, period: { ...period }, createdAt: now(), invalidated: false, promise: null };
    counts.upstreamRequests += 1;
    entry.promise = Promise.resolve().then(() => datafeed.getBars(info, resolution, entry.period)).then((result) => {
      const snapshot = copyResult(result);
      // Empty/error responses can be transient and must remain retryable.
      if (!disposed && !entry.invalidated && !refresh && snapshot.bars.length && ttlMs && maxEntries && maxBars) {
        entries.set(key, { series, period: entry.period, result: snapshot, createdAt: entry.createdAt });
        cachedBars += snapshot.bars.length;
        trim();
      }
      return snapshot;
    }).finally(() => {
      if (pending.get(key) === entry) pending.delete(key);
      publishStats();
    });
    pending.set(key, entry);
    publishStats();
    return copyResult(await entry.promise);
  }

  overrides.set("getBars", getBars);
  overrides.set("historyCache", historyCache);
  if (typeof datafeed.subscribeBars === "function") {
    overrides.set("subscribeBars", (info, resolution, onTick, ...args) => {
      const series = seriesKey(info, resolution);
      return datafeed.subscribeBars(info, resolution, (bar, ...tickArgs) => {
        const time = Number(bar?.time);
        invalidate((entry) => entry.series === series &&
          (!Number.isFinite(time) || entry.period.to == null || Number(entry.period.to) >= time));
        onTick(bar, ...tickArgs);
      }, ...args);
    });
  }
  for (const method of ["setBars", "pushBar", "updateBar", "set", "push"]) {
    if (typeof datafeed[method] !== "function") continue;
    overrides.set(method, (...args) => {
      invalidate();
      return datafeed[method](...args);
    });
  }
  // Debug instrumentation can replace methods on this wrapper without altering
  // the source used by another chart widget.
  return new Proxy({}, {
    get(_target, key) {
      if (overrides.has(key)) return overrides.get(key);
      const value = Reflect.get(datafeed, key, datafeed);
      if (typeof value !== "function") return value;
      if (!bound.has(key)) bound.set(key, value.bind(datafeed));
      return bound.get(key);
    },
    set(_target, key, value) {
      overrides.set(key, value);
      return true;
    },
    has(_target, key) {
      return overrides.has(key) || key in datafeed;
    },
    ownKeys() {
      return [...new Set([...Reflect.ownKeys(datafeed), ...overrides.keys()])];
    },
    getOwnPropertyDescriptor(_target, key) {
      if (!overrides.has(key) && !Object.hasOwn(datafeed, key)) return undefined;
      return { configurable: true, enumerable: true, writable: true };
    },
  });
}
