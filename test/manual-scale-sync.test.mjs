import test from "node:test";
import assert from "node:assert/strict";
import { createManualPriceScaleSync } from "../public/js/app/layout/manualScaleSync.js";
import { PriceScaleModel } from "../public/vendor/prochart/scale/priceScaleModel.mjs";
import { PriceScaleApi } from "../public/vendor/prochart/scale/priceScaleApi.mjs";

function fixture() {
  let panning = true;
  let settings = { scales: { autoScale: true, scalesPlacement: "right", invertScale: false } };
  const writes = [];
  const invalidations = [];
  const panes = [
    { range: { min: 100, max: 150 } },
    { range: { min: 20_000, max: 21_000 } },
  ].map(({ range }, index) => {
    const model = new PriceScaleModel({ invalidate: () => invalidations.push(index) }, { height: 400 }, "right");
    model.priceRange = { ...range };
    const api = new PriceScaleApi(model);
    return {
      index, model,
      series: { priceScale: () => api },
      chart: { priceScale: () => api },
    };
  });
  const settingsStore = {
    get: () => settings,
    set(section, key, value, opts) {
      writes.push({ section, key, value, opts });
      settings[section][key] = value;
    },
  };
  const sync = createManualPriceScaleSync({ settingsStore, getPanes: () => panes, isPanning: () => panning });
  return {
    panes, sync, writes, invalidations,
    setPanning(value) { panning = value; },
    replaceSettings(value) { settings = value; },
    getSettings: () => settings,
  };
}

test("manual plot gesture unlocks all layout panes immediately without sharing raw prices", () => {
  const f = fixture();
  const originalRanges = f.panes.map(({ model }) => ({ ...model.priceRange }));
  assert.equal(f.sync.handleManualScale({ detail: { paneIndex: 0, zone: "plot" } }), true);
  assert.deepEqual(f.panes.map(({ model }) => model.options.autoScale), [false, false]);
  assert.deepEqual(f.panes.map(({ model }) => model.priceRange), originalRanges);
  assert.deepEqual(f.panes.map((pane) => pane._manualScaleLocked), [true, true]);
  assert.deepEqual(f.writes, [], "settings and their expensive subscribers remain untouched during pan");
  assert.equal(f.sync.flushPending(), false);
  assert.deepEqual(f.writes, []);
  f.setPanning(false);
  assert.equal(f.sync.flushPending(), true);
  assert.deepEqual(f.writes, [{ section: "scales", key: "autoScale", value: false, opts: { skipHistory: true } }]);
  assert.equal(f.sync.flushPending(), false);
});

test("axis gestures preserve latest settings and collapse duplicate manual events into one write", () => {
  const f = fixture();
  const event = { detail: { paneIndex: 0, zone: "right" } };
  f.sync.handleManualScale(event);
  const initialInvalidations = f.invalidations.length;
  for (let i = 0; i < 50; i++) f.sync.handleManualScale(event);
  assert.equal(f.invalidations.length, initialInvalidations);
  f.replaceSettings({ scales: { autoScale: true, scalesPlacement: "left", invertScale: true }, canvas: { watermarkTicker: false } });
  f.setPanning(false); // pointer release and pointercancel use the same flush
  f.sync.flushPending();
  assert.equal(f.writes.length, 1);
  assert.equal(f.getSettings().scales.invertScale, true);
  assert.equal(f.getSettings().scales.scalesPlacement, "left");
  assert.equal(f.getSettings().canvas.watermarkTicker, false);
});

test("indicator axes and malformed events leave the chart layout and settings untouched", () => {
  const f = fixture();
  for (const event of [undefined, {}, { detail: {} }, { detail: { paneIndex: 1, zone: "right" } }, { detail: { paneIndex: 0, zone: "time" } }]) {
    assert.equal(f.sync.handleManualScale(event), false);
  }
  f.setPanning(false);
  assert.equal(f.sync.flushPending(), false);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.invalidations, []);
  assert.deepEqual(f.panes.map(({ model }) => model.options.autoScale), [true, true]);
});

test("already-manual preference repairs a new auto peer without another settings event", () => {
  const f = fixture();
  f.replaceSettings({ scales: { autoScale: false, scalesPlacement: "right" } });
  f.setPanning(false);
  assert.equal(f.sync.handleManualScale({ detail: { paneIndex: 0, zone: "left" } }), true);
  assert.deepEqual(f.panes.map(({ model }) => model.options.autoScale), [false, false]);
  assert.deepEqual(f.writes, []);
});
