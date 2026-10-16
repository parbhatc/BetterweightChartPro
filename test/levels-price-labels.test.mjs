import assert from "node:assert/strict";
import test from "node:test";

import {
  formatLevelLabel,
  HTF_LABEL_TEXT_COLOR,
  isHtfLevelLabel,
  levelLabelTextColor,
} from "../testing_web/frontend/js/indicators/levels/labels.js";

test("Levels can hide the numeric price while retaining the level name", () => {
  assert.equal(formatLevelLabel("PDH", 3303, true), "PDH (3303.00)");
  assert.equal(formatLevelLabel("PDH", 3303, false), "PDH");
});

test("Levels removes an existing price suffix when the setting is disabled", () => {
  assert.equal(formatLevelLabel("1H High (31303.25)", 31303.25, false), "1H High");
  assert.equal(formatLevelLabel("NFP (high impact)", 3303, false), "NFP (high impact)");
});

test("timeframe labels use white text without changing other label colors", () => {
  assert.equal(levelLabelTextColor("1H Low", "#line"), HTF_LABEL_TEXT_COLOR);
  assert.equal(levelLabelTextColor("4H & 1H Low", "#line"), HTF_LABEL_TEXT_COLOR);
  assert.equal(levelLabelTextColor("London", "#session"), "#session");
  assert.equal(isHtfLevelLabel("1H Low"), true);
  assert.equal(isHtfLevelLabel("London"), false);
});
