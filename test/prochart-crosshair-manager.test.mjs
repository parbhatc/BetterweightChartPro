import test from "node:test";
import assert from "node:assert/strict";

import { CrosshairManager } from "../public/vendor/prochart/crosshair/crosshairManager.mjs";
import { pointInRightPriceAxis } from "../public/vendor/prochart/utils/hitTest.mjs";
import { pointInRightPriceAxis as legacyPointInRightPriceAxis } from "../public/vendor/prochart/api/chartModel.mjs";

test("right price-axis hit testing remains available through the legacy export", () => {
  assert.equal(legacyPointInRightPriceAxis, pointInRightPriceAxis);
  assert.equal(pointInRightPriceAxis(390, 844, 72, 28, 350, 400), true);
  assert.equal(pointInRightPriceAxis(390, 844, 72, 28, 317, 400), false);
});

test("CrosshairManager owns mapping, payload generation, hit testing, and rAF fan-out", () => {
  const queuedFrames = [];
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    queuedFrames.push(callback);
    return queuedFrames.length;
  };
  globalThis.cancelAnimationFrame = () => {};

  try {
    const seriesApi = { id: "series-api" };
    const bar = { time: 1_002, close: 42 };
    const hitTestCalls = [];
    const seriesModel = {
      dataByIndex: (logical) => logical === 2 ? bar : null,
      overlays: new Set([{
        hitTest(x, y) {
          hitTestCalls.push({ x, y });
          return { externalId: "overlay-1" };
        },
      }]),
    };
    const rightPriceScale = {
      priceToCoordinate: (price) => price + 5,
    };
    let invalidations = 0;
    const model = {
      _destroyed: false,
      timeScale: {
        coordinateToLogical: (x) => x / 10,
        indexToTime: (logical) => logical + 1_000,
        timeToIndex: () => 7,
        logicalToCoordinate: (logical) => logical * 10,
      },
      panes: [{
        index: 0,
        top: 20,
        series: [seriesModel],
        priceScales: new Map([["right", rightPriceScale]]),
      }],
      seriesApis: new Map([[seriesModel, seriesApi]]),
      paneIndexAtY: () => 0,
      invalidateCrosshairOnly: () => {
        invalidations += 1;
      },
      priceScaleModelFor: () => rightPriceScale,
    };
    const manager = new CrosshairManager(model);
    const notifications = [];
    manager.subscribers.add((param) => notifications.push(param));

    manager.update(12, 25, { clientX: 100, pointerType: "mouse" });
    manager.update(18, 30, { clientX: 101, pointerType: "mouse" });

    assert.equal(queuedFrames.length, 1);
    assert.equal(manager.state.logical, 1.8);
    assert.equal(invalidations, 2);

    queuedFrames.shift()();

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].logical, 1.8);
    assert.equal(notifications[0].time, 1_002);
    assert.equal(notifications[0].seriesData.get(seriesApi), bar);
    assert.equal(notifications[0].hoveredObjectId, "overlay-1");
    assert.equal(notifications[0].sourceEvent.clientX, 101);
    assert.equal(notifications[0].sourceEvent.localX, 18);
    assert.deepEqual(hitTestCalls, [{ x: 18, y: 10 }]);

    manager.setPosition(5, 1_007);

    assert.equal(manager.state.external, true);
    assert.equal(manager.state.logical, 7);
    assert.equal(manager.state.x, 70);
    assert.equal(manager.state.y, 30);
    assert.equal(notifications.length, 2);

    manager.destroy();
    assert.equal(manager.subscribers.size, 0);
  } finally {
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
  }
});
