import assert from "node:assert/strict";
import test from "node:test";

import { confirmedHtfIndicesAfterAppend } from "../testing_web/frontend/js/indicators/fvg/replayProgress.js";

test("replay does not reconfirm an HTF bar while its aggregate bucket is unchanged", () => {
  assert.deepEqual(confirmedHtfIndicesAfterAppend(12, 12, 2), []);
});

test("replay confirms the former HTF tail exactly once when a new bucket opens", () => {
  assert.deepEqual(confirmedHtfIndicesAfterAppend(12, 13, 2), [11]);
});

test("replay catches up every newly confirmed HTF bar without touching the forming tail", () => {
  assert.deepEqual(confirmedHtfIndicesAfterAppend(12, 15, 2), [11, 12, 13]);
});
