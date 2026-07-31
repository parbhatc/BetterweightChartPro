import { distToSegment } from "../shared/segmentDistance.js";
import {
  clampPositionLevelPrice,
  positionAnchorPoints,
  positionGeometry,
  positionStatsCenterPrice,
} from "./geometry.js";
import { tickSizeForPrecision } from "./placement.js";
import { layoutPositionCenterStats } from "./render.js";
import {
  buildPositionCenterStatLines,
  computePositionStatValues,
  resolvePositionStatsFields,
  shouldShowPositionStats,
} from "./stats.js";

/**
 * @param {import("../../types.js").UserDrawing} drawing
 * @param {number} px
 * @param {number} py
 * @param {number} threshold
 * @param {(t: number) => number | null} timeToX
 * @param {(p: number) => number | null} priceToY
 */
export function hitPositionDrawing(drawing, px, py, threshold, timeToX, priceToY) {
  const geom = positionGeometry(drawing);
  if (!geom) return false;
  const x1 = timeToX(geom.tStart);
  const x2 = timeToX(geom.tEnd);
  const yTarget = priceToY(geom.targetPrice);
  const yStop = priceToY(geom.stopPrice);
  const yEntry = priceToY(geom.entryPrice);
  if (x1 == null || x2 == null || yTarget == null || yStop == null || yEntry == null) return false;

  const left = Math.min(x1, x2) - threshold;
  const right = Math.max(x1, x2) + threshold;
  const top = Math.min(yTarget, yStop) - threshold;
  const bottom = Math.max(yTarget, yStop) + threshold;

  if (px >= left && px <= right && py >= top && py <= bottom) return true;

  return (
    distToSegment(px, py, left, top, right, top) <= threshold ||
    distToSegment(px, py, right, top, right, bottom) <= threshold ||
    distToSegment(px, py, right, bottom, left, bottom) <= threshold ||
    distToSegment(px, py, left, bottom, left, top) <= threshold ||
    distToSegment(px, py, left, yEntry, right, yEntry) <= threshold
  );
}

/**
 * @param {import("../../types.js").UserDrawing} drawing
 * @param {number} px
 * @param {number} py
 * @param {(t: number) => number | null} timeToX
 * @param {(p: number) => number | null} priceToY
 * @param {{ isSelected?: boolean, precision?: number, bars?: { close?: number }[] }} state
 */
export function hitPositionStatsBox(drawing, px, py, timeToX, priceToY, state) {
  if (!shouldShowPositionStats(drawing, state)) return false;
  const geom = positionGeometry(drawing);
  if (!geom) return false;
  const x1 = timeToX(geom.tStart);
  const x2 = timeToX(geom.tEnd);
  const yEntry = priceToY(geom.entryPrice);
  if (x1 == null || x2 == null || yEntry == null) return false;

  const fields = resolvePositionStatsFields(drawing);
  const values = computePositionStatValues(drawing, state.precision ?? 2, state.bars);
  const lines = buildPositionCenterStatLines(fields, values);
  const yStats = priceToY(positionStatsCenterPrice(geom));
  const layout = layoutPositionCenterStats(
    { x: Math.min(x1, x2), y: yEntry },
    { x: Math.max(x1, x2), y: yEntry },
    lines,
    drawing.fontSize ?? 12,
    yStats ?? undefined,
  );
  if (!layout) return false;
  return px >= layout.x && px <= layout.x + layout.width && py >= layout.y && py <= layout.y + layout.height;
}

/**
 * @param {number} anchorIndex
 * @param {import("../../types.js").DrawPoint[]} startAnchors
 * @param {import("../../types.js").DrawPoint} point
 * @param {import("../../types.js").UserDrawing} drawing
 * @param {number} [precision]
 */
export function positionDragUpdate(anchorIndex, startAnchors, point, drawing, precision = 2) {
  const tick = tickSizeForPrecision(precision);
  if (startAnchors.length < 4) {
    startAnchors = positionAnchorPoints(drawing);
  }
  const isLong = drawing.type === "long-position";
  const [targetAnchor, entryAnchor, widthAnchor, stopAnchor] = startAnchors;
  if (!targetAnchor || !entryAnchor || !widthAnchor || !stopAnchor) {
    return { points: drawing.points.map((p) => ({ ...p })) };
  }
  const tStart = entryAnchor.time;
  let tEnd = widthAnchor.time;
  let entryPrice = entryAnchor.price;
  let targetPrice = targetAnchor.price;
  let stopPrice = stopAnchor.price;
  const reward = Math.abs(targetPrice - entryPrice);
  const risk = Math.abs(entryPrice - stopPrice);

  if (anchorIndex === 0) {
    targetPrice = clampPositionLevelPrice(point.price, entryPrice, isLong, "target", tick);
  } else if (anchorIndex === 1) {
    const newEntry = point.price;
    entryPrice = newEntry;
    targetPrice = isLong ? newEntry + reward : newEntry - reward;
    stopPrice = isLong ? newEntry - risk : newEntry + risk;
  } else if (anchorIndex === 2) {
    tEnd = Math.max(tStart + 1, point.time);
  } else if (anchorIndex === 3) {
    stopPrice = clampPositionLevelPrice(point.price, entryPrice, isLong, "stop", tick);
  }

  return {
    points: [
      { time: tStart, price: isLong ? targetPrice : stopPrice },
      { time: tEnd, price: isLong ? stopPrice : targetPrice },
    ],
    positionEntryPrice: entryPrice,
  };
}
