import assert from "node:assert/strict";
import test from "node:test";

import {
  LEVEL_HTF_PALETTE,
  LEVEL_REFERENCE_PALETTE,
  LEVEL_SESSION_PALETTE,
  migrateLegacyLevelColor,
} from "../testing_web/frontend/js/indicators/levels/palette.js";

test("Levels defaults use distinct muted colors and migrate former neon inputs", () => {
  assert.deepEqual(LEVEL_HTF_PALETTE["240"], { hi: "#526b7a", lo: "#8a6558" });
  assert.deepEqual(LEVEL_HTF_PALETTE["60"], { hi: "#607a73", lo: "#8a5f62" });
  assert.deepEqual(LEVEL_HTF_PALETTE["15"], { hi: "#887f58", lo: "#77667f" });
  assert.equal(LEVEL_SESSION_PALETTE.asia, "#607a73");
  assert.equal(LEVEL_REFERENCE_PALETTE.midpoint, "#71805b");
  assert.equal(migrateLegacyLevelColor("#9400d3", "#9400d3", "#75647d"), "#75647d");
  assert.equal(migrateLegacyLevelColor("#123456", "#9400d3", "#75647d"), "#123456");
});
