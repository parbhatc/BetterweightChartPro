import test from "node:test";
import assert from "node:assert/strict";
import { createOrderLineAdapter } from "../public/js/chart/orderLine/createOrderLineAdapter.js";
import { createOrderLinePriceLineSync } from "../public/js/chart/orderLine/orderLinePriceLineSync.js";
import { OrderLineManager } from "../public/js/chart/orderLine/OrderLineManager.js";
import { OrderLinePillPrimitive } from "../public/js/chart/orderLine/OrderLinePillPrimitive.js";
import { createPositionOverlay } from "../public/js/chart/orderLine/positionOverlay.js";

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
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
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

    await overlay.buy({ price: 100, qty: 1 });
    assert.equal(overlay.setMarkPrice(101), true);
    assert.equal(appearances.at(-1).text, "+$2.00");

    liveBarListener?.({ close: 99 });
    assert.equal(appearances.at(-1).text, "+$2.00");
  } finally {
    if (previousRaf) globalThis.requestAnimationFrame = previousRaf;
    else delete globalThis.requestAnimationFrame;
  }
});
