import test from "node:test";
import assert from "node:assert/strict";

import {
  paintSynchronizedReplayPanes,
  prepareSynchronizedReplayPanesBeforeTimeframeSwitch,
} from "../public/js/app/boot/chart/timeframeSyncPaint.js";

test("a synchronized host-replay timeframe switch repaints and refits every pane", () => {
  const panes = [
    { index: 0, resolution: "2", bars: [{ time: 60 }, { time: 120 }] },
    { index: 1, resolution: "2", bars: [{ time: 60 }, { time: 120 }] },
  ];
  const repainted = [];
  const refitted = [];
  const ctx = { layoutManager: { getSync: () => ({ dateRange: false }) } };

  paintSynchronizedReplayPanes(ctx, panes, [null, null], (_ctx, pane) => {
    repainted.push(pane.index);
    refitted.push(pane.index);
    pane.replayCursorEndIndex = pane.bars.length - 1;
  });

  assert.deepEqual(repainted, [0, 1]);
  assert.deepEqual(refitted, [0, 1]);
  assert.equal(panes[0].replayCursorEndIndex, 1);
  assert.equal(panes[1].replayCursorEndIndex, 1);
});

test("a synchronized replay switch never lets another symbol replace the active pane stash", () => {
  const panes = [
    { index: 0, symbol: "NQ", resolution: "15", bars: [{ close: 25844.25 }] },
    { index: 1, symbol: "ES", resolution: "15", bars: [{ close: 7806.25 }] },
  ];
  const savedLayouts = [{ resolution: "15" }, { resolution: "15" }];
  const stashed = [];
  const ctx = {
    opts: { replayHostControlled: true },
    getActivePane: () => panes[0],
    replayEngine: {
      beforeResolutionChange(pane, options) {
        stashed.push({
          pane: pane.index,
          symbol: pane.symbol,
          close: pane.bars.at(-1).close,
          layout: options.viewportLayout,
        });
      },
    },
  };

  prepareSynchronizedReplayPanesBeforeTimeframeSwitch(ctx, panes, savedLayouts);

  assert.deepEqual(stashed, [
    { pane: 0, symbol: "NQ", close: 25844.25, layout: savedLayouts[0] },
  ]);
  assert.equal(panes[0]._hostReplayTfSwitchInFlight, undefined);
  assert.equal(panes[1]._hostReplayTfSwitchInFlight, true);
});
