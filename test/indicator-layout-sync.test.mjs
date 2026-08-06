import test from "node:test";
import assert from "node:assert/strict";

import {
  indicatorPaneContentSignature,
  syncedIndicatorsByPane,
} from "../public/js/indicators/layoutSync.js";

function fvg(instanceId, paneIndex, opacity = 15) {
  return {
    instanceId,
    defId: "fvg",
    type: "overlay",
    paneIndex,
    inputs: { bullBoxColor: "#4caf50", bullBoxColorOpacity: opacity },
    style: {},
    visibility: {},
    hidden: false,
  };
}

test("indicator sync copies the active pane stack and retains compatible ids", () => {
  const result = syncedIndicatorsByPane(
    { 0: [fvg("source", 0)], 1: [fvg("target", 1, 20)] },
    [0, 1],
    0,
    () => "generated",
  );

  assert.equal(result["0"][0].instanceId, "source");
  assert.equal(result["1"][0].instanceId, "target");
  assert.equal(result["1"][0].paneIndex, 1);
  assert.equal(result["1"][0].inputs.bullBoxColorOpacity, 15);
  assert.equal(
    indicatorPaneContentSignature(result["0"]),
    indicatorPaneContentSignature(result["1"]),
  );
});

test("indicator sync reports no work when pane contents already match", () => {
  assert.equal(
    syncedIndicatorsByPane({ 0: [fvg("a", 0)], 1: [fvg("b", 1)] }, [0, 1], 0),
    null,
  );
});

test("indicator sync mirrors removals from the active pane", () => {
  const result = syncedIndicatorsByPane({ 0: [], 1: [fvg("target", 1)] }, [0, 1], 0);
  assert.deepEqual(result, { 0: [], 1: [] });
});
