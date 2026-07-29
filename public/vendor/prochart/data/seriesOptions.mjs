import { clone } from "../core/utils.mjs";

/** Normalize public series options without mutating the caller's object. */
export function normalizeSeriesOptions(options) {
  if (!options) return {};

  const normalized = clone(options);
  if (normalized.borderColor && normalized.borderUpColor === undefined) {
    normalized.borderUpColor = normalized.borderColor;
    normalized.borderDownColor = normalized.borderColor;
  }
  if (normalized.wickColor && normalized.wickUpColor === undefined) {
    normalized.wickUpColor = normalized.wickColor;
    normalized.wickDownColor = normalized.wickColor;
  }
  return normalized;
}
