import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "prochart") return {
      url: new URL("../public/vendor/prochart/index.mjs", import.meta.url).href,
      shortCircuit: true,
    };
    return next(specifier, context);
  },
});

const { attachLayoutPersistence } = await import("../public/js/app/boot/chart/layoutPersistence.js");
const { createLayoutManager, loadSavedLayouts } = await import("../public/js/ui/header/layout/manager.js");
const { createLayoutSync } = await import("../public/js/app/layout/sync.js");

class Element {
  constructor() {
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.clientWidth = 1000;
    this.clientHeight = 600;
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  appendChild(child) { this.children.push(child); }
  insertBefore(child) { this.appendChild(child); }
  querySelector() { return null; }
  setAttribute() {}
  addEventListener() {}
  removeEventListener() {}
  remove() {}
}

function fixture(autoSave = true) {
  const original = Object.fromEntries(["document", "localStorage", "setTimeout", "clearTimeout"].map((key) => [key, globalThis[key]]));
  const storage = new Map();
  const writes = [];
  const timers = new Map();
  let nextTimer = 0;
  let clones = 0;
  let headerUpdates = 0;
  globalThis.document = { createElement: () => new Element() };
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem(key, value) { writes.push(key); storage.set(key, value); },
  };
  globalThis.setTimeout = (callback) => { timers.set(++nextTimer, callback); return nextTimer; };
  globalThis.clearTimeout = (id) => timers.delete(id);
  const manager = createLayoutManager({
    stageEl: new Element(), primaryWrapEl: new Element(),
    createSecondaryPane: () => ({ wrapEl: new Element(), destroy() {} }),
    destroySecondaryPane() {},
  });
  manager.setAutoSave(autoSave);
  const drawings = { 0: [{ id: "ray", type: "horizontal-ray", points: [{ time: 60, price: 100 }] }] };
  let range = { from: 0, to: 2 };
  const pane = {
    index: 0, resolution: "1", symbol: "TEST",
    bars: [60, 120, 180].map((time) => ({ time, open: 100, high: 101, low: 99, close: 100 })),
    chart: { timeScale: () => ({ getVisibleLogicalRange: () => range, options: () => ({ rightOffset: 0 }) }) },
  };
  const ctx = {
    layoutManager: manager,
    settingsStore: { get: () => ({ symbol: { timezone: "Etc/UTC", session: "electronic" } }) },
    resolutions: [{ id: "1", sec: 60 }],
    ui: { chartPanning: true },
    getAllChartPanes: () => [pane],
    drawingHub: { getDrawingsByPane() { clones++; return structuredClone(drawings); } },
    headerToolbarUi: { updateSaveState() { headerUpdates++; } },
  };
  attachLayoutPersistence(ctx);
  writes.length = 0;
  return {
    ctx, manager, writes, drawings, timers,
    clones: () => clones,
    headerUpdates: () => headerUpdates,
    setRange(value) { range = value; },
    fireTimer() {
      assert.equal(timers.size, 1);
      const [id, callback] = timers.entries().next().value;
      timers.delete(id);
      callback();
    },
    cleanup() {
      ctx.disposeLayoutPersistence();
      manager.destroy();
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    },
  };
}

test("synced pan frames avoid storage and drawing clones, then save the final viewport", () => {
  const f = fixture();
  try {
    for (let frame = 0; frame < 120; frame++) {
      f.setRange({ from: frame, to: frame + 2 });
      f.ctx.scheduleAutosaveLayout({ viewportOnly: true });
      f.ctx.scheduleAutosaveLayout({ viewportOnly: true }); // peer range event
    }
    assert.equal(f.clones(), 0);
    assert.equal(f.writes.length, 0);
    f.fireTimer(); // held pointer can outlast the normal debounce
    assert.equal(f.writes.length, 0);
    assert.equal(f.clones(), 0);
    f.setRange({ from: 125, to: 127 });
    f.ctx.ui.chartPanning = false; // normal release and pointercancel share this lifecycle
    f.fireTimer();
    assert.equal(f.clones(), 1);
    assert.equal(f.timers.size, 0);
    const saved = loadSavedLayouts()[0];
    assert.equal(saved.viewports["0"].logicalFrom, 125);
    assert.equal(saved.viewports["0"].logicalTo, 127);
    assert.deepEqual(saved.drawings, f.drawings);
    assert.equal(f.manager.isDirty(), false);
  } finally { f.cleanup(); }
});

test("autosave off marks the final viewport dirty without repeatedly persisting during pan", () => {
  const f = fixture(false);
  try {
    for (let frame = 0; frame < 120; frame++) f.ctx.scheduleAutosaveLayout({ viewportOnly: true });
    assert.equal(f.writes.length, 0);
    f.ctx.ui.chartPanning = false;
    f.fireTimer();
    assert.equal(f.writes.length, 1);
    assert.equal(f.clones(), 0);
    assert.equal(f.headerUpdates(), 1);
    assert.equal(f.manager.isDirty(), true);
    assert.deepEqual(loadSavedLayouts(), []);
  } finally { f.cleanup(); }
});

test("drawing changes still persist immediately during a pending viewport debounce", () => {
  const f = fixture();
  try {
    f.ctx.scheduleAutosaveLayout({ viewportOnly: true });
    f.ctx.scheduleAutosaveLayout();
    assert.equal(f.clones(), 1);
    const payload = JSON.parse(globalThis.localStorage.getItem("tv-chart-layout-state"));
    assert.deepEqual(payload.drawings, f.drawings);
    f.fireTimer();
    assert.equal(f.clones(), 1, "a held pointer still defers the full library write");
    f.ctx.ui.chartPanning = false;
    f.fireTimer();
    assert.deepEqual(loadSavedLayouts()[0].drawings, f.drawings);
  } finally { f.cleanup(); }
});

test("disposed widgets cancel queued pan saves and stale callbacks cannot restart them", () => {
  const f = fixture();
  try {
    f.ctx.scheduleAutosaveLayout({ viewportOnly: true });
    const queuedCallback = f.timers.values().next().value;
    f.fireTimer(); // a still-held pointer replaces the debounce with an idle retry
    const retryCallback = f.timers.values().next().value;
    f.ctx.disposeLayoutPersistence();
    assert.equal(f.timers.size, 0);
    assert.equal(f.ctx.layoutAutosaveTimer, null);
    queuedCallback();
    retryCallback();
    assert.equal(f.timers.size, 0, "already-delivered callbacks cannot rearm after destroy");
    f.ctx.ui.chartPanning = false;
    f.ctx.scheduleAutosaveLayout({ viewportOnly: true });
    f.ctx.scheduleAutosaveLayout();
    f.ctx.saveLayoutToLibrary();
    f.ctx.disposeLayoutPersistence();
    assert.equal(f.timers.size, 0);
    assert.equal(f.clones(), 0);
    assert.deepEqual(f.writes, []);
  } finally { f.cleanup(); }
});

test("stationary held pans never redraw peers and queued source movement remains intact", () => {
  const oldFrame = globalThis.requestAnimationFrame;
  const frames = [];
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  try {
    let sourceRange = { from: 10, to: 20 };
    let peerRange = { from: 100, to: 200 };
    let peerWrites = 0;
    const source = { timeScale: () => ({
      getVisibleRange: () => null, getVisibleLogicalRange: () => sourceRange,
    }) };
    const peer = { timeScale: () => ({
      getVisibleLogicalRange: () => peerRange,
      setVisibleLogicalRange(value) { peerRange = value; peerWrites++; },
    }) };
    const panes = [source, peer].map((chart) => ({ chart, bars: [{}], barSec: 60 }));
    const sync = createLayoutSync({
      getLayoutManager: () => ({ getSync: () => ({ dateRange: true }) }),
      getLayoutPanes: () => panes, getActivePane: () => panes[0],
      isChartPanning: () => true,
    });
    sync.syncLayoutDateRangeFrom(source, sourceRange);
    for (let i = 0; i < 120; i++) sync.syncLayoutDateRangeFrom(source, { ...sourceRange });
    assert.equal(peerWrites, 0);
    assert.equal(frames.length, 0);
    sourceRange = { from: 11, to: 21 };
    sync.syncLayoutDateRangeFrom(source, sourceRange);
    assert.equal(peerWrites, 1);
    sourceRange = { from: 13, to: 23 };
    sync.syncLayoutDateRangeFrom(source, sourceRange);
    frames.shift()(); // release applies the latest queued source delta
    assert.equal(peerWrites, 2);
    assert.deepEqual(peerRange, { from: 103, to: 203 });
    frames.shift()();
    for (let i = 0; i < 120; i++) sync.syncLayoutDateRangeFrom(source, { ...sourceRange });
    assert.equal(peerWrites, 2);
    assert.equal(frames.length, 0);
  } finally { globalThis.requestAnimationFrame = oldFrame; }
});
