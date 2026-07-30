import test from "node:test";
import assert from "node:assert/strict";

import { FORECAST_FLYOUT_SECTIONS } from "../public/js/drawings/catalog/tools.js";
import { pointCountForTool } from "../public/js/drawings/registry/tools.js";
import { responsiveAxisMinimums } from "../public/js/chart/view/responsiveAxes.js";

const labels = (sections) => sections.flatMap((section) => section.tools);

test("forecasting menu mirrors the supported placement contracts", () => {
  assert.equal(pointCountForTool("anchored-volume-profile"), 1);
  assert.equal(pointCountForTool("fixed-range-volume-profile"), 2);
  assert.equal(pointCountForTool("anchored-vwap"), 1);
  assert.equal(pointCountForTool("bars-pattern"), 2);
  assert.equal(pointCountForTool("ghost-feed"), 2);
  assert.deepEqual(labels(FORECAST_FLYOUT_SECTIONS), [
    "long-position",
    "short-position",
    "position-forecast",
    "bars-pattern",
    "ghost-feed",
    "sector",
    "anchored-vwap",
    "fixed-range-volume-profile",
    "anchored-volume-profile",
    "price-range",
    "date-range",
    "date-price-range",
  ]);
});

test("mobile axes reserve TradingView-like interactive gutters", () => {
  assert.deepEqual(responsiveAxisMinimums(390, true), {
    priceScaleWidth: 72,
    timeScaleHeight: 28,
  });
  assert.deepEqual(responsiveAxisMinimums(1440, false), {
    priceScaleWidth: 72,
    timeScaleHeight: 0,
  });
});
