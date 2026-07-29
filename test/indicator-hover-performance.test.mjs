import test from "node:test";
import assert from "node:assert/strict";

import { syncActivePaneHoverState } from "../public/js/chart/pane/activeHoverState.js";
import { wireIndicatorLegendCrosshair } from "../public/js/indicators/crosshairLegend.js";
import { createRefresh } from "../public/js/indicators/controller/refresh.js";
import { Pane } from "../public/vendor/prochart/layout/paneModel.mjs";

test("indicator crosshair legends skip empty panes and update once per candle", () => {
  let subscriber;
  let indicatorCount = 0;
  let indicatorCountChecks = 0;
  let mainLegendRefreshes = 0;
  let studyValueRefreshes = 0;
  const pane = {
    chart: {
      subscribeCrosshairMove(callback) {
        subscriber = callback;
      },
    },
  };

  wireIndicatorLegendCrosshair(pane, {
    hasIndicators: () => {
      indicatorCountChecks += 1;
      return indicatorCount > 0;
    },
    refreshMainLegend: () => {
      mainLegendRefreshes += 1;
    },
    refreshStudyLegendValues: () => {
      studyValueRefreshes += 1;
    },
  });

  subscriber({ point: { x: 1, y: 1 }, time: 10 });
  subscriber({ point: { x: 2, y: 1 }, time: 20 });
  assert.equal(indicatorCountChecks, 1);
  assert.equal(mainLegendRefreshes, 0);
  assert.equal(studyValueRefreshes, 0);

  indicatorCount = 1;
  pane.hoverBar = { time: 10 };
  subscriber({ point: { x: 3, y: 1 }, time: 10 });
  subscriber({ point: { x: 4, y: 1 }, time: 10 });
  pane.hoverBar = { time: 20 };
  subscriber({ point: { x: 5, y: 1 }, time: 20 });
  pane.hoverBar = undefined;
  subscriber({});
  subscriber({});

  assert.equal(indicatorCountChecks, 4);
  assert.equal(mainLegendRefreshes, 3);
  assert.equal(studyValueRefreshes, 3);

  wireIndicatorLegendCrosshair(pane, {
    hasIndicators: () => true,
    refreshMainLegend: () => {
      mainLegendRefreshes += 1;
    },
    refreshStudyLegendValues: () => {
      studyValueRefreshes += 1;
    },
  });
  assert.equal(pane._legendCrosshairSub, true);
});

test("future whitespace dedupes by the resolved hovered bar before scanning indicators", () => {
  let subscriber;
  let indicatorCountChecks = 0;
  const pane = {
    chart: {
      subscribeCrosshairMove(callback) {
        subscriber = callback;
      },
    },
  };

  wireIndicatorLegendCrosshair(pane, {
    hasIndicators: () => {
      indicatorCountChecks += 1;
      return true;
    },
    refreshMainLegend() {},
    refreshStudyLegendValues() {},
  });

  pane.hoverBar = { time: 100 };
  subscriber({ point: { x: 1, y: 1 }, time: 100 });
  subscriber({ point: { x: 2, y: 1 }, time: 101 });

  pane.hoverBar = undefined;
  subscriber({ point: { x: 3, y: 1 }, time: 10_000 });
  subscriber({ point: { x: 4, y: 1 }, time: 20_000 });
  subscriber({ point: { x: 5, y: 1 }, time: 30_000 });

  assert.equal(indicatorCountChecks, 2);
});

test("study legend value refresh does not invoke its layout render", () => {
  const refresh = createRefresh({
    getAllChartPanes: () => [],
    paneByIndex: () => undefined,
    getInstances: () => new Map(),
    indicatorsForPane: () => [],
    destroySeries() {},
    ensureSeries() {},
    syncPaneVolumeMargins() {},
    rebuildStudyScaleLocks() {},
    syncStudyPaneScale() {},
    refreshOverlaysForPaneNow() {},
    emit() {},
  });
  let layoutRenders = 0;
  let valueRefreshes = 0;
  const pane = {
    _studyLegendOverlay: {
      render() {
        layoutRenders += 1;
      },
      refreshValues() {
        valueRefreshes += 1;
      },
    },
  };

  refresh.refreshStudyPaneLegendValues(pane);
  assert.equal(valueRefreshes, 1);
  assert.equal(layoutRenders, 0);

  refresh.refreshStudyPaneLegends(pane);
  assert.equal(layoutRenders, 1);
});

test("setting an unchanged pane height does not invalidate the chart", () => {
  let invalidations = 0;
  const pane = new Pane(
    {
      invalidate() {
        invalidations += 1;
      },
    },
    0,
  );

  pane.setRequestedHeight(0);
  pane.setRequestedHeight(110);
  pane.setRequestedHeight(110);
  pane.setRequestedHeight(110.9);
  pane.setRequestedHeight(-1);
  pane.setRequestedHeight(-1);

  assert.equal(pane.requestedHeight, 0);
  assert.equal(invalidations, 2);
});

test("switching active panes copies that pane's hover state to shared UI state", () => {
  const hoverBar = { time: 20, close: 102 };
  const hoverPrev = { time: 10, close: 101 };
  const pane = {
    hoverBar,
    hoverPrev,
  };
  const ui = {
    hoverBar: { time: 1 },
    hoverPrev: { time: 0 },
  };

  syncActivePaneHoverState(ui, pane);

  assert.strictEqual(ui.hoverBar, hoverBar);
  assert.strictEqual(ui.hoverPrev, hoverPrev);
});
