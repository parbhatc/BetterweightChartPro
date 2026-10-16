import assert from "node:assert/strict";
import test from "node:test";

import {
  fvgExtendPanelRows,
  isFvgExtendRowDisabled,
} from "../testing_web/frontend/js/indicators/ui/fvgExtendRows.js";

test("hidden FVG timeframes retain their Extend Boxes settings row", () => {
  const rows = [
    { enabled: true, timeframe: "chart" },
    { enabled: false, timeframe: "15" },
  ];

  assert.deepEqual(fvgExtendPanelRows(rows), rows);
  assert.equal(isFvgExtendRowDisabled(rows[0], false), false);
  assert.equal(isFvgExtendRowDisabled(rows[1], false), true);
  assert.equal(isFvgExtendRowDisabled(rows[0], true), true);
});
