import { ALL_INDICATORS } from "./definitions/index.js";
import { defineIndicator } from "./defineIndicator.js";

/** @typedef {typeof import("./BaseIndicator.js").BaseIndicator} IndicatorClass */
/** @typedef {import("./types.js").IndicatorInstance} IndicatorInstance */

/** @type {Map<string, IndicatorClass>} */
const registry = new Map(ALL_INDICATORS.map((Indicator) => [Indicator.id, Indicator]));

/** @returns {IndicatorClass[]} */
export function listIndicators() {
  return [...registry.values()]
    .filter((Indicator) => Indicator.enabled)
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** @param {string} id @returns {IndicatorClass | null} */
export function getIndicatorClass(id) {
  return registry.get(id) ?? null;
}

/** @param {IndicatorClass} Indicator */
export function registerIndicator(Indicator) {
  if (!Indicator.id) throw new Error("Indicator.id is required");
  registry.set(Indicator.id, Indicator);
}

/** Register either a complete class or a compact one-file definition object. */
export function registerIndicatorDefinition(configOrClass) {
  const Indicator =
    typeof configOrClass === "function" && typeof configOrClass.createInstance === "function"
      ? configOrClass
      : defineIndicator(configOrClass);
  registerIndicator(Indicator);
  return Indicator;
}

/** @param {string} defId @param {number} paneIndex @returns {IndicatorInstance | null} */
export function createIndicatorInstance(defId, paneIndex) {
  const Indicator = getIndicatorClass(defId);
  return Indicator?.createInstance(paneIndex) ?? null;
}

