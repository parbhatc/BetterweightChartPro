export const DEFAULT_FVG_BULL_COLOR = "#6e7c65";
export const DEFAULT_FVG_BEAR_COLOR = "#916966";
export const DEFAULT_FVG_FILL_OPACITY = 20;
export const DEFAULT_FVG_BORDER_OPACITY = 0;
export const DEFAULT_FVG_TAP_BORDER_COLOR = "#787b86";
export const DEFAULT_IFVG_COLOR = "#8a8051";
export const DEFAULT_IFVG_FILL_OPACITY = 20;

const LEGACY_FVG_COLORS = {
  bull: new Set(["#4caf50", "#00897b", "#00bcd4", "#2962ff"]),
  bear: new Set(["#f23645", "#880e4f", "#e53935", "#ff6d00"]),
};

const LEGACY_CHART_COLORS = new Set(["#4caf50", "#f23645"]);

export function defaultFvgPalette() {
  return {
    bull: DEFAULT_FVG_BULL_COLOR,
    bear: DEFAULT_FVG_BEAR_COLOR,
    fillOpacity: DEFAULT_FVG_FILL_OPACITY,
    borderOpacity: DEFAULT_FVG_BORDER_OPACITY,
  };
}

/**
 * Migrates only exact former FVG defaults. User-selected colors or opacity
 * changes remain untouched.
 * @param {"bull" | "bear"} side
 * @param {"fill" | "border"} role
 * @param {unknown} color
 * @param {unknown} opacity
 * @param {string} [presetId]
 */
export function migrateLegacyFvgSetting(side, role, color, opacity, presetId = "") {
  const normalizedColor = String(color ?? "").toLowerCase();
  const normalizedOpacity = Number(opacity);
  const legacyOpacity = role === "border"
    ? 50
    : LEGACY_CHART_COLORS.has(normalizedColor) ? 20 : 15;
  if (
    presetId === "dark" ||
    !LEGACY_FVG_COLORS[side].has(normalizedColor) ||
    !Number.isFinite(normalizedOpacity) ||
    normalizedOpacity !== legacyOpacity
  ) {
    return { color: String(color), opacity: normalizedOpacity };
  }
  return {
    color: side === "bull" ? DEFAULT_FVG_BULL_COLOR : DEFAULT_FVG_BEAR_COLOR,
    opacity: role === "border" ? DEFAULT_FVG_BORDER_OPACITY : DEFAULT_FVG_FILL_OPACITY,
  };
}

/** @param {unknown} color @param {unknown} opacity @param {string} [presetId] */
export function resolveDefaultIfvgSetting(color, opacity, presetId = "") {
  const normalizedColor = String(color ?? DEFAULT_IFVG_COLOR).toLowerCase();
  const normalizedOpacity = Number(opacity ?? DEFAULT_IFVG_FILL_OPACITY);
  const usesDefault =
    presetId !== "dark" && normalizedOpacity === DEFAULT_IFVG_FILL_OPACITY &&
    (normalizedColor === "#ffff00" || normalizedColor === DEFAULT_IFVG_COLOR);
  return {
    color: usesDefault ? DEFAULT_IFVG_COLOR : String(color),
    opacity: normalizedOpacity,
    usesDefault,
  };
}
