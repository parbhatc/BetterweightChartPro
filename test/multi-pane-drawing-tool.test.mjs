import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Keep the actual drawing hub, controllers, commit policy and pointer handlers.
// Only the visual toolbar mounts and browser surfaces are replaced in Node.
class Element {
  style = {};
  hidden = false;
  listeners = new Map();
  addEventListener(type, fn) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(fn);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  closest() { return null; }
  appendChild() {}
  setAttribute() {}
  remove() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 500 }; }
  pointer(type, x = 600, y = 350) {
    const event = {
      type, target: this, pointerId: 1, pointerType: "mouse", button: 0,
      buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y,
      preventDefault() {}, stopImmediatePropagation() {},
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const storage = new Map();
globalThis.HTMLElement = Element;
globalThis.window = Object.assign(new Element(), { matchMedia: () => ({ matches: false }) });
globalThis.document = Object.assign(new Element(), {
  createElement: () => new Element(), querySelector: () => null,
});
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
};
// These tests exercise synchronous commits; no queued visual crosshair work is needed.
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

const hooks = registerHooks({ resolve(specifier, context, next) {
  const exportName = specifier === "../toolbars/main/index.js" ? "mountMainToolbar"
    : specifier === "../toolbars/edit/index.js" ? "mountEditToolbar" : null;
  if (exportName && context.parentURL.endsWith("/drawings/multi/paneHub.js")) {
    return {
      url: `data:text/javascript,export function ${exportName}(){return {destroy(){}}}`,
      shortCircuit: true,
    };
  }
  return next(specifier, context);
} });
const { createMultiPaneDrawingHub } = await import("../public/js/drawings/multi/paneHub.js");
hooks.deregister();

function fixture(t, syncDrawings = false) {
  storage.clear();
  t.mock.method(console, "log", () => {});
  const bars = [{ time: 1_800_000_000, open: 100, high: 110, low: 90, close: 105 }];
  const context = {
    bars, barSec: 60,
    timeAdapter: {
      time: { toUtc: t => t, toChart: t => t },
      coord: {
        fromClient: (_chart, _series, _container, x, y) => ({ time: bars[0].time + x * 60, price: y }),
        xFromUtc: (_chart, time) => (time - bars[0].time) / 60,
        yFromPrice: (_series, price) => price,
      },
    },
  };
  const hub = createMultiPaneDrawingHub({
    toolbarEl: new Element(), getContextForPane: () => context,
    getSyncDrawings: () => syncDrawings,
  });
  t.after(() => hub.destroy());
  const panes = [];
  function attach(index) {
    const container = new Element();
    const applied = [];
    const scale = { subscribeVisibleLogicalRangeChange() {}, unsubscribeVisibleLogicalRangeChange() {} };
    const chart = {
      applyOptions: options => applied.push(options), clearCrosshairPosition() {},
      subscribeCrosshairMove() {}, unsubscribeCrosshairMove() {}, timeScale: () => scale,
    };
    const series = { attachPrimitive() {}, detachPrimitive() {}, priceToCoordinate: price => price };
    const ctrl = hub.attachPane(index, { chart, series, container });
    ctrl.setValuesTooltipOnLongPress(false);
    const pane = { ctrl, container, applied };
    panes[index] = pane;
    return pane;
  }
  attach(0);
  attach(1);
  return { hub, panes, attach };
}

const positionPoints = [
  { time: 1_800_000_000, price: 105 },
  { time: 1_800_000_600, price: 115 },
];

test("committing a long position disarms the other chart before its next click", t => {
  const { hub, panes } = fixture(t);
  let toolEvents = 0;
  hub.facade.on("toolChange", () => toolEvents++);
  hub.facade.setActiveTool("long-position");
  assert.deepEqual(panes.map(p => p.ctrl.getActiveTool()), ["long-position", "long-position"]);
  assert.equal(toolEvents, 1, "one toolbar selection publishes one hub event");
  panes[0].ctrl.addDrawing("long-position", positionPoints);
  assert.deepEqual(panes.map(p => p.ctrl.getActiveTool()), ["cursor", "cursor"]);
  assert.equal(toolEvents, 2, "the controller's commit transition publishes once without echoing");
  assert.equal(panes[1].applied.at(-1).handleScroll.pressedMouseMove, true, "peer chart panning is restored immediately");
  hub.setActivePane(1);
  panes[1].ctrl.armChartPlacementSuppress(-1);
  panes[1].container.pointer("pointerdown");
  panes[1].container.pointer("pointerup");
  assert.deepEqual(panes.map(p => p.ctrl.getCount()), [1, 0], "clicking the other chart cannot create a second position");
});

test("controller tool changes propagate from chart 2 with drawing contents linked or independent", t => {
  for (const linked of [false, true]) {
    const { hub, panes } = fixture(t, linked);
    hub.setActivePane(1);
    hub.facade.setActiveTool("short-position");
    panes[1].ctrl.addDrawing("short-position", positionPoints);
    assert.deepEqual(panes.map(p => p.ctrl.getActiveTool()), ["cursor", "cursor"]);
    assert.deepEqual(panes.map(p => p.ctrl.getCount()), linked ? [1, 1] : [0, 1]);
    panes[1].ctrl.setActiveTool("trend-line");
    assert.deepEqual(panes.map(p => p.ctrl.getActiveTool()), ["trend-line", "trend-line"]);
    panes[1].ctrl.setActiveTool("cursor");
    assert.deepEqual(panes.map(p => p.ctrl.getActiveTool()), ["cursor", "cursor"], "controller Escape/cancel transitions share the same path");
  }
});

test("explicit stay-in-drawing mode and tools retained after commit remain armed", t => {
  const { hub, panes } = fixture(t);
  hub.facade.setStayInDrawingMode(true);
  hub.facade.setActiveTool("long-position");
  panes[0].ctrl.addDrawing("long-position", positionPoints);
  assert.deepEqual(panes.map(p => p.ctrl.getActiveTool()), ["long-position", "long-position"]);
  hub.facade.setStayInDrawingMode(false);
  for (const tool of ["brush", "path", "polyline"]) {
    hub.facade.setActiveTool(tool);
    panes[1].ctrl.addDrawing(tool, positionPoints);
    assert.deepEqual(panes.map(p => p.ctrl.getActiveTool()), [tool, tool]);
  }
});

test("new panes inherit the layout tool and mode, including selections before attachment", t => {
  const { hub, panes, attach } = fixture(t);
  hub.facade.setStayInDrawingMode(true);
  hub.facade.setActiveTool("long-position");
  const third = attach(2);
  assert.equal(third.ctrl.getActiveTool(), "long-position");
  assert.equal(third.ctrl.getStayInDrawingMode(), true);
  third.ctrl.addDrawing("long-position", positionPoints);
  assert.deepEqual(panes.map(p => p.ctrl.getActiveTool()), ["long-position", "long-position", "long-position"]);
  for (let i = 0; i < 3; i++) hub.detachPane(i);
  hub.facade.setActiveTool("trend-line");
  assert.equal(hub.facade.getActiveTool(), "trend-line");
  assert.equal(attach(0).ctrl.getActiveTool(), "trend-line");
});
