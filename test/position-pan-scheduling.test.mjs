import test from "node:test";
import assert from "node:assert/strict";
import { createPositionOverlay } from "../public/js/chart/orderLine/positionOverlay.js";

function createHarness(t) {
  const oldRaf = globalThis.requestAnimationFrame;
  const oldCancel = globalThis.cancelAnimationFrame;
  const callbacks = new Map();
  const cancelled = [];
  let requests = 0;
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++requests;
    callbacks.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    cancelled.push(id);
    callbacks.delete(id);
  };
  t.mock.method(performance, "now", () => 1_000);
  t.after(() => {
    if (oldRaf) globalThis.requestAnimationFrame = oldRaf;
    else delete globalThis.requestAnimationFrame;
    if (oldCancel) globalThis.cancelAnimationFrame = oldCancel;
    else delete globalThis.cancelAnimationFrame;
  });

  let panning = false;
  let liveBarListener = null;
  const lines = [];
  const upls = [];
  const createLine = () => {
    const appearances = [];
    const handlers = {};
    let price = 0;
    const line = {
      appearances,
      handlers,
      removed: false,
      isMoving: false,
      applyAppearance(patch) { appearances.push(structuredClone(patch)); return this; },
      setPrice(next) { price = next; return this; },
      getPrice() { return price; },
      onCancel(callback) { handlers.cancel = callback; return this; },
      onMove(callback) { handlers.move = callback; return this; },
      onMoving(callback) { handlers.moving = callback; return this; },
      remove() { this.removed = true; },
    };
    for (const method of [
      "setText", "setQuantity", "setLineColor", "setBodyBackgroundColor",
      "setQuantityBackgroundColor", "setBodyTextColor", "setQuantityTextColor",
      "setLineStyle", "setLineLength", "setPillSide", "setPillOffset",
      "setCancelTooltip", "setQuantityBorderColor", "setBodyBorderColor",
    ]) {
      line[method] = function () { return this; };
    }
    lines.push(line);
    return line;
  };
  const overlay = createPositionOverlay({
    chart: () => ({ createOrderLine: async () => createLine() }),
    getBars: () => [{ close: 100 }],
    getSymbolInfo: () => ({ ticker: "MNQ", minmov: 1, pricescale: 4 }),
    isChartPanning: () => panning,
    onLiveBar(callback) {
      liveBarListener = callback;
      return () => { liveBarListener = null; };
    },
    emitPositionUpl(pnl) { upls.push(pnl); },
  });
  return {
    overlay,
    lines,
    upls,
    callbacks,
    cancelled,
    get requests() { return requests; },
    setPanning(value) { panning = value; },
    emitBar(bar) { liveBarListener?.(bar); },
    flushFrame() {
      const batch = [...callbacks];
      callbacks.clear();
      for (const [, callback] of batch) callback();
    },
  };
}

test("thousands of marks during pan retain one latest display without scheduling frames", async (t) => {
  const h = createHarness(t);
  await h.overlay.buy({ price: 100, qty: 1 });
  const line = h.lines[0];
  const initialPaints = line.appearances.length;
  h.setPanning(true);
  for (let i = 1; i <= 4_000; i += 1) {
    h.overlay.setMarkPrice(100 + i * 0.25);
    h.emitBar({ close: 99 });
  }
  assert.equal(h.requests, 0);
  assert.equal(h.callbacks.size, 0);
  assert.equal(line.appearances.length, initialPaints);
  assert.equal(h.upls.length, 0, "visual UP&L callbacks wait until the chart is released");
  assert.equal(h.overlay.flushDeferredPnl(), false);

  h.setPanning(false);
  assert.equal(h.overlay.flushDeferredPnl(), true);
  assert.equal(h.requests, 0, "release paints the final mark without another animation frame");
  assert.equal(line.appearances.length, initialPaints + 1);
  assert.equal(line.appearances.at(-1).text, "+$2,000.00");
  assert.deepEqual(h.upls, [2_000]);
  assert.equal(h.overlay.flushDeferredPnl(), false);
  h.overlay.clear();
});

test("a frame queued before pan retains its mark until release", async (t) => {
  const h = createHarness(t);
  await h.overlay.buy(100);
  const line = h.lines[0];
  const initialPaints = line.appearances.length;
  h.overlay.setMarkPrice(101);
  assert.equal(h.requests, 1);
  h.setPanning(true);
  h.flushFrame();
  assert.equal(line.appearances.length, initialPaints);
  h.setPanning(false);
  assert.equal(h.overlay.flushDeferredPnl(), true, "a queued frame keeps its mark without another tick");
  assert.equal(line.appearances.at(-1).text, "+$2.00");

  h.setPanning(true);
  for (let i = 1; i <= 1_000; i += 1) h.overlay.setMarkPrice(105);
  assert.equal(h.requests, 1);
  h.setPanning(false);
  assert.equal(h.overlay.flushDeferredPnl(), true);
  assert.equal(line.appearances.length, initialPaints + 2);
  assert.equal(line.appearances.at(-1).text, "+$10.00");
  assert.equal(h.overlay.flushDeferredPnl(), false);
  h.overlay.clear();
});

test("unchanged host book marks do not schedule repeated P&L frames", async (t) => {
  const h = createHarness(t);
  await h.overlay.buy(100);
  h.overlay.setMarkPrice(101);
  for (let i = 0; i < 1_000; i += 1) h.overlay.setMarkPrice(101);
  assert.equal(h.requests, 1);
  h.flushFrame();
  assert.equal(h.lines[0].appearances.at(-1).text, "+$2.00");
  for (let i = 0; i < 1_000; i += 1) h.overlay.setMarkPrice(101);
  assert.equal(h.requests, 1);
  assert.equal(h.callbacks.size, 0);
  h.overlay.setMarkPrice(102);
  assert.equal(h.requests, 2);
  h.flushFrame();
  assert.equal(h.lines[0].appearances.at(-1).text, "+$4.00");
  h.overlay.clear();
});

test("close cancels its display frame and stale callbacks cannot touch a later position", async (t) => {
  const h = createHarness(t);
  const closed = [];
  h.overlay.onClose((snapshot) => closed.push(snapshot));
  await h.overlay.buy(100);
  const oldLine = h.lines[0];
  h.overlay.setMarkPrice(101);
  const staleCallback = [...h.callbacks.values()][0];
  h.overlay.clear();
  assert.deepEqual(h.cancelled, [1]);
  assert.equal(h.callbacks.size, 0);
  assert.equal(h.overlay.flushDeferredPnl(), false);
  assert.equal(closed.length, 1);
  assert.equal(oldLine.removed, true);
  const oldPaints = oldLine.appearances.length;

  await h.overlay.buy(100);
  const newLine = h.lines[1];
  h.overlay.setMarkPrice(103);
  const newPaints = newLine.appearances.length;
  staleCallback();
  assert.equal(oldLine.appearances.length, oldPaints);
  assert.equal(newLine.appearances.length, newPaints);
  assert.equal(h.callbacks.size, 1, "stale callbacks preserve the new position's scheduled frame");
  h.flushFrame();
  assert.equal(newLine.appearances.at(-1).text, "+$6.00");
  h.overlay.clear();
});

test("destroy cancels queued and deferred P&L marks without emitting a close", async (t) => {
  const h = createHarness(t);
  let closes = 0;
  h.overlay.onClose(() => { closes += 1; });
  await h.overlay.buy(100);
  h.overlay.setMarkPrice(101);
  const staleCallback = [...h.callbacks.values()][0];
  h.setPanning(true);
  h.overlay.setMarkPrice(105);
  h.overlay.destroy();
  h.setPanning(false);
  assert.deepEqual(h.cancelled, [1]);
  assert.equal(h.callbacks.size, 0);
  assert.equal(h.overlay.flushDeferredPnl(), false);
  staleCallback();
  assert.deepEqual(h.upls, []);
  assert.equal(closes, 0);
  assert.equal(h.overlay.getPosition(), null);
});

test("a deferred mark is discarded when the position closes before pan release", async (t) => {
  const h = createHarness(t);
  await h.overlay.buy(100);
  h.setPanning(true);
  h.overlay.setMarkPrice(105);
  h.overlay.clear();
  h.setPanning(false);
  await h.overlay.buy(100);
  const newLine = h.lines[1];
  const newPaints = newLine.appearances.length;
  assert.equal(h.overlay.flushDeferredPnl(), false);
  assert.equal(newLine.appearances.length, newPaints);
  assert.equal(newLine.appearances.at(-1).text, "+$0.00");
  assert.equal(h.requests, 0);
  h.overlay.clear();
});

test("pan deferral preserves pending-limit fills and bracket callbacks", async (t) => {
  const h = createHarness(t);
  const opened = [];
  const stopChanges = [];
  const targetChanges = [];
  h.overlay.onOpen((snapshot) => opened.push(snapshot));
  h.overlay.onStopLossChanged((oldPrice, newPrice) => stopChanges.push([oldPrice, newPrice]));
  h.overlay.onTakeProfitChanged((oldPrice, newPrice) => targetChanges.push([oldPrice, newPrice]));
  await h.overlay.buyLimit(99, { qty: 2 });
  h.setPanning(true);
  h.emitBar({ close: 100, low: 98, high: 101 });
  await new Promise(setImmediate);
  assert.equal(h.lines[0].removed, true);
  assert.equal(opened.length, 1);
  assert.deepEqual(h.overlay.getPosition(), { entry: 99, qty: 2, stopLoss: null, takeProfit: null });
  await h.overlay.setStopLoss(95);
  await h.overlay.setTakeProfit(105);
  h.overlay.clearStopLoss();
  h.overlay.clearTakeProfit();
  assert.deepEqual(stopChanges, [[null, 95], [95, null]]);
  assert.deepEqual(targetChanges, [[null, 105], [105, null]]);
  assert.equal(h.requests, 0);

  h.setPanning(false);
  assert.equal(h.overlay.flushDeferredPnl(), true);
  assert.equal(h.lines[1].appearances.at(-1).text, "+$4.00");
  h.overlay.clear();
});
