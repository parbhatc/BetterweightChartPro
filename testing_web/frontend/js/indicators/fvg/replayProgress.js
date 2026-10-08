/**
 * Return the HTF bars that became confirmed since the previous replay frame.
 * The previous tail was forming, so it is the first bar eligible to confirm
 * when the aggregate series grows. If the HTF series did not grow, no bar
 * became confirmed and replay must not process the same zone again.
 *
 * @param {number} previousLength
 * @param {number} nextLength
 * @param {number} startIdx
 */
export function confirmedHtfIndicesAfterAppend(previousLength, nextLength, startIdx = 2) {
  const previous = Math.max(0, Math.trunc(Number(previousLength) || 0));
  const next = Math.max(0, Math.trunc(Number(nextLength) || 0));
  const start = Math.max(0, Math.trunc(Number(startIdx) || 0));
  if (next <= previous) return [];

  const firstConfirmed = Math.max(start, previous - 1);
  const lastConfirmed = next - 2;
  if (firstConfirmed > lastConfirmed) return [];

  return Array.from(
    { length: lastConfirmed - firstConfirmed + 1 },
    (_, offset) => firstConfirmed + offset,
  );
}
