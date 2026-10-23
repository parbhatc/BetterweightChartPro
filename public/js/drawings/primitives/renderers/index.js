import { applyColorOpacity } from "../../../ui/color/picker.js";
import { DEFAULT_DRAWING_COLOR, ANCHOR_BORDER_COLOR, ANCHOR_FILL_COLOR, ANCHOR_RADIUS, ANCHOR_BORDER_WIDTH } from "../../constants.js";
import {
  renderDisjointChannelDrawing,
  renderFlatTopBottomDrawing,
} from "../../tools/channel/family.js";
import {
  isParallelChannelTool,
  parallelChannelAnchorPoints,
  renderParallelChannelDrawing,
} from "../../tools/channel/parallel.js";
import {
  flatTopBottomAnchorPoints,
  isFlatTopBottomTool,
} from "../../tools/channel/flatTopBottom.js";
import { disjointChannelAnchorPoints, isDisjointChannelTool } from "../../tools/channel/disjoint.js";
import {
  isFibRetracementTool,
  renderFibStyleDrawing,
} from "../../tools/fib/retracement.js";
import {
  isRegressionTrendTool,
  regressionLineStyle,
  regressionTrendAnchorPoints,
  regressionTrendMedianAnchorIndices,
  renderRegressionTrendDrawing,
} from "../../tools/regression/trend.js";
import { renderGannStyleDrawing } from "../../tools/gann/index.js";
import { renderPatternDrawing, isPatternDrawingType } from "../../tools/pattern/index.js";
import { renderForecastDrawing, isForecastDrawingType } from "../../tools/forecast/index.js";
import { getDrawingTypeHandler } from "../../types/handlers.js";
import { renderPositionDrawing, positionAnchorPoints, positionGeometry } from "../../tools/position/barrel.js";
import { isRectangleTool, rectangleAnchorPoints } from "../../tools/shape/index.js";
import { renderMeasureDrawing, isMeasureDrawingType } from "../../tools/measure/index.js";
import { renderAnnotationDrawing, isAnnotationDrawingType } from "../../tools/annotation/index.js";
import { strokeSegment } from "../../tools/line/math.js";
import { extendedSegmentEndpoints, resolveExtendFlags } from "../../tools/line/extend.js";
import {
  drawTrendLineDecorations,
  isTrendLineFamilyType,
  strokeTrendLineShaft,
} from "../../tools/line/trendStyle.js";
import { isOnePointTool, isPositionTool, LINE_STYLE_DASH } from "../../registry/tools.js";
import {
  drawTrendAngleDecoration,
  chartAngleFromPoints,
  trendAngleSecondPoint,
  trendAngleSegmentPixels,
} from "../../tools/line/trendAngle.js";
import { drawTimeAxisLabel, drawingUsesTimeAxisLabel, isAxisLineTool } from "../../tools/axis/lines.js";

function pixelPoints(points, timeToX, priceToY) {
  /** @type {{ x: number, y: number }[]} */
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = pt(points, i, timeToX, priceToY);
    if (p) out.push(p);
  }
  return out;
}

/** @typedef {import("../../types.js").UserDrawing} UserDrawing */

function pt(points, i, timeToX, priceToY) {
  const p = points[i];
  if (!p) return null;
  const x = timeToX(p.time);
  const y = priceToY(p.price);
  if (x == null || y == null) return null;
  return { x, y };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {UserDrawing} drawing
 * @param {(t: number) => number | null} timeToX
 * @param {(p: number) => number | null} priceToY
 * @param {number} right
 * @param {number} bottom
 * @param {{ isPreview?: boolean, isSelected?: boolean, barSec?: number, precision?: number, formatPointTime?: (t: number) => string, bars?: { time: number, close?: number }[], anchorFillColor?: string }} state
 */
export function renderDrawing(ctx, drawing, timeToX, priceToY, right, bottom, state = {}) {
  const isPreview = Boolean(state.isPreview);
  // Fixed Range Volume Profile is launched from the indicator library. Its
  // range handles stay visible so the indicator can always be resized without
  // exposing it as a drawing-toolbar item.
  const showAnchors = isPreview || Boolean(state.isSelected) || drawing.type === "fixed-range-volume-profile";
  const baseColor = drawing.color ?? DEFAULT_DRAWING_COLOR;
  const color = applyColorOpacity(baseColor, drawing.colorOpacity ?? 100);
  const lw = drawing.lineWidth ?? 2;
  const dash = LINE_STYLE_DASH[drawing.lineStyle ?? 0] ?? [];

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.globalAlpha = isPreview ? 0.85 : 1;
  if (dash.length) ctx.setLineDash(dash);

  switch (drawing.type) {
    case "trend-line":
    case "ray":
    case "info-line":
    case "extended-line":
      renderTrendLineDrawing(ctx, drawing, timeToX, priceToY, right, bottom, color, lw, state);
      break;
    case "trend-angle":
      renderTrendAngleDrawing(ctx, drawing, timeToX, priceToY, right, bottom, color, lw, state);
      break;
    case "horizontal-ray":
      drawHorizontalRay(ctx, drawing, timeToX, priceToY, right);
      break;
    case "cross-line":
      drawCrossLine(ctx, drawing.points, timeToX, priceToY, right, bottom);
      break;
    case "horizontal-line":
      drawHorizontalFull(ctx, drawing.points, timeToX, priceToY, right);
      break;
    case "vertical-line":
      drawVertical(ctx, drawing.points, timeToX, priceToY, bottom);
      break;
    case "rectangle":
      if (isAnnotationDrawingType("rectangle")) {
        renderAnnotationDrawing(ctx, drawing, pixelPoints(drawing.points, timeToX, priceToY), right, bottom);
      } else {
        drawRectangle(ctx, drawing.points, timeToX, priceToY);
      }
      break;
    case "parallel-channel":
      renderParallelChannelDrawing(ctx, drawing, timeToX, priceToY, 0, right, bottom);
      break;
    case "disjoint-channel":
      renderDisjointChannelDrawing(ctx, drawing, timeToX, priceToY, 0, right, bottom, state);
      break;
    case "flat-top-bottom":
      renderFlatTopBottomDrawing(ctx, drawing, timeToX, priceToY, 0, right, bottom);
      break;
    case "regression-trend":
      renderRegressionTrendDrawing(ctx, drawing, timeToX, priceToY, right, bottom, state);
      break;
    case "long-position":
    case "short-position": {
      const handler = getDrawingTypeHandler(drawing.type);
      if (handler?.render) handler.render(ctx, drawing, timeToX, priceToY, right, state);
      else renderPositionDrawing(ctx, drawing, timeToX, priceToY, right, state);
      break;
    }
    case "fib-retracement":
    case "fib-extension":
    case "fib-channel":
    case "fib-time-zone":
    case "trend-based-fib-time":
    case "fib-circles":
    case "fib-spiral":
    case "fib-wedge":
      renderFibStyleDrawing(ctx, drawing, timeToX, priceToY, 0, right, bottom, state);
      break;
    case "gann-box":
    case "gann-square":
    case "gann-square-fixed":
    case "gann-fan":
      renderGannStyleDrawing(ctx, drawing, timeToX, priceToY, 0, right, bottom, state);
      break;
    default: {
      const pts = pixelPoints(drawing.points, timeToX, priceToY);
      if (isPatternDrawingType(drawing.type)) {
        renderPatternDrawing(ctx, drawing, pts, right, bottom, state);
      } else if (isForecastDrawingType(drawing.type)) {
        renderForecastDrawing(ctx, drawing, pts, right, bottom, {
          ...state,
          timeToX,
          priceToY,
        });
      } else if (isMeasureDrawingType(drawing.type)) {
        renderMeasureDrawing(ctx, drawing, pts, right, bottom, state);
      } else if (isAnnotationDrawingType(drawing.type)) {
        renderAnnotationDrawing(ctx, drawing, pts, right, bottom);
      } else {
        drawSegment(ctx, drawing.points, timeToX, priceToY);
      }
      break;
    }
  }

  if (isAxisLineTool(drawing.type)) {
    maybeDrawTimeAxisLabel(ctx, drawing, timeToX, bottom, color, state);
  }
  if (
    isPositionTool(drawing.type)
    && state.isSelected
    && typeof state.formatPointTime === "function"
  ) {
    const geom = positionGeometry(drawing);
    for (const time of geom ? [geom.tStart, geom.tEnd] : []) {
      const anchor = { time };
      if (!anchor) continue;
      const x = timeToX(anchor.time);
      if (x == null) continue;
      drawTimeAxisLabel(
        ctx,
        x,
        bottom,
        state.formatPointTime(anchor.time),
        ANCHOR_BORDER_COLOR,
      );
    }
  }

  if (showAnchors) {
    drawEndpointAnchors(ctx, drawing, timeToX, priceToY, color, lw, isPreview, state);
  }

  drawDrawingLabel(ctx, drawing, timeToX, priceToY, right, bottom);
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {UserDrawing} drawing
 * @param {(t: number) => number | null} timeToX
 * @param {(p: number) => number | null} priceToY
 * @param {number} right
 * @param {number} bottom
 * @param {string} color
 * @param {number} lw
 * @param {{ isSelected?: boolean, barSec?: number, precision?: number }} state
 */
function renderTrendLineDrawing(ctx, drawing, timeToX, priceToY, right, bottom, color, lw, state) {
  const a = pt(drawing.points, 0, timeToX, priceToY);
  const b = pt(drawing.points, 1, timeToX, priceToY);
  if (!a || !b) return;
  const segment = extendedSegmentEndpoints(a, b, resolveExtendFlags(drawing), 0, right, bottom);
  if (!strokeTrendLineShaftAroundMiddleLabel(ctx, drawing, segment)) {
    strokeTrendLineShaft(ctx, segment, drawing.leftEnd, drawing.rightEnd, lw);
  }
  drawTrendLineDecorations(ctx, drawing, segment, a, b, color, lw, {
    isSelected: state.isSelected,
    barSec: state.barSec,
    precision: state.precision,
  });
}

/**
 * TradingView removes the shaft directly behind center/middle trend-line text.
 * @returns {boolean} true when the split shaft was drawn
 */
function strokeTrendLineShaftAroundMiddleLabel(ctx, drawing, segment) {
  const raw = drawing.label;
  if (
    raw == null ||
    !String(raw).trim() ||
    (drawing.textAlignH ?? "center") !== "center" ||
    (drawing.textAlignV ?? "top") !== "middle"
  ) {
    return false;
  }

  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return false;

  const fontSize = drawing.fontSize ?? 14;
  ctx.save();
  ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
  const textWidth = String(raw)
    .split(/\n/)
    .reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
  ctx.restore();

  const halfGap = textWidth / 2 + 4;
  if (length <= halfGap * 2) return false;
  const ux = dx / length;
  const uy = dy / length;
  const midX = (segment.x1 + segment.x2) / 2;
  const midY = (segment.y1 + segment.y2) / 2;
  const gapStart = { x: midX - ux * halfGap, y: midY - uy * halfGap };
  const gapEnd = { x: midX + ux * halfGap, y: midY + uy * halfGap };

  ctx.save();
  if (drawing.leftEnd === "arrow" || drawing.rightEnd === "arrow") ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(segment.x1, segment.y1);
  ctx.lineTo(gapStart.x, gapStart.y);
  ctx.moveTo(gapEnd.x, gapEnd.y);
  ctx.lineTo(segment.x2, segment.y2);
  ctx.stroke();
  ctx.restore();
  return true;
}

function renderTrendAngleDrawing(ctx, drawing, timeToX, priceToY, right, bottom, color, lw, state) {
  const anchor = drawing.points[0];
  const end = drawing.points[1] ?? (state.isPreview ? null : trendAngleSecondPoint(drawing));
  if (!anchor || !end) return;

  const seg = trendAngleSegmentPixels(anchor, end, timeToX, priceToY);
  if (!seg) return;

  const a = { x: seg.ax, y: seg.ay };
  const b = { x: seg.bx, y: seg.by };
  const segment = { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 };
  const angleDeg = chartAngleFromPoints(anchor, end);

  strokeTrendLineShaft(ctx, segment, drawing.leftEnd, drawing.rightEnd, lw);
  drawTrendLineDecorations(ctx, drawing, segment, a, b, color, lw, {
    isSelected: state.isSelected,
    barSec: state.barSec,
    precision: state.precision,
  });
  drawTrendAngleDecoration(ctx, seg.ax, seg.ay, seg.bx, seg.by, angleDeg, color);
}

function drawDrawingLabel(ctx, drawing, timeToX, priceToY, right, bottom) {
  if (drawing.type === "text" || drawing.type === "text-annotation") return;
  const raw = drawing.label;
  if (raw == null || !String(raw).trim()) return;

  const a = pt(drawing.points, 0, timeToX, priceToY);
  const rawB = pt(drawing.points, 1, timeToX, priceToY) ?? a;
  if (!a) return;
  const isHorizontalRay = drawing.type === "horizontal-ray";
  const rotateWithLine = isTrendLineFamilyType(drawing.type) && rawB !== a;
  const labelSegment = rotateWithLine
    ? extendedSegmentEndpoints(a, rawB, resolveExtendFlags(drawing), 0, right, bottom)
    : null;
  const labelA = labelSegment
    ? { x: labelSegment.x1, y: labelSegment.y1 }
    : drawing.extendLeft
      ? { x: 0, y: a.y }
      : a;
  const b = labelSegment
    ? { x: labelSegment.x2, y: labelSegment.y2 }
    : isHorizontalRay
      ? { x: right, y: a.y }
      : rawB
        ? {
            x: drawing.extendRight ? right : rawB.x,
            y: rawB.y,
          }
        : a;

  // Programmatic journal annotations can begin well outside the visible
  // viewport (for example, an overnight FVG reviewed at the cash open).
  // Center labels inside the visible portion of the shape/segment instead of
  // centering against an off-screen anchor and making the label disappear.
  const visibleA = { ...labelA, x: Math.max(0, Math.min(right, labelA.x)) };
  const visibleB = b ? { ...b, x: Math.max(0, Math.min(right, b.x)) } : visibleA;

  const fontSize = drawing.fontSize ?? 14;
  const baseTextColor = drawing.textColor ?? drawing.color ?? DEFAULT_DRAWING_COLOR;
  const textColor = applyColorOpacity(baseTextColor, drawing.textColorOpacity ?? drawing.colorOpacity ?? 100);

  const alignH = drawing.textAlignH ?? "center";
  const alignV = drawing.textAlignV ?? "top";
  const gap = fontSize * 0.45 + 5;

  let ax = visibleA.x;
  let ay = visibleA.y;
  if (alignH === "right" && visibleB) {
    ax = visibleB.x;
    ay = visibleB.y;
  } else if (alignH === "center" && visibleB) {
    ax = (visibleA.x + visibleB.x) / 2;
    ay = (visibleA.y + visibleB.y) / 2;
  }
  if (isHorizontalRay && alignV === "middle") {
    const inset = Math.min(5, Math.max(0, (visibleB.x - visibleA.x) / 2));
    if (alignH === "left") ax = visibleA.x + inset;
    else if (alignH === "right") ax = visibleB.x - inset;
  }

  const lines = String(raw).split(/\n/);
  const lineHeight = Math.round(fontSize * 1.25);

  ctx.save();
  ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
  ctx.fillStyle = textColor;
  ctx.textAlign = alignH === "left" ? "left" : alignH === "right" ? "right" : "center";
  ctx.textBaseline = "top";

  const blockHeight = lines.length * lineHeight;
  let startY = 0;
  if (isHorizontalRay && alignV === "top") startY = -gap - blockHeight;
  else if (isHorizontalRay && alignV === "bottom") startY = gap;
  else if (rotateWithLine && alignV === "top") startY = -blockHeight - 2;
  else if (rotateWithLine && alignV === "bottom") startY = 2;
  else if (alignV === "top") startY = -gap;
  else if (alignV === "middle") startY = -blockHeight / 2 + lineHeight * 0.15;
  else startY = gap - blockHeight;

  let x = ax;
  let y = ay;
  if (rotateWithLine) {
    let angle = Math.atan2(visibleB.y - visibleA.y, visibleB.x - visibleA.x);
    if (angle > Math.PI / 2) angle -= Math.PI;
    else if (angle < -Math.PI / 2) angle += Math.PI;
    ctx.translate(x, y);
    ctx.rotate(angle);
    x = 0;
    y = 0;
  }

  lines.forEach((line, i) => {
    ctx.fillText(line, x, y + startY + i * lineHeight);
  });
  ctx.restore();
}

function drawEndpointAnchors(ctx, drawing, timeToX, priceToY, color, lw, isPreview = false, state = {}) {
  const r = ANCHOR_RADIUS;

  if (isParallelChannelTool(drawing.type)) {
    const anchors = parallelChannelAnchorPoints(drawing);
    for (let i = 0; i < anchors.length; i += 1) {
      const ap = anchors[i];
      const x = timeToX(ap.time);
      const y = priceToY(ap.price);
      if (x == null || y == null) continue;
      const isMid = i === 4 || i === 5;
      ctx.save();
      ctx.setLineDash([]);
      if (isMid) {
        const side = r * 1.35;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(x - side / 2, y - side / 2, side, side, 2);
        } else {
          ctx.rect(x - side / 2, y - side / 2, side, side);
        }
        ctx.fillStyle = ANCHOR_FILL_COLOR;
        ctx.fill();
        ctx.strokeStyle = ANCHOR_BORDER_COLOR;
        ctx.lineWidth = ANCHOR_BORDER_WIDTH;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = ANCHOR_FILL_COLOR;
        ctx.fill();
        ctx.strokeStyle = ANCHOR_BORDER_COLOR;
        ctx.lineWidth = ANCHOR_BORDER_WIDTH;
        ctx.stroke();
      }
      ctx.restore();
    }
    return;
  }

  if (isFlatTopBottomTool(drawing.type)) {
    const anchors = flatTopBottomAnchorPoints(drawing);
    /** @type {import("../../types.js").DrawPoint[]} */
    let visible;
    if (isPreview) {
      if (drawing.points.length <= 2) {
        visible = drawing.points;
      } else {
        visible = [anchors[0], anchors[1], anchors[3]];
      }
    } else {
      visible = anchors;
    }
    for (const ap of visible) {
      if (!ap) continue;
      const x = timeToX(ap.time);
      const y = priceToY(ap.price);
      if (x == null || y == null) continue;
      ctx.save();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = ANCHOR_FILL_COLOR;
      ctx.fill();
      ctx.strokeStyle = ANCHOR_BORDER_COLOR;
      ctx.lineWidth = ANCHOR_BORDER_WIDTH;
      ctx.stroke();
      ctx.restore();
    }
    return;
  }

  if (isDisjointChannelTool(drawing.type)) {
    const anchors = isPreview ? drawing.points : disjointChannelAnchorPoints(drawing);
    const count = isPreview ? Math.min(4, anchors.length) : anchors.length;
    for (let i = 0; i < count; i += 1) {
      const ap = anchors[i];
      if (!ap) continue;
      const x = timeToX(ap.time);
      const y = priceToY(ap.price);
      if (x == null || y == null) continue;
      ctx.save();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = ANCHOR_FILL_COLOR;
      ctx.fill();
      ctx.strokeStyle = ANCHOR_BORDER_COLOR;
      ctx.lineWidth = ANCHOR_BORDER_WIDTH;
      ctx.stroke();
      ctx.restore();
    }
    return;
  }

  if (isRegressionTrendTool(drawing.type)) {
    if (state.regressionGuidesOnly) return;
    if (isPreview) {
      let indices = [0];
      if (drawing.points.length > 1) {
        const p0 = drawing.points[0];
        const p1 = drawing.points[1];
        const ax = timeToX(p0.time);
        const ay = priceToY(p0.price);
        const bx = timeToX(p1.time);
        const by = priceToY(p1.price);
        if (
          ax != null &&
          ay != null &&
          bx != null &&
          by != null &&
          Math.hypot(ax - bx, ay - by) > 2 &&
          p0.time !== p1.time
        ) {
          indices = [0, 1];
        }
      }
      for (const i of indices) {
        const ap = drawing.points[i];
        const x = timeToX(ap.time);
        const y = priceToY(ap.price);
        if (x == null || y == null) continue;
        ctx.save();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = ANCHOR_FILL_COLOR;
        ctx.fill();
        ctx.strokeStyle = ANCHOR_BORDER_COLOR;
        ctx.lineWidth = ANCHOR_BORDER_WIDTH;
        ctx.stroke();
        ctx.restore();
      }
      return;
    }
    const bars = state.bars ?? [];
    const [midLeft, midRight] = regressionTrendMedianAnchorIndices(drawing, bars);
    const anchors = regressionTrendAnchorPoints(drawing, bars);
    const baseStyle = regressionLineStyle(drawing, "base");
    const anchorColor = applyColorOpacity(baseStyle.color, baseStyle.opacity);
    const side = r * 1.35;
    for (const i of [midLeft, midRight]) {
      const ap = anchors[i];
      if (!ap) continue;
      const x = timeToX(ap.time);
      const y = priceToY(ap.price);
      if (x == null || y == null) continue;
      ctx.save();
      ctx.setLineDash([]);
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x - side / 2, y - side / 2, side, side, 2);
      } else {
        ctx.rect(x - side / 2, y - side / 2, side, side);
      }
      ctx.fillStyle = ANCHOR_FILL_COLOR;
      ctx.fill();
      ctx.strokeStyle = anchorColor;
      ctx.lineWidth = ANCHOR_BORDER_WIDTH;
      ctx.stroke();
      ctx.restore();
    }
    return;
  }

  if (isPositionTool(drawing.type)) {
    const anchors = positionAnchorPoints(drawing);
    const side = r * 1.35;
    for (let i = 0; i < anchors.length; i += 1) {
      const ap = anchors[i];
      const x = timeToX(ap.time);
      const y = priceToY(ap.price);
      if (x == null || y == null) continue;
      ctx.save();
      ctx.setLineDash([]);
      ctx.beginPath();
      if (i === 1 && typeof ctx.arc === "function") {
        ctx.arc(x, y, side / 2, 0, Math.PI * 2);
      } else if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x - side / 2, y - side / 2, side, side, 1.5);
      } else {
        ctx.rect(x - side / 2, y - side / 2, side, side);
      }
      ctx.fillStyle = state.anchorFillColor ?? ANCHOR_FILL_COLOR;
      ctx.fill();
      ctx.strokeStyle = ANCHOR_BORDER_COLOR;
      ctx.lineWidth = ANCHOR_BORDER_WIDTH;
      ctx.stroke();
      ctx.restore();
    }
    return;
  }

  if (isRectangleTool(drawing.type)) {
    const anchors =
      isPreview && drawing.points.length < 2
        ? drawing.points
        : rectangleAnchorPoints(drawing);
    for (const ap of anchors) {
      if (!ap) continue;
      const x = timeToX(ap.time);
      const y = priceToY(ap.price);
      if (x == null || y == null) continue;
      ctx.save();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = ANCHOR_FILL_COLOR;
      ctx.fill();
      ctx.strokeStyle = ANCHOR_BORDER_COLOR;
      ctx.lineWidth = ANCHOR_BORDER_WIDTH;
      ctx.stroke();
      ctx.restore();
    }
    return;
  }

  let indices = isOnePointTool(drawing.type) && !isPositionTool(drawing.type)
    ? [0]
    : drawing.points.length > 0
      ? drawing.points.map((_, i) => i)
      : [0];

  if (isPreview && indices.length > 1) {
    const a = pt(drawing.points, 0, timeToX, priceToY);
    const b = pt(drawing.points, 1, timeToX, priceToY);
    if (a && b && Math.hypot(a.x - b.x, a.y - b.y) < 2) indices = [0];
  }

  for (const i of indices) {
    const p = pt(drawing.points, i, timeToX, priceToY);
    if (!p) continue;
    ctx.save();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = ANCHOR_FILL_COLOR;
    ctx.fill();
    ctx.strokeStyle = ANCHOR_BORDER_COLOR;
    ctx.lineWidth = ANCHOR_BORDER_WIDTH;
    ctx.stroke();
    ctx.restore();
  }
}

function drawSegment(ctx, points, timeToX, priceToY) {
  const a = pt(points, 0, timeToX, priceToY);
  const b = pt(points, 1, timeToX, priceToY);
  if (!a || !b) return;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}


function drawHorizontalRay(ctx, drawing, timeToX, priceToY, rightX) {
  const a = pt(drawing.points, 0, timeToX, priceToY);
  if (!a) return;
  ctx.beginPath();
  const visibleStart = Math.max(0, Math.min(rightX, a.x));
  const raw = drawing.label;
  const cutsLine = raw != null
    && String(raw).trim()
    && (drawing.textAlignV ?? "top") === "middle";

  if (!cutsLine) {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(rightX, a.y);
    ctx.stroke();
    drawHorizontalRayOrigin(ctx, a);
    return;
  }

  const fontSize = drawing.fontSize ?? 14;
  const alignH = drawing.textAlignH ?? "center";
  const inset = Math.min(5, Math.max(0, (rightX - visibleStart) / 2));
  const anchorX = alignH === "left"
    ? visibleStart + inset
    : alignH === "right"
      ? rightX - inset
      : (visibleStart + rightX) / 2;
  ctx.save();
  ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
  const textWidth = String(raw)
    .split(/\n/)
    .reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
  ctx.restore();

  const textLeft = alignH === "left"
    ? anchorX
    : alignH === "right"
      ? anchorX - textWidth
      : anchorX - textWidth / 2;
  const textRight = alignH === "left"
    ? anchorX + textWidth
    : alignH === "right"
      ? anchorX
      : anchorX + textWidth / 2;
  const lineGap = 4;
  const gapStart = Math.max(visibleStart, textLeft - lineGap);
  const gapEnd = Math.min(rightX, textRight + lineGap);

  if (a.x < gapStart) {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(gapStart, a.y);
  }
  if (gapEnd < rightX) {
    ctx.moveTo(gapEnd, a.y);
    ctx.lineTo(rightX, a.y);
  }
  ctx.stroke();
  drawHorizontalRayOrigin(ctx, a);
}

function drawHorizontalRayOrigin(ctx, point) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(point.x, point.y, Math.max(1.25, ctx.lineWidth * 0.75), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCrossLine(ctx, points, timeToX, priceToY, rightX, bottom) {
  const a = pt(points, 0, timeToX, priceToY);
  if (!a) return;
  ctx.beginPath();
  ctx.moveTo(0, a.y);
  ctx.lineTo(rightX, a.y);
  ctx.moveTo(a.x, 0);
  ctx.lineTo(a.x, bottom);
  ctx.stroke();
}

function maybeDrawTimeAxisLabel(ctx, drawing, timeToX, bottom, color, state) {
  if (!drawingUsesTimeAxisLabel(drawing)) return;
  const p = drawing.points[0];
  if (!p) return;
  const x = timeToX(p.time);
  if (x == null) return;
  const formatPointTime = state.formatPointTime ?? ((t) => String(t));
  drawTimeAxisLabel(ctx, x, bottom, formatPointTime(p.time), color);
}

function drawHorizontalFull(ctx, points, timeToX, priceToY, rightX) {
  const a = pt(points, 0, timeToX, priceToY);
  if (!a) return;
  ctx.beginPath();
  ctx.moveTo(0, a.y);
  ctx.lineTo(rightX, a.y);
  ctx.stroke();
}

function drawVertical(ctx, points, timeToX, priceToY, bottom) {
  const a = pt(points, 0, timeToX, priceToY);
  if (!a) return;
  ctx.beginPath();
  ctx.moveTo(a.x, 0);
  ctx.lineTo(a.x, bottom);
  ctx.stroke();
}

function drawRectangle(ctx, points, timeToX, priceToY) {
  const a = pt(points, 0, timeToX, priceToY);
  const b = pt(points, 1, timeToX, priceToY);
  if (!a || !b) return;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  ctx.globalAlpha *= 0.12;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha /= 0.12;
  ctx.strokeRect(x, y, w, h);
}
