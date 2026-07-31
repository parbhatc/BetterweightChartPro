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

/** @param {unknown} value @param {string} legacyColor @param {string} nextColor */
export function migrateLegacyLevelColor(value, legacyColor, nextColor) {
  const raw = value && typeof value === "object" && "color" in value
    ? value.color
    : value;
  if (String(raw ?? "").toLowerCase() === legacyColor.toLowerCase()) return nextColor;
  return raw ? String(raw) : nextColor;
}
