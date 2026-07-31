import test from "node:test";
import assert from "node:assert/strict";

const previousWindow = globalThis.window;
globalThis.window = {
  ...(previousWindow ?? {}),
  matchMedia: () => ({ matches: false }),
};
const { attachCrosshair } = await import(
  "../public/js/drawings/controller/crosshair.js"
);
const { COARSE_POINTER_MQ } = await import(
  "../public/js/drawings/controller/state.js"
);
if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;

test("drawing crosshair and dot retain the cursor's exact media coordinate", () => {
  const exactPositions = [];
  const fallbackPositions = [];
  let clearCalls = 0;
  const dot = { hidden: true, style: {} };
  const ctx = {
    activeTool: "trendline",
    isCursorTool: (tool) => tool === "cursor",
    draggingDrawing: false,
    magnetMode: "off",
    chart: {
      setCrosshairPositionAtCoordinate(x, y) {
        exactPositions.push({ x, y });
      },
      setCrosshairPosition(price, time) {
        fallbackPositions.push({ price, time });
      },
      isPointInPlot: (x, y) => x < 600 && y < 500,
      clearCrosshairPosition() {
        clearCalls += 1;
      },
    },
    series: {},
    container: {
      getBoundingClientRect: () => ({ left: 40, top: 30 }),
    },
    drawCrosshairDot: dot,
    pinnedDrawCrosshair: null,
    lastNativeDrawCrosshair: null,
    drawCrosshairMedia: null,
    lastDrawCrosshairParam: null,
    emit() {},
    getContext: () => ({
      timeAdapter: {
        coord: {
          fromClient: () => ({ price: 28420, time: 1234 }),
          fromMedia: () => ({ price: 28420, time: 1234 }),
        },
      },
    }),
  };

  attachCrosshair(ctx);
  ctx.syncDrawCrosshair(180, 250);

  assert.deepEqual(ctx.drawCrosshairMedia, { x: 140, y: 220 });
  assert.deepEqual(exactPositions, [{ x: 140, y: 220 }]);
  assert.deepEqual(fallbackPositions, []);
  assert.equal(dot.style.left, "140px");
  assert.equal(dot.style.top, "220px");
  assert.equal(dot.hidden, false);

  ctx.syncDrawCrosshairAtMediaAnchor();
  assert.deepEqual(exactPositions.at(-1), { x: 140, y: 220 });

  ctx.syncDrawCrosshair(700, 250);
  assert.equal(clearCalls, 1);
  assert.equal(dot.hidden, true);
  assert.equal(ctx.drawCrosshairMedia, null);
});

test("mobile drawing crosshair follows the touch anchor without drifting from its dot", () => {
  const exactPositions = [];
  let crosshairMoveListener = null;
  const dot = { hidden: true, style: {} };
  const ctx = {
    activeTool: "trendline",
    isCursorTool: (tool) => tool === "cursor",
    draggingDrawing: false,
    chart: {
      setCrosshairPositionAtCoordinate(x, y) {
        exactPositions.push({ x, y });
      },
      setCrosshairPosition() {
        assert.fail("mobile media tracking must not snap through time/price");
      },
      isPointInPlot: () => true,
      clearCrosshairPosition() {},
      subscribeCrosshairMove(listener) {
        crosshairMoveListener = listener;
      },
      unsubscribeCrosshairMove() {},
      timeScale() {
        return {
          subscribeVisibleLogicalRangeChange() {},
          unsubscribeVisibleLogicalRangeChange() {},
        };
      },
    },
    series: {},
    container: {
      getBoundingClientRect: () => ({ left: 25, top: 15 }),
    },
    drawCrosshairDot: dot,
    pinnedDrawCrosshair: null,
    lastNativeDrawCrosshair: null,
    drawCrosshairMedia: null,
    lastDrawCrosshairParam: null,
    anchoringDrawCrosshair: false,
    unsubDrawCrosshairDotSync() {},
    emit() {},
    getContext: () => ({
      timeAdapter: {
        coord: {
          fromMedia: () => ({ price: 28420, time: 1234 }),
        },
      },
    }),
  };

  COARSE_POINTER_MQ.matches = true;
  try {
    attachCrosshair(ctx);
    ctx.setDrawCrosshairAtClient(205, 275);

    assert.deepEqual(ctx.drawCrosshairMedia, { x: 180, y: 260 });
    assert.deepEqual(exactPositions, [{ x: 180, y: 260 }]);
    assert.equal(dot.style.left, "180px");
    assert.equal(dot.style.top, "260px");
    assert.equal(dot.hidden, false);

    ctx.bindDrawCrosshairDotSync();
    crosshairMoveListener({});
    assert.equal(dot.hidden, false);
    assert.equal(dot.style.left, "180px");
    assert.equal(dot.style.top, "260px");

    ctx.clearDrawCrosshair();
    assert.equal(dot.hidden, true);
  } finally {
    COARSE_POINTER_MQ.matches = false;
  }
});
