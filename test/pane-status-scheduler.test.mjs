import test from "node:test";
import assert from "node:assert/strict";

import { createPaneStatusScheduler } from "../public/js/chart/status/paneScheduler.js";

test("crosshair echoes refresh source and target OHLC in the same frame", () => {
  const frames = [];
  const refreshed = [];
  const scheduler = createPaneStatusScheduler(
    (pane) => refreshed.push(pane.index),
    (callback) => {
      frames.push(callback);
      return frames.length;
    },
  );

  scheduler.schedule({ index: 0, symbol: "NQ" });
  scheduler.schedule({ index: 1, symbol: "ES" });

  assert.equal(frames.length, 1);
  frames.shift()(0);
  assert.deepEqual(refreshed, [0, 1]);
});

test("repeated crosshair events coalesce separately for each pane", () => {
  const frames = [];
  const refreshed = [];
  const scheduler = createPaneStatusScheduler(
    (pane) => refreshed.push(pane.symbol),
    (callback) => {
      frames.push(callback);
      return frames.length;
    },
  );

  scheduler.schedule({ index: 0, symbol: "NQ-old" });
  scheduler.schedule({ index: 0, symbol: "NQ" });
  scheduler.schedule({ index: 1, symbol: "ES" });
  frames.shift()(0);

  assert.deepEqual(refreshed, ["NQ", "ES"]);
});
