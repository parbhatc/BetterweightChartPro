import test from "node:test";
import assert from "node:assert/strict";

import { resolveHostReplayResolutionAnchor } from "../public/js/replay/formingBar.js";

test("host replay keeps the resolution-aware sub-bar when switching 1m to 30s", () => {
  const minuteOpen = 9 * 60 * 60 + 41 * 60;
  const finalThirtySecondOpen = minuteOpen + 30;

  assert.equal(
    resolveHostReplayResolutionAnchor(finalThirtySecondOpen, minuteOpen),
    finalThirtySecondOpen,
  );
});

test("host replay falls back to its raw anchor when no mapped anchor is available", () => {
  assert.equal(resolveHostReplayResolutionAnchor(null, 1234), 1234);
});
