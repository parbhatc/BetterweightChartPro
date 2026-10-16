import { safePriceToY } from "../../chart/coords/timeScale.js";
import { chartDebug } from "../../debug/chart/index.js";
import { drawLabelCallout } from "./labelCallout.js";
import { resolveOverlayTimeMapping, createOverlayTimeToXFromMapping } from "./overlayMapBars.js";
import { verticalSegmentIntersectsViewport } from "./viewportCulling.js";

const LABEL_FONT = "600 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const HTF_LABEL_FONT = "700 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const SESSION_LABEL_FONT = "700 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/** @param {number} x1 @param {number} x2 @param {number} paneW */
function lineIntersectsViewport(x1, x2, paneW) {
  if (!Number.isFinite(x1) || !Number.isFinite(x2) || paneW <= 0) return false;
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  return hi >= 0 && lo <= paneW;
}

/** @param {number} x1 @param {number} x2 @param {number} paneW */
function labelXOnVisibleSegment(x1, x2, paneW) {
  const lo = Math.max(0, Math.min(x1, x2));
  const hi = Math.min(paneW, Math.max(x1, x2));
  return (lo + hi) / 2;
}

/** @param {CanvasRenderingContext2D} ctx @param {object} line @param {number} x1 @param {number} x2 @param {(p: number) => number | null} priceToY @param {number} paneW @param {number} paneHeight */
function drawLine(ctx, line, x1, x2, priceToY, paneW, paneHeight) {
  const y1 = priceToY(line.priceStart);
  const y2 = priceToY(line.priceEnd);
  if (x1 == null || x2 == null || y1 == null || y2 == null) return;
  if (!verticalSegmentIntersectsViewport(y1, y2, paneHeight)) return;
  // Stale mapBars during history restore — skip inverted coords.
  if (x1 > x2 + 2) return;
  if (Math.abs(x2 - x1) < 1 && Math.abs(y2 - y1) < 1) return;

  ctx.save();
  const swept = Boolean(line.swept);
  ctx.strokeStyle = line.color ?? "#2962ff";
  ctx.lineWidth = Math.max(1, Number(line.width) || 1);
  ctx.globalAlpha = swept ? 0.72 : 1;
  const dash = swept ? [2, 3] : Array.isArray(line.dash) ? line.dash : [];
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();

  if (!lineIntersectsViewport(x1, x2, paneW)) return;

  if (line.sessionLabel) {
    const rightX = Math.min(paneW, Math.max(x1, x2));
    ctx.save();
    ctx.font = SESSION_LABEL_FONT;
    ctx.fillStyle = line.sessionLabelColor ?? line.color ?? "#fafafa";
    const labelAbove = line.kind === "high";
    ctx.textBaseline = labelAbove ? "bottom" : "top";
    ctx.textAlign = "right";
    ctx.globalAlpha = swept ? 0.7 : 0.95;
    const labelX = rightX - 8;
    const labelY = labelAbove ? y1 - 4 : y1 + 4;
    const labelText = String(line.sessionLabel);
    const labelWidth = ctx.measureText(labelText).width;
    const labelTop = labelAbove ? labelY - 16 : labelY - 1;
    ctx.fillStyle = "rgba(8, 11, 18, 0.82)";
    ctx.fillRect(labelX - labelWidth - 4, labelTop, labelWidth + 8, 17);
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(8, 11, 18, 0.92)";
    ctx.fillStyle = line.sessionLabelColor ?? line.color ?? "#fafafa";
    ctx.strokeText(labelText, labelX, labelY);
    ctx.fillText(labelText, labelX, labelY);
    ctx.restore();
  }

  if (!line.label) return;

  if (line.labelAnchor === "right") {
    const rightX = Math.max(x1, x2);
    const ly = y1;
    if (!Number.isFinite(rightX) || !Number.isFinite(ly)) return;
    ctx.save();
    ctx.font = line.labelEmphasis ? HTF_LABEL_FONT : LABEL_FONT;
    ctx.fillStyle = line.labelTextColor ?? line.color ?? "#fafafa";
    ctx.textBaseline = "middle";
    ctx.textAlign = line.extendRight ? "right" : "left";
    ctx.globalAlpha = swept ? 0.7 : 0.95;
    const labelText = String(line.label);
    const labelX = line.extendRight ? paneW - 4 : rightX + 4;
    if (line.labelEmphasis) {
      ctx.lineJoin = "round";
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.95)";
      ctx.strokeText(labelText, labelX, ly);
    }
    ctx.fillText(labelText, labelX, ly);
    ctx.restore();
    return;
  }

  const isSmt = line.kind === "high" || line.kind === "low";
  const lx = isSmt ? (x1 + x2) / 2 : labelXOnVisibleSegment(x1, x2, paneW);
  let ly;
  if (isSmt) {
    ly = (y1 + y2) / 2;
  } else if (line.labelPrice != null && Number.isFinite(line.labelPrice)) {
    ly = priceToY(line.labelPrice);
    if (ly == null) ly = (y1 + y2) / 2;
  } else {
    ly = (y1 + y2) / 2;
  }

  if (!Number.isFinite(lx) || !Number.isFinite(ly)) {
    if (isSmt) {
      chartDebug("smt", "label coord miss", {
        lx,
        ly,
        x1,
        x2,
        paneW,
        timeStart: line.timeStart,
        timeEnd: line.timeEnd,
        label: line.label,
      });
    }
    return;
  }

  // Market-structure labels are annotations on the level itself, not callouts.
  // Keep this opt-in so existing overlays (for example SMT) retain their
  // current boxed-label appearance.
  if (line.labelPlain) {
    ctx.save();
    ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = line.labelTextColor ?? line.color ?? "#089981";
    ctx.textAlign = "center";
    const labelBelow = line.labelStyle === "down";
    ctx.textBaseline = labelBelow ? "top" : "bottom";
    ctx.fillText(String(line.label), lx, labelBelow ? ly + 2 : ly - 2);
    ctx.restore();
    return;
  }

  ctx.save();
  const labelAngle = isSmt ? Math.atan2(y2 - y1, x2 - x1) : undefined;
  drawLabelCallout(
    ctx,
    lx,
    ly,
    String(line.label),
    line.labelBg ?? "#3d1f1f",
    line.labelTextColor ?? line.color ?? "#ff1100",
    line.labelStyle === "up" ? "low" : "high",
    labelAngle != null ? { angle: labelAngle, paneW } : undefined,
  );
  ctx.restore();
}

class LinesPaneRenderer {
  /** @param {() => object} getData */
  constructor(getData) {
    this._getData = getData;
  }

  /** @param {import("fancy-canvas").CanvasRenderingTarget2D} target */
  draw(target) {
    const { lines, timeToX, priceToY } = this._getData();
    if (!lines?.length) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const paneW = mediaSize.width;
      const pad = 4;
      for (const line of lines) {
        const x1 = line.extendLeft ? 0 : timeToX(line.timeStart);
        const x2 = line.extendRight ? paneW : timeToX(line.timeEnd);
        if (x1 != null && x2 != null) {
          const lo = Math.min(x1, x2);
          const hi = Math.max(x1, x2);
          if (hi < -pad || lo > paneW + pad) continue;
        }
        drawLine(ctx, line, x1, x2, priceToY, paneW, mediaSize.height);
      }
    });
  }
}

class LinesPaneView {
  /** @param {LinesPrimitive} source */
  constructor(source) {
    this._source = source;
    this._renderer = new LinesPaneRenderer(() => this._source.drawData());
  }

  zOrder() {
    return "top";
  }

  renderer() {
    return this._renderer;
  }
}

/** @param {object[]} a @param {object[]} b */
function linesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      x.timeStart !== y.timeStart ||
      x.timeEnd !== y.timeEnd ||
      x.priceStart !== y.priceStart ||
      x.priceEnd !== y.priceEnd ||
      x.color !== y.color ||
      x.label !== y.label ||
      x.labelBg !== y.labelBg ||
      x.labelTextColor !== y.labelTextColor ||
      x.labelEmphasis !== y.labelEmphasis ||
      x.labelAnchor !== y.labelAnchor ||
      x.labelPlain !== y.labelPlain ||
      x.sessionLabel !== y.sessionLabel ||
      x.sessionLabelColor !== y.sessionLabelColor ||
      Boolean(x.extendLeft) !== Boolean(y.extendLeft) ||
      Boolean(x.extendRight) !== Boolean(y.extendRight) ||
      String(x.dash ?? "") !== String(y.dash ?? "") ||
      x.swept !== y.swept ||
      x.width !== y.width
    ) {
      return false;
    }
  }
  return true;
}

class LinesPrimitive {
  constructor() {
    /** @type {object[]} */
    this._lines = [];
    /** @type {{ mapBars: object[], barSec: number, lastRealChartTime?: number, timeAdapter?: object } | null} */
    this._timeCtx = null;
    /** Cached series.data()-derived time mapping; rebuilt only on data change, not per pan frame. */
    this._timeMapping = null;
    /** @type {import("prochart").IChartApi | null} */
    this._chart = null;
    /** @type {import("prochart").ISeriesApi | null} */
    this._series = null;
    /** @type {(() => void) | null} */
    this._requestUpdate = null;
    this._paneView = new LinesPaneView(this);
  }

  /** @param {object[]} lines @param {object | null} [timeCtx] @param {{ geometryUnchanged?: boolean, skipRedraw?: boolean }} [opts] */
  setLines(lines, timeCtx = null, opts = {}) {
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

    if (lines != null && !geometryUnchanged) {
      if (!linesEqual(this._lines, lines)) {
        this._lines = lines ?? [];
        dirty = true;
      }
    }

    // Bar data / time context changed → drop the cached mapping so the next
    // draw rebuilds it (one series.data() copy). Pure pans never set dirty.
    if (dirty) this._timeMapping = null;

    if (dirty && !skipRedraw) this._requestUpdate?.();
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
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._timeMapping = null;
  }

  updateAllViews() {}

  paneViews() {
    return [this._paneView];
  }

  drawData() {
    const chart = this._chart;
    const series = this._series;
    if (!chart || !series) {
      return { lines: [], timeToX: () => null, priceToY: () => null, paneW: 0 };
    }
    const paneW = chart.paneSize?.()?.width ?? 0;
    // Reuse the cached bar mapping across pan frames; rebuild (one series.data()
    // copy) only after a data change invalidated it.
    if (!this._timeMapping) {
      this._timeMapping = resolveOverlayTimeMapping(series, this._timeCtx);
    }
    const timeToX = createOverlayTimeToXFromMapping(chart, this._timeMapping);

    return {
      lines: this._lines,
      paneW,
      timeToX,
      priceToY: (p) => safePriceToY(series, p),
    };
  }
}

/** @param {{ series: import("prochart").ISeriesApi }} opts */
export function attachLinesPrimitive(opts) {
  const primitive = new LinesPrimitive();
  opts.series.attachPrimitive(primitive);
  return {
    setLines: (lines, timeCtx, opts) => primitive.setLines(lines, timeCtx, opts),
    setLabels: (lines) => primitive.setLines(lines),
    setBoxes: (lines, timeCtx, opts) => primitive.setLines(lines, timeCtx, opts),
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
