import test from "node:test";
import assert from "node:assert/strict";

import { IndicatorPaneUiLifecycle } from "../public/js/indicators/ui/indicatorPaneUiLifecycle.js";

test("recreated panes receive a legend bound to their own status element", () => {
  const createdFor = [];
  const destroyedFor = [];
  const lifecycle = new IndicatorPaneUiLifecycle((pane) => {
    createdFor.push(pane);
    return {
      render() {},
      destroy() {
        destroyedFor.push(pane);
      },
    };
  });
  const oldPane = { index: 1, statusEl: { id: "old-status" } };
  const newPane = { index: 1, statusEl: { id: "new-status" } };

  const oldLegend = lifecycle.ensureLegend(oldPane);
  assert.strictEqual(lifecycle.ensureLegend(oldPane), oldLegend);

  const newLegend = lifecycle.ensureLegend(newPane);
  assert.notStrictEqual(newLegend, oldLegend);
  assert.deepEqual(createdFor, [oldPane, newPane]);
  assert.deepEqual(destroyedFor, [oldPane]);
});

test("pane indicator teardown destroys its legend and study overlay exactly once", () => {
  let legendDestroys = 0;
  let overlayDestroys = 0;
  const lifecycle = new IndicatorPaneUiLifecycle(() => ({
    render() {},
    destroy() {
      legendDestroys += 1;
    },
  }));
  const pane = {
    index: 2,
    statusEl: {},
    _studyLegendOverlay: {
      destroy() {
        overlayDestroys += 1;
      },
    },
  };

  lifecycle.ensureLegend(pane);
  lifecycle.destroyPane(pane);
  lifecycle.destroyPane(pane);

  assert.equal(legendDestroys, 1);
  assert.equal(overlayDestroys, 1);
  assert.equal(pane._studyLegendOverlay, null);
  assert.equal(lifecycle.ensureLegend(pane), null);
});

test("study legend overlay unsubscribes its visible-range listener on destroy", async () => {
  class FakeElement {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.parentElement = null;
      this.removed = false;
    }

    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    remove() {
      this.removed = true;
      if (!this.parentElement) return;
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
  }

  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const documentListeners = [];
  const windowListeners = [];
  globalThis.document = {
    documentElement: { dataset: {} },
    addEventListener(type, listener, options) {
      documentListeners.push({ type, listener, options });
    },
    createElement() {
      return new FakeElement();
    },
  };
  globalThis.window = {
    addEventListener(type, listener) {
      windowListeners.push({ action: "add", type, listener });
    },
    removeEventListener(type, listener) {
      windowListeners.push({ action: "remove", type, listener });
    },
  };

  let subscribed = null;
  let unsubscribed = null;
  let unsubscribeCalls = 0;
  const timeScale = {
    subscribeVisibleLogicalRangeChange(listener) {
      subscribed = listener;
    },
    unsubscribeVisibleLogicalRangeChange(listener) {
      unsubscribeCalls += 1;
      unsubscribed = listener;
    },
  };
  const stageEl = new FakeElement();

  try {
    const { attachStudyPaneLegendOverlay } = await import(
      `../public/js/indicators/ui/studyPaneLegendOverlay.js?lifecycle=${Date.now()}`
    );
    const overlay = attachStudyPaneLegendOverlay({
      stageEl,
      chart: {
        timeScale: () => timeScale,
      },
      getStudiesForLwcPane: () => [],
      actions: {},
    });
    const root = stageEl.children[0];

    assert.equal(typeof subscribed, "function");
    overlay.destroy();
    overlay.destroy();

    assert.strictEqual(unsubscribed, subscribed);
    assert.equal(unsubscribeCalls, 1);
    assert.equal(root.removed, true);
    assert.equal(
      windowListeners.some(
        (entry) =>
          entry.action === "remove" && entry.type === "resize" && entry.listener === subscribed,
      ),
      true,
    );
    assert.equal(documentListeners.length, 3);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
