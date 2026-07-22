import test from "node:test";
import assert from "node:assert/strict";
import { createOrderLinePriceLineSync } from "../public/js/chart/orderLine/orderLinePriceLineSync.js";

test("order lines fall back to ProChart price lines and primitives", () => {
  const priceLines = new Set();
  const primitives = new Set();
  const series = {
    createPriceLine(options) {
      let current = structuredClone(options);
      const line = {
        applyOptions(patch) { current = { ...current, ...structuredClone(patch) }; },
        options() { return structuredClone(current); },
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
  assert.equal(priceLines.size, 1);
  assert.equal(primitives.size, 1);
  sync.sync([]);
  assert.equal(priceLines.size, 0);
  assert.equal(primitives.size, 0);
});
