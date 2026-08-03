/** @param {object[]} bars @param {object | undefined} runtime */
function appendedOneBar(bars, runtime) {
  if (!runtime?.snapshot || runtime.head == null) return false;
  if (bars.length !== runtime.length + 1 || bars[0]?.time !== runtime.head) return false;
  return bars[bars.length - 2]?.time === runtime.tail;
}

/** @param {object[]} bars @param {object | undefined} runtime */
function prependedHistory(bars, runtime) {
  if (runtime?.head == null || !bars.length || bars[0]?.time === runtime.head) return false;
  return bars.at(-1)?.time === runtime.tail && bars.length > (runtime.length ?? 0);
}

/**
 * Shared lifecycle for expensive drawing overlays with optional incremental
 * patches. Study code supplies stable keys and calculation callbacks; the chart
 * owns cache hits, prepend invalidation, append/live/external-data selection,
 * and runtime bookkeeping.
 *
 * @param {object} options
 * @param {object[]} options.chartBars
 * @param {object} options.instance
 * @param {{ chart: string, data?: string, live?: string }} options.keys
 * @param {() => { output: object[], snapshot?: object | null }} options.full
 * @param {(snapshot: object, previous: object[]) => ({ output: object[], snapshot?: object | null } | null)} [options.patchData]
 * @param {(snapshot: object, previous: object[]) => ({ output: object[], snapshot?: object | null } | null)} [options.patchAppend]
 * @param {(snapshot: object, previous: object[]) => ({ output: object[], snapshot?: object | null } | null)} [options.patchLive]
 * @param {string} [options.runtimeKey]
 */
export function runIncrementalOverlay(options) {
  const {
    chartBars,
    instance,
    keys,
    full,
    patchData,
    patchAppend,
    patchLive,
    runtimeKey = "_incrementalOverlayRuntime",
  } = options;
  const dataKey = keys.data ?? "";
  const liveKey = keys.live ?? "";
  const fullKey = `${keys.chart}|data:${dataKey}`;
  const meta = {
    length: chartBars.length,
    head: chartBars[0]?.time ?? null,
    tail: chartBars.at(-1)?.time ?? null,
  };
  let runtime = instance[runtimeKey];
  if (prependedHistory(chartBars, runtime)) {
    delete instance[runtimeKey];
    runtime = null;
  }

  if (runtime?.fullKey === fullKey && runtime.liveKey === liveKey && Array.isArray(runtime.output)) {
    return runtime.output;
  }

  const tryPatch = (callback) => {
    if (!runtime?.snapshot || typeof callback !== "function") return null;
    return callback(runtime.snapshot, runtime.output ?? []);
  };
  let patched = null;
  if (runtime?.chartKey === keys.chart && runtime.dataKey !== dataKey) patched = tryPatch(patchData);
  if (!patched && appendedOneBar(chartBars, runtime)) patched = tryPatch(patchAppend);
  if (!patched && runtime?.chartKey === keys.chart && runtime.liveKey !== liveKey) {
    patched = tryPatch(patchLive);
  }

  if (patched) {
    instance[runtimeKey] = {
      fullKey,
      chartKey: keys.chart,
      dataKey,
      liveKey,
      snapshot: patched.snapshot ?? runtime.snapshot,
      output: patched.output,
      ...meta,
    };
    return patched.output;
  }

  const complete = full();
  instance[runtimeKey] = {
    fullKey,
    chartKey: keys.chart,
    dataKey,
    liveKey,
    snapshot: complete.snapshot ?? null,
    output: complete.output ?? [],
    ...meta,
  };
  return complete.output ?? [];
}

/** Whether a cached overlay needs another pass because its live key changed. */
export function incrementalOverlayNeedsRefresh(instance, liveKey, runtimeKey = "_incrementalOverlayRuntime") {
  const runtime = instance?.[runtimeKey];
  return !runtime?.snapshot || runtime.liveKey !== liveKey;
}
