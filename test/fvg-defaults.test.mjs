import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FVG_BEAR_COLOR,
  DEFAULT_FVG_BORDER_OPACITY,
  DEFAULT_FVG_BULL_COLOR,
  DEFAULT_FVG_FILL_OPACITY,
  DEFAULT_FVG_TAP_BORDER_COLOR,
  DEFAULT_IFVG_COLOR,
  defaultFvgPalette,
  migrateLegacyFvgSetting,
  resolveDefaultIfvgSetting,
} from "../testing_web/frontend/js/indicators/fvg/palette.js";

test("FVG defaults stay readable on both standard and Gray chart backgrounds", () => {
  assert.equal(DEFAULT_FVG_BULL_COLOR, "#6e7c65");
  assert.equal(DEFAULT_FVG_BEAR_COLOR, "#916966");
  assert.equal(DEFAULT_FVG_FILL_OPACITY, 20);
  assert.equal(DEFAULT_FVG_BORDER_OPACITY, 0);
  assert.equal(DEFAULT_FVG_TAP_BORDER_COLOR, "#787b86");
  assert.deepEqual(defaultFvgPalette(), {
    bull: "#6e7c65",
    bear: "#916966",
    fillOpacity: 20,
    borderOpacity: 0,
  });
});

test("IFVG uses a muted borderless-compatible default and migrates legacy yellow", () => {
  assert.equal(DEFAULT_IFVG_COLOR, "#8a8051");
  assert.deepEqual(resolveDefaultIfvgSetting("#ffff00", 20), {
    color: "#8a8051",
    opacity: 20,
    usesDefault: true,
  });
  assert.deepEqual(resolveDefaultIfvgSetting("#123456", 35), {
    color: "#123456",
    opacity: 35,
    usesDefault: false,
  });
});

test("former FVG defaults migrate without replacing custom color settings", () => {
  assert.deepEqual(migrateLegacyFvgSetting("bull", "fill", "#00897b", 15), {
    color: "#6e7c65",
    opacity: 20,
  });
  assert.deepEqual(migrateLegacyFvgSetting("bear", "border", "#f23645", 50), {
    color: "#916966",
    opacity: 0,
  });
  assert.deepEqual(migrateLegacyFvgSetting("bull", "fill", "#123456", 15), {
    color: "#123456",
    opacity: 15,
  });
  assert.deepEqual(migrateLegacyFvgSetting("bear", "fill", "#880e4f", 35), {
    color: "#880e4f",
    opacity: 35,
  });
});
