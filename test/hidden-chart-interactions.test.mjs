import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { bindChartPortal, isChartHostInteractive, releaseChartHostInteractions } from "../public/js/ui/chart/hostInteraction.js";
import { attachKeyboard } from "../public/js/drawings/controller/keyboard.js";
import { wireKeyboardShortcuts } from "../public/js/app/boot/chart/keyboard.js";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "prochart") return { url: new URL("../public/vendor/prochart/index.mjs", import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
const { mountChartContextMenu } = await import("../public/js/ui/context/chart.js");
const { mountTimeScaleContextMenu } = await import("../public/js/ui/context/timeScale.js");
const { mountPriceScaleContextMenu } = await import("../public/js/ui/context/priceScale.js");
const { mountStatusLineContextMenu } = await import("../public/js/ui/context/statusLine.js");

function element(parentElement = null, shell = false) {
  const attributes = new Map();
  return {
    parentElement, isConnected: true, hidden: false, inert: false,
    matches: (selector) => shell && selector === ".tv-app",
    hasAttribute: (name) => attributes.has(name),
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    toggleAttribute: (name, enabled) => enabled ? attributes.set(name, "") : attributes.delete(name),
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    remove() { this.isConnected = false; },
  };
}

test("retained hidden charts suppress only their own shortcuts and controls", () => {
  const originals = Object.fromEntries(["MutationObserver", "document", "window", "HTMLInputElement", "HTMLTextAreaElement"].map((key) => [key, globalThis[key]]));
  const observers = [];
  const keyListeners = [];
  globalThis.MutationObserver = class {
    constructor(sync) { this.sync = sync; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  globalThis.HTMLInputElement = class {};
  globalThis.HTMLTextAreaElement = class {};
  globalThis.document = {
    addEventListener(type, listener) { if (type === "keydown") keyListeners.push(listener); },
    removeEventListener() {}, querySelector() { return null; },
  };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const route = element();
  const retainedHost = element(route, true);
  const retainedChart = element(retainedHost);
  const visibleHost = element(null, true);
  const retainedPortal = element();
  const visiblePortal = element();
  let retainedClosed = 0;
  let visibleClosed = 0;
  let removedDrawings = 0;
  let changedScale = 0;
  try {
    bindChartPortal(retainedPortal, retainedChart, () => retainedClosed++);
    bindChartPortal(visiblePortal, visibleHost, () => visibleClosed++);
    const nestedPortal = element();
    bindChartPortal(nestedPortal, element(retainedPortal));
    assert.equal(retainedPortal.getAttribute("data-bwc-portal-owned"), retainedHost.getAttribute("data-bwc-chart-host"));
    assert.equal(nestedPortal.getAttribute("data-bwc-portal-owned"), retainedHost.getAttribute("data-bwc-chart-host"));
    assert.notEqual(visiblePortal.getAttribute("data-bwc-portal-owned"), retainedPortal.getAttribute("data-bwc-portal-owned"), "compact cleanup can identify only its own portals");
    assert.equal(observers.length, 2, "one observer is shared by each widget's portals");
    const controller = { container: retainedChart, drawings: [{}], removeDrawings() { removedDrawings++; }, getAlwaysRemoveLocked() { return false; }, drag: { finishPointerDrag() {} } };
    attachKeyboard(controller);
    controller.bindKeyboard();
    wireKeyboardShortcuts({ el: retainedChart, settingsStore: { get: () => ({}), set() { changedScale++; } } });
    const sendKey = (key, altKey = false) => keyListeners.forEach((listener) => listener({ key, altKey, ctrlKey: false, metaKey: false, target: {}, preventDefault() {} }));
    for (const [attribute, value] of [["aria-hidden", "true"], ["inert", ""], ["hidden", ""]]) {
      route.setAttribute(attribute, value);
      observers.forEach((observer) => observer.sync());
      assert.equal(isChartHostInteractive(retainedChart), false);
      assert.equal(isChartHostInteractive(element(retainedPortal)), false, "portal descendants resolve back to their chart");
      assert.equal(retainedPortal.hasAttribute("data-bwc-host-inactive"), true);
      assert.equal(nestedPortal.hasAttribute("data-bwc-host-inactive"), true);
      assert.equal(visiblePortal.hasAttribute("data-bwc-host-inactive"), false);
      sendKey("Delete");
      sendKey("i", true);
      route.removeAttribute(attribute);
      observers.forEach((observer) => observer.sync());
      assert.equal(isChartHostInteractive(retainedChart), true);
    }
    assert.equal(removedDrawings, 0, "dashboard Delete cannot remove retained chart drawings");
    assert.equal(changedScale, 0, "dashboard Alt+I cannot alter retained scale settings");
    assert.equal(retainedClosed, 3);
    assert.equal(visibleClosed, 0);
    sendKey("Delete");
    sendKey("i", true);
    assert.equal(removedDrawings, 1);
    assert.equal(changedScale, 1);
    releaseChartHostInteractions(retainedChart);
    assert.equal(retainedPortal.isConnected, false);
    assert.equal(visiblePortal.isConnected, true);
    assert.equal(observers[0].disconnected, true);
    assert.equal(retainedHost.hasAttribute("data-bwc-chart-host"), false);
  } finally {
    releaseChartHostInteractions(visibleHost);
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test("hidden chart context menu hotkeys cannot reset, copy, or paste before portal dismissal runs", () => {
  const originals = { document: globalThis.document, window: globalThis.window, MutationObserver: globalThis.MutationObserver };
  const listeners = [];
  const portals = [];
  // Deliberately leave mutation callbacks pending: the key guard must work as
  // soon as the route becomes inactive, even if its menu was open beforehand.
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.document = {
    createElement() { return element(); },
    body: { appendChild(node) { portals.push(node); } },
    addEventListener(type, listener) { if (type === "keydown") listeners.push(listener); },
    removeEventListener() {},
  };
  globalThis.window = { addEventListener() {} };
  const route = element();
  const host = element(route, true);
  const container = element(host);
  const counts = { reset: 0, copy: 0, paste: 0, resetTime: 0, prevented: 0 };
  try {
    mountChartContextMenu({ container, getState: () => ({ hasSelectedDrawing: true }), actions: {
      resetChart() { counts.reset++; }, copyDrawing() { counts.copy++; }, paste() { counts.paste++; },
    } });
    mountTimeScaleContextMenu({ container, actions: { resetTimeScale() { counts.resetTime++; } } });
    mountPriceScaleContextMenu({ container });
    mountStatusLineContextMenu({ statusEl: container });
    const send = (key, modifiers = {}) => listeners.forEach((listener) => listener({
      key, ctrlKey: false, altKey: false, ...modifiers,
      preventDefault() { counts.prevented++; },
    }));
    portals.forEach((portal) => { portal.hidden = false; });
    route.setAttribute("aria-hidden", "true");
    send("r", { altKey: true });
    send("c", { ctrlKey: true });
    send("v", { ctrlKey: true });
    send("q", { ctrlKey: true, altKey: true });
    send("Escape");
    assert.deepEqual(counts, { reset: 0, copy: 0, paste: 0, resetTime: 0, prevented: 0 });
    assert.ok(portals.every((portal) => portal.hidden === false), "inactive context handlers do not process Escape either");
    route.removeAttribute("aria-hidden");
    send("r", { altKey: true });
    portals[0].hidden = false;
    send("c", { ctrlKey: true });
    portals[0].hidden = false;
    send("v", { ctrlKey: true });
    send("q", { ctrlKey: true, altKey: true });
    assert.deepEqual(counts, { reset: 1, copy: 1, paste: 1, resetTime: 1, prevented: 4 });
  } finally {
    releaseChartHostInteractions(host);
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
