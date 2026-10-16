import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeFvgTimeframes,
} from "../testing_web/frontend/js/indicators/ui/fvgTimeframeRows.js";
import { isFvgVisibleForMitigationFilter } from "../testing_web/frontend/js/indicators/fvg/tap.js";

test("unmitigated-only is saved and resolved independently for each FVG timeframe", () => {
  const rows = normalizeFvgTimeframes([
    { enabled: true, label: "5m FVG", timeframe: "5", unmitigatedOnly: false },
    { enabled: true, label: "15m FVG", timeframe: "15", unmitigatedOnly: true },
  ]);

  assert.equal(rows[0].unmitigatedOnly, false);
  assert.equal(rows[1].unmitigatedOnly, true);

});

test("an unmitigated-only layer hides a zone after its first touch", () => {
  const untouched = { tapped: false };
  const touched = { tapped: true };

  assert.equal(isFvgVisibleForMitigationFilter({ unmitigatedOnly: true }, untouched), true);
  assert.equal(isFvgVisibleForMitigationFilter({ unmitigatedOnly: true }, touched), false);
  assert.equal(isFvgVisibleForMitigationFilter({ unmitigatedOnly: false }, touched), true);
});

test("older timeframe settings default to showing touched FVGs", () => {
  const [row] = normalizeFvgTimeframes([
    { enabled: true, label: "15m FVG", timeframe: "15" },
  ]);

  assert.equal(row.unmitigatedOnly, false);
});
