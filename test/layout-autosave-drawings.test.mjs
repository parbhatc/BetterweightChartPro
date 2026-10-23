import test from "node:test";
import assert from "node:assert/strict";

import { persistAutosaveDrawingSnapshot } from "../public/js/app/boot/chart/layoutDrawingSnapshot.js";

test("ray and trend-line autosave persists its local snapshot before the library debounce", () => {
  const drawings = {
    0: [
      { id: "ray-1", type: "horizontal-ray" },
      { id: "trend-1", type: "trend-line" },
    ],
  };
  const snapshots = [];
  const ctx = {
    layoutManager: {
      getAutoSave: () => true,
      setDrawingsSnapshot(value) { snapshots.push(value); },
    },
    drawingHub: {
      getDrawingsByPane: () => structuredClone(drawings),
    },
  };

  const persisted = persistAutosaveDrawingSnapshot(ctx);

  assert.equal(persisted, true);
  assert.deepEqual(snapshots, [drawings]);
});

test("drawing snapshots remain unsaved when layout autosave is off", () => {
  const snapshots = [];
  const ctx = {
    layoutManager: {
      getAutoSave: () => false,
      setDrawingsSnapshot(value) { snapshots.push(value); },
    },
    drawingHub: {
      getDrawingsByPane: () => ({ 0: [{ id: "ray-1" }] }),
    },
  };

  const persisted = persistAutosaveDrawingSnapshot(ctx);

  assert.equal(persisted, false);
  assert.deepEqual(snapshots, []);
});
