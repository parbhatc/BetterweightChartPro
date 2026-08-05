import { safePriceToY } from "../../chart/coords/timeScale.js";
import { applyColorOpacity } from "../../ui/color/picker.js";
import { resolveOverlayTimeMapping, createOverlayTimeToXFromMapping } from "./overlayMapBars.js";
import { verticalSegmentIntersectsViewport } from "./viewportCulling.js";

const LABEL_FONT_FAMILY =
  `-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif`;

/** @param {object} item */
function labelFont(item) {
  const size = Math.max(8, Math.min(18, Number(item.fontSize) || 11));
  const weight = Number(item.fontWeight) || 400;
  return `${weight} ${size}px ${LABEL_FONT_FAMILY}`;
}

/** @param {object} box @param {number} left @param {number} right @param {number} w @param {(t: number) => number | null} timeToX @param {number} pad */
function labelXInBox(box, left, right, w, timeToX, pad) {
  const lo = left + pad;
  const hi = right - pad;
  if (hi <= lo) return null;

  const align = box.labelAlign ?? "right";
  // Centered labels on fixed-width boxes: pixel midpoint (stable after refresh / time-map updates).
  if (align === "center" && !box.extendRight) {
    return lo + (hi - lo) / 2;
  }

  if (box.labelTime != null && Number.isFinite(box.labelTime)) {
    const x = timeToX(box.labelTime);
    if (x != null && Number.isFinite(x)) return Math.min(hi, Math.max(lo, x));
  }

  if (align === "center") return lo + (hi - lo) / 2;
  if (align === "left") return lo;
  return hi;
}

export function formatCountdownLabel(closeAt, now = Date.now() / 1000) {
  const remaining = Math.max(0, Math.ceil(Number(closeAt) - Number(now)));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  const clock = hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
  return `Closes in: ${clock}`;
}

/** Draw a Pine-table-style cell anchored to the pane instead of time/price. */
function drawScreenBox(ctx, box, mediaSize) {
  const width = Math.max(1, Number(box.screenWidth) || 96);
  const height = Math.max(1, Number(box.screenHeight) || 20);
  const rows = Math.max(1, Math.trunc(Number(box.screenRows) || 1));
  const row = Math.max(0, Math.min(rows - 1, Math.trunc(Number(box.screenRow) || 0)));
  const marginX = Math.max(0, Number(box.screenMarginX) || 0);
  const marginY = Math.max(0, Number(box.screenMarginY) || 0);
  const totalHeight = height * rows;
  const left = box.screenHorizontal === "left"
    ? marginX
    : mediaSize.width - marginX - width;
  const groupTop = box.screenVertical === "top"
    ? marginY
    : box.screenVertical === "bottom"
      ? mediaSize.height - marginY - totalHeight
      : (mediaSize.height - totalHeight) / 2;
  const top = groupTop + row * height;

  ctx.save();
  ctx.fillStyle = box.fillColor ?? applyColorOpacity("#2962ff", 10);
  ctx.fillRect(left, top, width, height);

  const bw = Number(box.borderWidth) || 0;
  if (bw > 0 && box.borderColor) {
    ctx.strokeStyle = box.borderColor;
    ctx.lineWidth = bw;
    ctx.setLineDash(Array.isArray(box.borderDash) ? box.borderDash : []);
    ctx.strokeRect(left + bw / 2, top + bw / 2, width - bw, height - bw);
  }

  const label = Number.isFinite(Number(box.countdownTo))
    ? formatCountdownLabel(Number(box.countdownTo))
    : box.label;
  if (box.showLabel && label) {
    ctx.font = labelFont(box);
    ctx.fillStyle = box.textColor ?? "#131722";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(String(label), left + width / 2, top + height / 2);
  }
  ctx.restore();
}

/** @param {CanvasRenderingContext2D} ctx @param {string} label @param {{ x: number, y: number }} point @param {{ width: number, height: number }} mediaSize */
function drawHoverTooltip(ctx, label, point, mediaSize) {
  const lines = String(label ?? "").split("\n").filter(Boolean);
  if (!lines.length || !point) return;
  const font = `500 11px ${LABEL_FONT_FAMILY}`;
  const lineHeight = 15;
  const padX = 9;
  const padY = 7;
  ctx.save();
  ctx.font = font;
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + padX * 2;
  const height = lines.length * lineHeight + padY * 2;
  let left = point.x + 12;
  let top = point.y + 12;
  if (left + width > mediaSize.width - 4) left = point.x - width - 12;
  if (top + height > mediaSize.height - 4) top = point.y - height - 12;
  left = Math.max(4, left);
  top = Math.max(4, top);
  ctx.fillStyle = "rgba(15,23,42,0.94)";
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = "#f8fafc";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], left + padX, top + padY + i * lineHeight);
  }
  ctx.restore();
}

/** @param {{ top: number, height: number }[]} items @param {number} paneHeight @param {number} [margin] @param {number} [gap] */
export function resolveVerticalLabelStack(items, paneHeight, margin = 4, gap = 4) {
  const resolved = items.map((item, index) => ({ ...item, _index: index }));
  const sorted = [...resolved].sort((a, b) => a.top - b.top);
  for (let i = 1; i < sorted.length; i++) {
    const minimumTop = sorted[i - 1].top + sorted[i - 1].height + gap;
    if (sorted[i].top < minimumTop) sorted[i].top = minimumTop;
  }
  const bottom = sorted.at(-1)?.top + sorted.at(-1)?.height;
  if (Number.isFinite(bottom) && bottom > paneHeight - margin) {
    const shift = bottom - (paneHeight - margin);
    for (const item of sorted) item.top -= shift;
  }
  const top = sorted[0]?.top;
  if (Number.isFinite(top) && top < margin) {
    const shift = margin - top;
    for (const item of sorted) item.top += shift;
  }
  return resolved.sort((a, b) => a._index - b._index).map(({ _index, ...item }) => item);
}

/** @param {CanvasRenderingContext2D} ctx @param {string|string[]} text @param {number} centerX @param {number} anchorY @param {"above"|"center"|"below"} placement @param {{ width: number, height: number }} mediaSize */
function positionStatPillLayout(ctx, text, centerX, anchorY, placement, mediaSize) {
  const lines = (Array.isArray(text) ? text : [text]).map(String).filter(Boolean);
  if (!lines.length) return null;
  const font = `600 11px ${LABEL_FONT_FAMILY}`;
  const lineHeight = 16;
  const padX = 10;
  const padY = 6;
  ctx.save();
  ctx.font = font;
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + padX * 2;
  const height = lines.length * lineHeight + padY * 2;
  let left = centerX - width / 2;
  let top = placement === "above"
    ? anchorY - height - 4
    : placement === "below"
      ? anchorY + 4
      : anchorY - height / 2;
  left = Math.max(4, Math.min(mediaSize.width - width - 4, left));
  top = Math.max(4, Math.min(mediaSize.height - height - 4, top));
  ctx.restore();
  return { lines, font, lineHeight, padY, width, height, left, top, anchorY, centerX };
}

/** @param {CanvasRenderingContext2D} ctx @param {object} layout @param {string} fillColor @param {string} textColor @param {string} [borderColor] @param {number} [borderWidth] */
function drawPositionStatPill(ctx, layout, fillColor, textColor, borderColor, borderWidth = 0) {
  if (!layout) return;
  const { lines, font, lineHeight, padY, width, height, left, top, anchorY, centerX } = layout;
  ctx.save();
  if (anchorY < top || anchorY > top + height) {
    const edgeY = anchorY < top ? top : top + height;
    ctx.strokeStyle = "rgba(255,255,255,0.42)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, anchorY);
    ctx.lineTo(centerX, edgeY);
    ctx.stroke();
  }
  ctx.fillStyle = fillColor;
  ctx.fillRect(left, top, width, height);
  if (borderWidth > 0 && borderColor) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth;
    ctx.strokeRect(left + borderWidth / 2, top + borderWidth / 2, width - borderWidth, height - borderWidth);
  }
  ctx.fillStyle = textColor;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], left + width / 2, top + padY + i * lineHeight);
  }
  ctx.restore();
}

/** @param {CanvasRenderingContext2D} ctx @param {object[]} boxes @param {string} hoveredBoxId @param {(t: number) => number|null} timeToX @param {(p: number) => number|null} priceToY @param {{ width: number, height: number }} mediaSize */
function drawPositionHoverStats(ctx, boxes, hoveredBoxId, timeToX, priceToY, mediaSize) {
  const group = boxes.filter((box) =>
    (box.hoverId ?? box.hoverLabel) === hoveredBoxId && box.hoverStats
  );
  const stats = group[0]?.hoverStats;
  if (!stats || !group.length) return false;
  const x1 = timeToX(group[0].timeStart);
  const x2 = group[0].extendRight ? mediaSize.width : timeToX(group[0].timeEnd);
  const targetY = priceToY(Number(stats.targetPrice));
  const entryY = priceToY(Number(stats.entryPrice));
  const stopY = priceToY(Number(stats.stopPrice));
  if ([x1, x2, targetY, entryY, stopY].some((value) => value == null || !Number.isFinite(value))) {
    return false;
  }
  const centerX = (x1 + x2) / 2;
  const textColor = stats.textColor ?? "#ffffff";
  const layouts = resolveVerticalLabelStack([
    positionStatPillLayout(ctx, stats.targetLabel, centerX, targetY, "above", mediaSize),
    positionStatPillLayout(ctx, stats.centerLines, centerX, entryY, "center", mediaSize),
    positionStatPillLayout(ctx, stats.stopLabel, centerX, stopY, "below", mediaSize),
  ].filter(Boolean), mediaSize.height);
  drawPositionStatPill(
    ctx, layouts[0],
    stats.targetColor ?? "#089981", textColor,
    stats.labelBorderColor, Number(stats.labelBorderWidth) || 0,
  );
  drawPositionStatPill(
    ctx, layouts[1],
    stats.centerColor ?? "#f23645", textColor,
    stats.centerBorderColor ?? "#ffffff", Number(stats.centerBorderWidth ?? 1),
  );
  drawPositionStatPill(
    ctx, layouts[2],
    stats.stopColor ?? "#f23645", textColor,
    stats.labelBorderColor, Number(stats.labelBorderWidth) || 0,
  );
  return true;
}

/** @param {object[]} boxes @param {number} time @param {number} pointY @param {(price: number) => number | null} priceToY */
export function hoverBoxIdAt(boxes, time, pointY, priceToY) {
  if (!Number.isFinite(time) || !Number.isFinite(pointY)) return null;
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i];
    if (!box?.hoverLabel && !box?.hoverStats) continue;
    const start = Number(box.timeStart);
    const end = Number(box.timeEnd);
    if (!Number.isFinite(start) || time < start) continue;
    if (!box.extendRight && (!Number.isFinite(end) || time > end)) continue;
    const topY = priceToY(Number(box.priceTop));
    const bottomY = priceToY(Number(box.priceBottom));
    if (topY == null || bottomY == null) continue;
    const top = Math.min(topY, bottomY) - 2;
    const bottom = Math.max(topY, bottomY) + 2;
    if (pointY >= top && pointY <= bottom) return box.hoverId ?? box.hoverLabel;
  }
  return null;
}

/** @param {CanvasRenderingContext2D} ctx @param {object} box @param {(t: number) => number | null} timeToX @param {(p: number) => number | null} priceToY @param {number} rightX @param {number} paneHeight */
function drawBox(ctx, box, timeToX, priceToY, rightX, paneHeight) {
  const x1 = timeToX(box.timeStart);
  const x2End = box.extendRight ? null : timeToX(box.timeEnd);
  const x2 = box.extendRight ? rightX : x2End;
  const yTop = priceToY(box.priceTop);

  if (box.kind === "line") {
    if (x1 == null || x2 == null || yTop == null || x1 > x2 + 2) return;
    if (!verticalSegmentIntersectsViewport(yTop, yTop, paneHeight)) return;
    ctx.save();
    ctx.strokeStyle = box.lineColor ?? box.borderColor ?? box.fillColor ?? "#787b86";
    ctx.lineWidth = Math.max(1, Number(box.lineWidth) || 1);
    ctx.setLineDash(Array.isArray(box.lineDash) ? box.lineDash : []);
    ctx.beginPath();
    ctx.moveTo(x1, yTop);
    ctx.lineTo(x2, yTop);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (box.kind === "label") {
    if (x1 == null || yTop == null || !box.label) return;
    if (!verticalSegmentIntersectsViewport(yTop, yTop, paneHeight)) return;
    ctx.save();
    ctx.font = labelFont(box);
    ctx.fillStyle = box.textColor ?? "#131722";
    ctx.textBaseline = "middle";
    ctx.textAlign = box.labelAlign === "right" ? "right" : box.labelAlign === "center" ? "center" : "left";
    ctx.fillText(String(box.label), x1 + (Number(box.labelOffsetX) || 0), yTop);
    ctx.restore();
    return;
  }

  const yBot = priceToY(box.priceBottom);
  if (box.kind === "vertical-line") {
    if (x1 == null || yTop == null || yBot == null) return;
    if (!verticalSegmentIntersectsViewport(yTop, yBot, paneHeight)) return;
    ctx.save();
    ctx.strokeStyle = box.lineColor ?? box.borderColor ?? box.fillColor ?? "#787b86";
    ctx.lineWidth = Math.max(1, Number(box.lineWidth) || 1);
    ctx.setLineDash(Array.isArray(box.lineDash) ? box.lineDash : []);
    ctx.beginPath();
    ctx.moveTo(x1, yTop);
    ctx.lineTo(x1, yBot);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (x1 == null || x2 == null || yTop == null || yBot == null) return;
  if (!verticalSegmentIntersectsViewport(yTop, yBot, paneHeight)) return;
  // Skip draw when start/end coords disagree (stale mapBars during history restore).
  if (!box.extendRight && x2End != null && x1 > x2End + 2) return;

  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(yTop, yBot);
  const bottom = Math.max(yTop, yBot);
  const w = right - left;
  const h = bottom - top;
  if (w < 1 || h < 1) return;

  ctx.save();
  ctx.fillStyle = box.fillColor ?? applyColorOpacity("#2962ff", 10);
  ctx.fillRect(left, top, w, h);

  const bw = Number(box.borderWidth) || 0;
  if (bw > 0 && box.borderColor) {
    ctx.strokeStyle = box.borderColor;
    ctx.lineWidth = bw;
    ctx.setLineDash(Array.isArray(box.borderDash) ? box.borderDash : []);
    ctx.strokeRect(left + bw / 2, top + bw / 2, w - bw, h - bw);
  }

  if (box.showLabel && box.label) {
    ctx.font = labelFont(box);
    ctx.fillStyle = box.textColor ?? "#00e676";
    ctx.textBaseline = "middle";
    const midY = top + h / 2;
    const pad = 6;
    const align = box.labelAlign ?? "center";

    let labelX;
    let textAlign;
    if (!box.extendRight && align === "center") {
      // Pixel center — do not use labelTime (time midpoint drifts vs box edges when wait-for-close shifts end).
      labelX = left + w / 2;
      textAlign = "center";
    } else {
      labelX = labelXInBox(box, left, right, w, timeToX, pad);
      if (labelX == null) {
        ctx.restore();
        return;
      }
      textAlign = align === "left" ? "left" : align === "center" ? "center" : "right";
    }

    ctx.textAlign = textAlign;
    const lines = String(box.label).split("\n");
    const lineHeight = 13;
    const blockH = (lines.length - 1) * lineHeight;
    const startY = midY - blockH / 2;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      ctx.fillText(line, labelX, startY + i * lineHeight);
    }
  }
  ctx.restore();
}

class BoxesPaneRenderer {
  /** @param {() => object} getData @param {(box: object) => boolean} filter @param {boolean} drawHoverOverlay */
  constructor(getData, filter, drawHoverOverlay = false) {
    this._getData = getData;
    this._filter = filter;
    this._drawHoverOverlay = drawHoverOverlay;
  }

  /** @param {import("fancy-canvas").CanvasRenderingTarget2D} target */
  draw(target) {
    const { boxes, timeToX, priceToY, hoveredBoxId, hoverPoint } = this._getData();
    if (!boxes?.length) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const rightX = mediaSize.width;
      const pad = 4;
      for (const box of boxes) {
        if (!this._filter(box)) continue;
        if (box.kind === "screen-box") {
          drawScreenBox(ctx, box, mediaSize);
          continue;
        }
        const x1 = timeToX(box.timeStart);
        const x2End = box.extendRight ? null : timeToX(box.timeEnd);
        const x2 = box.extendRight ? rightX : x2End;
        if (x1 == null || x2 == null) continue;
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        if (right < -pad || left > rightX + pad) continue;
        drawBox(ctx, box, timeToX, priceToY, rightX, mediaSize.height);
      }
      // Hover labels belong to the top primitive view even when the position
      // zones themselves are bottom-layer fills. Otherwise candles paint over
      // the text and make the most important numbers unreadable.
      const hoveredBox = !this._drawHoverOverlay || hoveredBoxId == null
        ? null
        : boxes.find((box) =>
            (box.hoverId ?? box.hoverLabel) === hoveredBoxId &&
            (box.hoverLabel || box.hoverStats)
          );
      if (hoveredBox && hoverPoint) {
        const drewPositionStats = drawPositionHoverStats(
          ctx,
          boxes,
          hoveredBoxId,
          timeToX,
          priceToY,
          mediaSize,
        );
        if (!drewPositionStats && hoveredBox.hoverLabel) {
          drawHoverTooltip(ctx, hoveredBox.hoverLabel, hoverPoint, mediaSize);
        }
      }
    });
  }
}

class BoxesPaneView {
  /** @param {BoxesPrimitive} source @param {"bottom" | "top"} order */
  constructor(source, order) {
    this._source = source;
    this._order = order;
    const top = order === "top";
    this._renderer = new BoxesPaneRenderer(
      () => this._source.drawData(),
      (box) => (box.zOrder === "top") === top,
      top,
    );
  }

  zOrder() {
    return this._order;
  }

  renderer() {
    return this._renderer;
  }
}

/** @param {object[]} a @param {object[]} b */
function boxesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      x.timeStart !== y.timeStart ||
      x.timeEnd !== y.timeEnd ||
      x.labelTime !== y.labelTime ||
      Boolean(x.extendRight) !== Boolean(y.extendRight) ||
      x.priceTop !== y.priceTop ||
      x.priceBottom !== y.priceBottom ||
      x.kind !== y.kind ||
      x.fillColor !== y.fillColor ||
      x.borderColor !== y.borderColor ||
      x.borderWidth !== y.borderWidth ||
      String(x.borderDash ?? "") !== String(y.borderDash ?? "") ||
      x.lineColor !== y.lineColor ||
      x.lineWidth !== y.lineWidth ||
      String(x.lineDash ?? "") !== String(y.lineDash ?? "") ||
      Boolean(x.showLabel) !== Boolean(y.showLabel) ||
      x.label !== y.label ||
      x.textColor !== y.textColor ||
      x.fontSize !== y.fontSize ||
      x.fontWeight !== y.fontWeight ||
      x.labelAlign !== y.labelAlign ||
      x.labelOffsetX !== y.labelOffsetX ||
      x.screenHorizontal !== y.screenHorizontal ||
      x.screenVertical !== y.screenVertical ||
      x.screenWidth !== y.screenWidth ||
      x.screenHeight !== y.screenHeight ||
      x.screenRows !== y.screenRows ||
      x.screenRow !== y.screenRow ||
      x.screenMarginX !== y.screenMarginX ||
      x.screenMarginY !== y.screenMarginY ||
      x.countdownTo !== y.countdownTo ||
      x.zOrder !== y.zOrder ||
      x.hoverId !== y.hoverId ||
      x.hoverLabel !== y.hoverLabel ||
      JSON.stringify(x.hoverStats ?? null) !== JSON.stringify(y.hoverStats ?? null)
    ) {
      return false;
    }
  }
  return true;
}

class BoxesPrimitive {
  constructor() {
    /** @type {object[]} */
    this._boxes = [];
    /** @type {{ mapBars: object[], barSec: number, lastRealChartTime?: number, timeAdapter?: ReturnType<import("../../chart/time/timeAdapter.js").createTimeAdapter> } | null} */
    this._timeCtx = null;
    /** Cached series.data()-derived time mapping; rebuilt only on data change, not per pan frame. */
    this._timeMapping = null;
    /** @type {import("prochart").IChartApi | null} */
    this._chart = null;
    /** @type {import("prochart").ISeriesApi | null} */
    this._series = null;
    /** @type {(() => void) | null} */
    this._requestUpdate = null;
    this._countdownTimer = null;
    /** @type {(() => void) | null} */
    this._unsub = null;
    this._hoveredBoxId = null;
    this._hoverPoint = null;
    this._crosshairHandler = (param) => {
      const point = param?.point;
      const time = Number(param?.time);
      const data = this.drawData();
      const nextId = point
        ? hoverBoxIdAt(this._boxes, time, Number(point.y), data.priceToY)
        : null;
      const nextPoint = nextId != null && point ? { x: Number(point.x), y: Number(point.y) } : null;
      const changed =
        nextId !== this._hoveredBoxId ||
        nextPoint?.x !== this._hoverPoint?.x ||
        nextPoint?.y !== this._hoverPoint?.y;
      this._hoveredBoxId = nextId;
      this._hoverPoint = nextPoint;
      if (changed) this._requestUpdate?.();
    };
    this._paneViews = [
      new BoxesPaneView(this, "bottom"),
      new BoxesPaneView(this, "top"),
    ];
  }

  /** @param {object[]} boxes @param {{ mapBars?: object[], barSec?: number, lastRealChartTime?: number, timeAdapter?: ReturnType<import("../../chart/time/timeAdapter.js").createTimeAdapter> } | null} [timeCtx] @param {{ geometryUnchanged?: boolean, skipRedraw?: boolean }} [opts] */
  setBoxes(boxes, timeCtx = null, opts = {}) {
    const { geometryUnchanged = false, skipRedraw = false } = opts;
    let dirty = false;

    if (timeCtx) {
      const prev = this._timeCtx;
      this._timeCtx = timeCtx;
      if (
        !prev ||
        prev.timeAdapter !== timeCtx.timeAdapter ||
        prev.mapBars !== timeCtx.mapBars ||
        prev.lastRealChartTime !== timeCtx.lastRealChartTime ||
        prev.barSec !== timeCtx.barSec
      ) {
        dirty = true;
      }
    }

    if (boxes != null && !geometryUnchanged) {
      if (!boxesEqual(this._boxes, boxes)) {
        this._boxes = boxes ?? [];
        dirty = true;
      }
    }

    // Bar data / time context changed → drop cached mapping; pure pans never set dirty.
    if (dirty) this._timeMapping = null;

    if (dirty && !skipRedraw) this._requestUpdate?.();
    this._syncCountdownTimer();
  }

  _syncCountdownTimer() {
    const needsTimer = Boolean(this._requestUpdate) && this._boxes.some(
      (box) => Number.isFinite(Number(box.countdownTo)),
    );
    if (!needsTimer && this._countdownTimer != null) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    } else if (needsTimer && this._countdownTimer == null) {
      this._countdownTimer = setInterval(() => this._requestUpdate?.(), 1000);
    }
  }

  requestRefresh() {
    this._requestUpdate?.();
  }

  /** @param {import("prochart").SeriesAttachedParameter} param */
  attached(param) {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    this._timeMapping = null;
    this._chart.subscribeCrosshairMove?.(this._crosshairHandler);
    this._syncCountdownTimer();
  }

  detached() {
    this._chart?.unsubscribeCrosshairMove?.(this._crosshairHandler);
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._timeMapping = null;
    this._hoveredBoxId = null;
    this._hoverPoint = null;
    this._syncCountdownTimer();
  }

  updateAllViews() {}

  paneViews() {
    return this._paneViews;
  }

  drawData() {
    const chart = this._chart;
    const series = this._series;
    if (!chart || !series) {
      return {
        boxes: [],
        timeToX: () => null,
        priceToY: () => null,
        hoveredBoxId: null,
        hoverPoint: null,
      };
    }
    // Reuse cached bar mapping across pan frames; rebuild (one series.data() copy)
    // only after a data change invalidated it.
    if (!this._timeMapping) {
      this._timeMapping = resolveOverlayTimeMapping(series, this._timeCtx);
    }
    const timeToX = createOverlayTimeToXFromMapping(chart, this._timeMapping);

    return {
      boxes: this._boxes,
      timeToX,
      priceToY: (p) => safePriceToY(series, p),
      hoveredBoxId: this._hoveredBoxId,
      hoverPoint: this._hoverPoint,
    };
  }
}

/** @param {{ series: import("prochart").ISeriesApi }} opts */
export function attachBoxesPrimitive(opts) {
  const primitive = new BoxesPrimitive();
  opts.series.attachPrimitive(primitive);
  return {
    setBoxes: (boxes, timeCtx, opts) => primitive.setBoxes(boxes, timeCtx, opts),
    setLabels: (boxes) => primitive.setBoxes(boxes),
    requestRefresh: () => primitive.requestRefresh(),
    destroy: () => {
      try {
        opts.series.detachPrimitive(primitive);
      } catch {
        /* ignore */
      }
    },
  };
}
