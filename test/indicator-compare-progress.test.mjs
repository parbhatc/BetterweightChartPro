import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeCountBackNeeds,
  shouldPublishCompareProgress,
} from "../public/js/app/boot/chart/indicatorDataLoader.js";

test("SMT publishes a fresh initial compare page before historical backfill completes", () => {
  assert.equal(shouldPublishCompareProgress({
    hasBars: true,
    versionBefore: 2,
    versionAfter: 3,
    anchorSec: 1_786_000_000,
    tailStale: false,
  }), true);
});

test("SMT does not publish empty, unchanged, or replay-stale compare data", () => {
  assert.equal(shouldPublishCompareProgress({
    hasBars: false,
    versionBefore: 2,
    versionAfter: 3,
    anchorSec: null,
    tailStale: false,
  }), false);
  assert.equal(shouldPublishCompareProgress({
    hasBars: true,
    versionBefore: 3,
    versionAfter: 3,
    anchorSec: null,
    tailStale: false,
  }), false);
  assert.equal(shouldPublishCompareProgress({
    hasBars: true,
    versionBefore: 2,
    versionAfter: 3,
    anchorSec: 1_786_000_000,
    tailStale: true,
  }), false);
});

test("parallel indicator loads deduplicate HTF needs at the deepest count", () => {
  const merged = mergeCountBackNeeds(
    new Map([["NQ|240", 300], ["NQ|60", 500]]),
    new Map([["NQ|240", 800], ["ES|15", 200]]),
  );

  assert.deepEqual([...merged], [
    ["NQ|240", 800],
    ["NQ|60", 500],
    ["ES|15", 200],
  ]);
});
