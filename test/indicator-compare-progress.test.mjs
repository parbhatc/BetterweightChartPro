import test from "node:test";
import assert from "node:assert/strict";

import { shouldPublishCompareProgress } from "../public/js/app/boot/chart/indicatorDataLoader.js";

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
