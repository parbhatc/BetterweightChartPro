import {
  DEFAULT_SETTINGS,
  SETTINGS_SECTIONS,
  cloneSettingsDefaults,
} from "./defaults.js";

const MAX_UNDO = 100;

const LEGACY_DARK_CANVAS_COLORS = {
  backgroundColor: ["#020617", DEFAULT_SETTINGS.canvas.backgroundColor],
  backgroundGradientTopColor: ["#0f172a", DEFAULT_SETTINGS.canvas.backgroundGradientTopColor],
  backgroundGradientBottomColor: ["#020617", DEFAULT_SETTINGS.canvas.backgroundGradientBottomColor],
  gridVertColor: ["rgba(226, 232, 240, 0.06)", DEFAULT_SETTINGS.canvas.gridVertColor],
  gridHorzColor: ["rgba(226, 232, 240, 0.06)", DEFAULT_SETTINGS.canvas.gridHorzColor],
  crosshairColor: ["#64748b", DEFAULT_SETTINGS.canvas.crosshairColor],
  watermarkColor: ["rgba(148, 163, 184, 0.25)", DEFAULT_SETTINGS.canvas.watermarkColor],
  scalesTextColor: ["#e2e8f0", DEFAULT_SETTINGS.canvas.scalesTextColor],
};

/** @param {typeof DEFAULT_SETTINGS | null | undefined} next */
function normalizeSettings(next) {
  const merged = cloneSettingsDefaults();
  if (!next || typeof next !== "object") return merged;
  for (const [section, values] of Object.entries(next)) {
    if (merged[section] && values && typeof values === "object") {
      Object.assign(merged[section], values);
    }
  }
  if (!["default", "none", "theme"].includes(String(merged.canvas.appearancePreset))) {
    merged.canvas.appearancePreset = DEFAULT_SETTINGS.canvas.appearancePreset;
  }
  if (String(next.symbol?.ethBackground ?? "").toLowerCase() === "rgba(161, 161, 170, 0.08)") {
    merged.symbol.ethBackground = DEFAULT_SETTINGS.symbol.ethBackground;
  }
  // Migrate the previous lower-margin default so existing saved layouts pick
  // up the tighter TradingView-like spacing without touching custom values.
  if (Number(next.canvas?.marginBottom) === 8) {
    merged.canvas.marginBottom = DEFAULT_SETTINGS.canvas.marginBottom;
  }
  // Saved layouts from the previous dark theme otherwise restore its navy
  // Basic styles over Auren's neutral zinc palette. Only migrate exact legacy
  // defaults so intentional custom colors remain untouched.
  for (const [key, [legacy, replacement]] of Object.entries(LEGACY_DARK_CANVAS_COLORS)) {
    if (String(next.canvas?.[key] ?? "").toLowerCase() === legacy.toLowerCase()) {
      merged.canvas[key] = replacement;
    }
  }
  // Gray originally used an opaque light-gray crosshair, which looked washed
  // out over its warm background. Migrate only that exact preset default to
  // TradingView's darker, half-opacity treatment and preserve custom colors.
  if (
    merged.canvas.appearancePreset === "theme" &&
    String(next.canvas?.crosshairColor ?? "").toLowerCase() === "#9c9c9c" &&
    Number(next.canvas?.crosshairOpacity ?? 100) === 100
  ) {
    merged.canvas.crosshairColor = "#000000";
    merged.canvas.crosshairOpacity = 50;
  }
  // Version 1 briefly shipped bid/ask labels and lines enabled by default.
  // Move those profiles back to the quieter opt-in default once; version 2
  // then preserves every explicit user choice.
  if (Number(next.scales?.bidAskDefaultsVersion) === 1) {
    merged.scales.bidLabelValue = false;
    merged.scales.bidLabelLine = false;
    merged.scales.askLabelValue = false;
    merged.scales.askLabelLine = false;
  }
  merged.scales.bidAskDefaultsVersion = 2;
  // Version 1 stored an inverse pixel-derived value and adjusted margins
  // instead of the visible price span. It cannot be interpreted as
  // TradingView's price-units-per-bar ratio.
  if (Number(next.scales?.lockPriceToBarRatioVersion) !== 2) {
    merged.scales.lockPriceToBarRatio = false;
    merged.scales.lockPriceToBarRatioValue = null;
  }
  merged.scales.lockPriceToBarRatioVersion = 2;
  // TradingView attribution is not part of BWC Pro's appearance controls.
  merged.canvas.attributionLogo = false;
  return merged;
}

export function createChartSettings() {
  /** @type {typeof DEFAULT_SETTINGS} */
  let settings = cloneSettingsDefaults();
  /** @type {typeof DEFAULT_SETTINGS[]} */
  let undoStack = [];
  /** @type {typeof DEFAULT_SETTINGS[]} */
  let redoStack = [];
  const listeners = new Set();

  function emit() {
    listeners.forEach((fn) => fn(settings));
  }

  function pushUndo() {
    undoStack.push(structuredClone(settings));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
  }

  return {
    get() {
      return settings;
    },
    getDefaults() {
      return cloneSettingsDefaults();
    },
    getSections() {
      return SETTINGS_SECTIONS;
    },
    canUndo() {
      return undoStack.length > 0;
    },
    canRedo() {
      return redoStack.length > 0;
    },
    getUndoDepth() {
      return undoStack.length;
    },
    trimUndo(depth) {
      if (depth < undoStack.length) undoStack.length = depth;
    },
    clearRedo() {
      redoStack = [];
    },
    markHistory() {
      pushUndo();
    },
    undo() {
      if (!undoStack.length) return false;
      redoStack.push(structuredClone(settings));
      settings = undoStack.pop();
      emit();
      return true;
    },
    redo() {
      if (!redoStack.length) return false;
      undoStack.push(structuredClone(settings));
      settings = redoStack.pop();
      emit();
      return true;
    },
    /** @param {string} section @param {string} key @param {unknown} value @param {{ skipHistory?: boolean }} [opts] */
    set(section, key, value, opts = {}) {
      if (!settings[section]) return;
      const defaults = cloneSettingsDefaults();
      if (!(key in settings[section])) {
        if (!defaults[section] || !(key in defaults[section])) return;
      }
      if (!opts.skipHistory) pushUndo();
      settings[section][key] = value;
      emit();
    },
    /** @param {Partial<typeof DEFAULT_SETTINGS>} patch @param {{ skipHistory?: boolean }} [opts] */
    merge(patch, opts = {}) {
      if (!opts.skipHistory) pushUndo();
      for (const [section, values] of Object.entries(patch)) {
        if (settings[section] && values && typeof values === "object") {
          Object.assign(settings[section], values);
        }
      }
      emit();
    },
    /** @param {typeof DEFAULT_SETTINGS} next @param {{ skipHistory?: boolean }} [opts] */
    replace(next, opts = {}) {
      if (!opts.skipHistory) pushUndo();
      settings = normalizeSettings(next);
      emit();
    },
    reset() {
      pushUndo();
      settings = cloneSettingsDefaults();
      emit();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
