import { defineIndicator } from "../defineIndicator.js";
import { registerIndicator } from "../catalog.js";
import { compileIndicatorFormula, parseIndicatorFormula } from "./formula.js";

const STORAGE_KEY = "bwc.customIndicators.v1";

function slug(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function normalizeCustomIndicatorSpec(spec) {
  if (!spec || typeof spec !== "object") throw new TypeError("Custom indicator settings are required");
  const title = String(spec.title ?? spec.name ?? "").trim();
  if (!title) throw new Error("Indicator name is required");
  if (title.length > 60) throw new Error("Indicator name must be 60 characters or fewer");
  const formula = String(spec.formula ?? "").trim();
  parseIndicatorFormula(formula);
  const id = String(spec.id ?? `custom_${slug(title)}`).trim();
  if (!/^custom_[a-z0-9_]+$/.test(id)) throw new Error("Custom indicator id must start with custom_");
  const color = /^#[0-9a-f]{6}$/i.test(String(spec.color ?? "")) ? String(spec.color) : "#7c4dff";
  return {
    id,
    title,
    shortTitle: String(spec.shortTitle ?? title).trim().slice(0, 24) || title.slice(0, 24),
    formula,
    color,
    placement: spec.placement === "pane" ? "pane" : "chart",
  };
}

export function customIndicatorClass(specIn) {
  const spec = normalizeCustomIndicatorSpec(specIn);
  const compute = compileIndicatorFormula(spec.formula);
  const Indicator = defineIndicator({
    id: spec.id,
    title: spec.title,
    shortTitle: spec.shortTitle,
    primaryPlot: "value",
    plots: [{ id: "value", title: spec.title, color: spec.color, priceLine: true }],
    studyPaneOrder: spec.placement === "pane" ? 50 : null,
    studyPaneHeight: 120,
    compute: (bars) => ({ value: compute(bars) }),
  });
  Indicator.customSpec = spec;
  Indicator.isCustom = true;
  return Indicator;
}

export function registerCustomIndicator(specIn) {
  const Indicator = customIndicatorClass(specIn);
  registerIndicator(Indicator);
  return Indicator.customSpec;
}

export function loadCustomIndicatorSpecs(storage = globalThis.localStorage) {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function saveCustomIndicatorSpec(specIn, storage = globalThis.localStorage) {
  const spec = normalizeCustomIndicatorSpec(specIn);
  if (!storage) return spec;
  const saved = loadCustomIndicatorSpecs(storage).filter((item) => item?.id !== spec.id);
  saved.push(spec);
  storage.setItem(STORAGE_KEY, JSON.stringify(saved));
  return spec;
}

export function registerStoredCustomIndicators(storage = globalThis.localStorage) {
  const registered = [];
  for (const raw of loadCustomIndicatorSpecs(storage)) {
    try {
      registered.push(registerCustomIndicator(raw));
    } catch (error) {
      console.warn("Skipping invalid saved custom indicator", error);
    }
  }
  return registered;
}

export function createCustomIndicator(specIn, { persist = true, storage = globalThis.localStorage } = {}) {
  const spec = persist ? saveCustomIndicatorSpec(specIn, storage) : normalizeCustomIndicatorSpec(specIn);
  registerCustomIndicator(spec);
  return spec;
}
