import test from "node:test";
import assert from "node:assert/strict";
import { createOrderLineAdapter } from "../public/js/chart/orderLine/createOrderLineAdapter.js";
import { createOrderLinePriceLineSync } from "../public/js/chart/orderLine/orderLinePriceLineSync.js";
import { OrderLineManager } from "../public/js/chart/orderLine/OrderLineManager.js";
import { OrderLinePillPrimitive } from "../public/js/chart/orderLine/OrderLinePillPrimitive.js";
import { createPositionOverlay } from "../public/js/chart/orderLine/positionOverlay.js";
import { ExecutionShapeManager } from "../public/js/chart/executionShape/ExecutionShapeManager.js";

test("execution markers can be hidden and restored without removing them", async () => {
  let visible = true;
  let primitive = null;
  const pane = {
    series: {
      attachPrimitive(next) { primitive = next; },
      detachPrimitive(current) {
        if (primitive === current) primitive = null;
      },
    },
  };
  const manager = new ExecutionShapeManager(() => pane, {
    isVisible: () => visible,
  });

  const marker = await manager.createExecutionShape();
  marker.setTime(1_798_520_400).setPrice(20_000).setDirection("buy");
  assert.equal(manager._activeStates().length, 1);

  visible = false;
  assert.deepEqual(manager._activeStates(), []);
  assert.ok(primitive, "hiding markers keeps the renderer and marker data available");

  visible = true;
  assert.equal(manager._activeStates().length, 1);

  manager.destroy();
  assert.equal(primitive, null);
});

test("order-line hit testing reuses pane geometry until layout invalidation", () => {
  let rectReads = 0;
  const pane = {
    el: {
      getBoundingClientRect() {
        rectReads += 1;
        return { left: 10, top: 20, width: 800, height: 500 };
      },
    },
  };
  const manager = new OrderLineManager(() => pane);
  manager._paneRef = pane;

  assert.deepEqual(
    manager._clientToPane({ clientX: 30, clientY: 50 }),
    {
      pane,
      x: 20,
      y: 30,
      rect: { left: 10, top: 20, width: 800, height: 500 },
    },
  );
  manager._clientToPane({ clientX: 40, clientY: 60 });
  assert.equal(rectReads, 1);

  manager._invalidatePaneRect();
  manager._clientToPane({ clientX: 40, clientY: 60 });
  assert.equal(rectReads, 2);
});

test("order lines fall back to ProChart price lines and primitives", () => {
  const priceLines = new Set();
  const primitives = new Set();
  let optionsCalls = 0;
  const series = {
    createPriceLine(options) {
      let current = structuredClone(options);
      const line = {
        applyOptions(patch) { current = { ...current, ...structuredClone(patch) }; },
        options() {
          optionsCalls += 1;
          return structuredClone(current);
        },
      };
      priceLines.add(line);
      return line;
    },
    removePriceLine(line) { priceLines.delete(line); },
    attachPrimitive(primitive) {
      primitives.add(primitive);
      primitive.attached({
        chart: { paneSize: () => ({ width: 800, height: 500 }) },
        series,
        requestUpdate() {},
      });
    },
    detachPrimitive(primitive) { primitives.delete(primitive); primitive.detached(); },
    priceToCoordinate() { return 250; },
  };
  const sync = createOrderLinePriceLineSync(() => ({ series }));
  sync.sync([{ id: "position", price: 100, text: "Long", quantity: "1", lineColor: "#10b981" }]);
  assert.equal(priceLines.size, 0, "compat order lines stay off the main chart canvas");
  assert.equal(primitives.size, 1);

  const primitive = [...primitives][0];
  assert.strictEqual(primitive.paneViews(), primitive.paneViews());
  assert.strictEqual(
    primitive.paneViews()[0].renderer(),
    primitive.paneViews()[0].renderer(),
  );

  let measureCalls = 0;
  const context = new Proxy(
    {
      measureText(text) {
        measureCalls += 1;
        return { width: String(text).length * 7 };
      },
    },
    {
      get(target, property) {
        if (property in target) return target[property];
        return () => {};
      },
    },
  );
  const target = {
    useMediaCoordinateSpace(draw) {
      draw({
        context,
        mediaSize: { width: 800, height: 500 },
      });
    },
  };
  const renderer = primitive.paneViews()[0].renderer();
  renderer.draw(target);
  renderer.draw(target);
  assert.equal(measureCalls, 2);
  assert.equal(optionsCalls, 0);

  sync.sync([{
    id: "position",
    price: 101,
    text: "Long",
    quantity: "1",
    lineColor: "#ef4444",
    isMoving: true,
  }]);
  renderer.draw(target);
  assert.equal(measureCalls, 2, "price/color/moving patches retain text measurements");
  assert.equal(optionsCalls, 0, "compat patches never clone full price-line options");

  sync.sync([{
    id: "position",
    price: 101,
    text: "Longer label",
    quantity: "1",
    lineColor: "#ef4444",
  }]);
  renderer.draw(target);
  assert.equal(measureCalls, 4, "text patches invalidate both row measurements");

  sync.sync([]);
  assert.equal(priceLines.size, 0);
  assert.equal(primitives.size, 0);
});

test("order-line pill placement uses the primitive render target width", () => {
  const primitive = new OrderLinePillPrimitive({
    id: "position",
    price: 100,
    color: "#10b981",
    pills: {
      body: { text: "Long" },
      quantity: { text: "1" },
    },
  });
  primitive.attached({
    chart: {
      paneSize() {
        throw new Error("renderer must not query chart layout");
      },
    },
    series: {
      priceToCoordinate() {
        return 50;
      },
    },
    requestUpdate() {},
  });

  const fillRects = [];
  const context = new Proxy(
    {
      measureText(text) {
        return { width: String(text).length * 7 };
      },
      fillRect(...args) {
        fillRects.push(args);
      },
    },
    {
      get(target, property) {
        if (property in target) return target[property];
        return () => {};
      },
    },
  );
  primitive.paneViews()[0].renderer().draw({
    useMediaCoordinateSpace(draw) {
      draw({
        context,
        mediaSize: { width: 320, height: 100 },
      });
    },
  });

  assert.ok(
    fillRects.some(([x, , width]) => x === 290 && width === 20),
    "right-side cancel pill should be inset 10px from the 320px render target",
  );
  primitive.detached();
});

test("a pinned order line migrates to the pane under the Auto cursor", () => {
  const makePane = (index) => {
    const primitives = new Set();
    const series = {
      attachPrimitive(primitive) { primitives.add(primitive); },
      detachPrimitive(primitive) { primitives.delete(primitive); },
    };
    return { index, series, primitives };
  };
  const nq = makePane(0);
  const es = makePane(1);
  const panes = [nq, es];
  const sync = createOrderLinePriceLineSync(() => nq, () => panes);
  const state = { id: "auto-preview", price: 100, text: "Risk $100", quantity: "1", paneIndex: 1 };

  sync.sync([state]);
  assert.equal(nq.primitives.size, 0);
  assert.equal(es.primitives.size, 1);

  state.paneIndex = 0;
  state.price = 101;
  sync.sync([state]);
  assert.equal(nq.primitives.size, 1);
  assert.equal(es.primitives.size, 0);

  sync.destroy();
  assert.equal(nq.primitives.size, 0);
  assert.equal(es.primitives.size, 0);
});

test("order-line pill text updates invalidate only the lightweight top layer", () => {
  let fullUpdates = 0;
  let topLayerUpdates = 0;
  const primitive = new OrderLinePillPrimitive({
    id: "position",
    price: 100,
    pills: {
      body: { text: "$1.00" },
    },
  });
  primitive.attached({
    chart: {},
    series: {
      priceToCoordinate() {
        return 50;
      },
    },
    requestUpdate() {
      fullUpdates += 1;
    },
    requestTopLayerUpdate() {
      topLayerUpdates += 1;
    },
  });

  primitive.applyOptions({
    pills: {
      body: { text: "$1.25" },
    },
  });

  assert.equal(primitive.paneViews()[0].useTopCanvas, true);
  assert.equal(topLayerUpdates, 1);
  assert.equal(fullUpdates, 0);
  primitive.detached();
});

test("live PnL appearance patches never invalidate the price-line stroke", () => {
  const nativePatches = [];
  const adapter = createOrderLineAdapter({ requestRefresh() {} }, "position");
  adapter._state._nativeLine = {
    applyOptions(patch) {
      nativePatches.push(structuredClone(patch));
    },
  };

  adapter.applyAppearance({
    text: "+$25.00",
    quantityText: "2",
    fill: "#10b981",
    quantityFill: "#2563eb",
    textColor: "#ffffff",
  });

  assert.deepEqual(nativePatches, [{
    pills: {
      body: {
        text: "+$25.00",
        backgroundColor: "#10b981",
        textColor: "#ffffff",
      },
      quantity: {
        backgroundColor: "#2563eb",
        text: "2",
        visible: true,
        textColor: "#ffffff",
      },
    },
  }]);
  assert.equal(adapter._state.lineColor, "#089981");
});

test("host mark price keeps the position pill on live LTP instead of candle close", async () => {
  const previousRaf = globalThis.requestAnimationFrame;
  let pendingRaf = null;
  globalThis.requestAnimationFrame = (callback) => {
    pendingRaf = callback;
    return 1;
  };
  const flushRaf = () => {
    const callback = pendingRaf;
    pendingRaf = null;
    callback?.();
  };
  try {
    let liveBarListener = null;
    const appearances = [];
    const chain = {
      isMoving: false,
      applyAppearance(patch) { appearances.push(structuredClone(patch)); return this; },
      onCancel() { return this; },
      onMove() { return this; },
      onMoving() { return this; },
      remove() {},
    };
    for (const method of [
      "setText", "setQuantity", "setLineColor", "setBodyBackgroundColor",
      "setQuantityBackgroundColor", "setBodyTextColor", "setQuantityTextColor",
      "setLineStyle", "setLineLength", "setPillSide", "setPillOffset",
      "setCancelTooltip", "setQuantityBorderColor", "setBodyBorderColor", "setPrice",
    ]) {
      chain[method] = function () { return this; };
    }
    const overlay = createPositionOverlay({
      chart: () => ({ createOrderLine: async () => chain }),
      getBars: () => [{ close: 100 }],
      getSymbolInfo: () => ({ ticker: "CME_MINI:MNQ1!", minmov: 1, pricescale: 4 }),
      isChartPanning: () => false,
      onLiveBar(callback) { liveBarListener = callback; return () => {}; },
      emitPositionUpl() {},
    });

    overlay.setPresentation({ symbolLabel: "MNQ", tickSize: 0.25, tickValue: 0.5 });
    await overlay.buy({ price: 100, qty: 1 });
    assert.equal(overlay.setMarkPrice(101), true);
    flushRaf();
    assert.equal(appearances.at(-1).text, "MNQ · +$2.00");
    assert.equal(overlay.setMarkPrice(102), true);
    flushRaf();
    assert.equal(appearances.at(-1).text, "MNQ · +$4.00");

    liveBarListener?.({ close: 99 });
    assert.equal(appearances.at(-1).text, "MNQ · +$4.00");
  } finally {
    if (previousRaf) globalThis.requestAnimationFrame = previousRaf;
    else delete globalThis.requestAnimationFrame;
  }
});

test("a bracket drag updates its model price even when rounded P&L text is unchanged", async () => {
  const lines = [];
  const createLine = () => {
    let price = 0;
    let moving = null;
    let moved = null;
    const line = {
      isMoving: false,
      getPrice() { return price; },
      setPrice(next) { price = next; return this; },
      onMoving(callback) { moving = callback; return this; },
      onMove(callback) { moved = callback; return this; },
      onCancel() { return this; },
      applyAppearance() { return this; },
      remove() {},
      fireMoving() { moving?.(); },
      fireMove() { moved?.(); },
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
    getSymbolInfo: () => ({ ticker: "CME_MINI:MNQ1!", minmov: 1, pricescale: 4 }),
    isChartPanning: () => false,
    onLiveBar: () => () => {},
    emitPositionUpl() {},
  });

  overlay.setPresentation({ symbolLabel: "MNQ", tickSize: 0.25, tickValue: 0.5 });
  await overlay.sell({ price: 100, qty: 1 });
  await overlay.setTakeProfit(90);
  const changes = [];
  overlay.onTakeProfitChanged((oldPrice, newPrice) => {
    changes.push([oldPrice, newPrice]);
  });
  const takeProfitLine = lines[1];
  takeProfitLine.setPrice(90.000001);
  takeProfitLine.fireMoving();

  assert.equal(overlay.getPosition().takeProfit, 90.000001);
  takeProfitLine.fireMove();
  assert.deepEqual(changes, [[90, 90.000001]]);
});

test("a partial close keeps the remaining position and brackets on the chart", async () => {
  const lines = [];
  const createLine = () => {
    const state = { quantity: "", removed: false };
    const line = {
      isMoving: false,
      state,
      applyAppearance() { return this; },
      onCancel() { return this; },
      onMove() { return this; },
      onMoving() { return this; },
      remove() { state.removed = true; },
    };
    for (const method of [
      "setText", "setLineColor", "setBodyBackgroundColor",
      "setQuantityBackgroundColor", "setBodyTextColor", "setQuantityTextColor",
      "setLineStyle", "setLineLength", "setPillSide", "setPillOffset",
      "setCancelTooltip", "setQuantityBorderColor", "setBodyBorderColor", "setPrice",
    ]) {
      line[method] = function () { return this; };
    }
    line.setQuantity = function (quantity) { state.quantity = String(quantity); return this; };
    lines.push(line);
    return line;
  };
  const overlay = createPositionOverlay({
    chart: () => ({ createOrderLine: async () => createLine() }),
    getBars: () => [{ close: 95 }],
    getSymbolInfo: () => ({ ticker: "CME_MINI:MNQ1!", minmov: 1, pricescale: 4 }),
    isChartPanning: () => false,
    onLiveBar: () => () => {},
    emitPositionUpl() {},
  });

  overlay.setPresentation({ symbolLabel: "MNQ", tickSize: 0.25, tickValue: 0.5 });
  await overlay.sell({ price: 100, qty: 6 });
  await overlay.setStopLoss(105);
  await overlay.setTakeProfit(90);
  await overlay.modifyPosition({ entry: 100, qty: -5 });

  assert.deepEqual(overlay.getPosition(), {
    entry: 100,
    qty: -5,
    stopLoss: 105,
    takeProfit: 90,
  });
  assert.equal(lines[0].state.removed, false);
  assert.equal(lines[0].state.quantity, "5");
  assert.equal(lines[1].state.quantity, "5");
  assert.equal(lines[2].state.quantity, "5");
});
