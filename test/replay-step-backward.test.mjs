import assert from "node:assert/strict";
import test from "node:test";

import { createReplayPlayback } from "../public/js/replay/engine/playback.js";

function playbackForBars(bars) {
  const pane = { resolution: "1" };
  const ctx = {
    resolution: "1",
    barSecForPaneLocal: () => 60,
    getActivePane: () => pane,
    chartPanes: new Map([[0, pane]]),
  };
  const replay = { getState: () => ({ playing: false }), pause: () => {} };
  const state = {};
  const playback = createReplayPlayback(ctx, replay, state, {
    ensureAllSnapshotsForward: async () => {},
    hasForwardBars: () => false,
    getMaxBarIndex: () => bars.length - 1,
    ensureReplayLtBarsForCursor: async () => {},
  });
  return { playback, pane };
}

test("previous replay step moves back one interval and clamps to loaded history", () => {
  const bars = [{ time: 100 }, { time: 160 }, { time: 220 }];
  const { playback, pane } = playbackForBars(bars);
  const state = { currentBarTime: 220, stepInterval: "1", autoSelectInterval: true };

  assert.deepEqual(playback.resolvePreviousReplayCursor(state, { bars }, pane), {
    previousTime: 160,
    previousIdx: 1,
  });

  state.currentBarTime = 160;
  assert.deepEqual(playback.resolvePreviousReplayCursor(state, { bars }, pane), {
    previousTime: 100,
    previousIdx: 0,
  });

  state.currentBarTime = 100;
  assert.equal(playback.resolvePreviousReplayCursor(state, { bars }, pane), null);
});
