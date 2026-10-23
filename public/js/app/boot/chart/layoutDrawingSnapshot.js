/**
 * Persist drawings to the layout manager synchronously while auto-save is on.
 * The slower layout-library write may remain debounced.
 * @param {{ layoutManager?: object, drawingHub?: object }} ctx
 */
export function persistAutosaveDrawingSnapshot(ctx) {
  if (!ctx.layoutManager?.getAutoSave?.()) return false;
  const drawings = ctx.drawingHub?.getDrawingsByPane?.();
  ctx.layoutManager.setDrawingsSnapshot(drawings ?? null);
  return true;
}
