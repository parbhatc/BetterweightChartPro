import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

class ListenerTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, options);
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, options);
    this.listeners.get(type)?.delete(listener);
  }
}

class FakeElement extends ListenerTarget {
  constructor(tag = "div") {
    super();
    this.tagName = tag;
    this.children = [];
    this.selectors = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.isConnected = true;
    this.textContent = "";
    this.ownerDocument = globalThis.document;
    const classes = new Set();
    this.classList = { add: (value) => classes.add(value), remove: (value) => classes.delete(value) };
  }
  set innerHTML(value) {
    this.markup = value;
    if (!value.includes('data-name="symbol-search-items-dialog"')) return;
    for (const [selector, Type] of [["#symbol-search", FakeInput], ["#symbol-list", FakeElement],
      ["[data-tabs]", FakeElement], ["[data-clear]", FakeButton]]) {
      const child = new Type();
      this.selectors.set(selector, child);
      this.appendChild(child);
    }
  }
  get innerHTML() { return this.markup ?? ""; }
  querySelector(selector) { return this.selectors.get(selector) ?? null; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  hasAttribute(key) { return this.attributes.has(key); }
  removeAttribute(key) { this.attributes.delete(key); }
  toggleAttribute(key, active) { if (active) this.setAttribute(key, ""); else this.removeAttribute(key); }
  matches(selector) { return selector === ".tv-app" && this.chartHost === true; }
  closest(selector) { return selector === "[data-symbol]" && this.dataset.symbol ? this : null; }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  contains(child) { return this.children.includes(child); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { this.ownerDocument.activeElement = null; }
  remove() { this.isConnected = false; this.parentElement = null; }
}
class FakeInput extends FakeElement { value = ""; }
class FakeButton extends FakeElement {}
class FakeImage extends FakeElement {}
class FakeDocument extends ListenerTarget {
  constructor() {
    super();
    this.body = new FakeElement("body");
    this.head = new FakeElement("head");
    this.activeElement = null;
  }
  createElement(tag) { return new FakeElement(tag); }
  getElementById(id) { return [...this.head.children, ...this.body.children].find((child) => child.id === id) ?? null; }
}

globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeElement;
globalThis.HTMLInputElement = FakeInput;
globalThis.HTMLButtonElement = FakeButton;
globalThis.HTMLImageElement = FakeImage;
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = new FakeDocument();
globalThis.requestAnimationFrame = (callback) => { callback(); return 0; };
const storage = new Map();
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };

const { mountSymbolSearch } = await import("../public/js/ui/symbol/search.js");
// The browser's import map points this bare engine name at the bundled engine.
const engineImportMap = registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "prochart"
    ? { url: new URL("../public/vendor/prochart/index.mjs", import.meta.url).href, shortCircuit: true }
    : nextResolve(specifier, context);
} });
const { wireSymbolAndTimeframePickers } = await import("../public/js/app/boot/chart/pickers.js");
engineImportMap.deregister();
const { releaseChartHostInteractions } = await import("../public/js/ui/chart/hostInteraction.js");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

function fixture(t, datafeed) {
  globalThis.document = new FakeDocument();
  storage.clear();
  const root = new FakeElement();
  root.chartHost = true;
  for (const selector of ["#symbol-trigger", "#symbol-logo", "#symbol-ticker", "#symbol-name", "#symbol-exchange"]) {
    root.selectors.set(selector, selector === "#symbol-logo" ? new FakeImage() : new FakeElement());
  }
  let ui;
  t.after(() => { ui?.destroy(); releaseChartHostInteractions(root); });
  return {
    root, datafeed,
    mount(onSelect = () => {}) { ui = mountSymbolSearch({ root, datafeed, initialSymbol: "NQ", onSelect }); return ui; },
    setUi(value) { ui = value; },
    ticker: () => root.querySelector("#symbol-ticker").textContent,
    label: () => root.querySelector("#symbol-name").textContent,
    modal: () => document.body.children.find((child) => child.id === "symbol-modal"),
  };
}

test("primary symbol/history loading continues while initial picker search is unresolved", async (t) => {
  const search = deferred();
  const calls = [];
  const f = fixture(t, {
    searchSymbols: (query) => { calls.push(`search:${query}`); return search.promise; },
    resolveSymbol: async (symbol) => { calls.push(`resolve:${symbol}`); return { ticker: symbol }; },
    getBars: async () => { calls.push("history"); return { bars: [{ time: 60, close: 100 }] }; },
  });
  const ctx = { symbolPicker: f.root, symbol: "NQ", datafeed: f.datafeed, tfPickerEl: null };
  const boot = (async () => {
    await wireSymbolAndTimeframePickers(ctx);
    f.setUi(ctx.symbolSearchUi);
    const info = await ctx.datafeed.resolveSymbol(ctx.symbol);
    return ctx.datafeed.getBars(info, "1");
  })();
  await flush();
  assert.deepEqual(calls, ["search:NQ", "resolve:NQ", "history"]);
  assert.equal(f.ticker(), "NQ", "the known symbol is visible before metadata arrives");
  assert.equal((await boot).bars.length, 1);
  search.resolve([{ symbol: "NQ", ticker: "CME:NQ", name: "Nasdaq futures", exchange: "CME" }]);
  await ctx.symbolSearchUi.init();
  assert.equal(f.label(), "Nasdaq futures");
  assert.equal(calls.filter((call) => call.startsWith("search:")).length, 1, "initialization is shared");
});

test("late initial search cannot overwrite a symbol selected from the interactive picker", async (t) => {
  const initial = deferred();
  const f = fixture(t, { searchSymbols: (query) => query === "NQ" ? initial.promise : Promise.resolve([
    { symbol: "ES", ticker: "CME:ES", name: "S&P futures", exchange: "CME" },
  ]) });
  const selected = [];
  const ui = f.mount((symbol) => selected.push(symbol));
  const metadata = ui.init();
  ui.open();
  await flush();
  const list = f.modal().querySelector("#symbol-list");
  const item = new FakeElement();
  item.dataset.symbol = "CME:ES";
  const click = new Event("click");
  Object.defineProperty(click, "target", { value: item });
  list.dispatchEvent(click);
  assert.deepEqual(selected, ["CME:ES"]);
  assert.equal(ui.getSymbol(), "CME:ES");
  assert.equal(f.label(), "S&P futures");
  initial.resolve([{ symbol: "NQ", ticker: "CME:NQ", name: "Old Nasdaq label", exchange: "CME" }]);
  await metadata;
  assert.equal(f.ticker(), "ES");
  assert.equal(f.label(), "S&P futures");
});

test("late fallback resolution cannot overwrite newer metadata even after a symbol round trip", async (t) => {
  const resolved = deferred();
  const f = fixture(t, { searchSymbols: async () => [], resolveSymbol: () => resolved.promise });
  const ui = f.mount();
  const metadata = ui.init();
  await flush();
  ui.setSymbol("ES", { ticker: "CME:ES", name: "Selected ES" });
  ui.setSymbol("NQ", { ticker: "CME:NQ", name: "Selected NQ" });
  resolved.resolve({ description: "Obsolete initial metadata", ticker: "CME:NQ", exchange: "CME" });
  await metadata;
  assert.equal(ui.getSymbol(), "NQ");
  assert.equal(f.label(), "Selected NQ");
});

test("destroyed pickers ignore late metadata and release their interaction listeners", async (t) => {
  const search = deferred();
  const f = fixture(t, { searchSymbols: () => search.promise });
  const ui = f.mount();
  const metadata = ui.init();
  const modal = f.modal();
  assert.equal(document.listeners.get("keydown").size, 1);
  ui.destroy();
  assert.equal(document.listeners.get("keydown").size, 0);
  assert.equal(f.root.querySelector("#symbol-trigger").listeners.get("click").size, 0);
  assert.equal(modal.isConnected, false);
  search.resolve([{ symbol: "NQ", ticker: "CME:NQ", name: "Late label" }]);
  await metadata;
  ui.open();
  assert.equal(modal.hidden, true);
  assert.equal(f.label(), "NQ");
});

test("initial metadata failure is handled without failing or delaying primary history", async (t) => {
  const search = deferred();
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  let historyCalls = 0;
  const f = fixture(t, {
    searchSymbols: () => search.promise,
    resolveSymbol: async () => ({ ticker: "NQ" }),
    getBars: async () => { historyCalls += 1; return { bars: [] }; },
  });
  const ctx = { symbolPicker: f.root, symbol: "NQ", datafeed: f.datafeed, tfPickerEl: null };
  await wireSymbolAndTimeframePickers(ctx);
  f.setUi(ctx.symbolSearchUi);
  await f.datafeed.getBars(await f.datafeed.resolveSymbol("NQ"), "1");
  search.reject(new Error("Catalog unavailable"));
  await flush();
  assert.equal(warnings.length, 1);
  assert.equal(historyCalls, 1);
  assert.equal(f.ticker(), "NQ");
  assert.equal(ctx.symbolSearchUi.getSymbol(), "NQ");
});

test("metadata failures from disposed or superseded picker requests are ignored", async (t) => {
  const search = deferred();
  const f = fixture(t, { searchSymbols: () => search.promise });
  const ui = f.mount();
  const metadata = ui.init();
  ui.destroy();
  search.reject(new Error("Canceled chart metadata"));
  await metadata;
});
