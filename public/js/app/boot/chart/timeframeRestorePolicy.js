/**
 * UTC restoration is a compatibility fallback for old saved layouts. Current
 * layouts include bar-slot geometry, which must win across timeframe changes.
 * @param {{ width?: number, toBeyondAnchor?: number, visibleFromUtc?: number, visibleToUtc?: number } | null | undefined} layout
 * @param {string | null | undefined} targetResolution
 */
export function timeframeSwitchPrefersUtcRestore(layout, targetResolution) {
  if (!layout || layout.visibleFromUtc == null || layout.visibleToUtc == null) return false;
  const hasBarLayout = Number.isFinite(layout.width) && Number.isFinite(layout.toBeyondAnchor);
  return !hasBarLayout && typeof targetResolution === "string" && targetResolution.length > 0;
}
