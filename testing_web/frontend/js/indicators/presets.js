import { registerIndicatorPresetProvider } from "/js/indicators/presets.js";
import { testingIndicatorPresetPatch } from "./presetPatches.js";

export { testingIndicatorPresetPatch } from "./presetPatches.js";

export function registerTestingIndicatorPresets() {
  return registerIndicatorPresetProvider(testingIndicatorPresetPatch);
}
