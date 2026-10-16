/** @typedef {import("/js/indicators/script/liquidityMatrix.js").LiqLine} LiqLine */

const SESSION_TAG_ORDER = ["Asia", "London", "New York AM", "New York Lunch", "New York PM"];
const TF_TAG_ORDER = ["4H", "1H", "15m", "10m", "5m"];
const REFERENCE_TAGS = new Set(["PDH", "PDL", "PWH", "PWL", "Mid"]);
/** ponytail: 1-day ceiling — don't merge May 4H @ 30291 with Jun 15m @ 30291.50 */
const CONFLO_START_GAP_SEC = 86400;

/** Zero max uses a short grace period; positive max retains its capped swept lines. */
export function keepRecentSweptLevels(lines, bars, endIdx, holdBars, maxSwept) {
  if (maxSwept > 0) return lines;
  if (holdBars <= 0) return lines.filter((line) => !line.swept);
  const expiredThrough = bars[endIdx - holdBars]?.time ?? -Infinity;
  return lines.filter((line) => {
    if (!line.swept) return true;
    return Number.isFinite(line.sweepTime) && line.sweepTime > expiredThrough;
  });
}

/** @param {string} label */
function parseLevelTags(label) {
  const base = label.split(" (")[0].replace(/\s+(?:Swing\s+)?(?:High|Low)$/i, "").trim();
  return base.split(/\s*(?:&|\+)\s*/).map((s) => s.trim()).filter(Boolean);
}

/** Lower values have higher visual priority when merged. */
function levelColorPriority(line) {
  const tags = parseLevelTags(line.label ?? "");
  // Asia is the visually defining level when it overlaps an HTF pivot. Keep
  // the HTF name on the right, but preserve Asia's blue line across the chart.
  if (line.sessionTag === "Asia" || tags.includes("Asia")) return -1;
  const tfIndex = tags.reduce((best, tag) => {
    const index = TF_TAG_ORDER.indexOf(tag);
    return index >= 0 ? Math.min(best, index) : best;
  }, Infinity);
  if (Number.isFinite(tfIndex)) return tfIndex;
  if (line.referenceLevel === true) return 20;
  if (tags.some((tag) => SESSION_TAG_ORDER.includes(tag))) return 30;
  return 40;
}

/** @param {Set<string>} tags @param {"High"|"Low"} side */
function formatMergedTags(tags, side) {
  const ordered = [...tags].sort((a, b) => {
    const ai = SESSION_TAG_ORDER.indexOf(a);
    const bi = SESSION_TAG_ORDER.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    const ti = TF_TAG_ORDER.indexOf(a);
    const tj = TF_TAG_ORDER.indexOf(b);
    return (ti >= 0 ? ti : 99) - (tj >= 0 ? tj : 99) || a.localeCompare(b);
  });
  const hasReference = ordered.some((tag) => REFERENCE_TAGS.has(tag));
  const suffix = hasReference ? "" : ` ${side}`;
  return `${ordered.join(" & ")}${suffix}`;
}

/** @param {LiqLine[]} lines @param {number} proximity */
export function applyClusterConfluence(lines, proximity) {
  const n = lines.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(i) {
    let r = i;
    while (parent[r] !== r) {
      parent[r] = parent[parent[r]];
      r = parent[r];
    }
    return r;
  }
  function unite(a, b) {
    parent[find(a)] = find(b);
  }

  /** @param {LiqLine} l */
  const bornOf = (l) => l.bornTime ?? l.startTime;
  /** A level swept BEFORE another was born is a separate liquidity event — a
   * 9:15 low swept at 9:40 must not merge with a fresh 10:00 low at the same
   * price; the old line stays swept, the new one lives on its own. */
  const sweptBefore = (a, b) => a.swept && a.sweepTime != null && a.sweepTime <= bornOf(b);

  for (let i = 0; i < n; i++) {
    if (lines[i]._drop) continue;
    for (let j = i + 1; j < n; j++) {
      if (lines[j]._drop) continue;
      if (lines[i].kind !== lines[j].kind) continue;
      if (Math.abs(lines[i].price - lines[j].price) > proximity) continue;
      const includesReference =
        lines[i].referenceLevel === true || lines[j].referenceLevel === true;
      if (
        !includesReference &&
        Math.abs(lines[i].startTime - lines[j].startTime) > CONFLO_START_GAP_SEC
      ) {
        continue;
      }
      if (sweptBefore(lines[i], lines[j]) || sweptBefore(lines[j], lines[i])) continue;
      unite(i, j);
    }
  }

  /** @type {Map<number, LiqLine[]>} */
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    if (lines[i]._drop) continue;
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(lines[i]);
  }

  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const tags = new Set();
    for (const l of group) {
      for (const t of parseLevelTags(l.label)) tags.add(t);
    }
    const side = group[0].kind === "high" ? "High" : "Low";
    const sessionMembers = group
      .filter((line) => line.sessionTag || line.sessionBorn != null)
      .sort((a, b) => {
        const ai = SESSION_TAG_ORDER.indexOf(a.sessionTag);
        const bi = SESSION_TAG_ORDER.indexOf(b.sessionTag);
        return (ai >= 0 ? ai : 99) - (bi >= 0 ? bi : 99);
      });
    const sessionTags = new Set(sessionMembers.map((line) => line.sessionTag).filter(Boolean));
    const nonSessionTags = new Set([...tags].filter((tag) => !SESSION_TAG_ORDER.includes(tag)));
    const colorSource = group.reduce((best, line) =>
      levelColorPriority(line) < levelColorPriority(best) ? line : best,
    );
    const sweptMembers = group.filter((l) => l.swept && l.sweepTime != null);
    // Swept only when EVERY member is swept — an unswept member means liquidity
    // still rests at this price (e.g. a live Asia low re-formed on an old swept
    // pivot); inheriting a stale sweep would hide the active level.
    const allSwept = sweptMembers.length === group.length;
    let survivor = group.reduce((best, l) => {
      const bt = l.bornTime ?? l.startTime;
      const bb = best.bornTime ?? best.startTime;
      if (!l.swept && best.swept) return l;
      if (l.swept && !best.swept) return best;
      return bt >= bb ? l : best;
    });
    for (const l of group) {
      if (
        l.startTime < survivor.startTime &&
        Math.abs(l.startTime - survivor.startTime) <= CONFLO_START_GAP_SEC
      ) {
        survivor.startTime = l.startTime;
        survivor.startChartTime = l.startChartTime;
      }
      if (!allSwept && l.endTime > survivor.endTime) {
        survivor.endTime = l.endTime;
        survivor.endChartTime = l.endChartTime;
      }
    }
    const splitSessionLabel = sessionTags.size > 0 && nonSessionTags.size > 0;
    survivor.label = formatMergedTags(splitSessionLabel ? nonSessionTags : tags, side);
    if (splitSessionLabel) {
      survivor.splitSessionLabel = true;
      survivor.sessionLabel = [...sessionTags].join(" & ");
      survivor.sessionLabelColor = sessionMembers[0]?.sessionLabelColor ?? sessionMembers[0]?.color;
    }
    survivor.color = colorSource.color;
    survivor.lineWidth = 3;
    if (allSwept && sweptMembers.length) {
      const times = sweptMembers.map((l) => l.sweepTime).filter((t) => t != null);
      const chartTimes = sweptMembers.map((l) => l.sweepChartTime ?? l.endChartTime).filter((t) => t != null);
      survivor.swept = true;
      // Latest sweep — the merged pool is only fully taken when its LAST member
      // is swept; the earliest sweep would end the line before the newest level
      // (e.g. an Asia low re-formed on an old pivot) was even born.
      survivor.sweepTime = Math.max(...times);
      survivor.endTime = survivor.sweepTime;
      if (chartTimes.length) {
        const bySweep = sweptMembers
          .map((l) => ({ sweep: l.sweepTime, chart: l.sweepChartTime ?? l.endChartTime }))
          .filter((x) => x.sweep != null && x.chart != null);
        const match = bySweep.find((x) => x.sweep === survivor.sweepTime) ?? bySweep[0];
        survivor.sweepChartTime = match?.chart ?? Math.min(...chartTimes);
        survivor.endChartTime = survivor.sweepChartTime;
      }
    } else {
      for (const l of group) {
        if (l.endTime > survivor.endTime) {
          survivor.endTime = l.endTime;
          survivor.endChartTime = l.endChartTime;
        }
      }
      survivor.swept = false;
      survivor.sweepTime = undefined;
      survivor.sweepChartTime = undefined;
    }
    for (const l of group) {
      if (l !== survivor) l._drop = true;
    }
  }
  return lines.filter((l) => !l._drop);
}
