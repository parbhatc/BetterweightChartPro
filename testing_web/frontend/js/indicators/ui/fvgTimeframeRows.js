/** @typedef {{ enabled: boolean, label: string, timeframe: string, unmitigatedOnly: boolean }} FvgTimeframeRow */

/** @type {FvgTimeframeRow[]} */
export const DEFAULT_FVG_TIMEFRAMES = [
  { enabled: true, label: "FVG", timeframe: "chart", unmitigatedOnly: false },
  { enabled: false, label: "15m FVG", timeframe: "15", unmitigatedOnly: false },
  { enabled: false, label: "1h FVG", timeframe: "60", unmitigatedOnly: false },
  { enabled: false, label: "4h FVG", timeframe: "240", unmitigatedOnly: false },
  { enabled: false, label: "D FVG", timeframe: "D", unmitigatedOnly: false },
];

const LEGACY_TF_DEFS = [
  { on: "tf1On", tf: "tf1", label: "tf1Label", defTf: "chart", defLabel: "FVG", defaultOn: true },
  { on: "tf2On", tf: "tf2", label: "tf2Label", defTf: "15", defLabel: "15m FVG" },
  { on: "tf3On", tf: "tf3", label: "tf3Label", defTf: "60", defLabel: "1h FVG" },
  { on: "tf4On", tf: "tf4", label: "tf4Label", defTf: "240", defLabel: "4h FVG" },
  { on: "tf5On", tf: "tf5", label: "tf5Label", defTf: "D", defLabel: "D FVG" },
];

/** @param {unknown} raw @returns {FvgTimeframeRow[]} */
export function normalizeFvgTimeframes(raw) {
  if (!Array.isArray(raw)) return DEFAULT_FVG_TIMEFRAMES.map((r) => ({ ...r }));
  return raw
    .map((r) => ({
      enabled: r?.enabled !== false,
      label: String(r?.label ?? "").trim(),
      timeframe: String(r?.timeframe ?? "chart").trim() || "chart",
      unmitigatedOnly: r?.unmitigatedOnly === true,
    }))
    .filter((r) => r.label);
}

/** @param {object} inputs @returns {FvgTimeframeRow[]} */
function migrateLegacyFvgTimeframes(inputs) {
  const rows = [];
  for (const def of LEGACY_TF_DEFS) {
    const enabled = def.defaultOn ? inputs[def.on] !== false : Boolean(inputs[def.on]);
    rows.push({
      enabled,
      label: String(inputs[def.label] ?? def.defLabel).trim(),
      timeframe: String(inputs[def.tf] ?? def.defTf),
      unmitigatedOnly: false,
    });
  }
  return normalizeFvgTimeframes(rows);
}

/** @param {object} inputs @returns {FvgTimeframeRow[]} */
export function resolveFvgTimeframeRows(inputs) {
  if (Array.isArray(inputs.fvgTimeframes) && inputs.fvgTimeframes.length > 0) {
    return normalizeFvgTimeframes(inputs.fvgTimeframes);
  }
  const hasLegacy = LEGACY_TF_DEFS.some(
    (d) => d.on in inputs || d.tf in inputs || d.label in inputs,
  );
  if (hasLegacy) return migrateLegacyFvgTimeframes(inputs);
  return DEFAULT_FVG_TIMEFRAMES.map((r) => ({ ...r }));
}
