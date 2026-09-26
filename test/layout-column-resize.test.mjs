import test from "node:test";
import assert from "node:assert/strict";

import { createLayoutManager } from "../public/js/ui/header/layout/manager.js";

class FakeElement {
  constructor() {
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.clientWidth = 1000;
    this.clientHeight = 600;
    this.listeners = new Map();
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name),
    };
  }

  appendChild(child) {
    this.children.push(child);
    child.parent = this;
  }

  insertBefore(child) {
    this.appendChild(child);
  }

  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
  }

  querySelector() { return null; }
  setAttribute() {}
  getBoundingClientRect() { return { left: 0, top: 0 }; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  dispatch(type, event = {}) { this.listeners.get(type)?.(event); }
}

test("chart pane dividers resize adjacent tracks and survive layout restore", () => {
  const oldDocument = globalThis.document;
  const oldStorage = globalThis.localStorage;
  const store = new Map();
  const doc = new FakeElement();
  doc.body = new FakeElement();
  doc.createElement = () => new FakeElement();
  globalThis.document = doc;
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  const makeManager = () => createLayoutManager({
    stageEl: new FakeElement(),
    primaryWrapEl: new FakeElement(),
    createSecondaryPane: () => ({ wrapEl: new FakeElement(), destroy() {} }),
    destroySecondaryPane: (pane) => pane.destroy(),
  });

  try {
    const manager = makeManager();
    manager.setLayout("3h");
    const grid = manager.getGridEl();
    const handles = grid.children.filter((child) => child.className === "tv-layout-column-resizer");
    assert.equal(handles.length, 2);
    handles[0].dispatch("pointerdown", { button: 0, preventDefault() {} });
    doc.dispatch("pointermove", { clientX: 450 });
    doc.dispatch("pointerup");
    const widths = manager.getColumnWidths()["3h"];
    assert.ok(widths[0] > widths[1]);
    assert.ok(Math.abs(widths.reduce((sum, value) => sum + value, 0) - 1) < 1e-9);

    manager.setLayout("3v");
    assert.equal(grid.children.filter((child) => child.className === "tv-layout-column-resizer").length, 0);
    const rowHandles = grid.children.filter((child) => child.className === "tv-layout-row-resizer");
    assert.equal(rowHandles.length, 2);
    rowHandles[0].dispatch("pointerdown", { button: 0, preventDefault() {} });
    doc.dispatch("pointermove", { clientY: 270 });
    doc.dispatch("pointerup");
    const heights = manager.getRowHeights()["3v"];
    assert.ok(heights[0] > heights[1]);
    assert.ok(Math.abs(heights.reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
    manager.setLayout("1-2");
    const mixedHandles = grid.children.filter((child) => child.className === "tv-layout-column-resizer");
    assert.equal(mixedHandles.length, 1);
    assert.ok(parseFloat(mixedHandles[0].style.top) > 250);
    manager.setLayout("3h");
    assert.deepEqual(manager.getColumnWidths()["3h"], widths);
    assert.deepEqual(manager.getRowHeights()["3v"], heights);
    manager.destroy();

    const restored = makeManager();
    assert.equal(restored.getLayoutId(), "3h");
    assert.deepEqual(restored.getColumnWidths()["3h"], widths);
    assert.deepEqual(restored.getRowHeights()["3v"], heights);
    restored.destroy();
  } finally {
    globalThis.document = oldDocument;
    globalThis.localStorage = oldStorage;
  }
});
