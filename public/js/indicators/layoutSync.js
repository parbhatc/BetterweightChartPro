/** @param {object[] | null | undefined} list */
export function indicatorPaneContentSignature(list) {
  return JSON.stringify((Array.isArray(list) ? list : []).map((raw) => ({
    defId: raw.defId,
    type: raw.type,
    inputs: raw.inputs,
    style: raw.style,
    visibility: raw.visibility,
    hidden: Boolean(raw.hidden),
  })));
}

/**
 * Copy one pane's indicator stack to every pane while retaining compatible
 * target instance ids. Stable ids keep open legends/settings attached.
 *
 * @param {Record<string, object[]>} byPane
 * @param {number[]} paneIndexes
 * @param {number} sourcePaneIndex
 * @param {(defId: string, paneIndex: number, position: number) => string} [makeId]
 */
export function syncedIndicatorsByPane(
  byPane,
  paneIndexes,
  sourcePaneIndex,
  makeId = (defId, paneIndex) => `${defId}_${paneIndex}_${Math.random().toString(36).slice(2, 9)}`,
) {
  const source = Array.isArray(byPane?.[String(sourcePaneIndex)])
    ? byPane[String(sourcePaneIndex)]
    : [];
  const sourceSignature = indicatorPaneContentSignature(source);
  const alreadySynced = paneIndexes.every(
    (paneIndex) => indicatorPaneContentSignature(byPane?.[String(paneIndex)]) === sourceSignature,
  );
  if (alreadySynced) return null;

  return Object.fromEntries(paneIndexes.map((paneIndex) => {
    const target = Array.isArray(byPane?.[String(paneIndex)]) ? byPane[String(paneIndex)] : [];
    const list = source.map((raw, position) => {
      const compatible = target[position]?.defId === raw.defId ? target[position] : null;
      return {
        ...structuredClone(raw),
        instanceId:
          paneIndex === sourcePaneIndex
            ? raw.instanceId
            : compatible?.instanceId ?? makeId(raw.defId, paneIndex, position),
        paneIndex,
      };
    });
    return [String(paneIndex), list];
  }));
}
