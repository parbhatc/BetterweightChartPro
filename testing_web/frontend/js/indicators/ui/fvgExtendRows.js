/**
 * Keep every configured timeframe in the Extend Boxes panel. A timeframe that
 * is temporarily hidden still needs a DOM row so reading another setting does
 * not erase its saved extend preference.
 *
 * @param {Array<{ enabled?: boolean }>} rows
 */
export function fvgExtendPanelRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

/** @param {{ enabled?: boolean }} row @param {boolean} panelDisabled */
export function isFvgExtendRowDisabled(row, panelDisabled) {
  return panelDisabled || row?.enabled === false;
}
