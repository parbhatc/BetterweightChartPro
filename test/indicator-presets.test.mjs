import test from "node:test";
import assert from "node:assert/strict";

import {
  indicatorPresetPatch,
  normalizeIndicatorPresetId,
  registerIndicatorPresetProvider,
} from "../public/js/indicators/presets.js";
import { createLifecycle } from "../public/js/indicators/controller/lifecycle.js";
import {
  LEVEL_DARK_HTF_PALETTE,
  LEVEL_DARK_SESSION_PALETTE,
  levelEnginePalette,
  migrateLegacyLevelColor,
  resolveLevelPalettePreset,
} from "../testing_web/frontend/js/indicators/levels/palette.js";
import { testingIndicatorPresetPatch } from "../testing_web/frontend/js/indicators/presetPatches.js";

test("indicator presets are independent and preserve the historical dark palettes", () => {
  assert.equal(normalizeIndicatorPresetId("missing"), "none");
  assert.equal(indicatorPresetPatch("smt", "none"), null);

  const graySmt = indicatorPresetPatch("smt", "gray");
  assert.equal(graySmt.style.highColor, "#916966");
  assert.equal(graySmt.style.lowColor, "#6e7c65");

  const grayHtf = indicatorPresetPatch("htf_power_of_three", "gray");
  assert.equal(grayHtf.style.openLineColor, "#5e6977");
  assert.equal(grayHtf.style.openLineColorOpacity, 100);
  const darkHtf = indicatorPresetPatch("htf_power_of_three", "dark");
  assert.equal(darkHtf.style.openLineColor, "#787b86");
  assert.equal(darkHtf.style.openLineColorOpacity, 50);

  assert.equal(indicatorPresetPatch("host_owned", "gray"), null);
  const dispose = registerIndicatorPresetProvider((defId, id) =>
    defId === "host_owned" ? { inputs: { palette: id } } : null,
  );
  assert.equal(indicatorPresetPatch("host_owned", "dark").inputs.palette, "dark");
  dispose();
  assert.equal(indicatorPresetPatch("host_owned", "dark"), null);
});

test("the testing FVG preset exposes and resets its timeframe colors", () => {
  const dark = testingIndicatorPresetPatch("fvg", "dark");
  assert.equal(dark.inputs.indicatorAppearancePreset, "dark");
  assert.equal(dark.inputs.showFvgBoxColors, true);
  assert.deepEqual(dark.inputs.fvgBoxColorsByTf, {});
  assert.equal(dark.inputs.bullBoxColor, "#4caf50");
  assert.equal(dark.inputs.bullBorderColorOpacity, 50);
  assert.equal(dark.inputs.bearBoxColor, "#f23645");
  assert.equal(dark.inputs.ifvgBoxColor, "#ffff00");
});

test("dark Levels uses the pre-Gray HTF and session colors", () => {
  assert.equal(resolveLevelPalettePreset(undefined), "dark");
  assert.equal(resolveLevelPalettePreset("gray"), "gray");
  const levelsHtfStyles = { all: () => ({
    "240": { tag: "4H", hi: "#526b7a", lo: "#8a6558" },
    "60": { tag: "1H", hi: "#607a73", lo: "#8a5f62" },
  }) };
  const levelsSessionDefs = { all: () => ({
    asia: { label: "Asia", color: "#607a73" },
    london: { label: "London", color: "#75647d" },
  }) };
  const dark = levelEnginePalette("dark", levelsHtfStyles, levelsSessionDefs);
  assert.equal(dark.htfStyles["240"].hi, LEVEL_DARK_HTF_PALETTE["240"].hi);
  assert.equal(dark.htfStyles["60"].lo, "#ff4d4d");
  assert.equal(dark.sessionDefs.asia.color, LEVEL_DARK_SESSION_PALETTE.asia);
  assert.equal(dark.sessionDefs.london.color, "#9400d3");
  assert.equal(migrateLegacyLevelColor("#f59e0b", "#f59e0b", "#8a7654", "dark"), "#f59e0b");
  assert.equal(migrateLegacyLevelColor("#75647d", "#9400d3", "#75647d", "dark"), "#9400d3");
  assert.equal(migrateLegacyLevelColor("#f59e0b", "#f59e0b", "#8a7654", "gray"), "#8a7654");
});

test("the lifecycle applies the selected palette to restored, new, and existing indicators", () => {
  const instances = new Map();
  let selectedId = null;
  let preset = "gray";
  const lifecycle = createLifecycle({
    paneByIndex: () => null,
    getInstances: () => instances,
    destroySeries: () => {},
    refreshInstance: () => {},
    refreshPaneImmediate: () => {},
    refreshOverlaysImmediate: () => {},
    syncPaneVolumeMargins: () => {},
    rebuildStudyScaleLocks: () => {},
    collapseEmptyStudyPanes: () => {},
    emit: () => {},
    getSelectedId: () => selectedId,
    setSelectedId: (id) => { selectedId = id; },
    indicatorsForPane: (paneIndex) => [...instances.values()].filter((item) => item.paneIndex === paneIndex),
    getPresetPatch: (defId) => indicatorPresetPatch(defId, preset),
  });

  const id = lifecycle.addIndicator("cisd", 0);
  assert.equal(instances.get(id).style.bullColor, "#6e7c65");
  instances.get(id).inputs.minCandles = 9;

  preset = "dark";
  lifecycle.applyPreset((defId) => indicatorPresetPatch(defId, preset));
  assert.equal(instances.get(id).style.bullColor, "#089981");
  assert.equal(instances.get(id).inputs.minCandles, 9);

  lifecycle.setIndicatorsByPane({
    0: [{ instanceId: "restored", defId: "smt", paneIndex: 0, inputs: { leftLen: 7 }, style: {}, visibility: {} }],
  });
  assert.equal(instances.get("restored").style.highColor, "#ff1100");
  assert.equal(instances.get("restored").inputs.leftLen, 7);
});
