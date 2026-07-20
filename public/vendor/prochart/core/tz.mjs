import { lowerBound } from "./utils.mjs";

/**
 * Fast UTC-offset lookup from a precomputed, sorted transition table.
 * @param {string} timeZone
 * @param {{ utcTimestamp: number, offset: number }[]} transitions sorted ascending
 */
export function createFastTimezoneProvider(timeZone, transitions) {
  const ts = (transitions && transitions.length ? transitions : [{ utcTimestamp: 0, offset: 0 }])
    .slice()
    .sort((a, b) => a.utcTimestamp - b.utcTimestamp);
  const stamps = new Float64Array(ts.length);
  const offsets = new Float64Array(ts.length);
  for (let i = 0; i < ts.length; i++) {
    stamps[i] = ts[i].utcTimestamp;
    offsets[i] = ts[i].offset;
  }
  let lastIdx = 0;
  return {
    timeZone,
    getOffset(utcSec) {
      if (utcSec >= stamps[lastIdx] && (lastIdx + 1 >= stamps.length || utcSec < stamps[lastIdx + 1])) {
        return offsets[lastIdx];
      }
      let i = lowerBound(stamps, stamps.length, utcSec + 1e-9) - 1;
      if (i < 0) i = 0;
      lastIdx = i;
      return offsets[i];
    },
  };
}
