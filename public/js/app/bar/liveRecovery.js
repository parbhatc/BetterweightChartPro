import { captureVisibleViewport, restoreVisibleViewport } from "../../chart/pane/viewport.js";
import { invalidatePaneChartView } from "../../chart/pane/viewCache.js";
import { symbolDelayFromInfo } from "../../datafeed/symbolDelay.js";
import { buildTvPeriodParams } from "./periodParams.js";
import { paneBarsMatchCurrentSeries } from "./symbolBarCache.js";
import { alignedSeriesBucketOpen } from "../../indicators/security/sessionBuckets.js";

const RECOVERY_PAGE = 500;

function cancelled() {
  const error = new Error("Live history recovery was superseded");
  error.name = "AbortError";
  return error;
}

/** Incremental live recovery; snapshots are scoped to this widget and timeline. */
export function createLiveHistoryRecovery(opts) {
  const snapshots = new WeakMap();
  const capturedBarsByRecord = new WeakMap();
  const pending = new WeakMap();
  const panes = () => opts.getAllChartPanes?.() ?? [];
  const replay = (pane) => Boolean(
    opts.isReplayLocked?.() || opts.getReplayLoadContext?.(pane) ||
    opts.getReplayLoadCapTo?.(pane) != null,
  );

  function captureResumeState() {
    const records = panes().filter((pane) =>
      pane.bars?.length && paneBarsMatchCurrentSeries(pane) && !replay(pane),
    ).map((pane) => ({
      pane,
      index: pane.index,
      symbol: pane.symbol,
      resolution: pane.resolution,
      lastTime: pane.bars.at(-1).time,
      fromTime: pane.bars.at(-2)?.time ?? pane.bars.at(-1).time,
      generation: pane._historyGeneration ?? 0,
    }));
    const snapshot = {
      version: 1,
      capturedAt: Date.now(),
      panes: records.map(({ pane: _pane, ...record }) => ({ ...record })),
    };
    for (const record of records) {
      capturedBarsByRecord.set(record, new Map(record.pane.bars.map((bar) => [bar.time, bar])));
    }
    snapshots.set(snapshot, { records, capturedAt: snapshot.capturedAt });
    return snapshot;
  }

  function recoverPane(record, shouldContinue, requestReason = "chart.resume-gap", deferChartRefresh = false) {
    const pane = record.pane;
    const currentSeries = () =>
      panes().includes(pane) && !replay(pane) &&
      paneBarsMatchCurrentSeries(pane) && pane.symbol === record.symbol &&
      pane.resolution === record.resolution &&
      (pane._historyGeneration ?? 0) === record.generation;
    const valid = () => shouldContinue() && currentSeries();
    const interruption = () => {
      const error = cancelled();
      error.seriesReplaced = shouldContinue() && !currentSeries();
      return error;
    };
    if (!valid()) return Promise.reject(interruption());
    const existing = pending.get(pane);
    if (existing?.symbol === record.symbol && existing.resolution === record.resolution && existing.generation === record.generation) {
      existing.from = Math.min(existing.from, record.fromTime);
      existing.callers.add(valid);
      return existing.promise;
    }
    const task = {
      symbol: record.symbol, resolution: record.resolution, generation: record.generation,
      from: record.fromTime, callers: new Set([valid]), promise: null,
    };
    pending.set(pane, task);
    const active = () => pending.get(pane) === task && [...task.callers].some((check) => check());
    task.promise = (async () => {
      const barSec = Math.max(1, Number(opts.getBarSecForPane?.(pane)) || 60);
      const delay = symbolDelayFromInfo(pane.symbolInfo).delayMinutes * 60;
      const to = Math.max(record.lastTime, alignedSeriesBucketOpen(
        Date.now() / 1000 - delay, barSec, pane.bars.at(-1)?.time ?? record.lastTime,
      ));
      let cursor = to;
      const recovered = new Map();
      // Retry the same checkpoint without overwriting quotes that arrived
      // after the first repair failed or while the browser was resuming.
      const before = capturedBarsByRecord.get(record) ?? new Map(pane.bars.map((bar) => [bar.time, bar]));
      let requests = 0;
      while (cursor >= task.from) {
        if (!active()) throw interruption();
        const countBack = Math.min(RECOVERY_PAGE, Math.ceil((cursor - task.from) / barSec) + 1);
        const params = {
          ...buildTvPeriodParams({ barSec, countBack, to: cursor }),
          refresh: true,
          requestReason,
        };
        const result = await opts.datafeed.getBars(pane.symbolInfo, record.resolution, params);
        requests += 1;
        if (!active()) throw interruption();
        const page = (result.bars ?? []).filter((bar) => Number.isFinite(bar.time) && bar.time <= cursor);
        if (!page.length) throw new Error(`No candles returned while recovering ${record.symbol} ${record.resolution}`);
        let oldest = Infinity;
        for (const bar of page) {
          oldest = Math.min(oldest, bar.time);
          if (bar.time >= task.from) recovered.set(bar.time, bar);
        }
        if (oldest <= task.from) break;
        const next = oldest - barSec;
        if (next >= cursor) throw new Error("Live history recovery did not advance");
        cursor = next;
      }
      if (!active()) throw interruption();
      const viewport = deferChartRefresh ? null : captureVisibleViewport(pane.chart);
      const merged = new Map(pane.bars.map((bar) => [bar.time, bar]));
      for (const [time, bar] of recovered) {
        const live = merged.get(time);
        if (live && live !== before.get(time)) continue;
        merged.set(time, bar);
      }
      const oldCount = pane.bars.length;
      const firstTimeBefore = pane.bars[0]?.time ?? null;
      pane.bars = [...merged.values()].sort((left, right) => left.time - right.time);
      invalidatePaneChartView(pane);
      if (!deferChartRefresh) {
        opts.refreshPaneCandleData?.(pane, { avoidPreserveViewport: false, deferSessionBg: true });
        restoreVisibleViewport(pane.chart, viewport);
      }
      opts.onRecovered?.(pane);
      if (!deferChartRefresh) pane.sessionBg?.requestRefresh();
      return {
        index: pane.index, symbol: record.symbol, resolution: record.resolution,
        from: task.from, to, fromTime: task.from, toTime: to,
        requests, repairedBars: recovered.size, added: pane.bars.length - oldCount,
        beforeBars: oldCount, afterBars: pane.bars.length,
        firstTimeBefore, firstTimeAfter: pane.bars[0]?.time ?? null,
      };
    })().finally(() => {
      if (pending.get(pane) === task) pending.delete(pane);
    });
    return task.promise;
  }

  async function recoverLiveHistory(options = {}) {
    const snapshot = options.since ?? captureResumeState();
    const saved = snapshots.get(snapshot);
    if (!saved) throw new Error("Recovery snapshot belongs to a different chart widget");
    const shouldContinue = typeof options.shouldContinue === "function" ? options.shouldContinue : () => true;
    if (!shouldContinue()) throw cancelled();
    const skipped = [];
    const completed = new Map();
    const sameSeries = (record, pane) => record?.pane === pane && record.symbol === pane.symbol && record.resolution === pane.resolution && record.generation === (pane._historyGeneration ?? 0);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (!shouldContinue()) throw cancelled();
      const deadline = Date.now() + 2000;
      while (panes().some((pane) => !replay(pane) && (!pane.bars?.length || !paneBarsMatchCurrentSeries(pane)))) {
        if (!shouldContinue()) throw cancelled();
        if (Date.now() >= deadline) throw new Error("Waiting for replacement chart candles before live recovery");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const records = panes().filter((pane) => pane.bars?.length && !replay(pane)).map((pane) => {
        const original = saved.records.find((record) => sameSeries(record, pane));
        if (original) return original;
        // A replacement timeframe may have loaded while the browser was hidden.
        // Its newest tick is not proof that the intervening candles are present.
        const barSec = Math.max(1, Number(opts.getBarSecForPane?.(pane)) || 60);
        const delay = symbolDelayFromInfo(pane.symbolInfo).delayMinutes * 60;
        const captureClock = saved.capturedAt / 1000 - delay;
        const formingAtHide = alignedSeriesBucketOpen(captureClock, barSec, pane.bars.at(-1)?.time);
        const beforeHide = pane.bars.filter((bar) => bar.time <= captureClock);
        const actualOverlap = beforeHide.at(-2)?.time ?? beforeHide.at(-1)?.time ?? Infinity;
        return {
          pane, index: pane.index, symbol: pane.symbol, resolution: pane.resolution,
          generation: pane._historyGeneration ?? 0,
          fromTime: Math.max(pane.bars[0].time, Math.min(formingAtHide - barSec, actualOverlap)),
          lastTime: formingAtHide,
        };
      });
      const pendingRecords = records.filter((record) => !sameSeries(completed.get(record.pane)?.record, record.pane));
      if (!pendingRecords.length) {
        const current = records.map((record) => completed.get(record.pane)?.result).filter(Boolean);
        return {
          panes: current, skipped,
          recoverySince: { version: 1, capturedAt: saved.capturedAt, panes: records.map(({ pane: _pane, ...record }) => ({ ...record })) },
        };
      }
      await Promise.all(pendingRecords.map(async (record) => {
        try {
          const result = await recoverPane(record, shouldContinue);
          completed.set(record.pane, { record, result });
        } catch (error) {
          if (!error.seriesReplaced) throw error;
          skipped.push({ index: record.index, symbol: record.symbol, resolution: record.resolution, reason: "series-replaced" });
        }
      }));
    }
    throw new Error("Chart series kept changing during live recovery");
  }

  /** Repair one restored timeframe with the same paged, atomic gap recovery. */
  function recoverPaneHistory(pane, options = {}) {
    const snapshot = options.since ?? captureResumeState();
    const saved = snapshots.get(snapshot);
    if (!saved) return Promise.reject(new Error("Recovery snapshot belongs to a different chart widget"));
    const record = saved.records.find((candidate) => candidate.pane === pane);
    if (!record) return Promise.resolve(null);
    const shouldContinue = typeof options.shouldContinue === "function" ? options.shouldContinue : () => true;
    return recoverPane(record, shouldContinue, options.requestReason, options.deferChartRefresh);
  }

  return { captureResumeState, recoverLiveHistory, recoverPaneHistory };
}
