export const LEVEL_HTF_PALETTE = Object.freeze({
  "240": Object.freeze({ hi: "#526b7a", lo: "#8a6558" }),
  "60": Object.freeze({ hi: "#607a73", lo: "#8a5f62" }),
  "15": Object.freeze({ hi: "#887f58", lo: "#77667f" }),
  "10": Object.freeze({ hi: "#8e825d", lo: "#7d6984" }),
  "5": Object.freeze({ hi: "#948762", lo: "#826d88" }),
});

export const LEVEL_SESSION_PALETTE = Object.freeze({
  asia: "#607a73",
  london: "#75647d",
  ny_am: "#865f69",
  ny_lunch: "#8a7654",
  ny_pm: "#526b7a",
});

export const LEVEL_REFERENCE_PALETTE = Object.freeze({
  previousDay: "#8a7654",
  previousWeek: "#5e7482",
  midpoint: "#71805b",
  confluenceHigh: "#75647d",
  confluenceLow: "#8a7654",
});

export const LEVEL_DARK_HTF_PALETTE = Object.freeze({
  "240": Object.freeze({ hi: "#007fff", lo: "#ff7644" }),
  "60": Object.freeze({ hi: "#00ffcc", lo: "#ff4d4d" }),
  "15": Object.freeze({ hi: "#ffed4a", lo: "#e046ff" }),
  "10": Object.freeze({ hi: "#ffed4a", lo: "#e046ff" }),
  "5": Object.freeze({ hi: "#ffed4a", lo: "#e046ff" }),
});

export const LEVEL_DARK_SESSION_PALETTE = Object.freeze({
  asia: "#00ffcc",
  london: "#9400d3",
  ny_am: "#ff007f",
  ny_lunch: "#ffaa00",
  ny_pm: "#007fff",
});

export function resolveLevelPalettePreset(value) {
  return String(value ?? "dark") === "gray" ? "gray" : "dark";
}

/** @param {string} presetId @param {object} htfStyles @param {object} sessionDefs */
export function levelEnginePalette(presetId, htfStyles, sessionDefs) {
  if (presetId !== "dark") {
    return { htfStyles: htfStyles.all(), sessionDefs: sessionDefs.all() };
  }
  return {
    htfStyles: Object.fromEntries(Object.entries(htfStyles.all()).map(([id, style]) => [
      id,
      { ...style, ...(LEVEL_DARK_HTF_PALETTE[id] ?? LEVEL_DARK_HTF_PALETTE["240"]) },
    ])),
    sessionDefs: Object.fromEntries(Object.entries(sessionDefs.all()).map(([id, def]) => [
      id,
      { ...def, color: LEVEL_DARK_SESSION_PALETTE[id] ?? LEVEL_DARK_SESSION_PALETTE.asia },
    ])),
  };
}

/** @param {unknown} value @param {string} legacyColor @param {string} nextColor @param {string} [presetId] */
export function migrateLegacyLevelColor(value, legacyColor, nextColor, presetId = "") {
  const raw = value && typeof value === "object" && "color" in value
    ? value.color
    : value;
  const normalized = String(raw ?? "").toLowerCase();
  if (presetId === "dark" && normalized === nextColor.toLowerCase()) return legacyColor;
  if (presetId !== "dark" && normalized === legacyColor.toLowerCase()) return nextColor;
  return raw ? String(raw) : nextColor;
}
