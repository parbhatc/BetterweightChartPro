import { VALUES_TOOLTIP_LONG_PRESS_MS, VALUES_TOOLTIP_MOVE_THRESHOLD } from "../../constants.js";
import { barPriceClass, candleValueColor, isBarUp, barChangeFromPrevClose } from "../../../chart/bar/style.js";

export function nearestBarForTooltip(bars, time, barSec = 60) {
  if (!bars?.length || time == null) return { bar: null, prev: null };
  const tolerance = Math.max(1, Number(barSec) || 60) * 0.5;
  const lastIdx = bars.length - 1;
  if (time > bars[lastIdx].time + tolerance) {
    return {
      bar: bars[lastIdx],
      prev: lastIdx > 0 ? bars[lastIdx - 1] : null,
      future: true,
    };
  }
  let bestIdx = 0;
  let bestDist = Math.abs(bars[0].time - time);
  for (let i = 1; i < bars.length; i += 1) {
    const dist = Math.abs(bars[i].time - time);
    if (dist < bestDist) {
      bestIdx = i;
      bestDist = dist;
    }
  }
  if (bestDist > tolerance) return { bar: null, prev: null };
  return { bar: bars[bestIdx], prev: bestIdx > 0 ? bars[bestIdx - 1] : null };
}

/**
 * @param {object} deps
 * @param {import("prochart").IChartApi} [deps.chart]
 * @param {import("prochart").ISeriesApi} [deps.series]
 * @param {(bar: object, prev: object | null) => void} [deps.onBarHover]
 * @param {(pinned: boolean) => void} [deps.onPinChange]
 */
export function createTooltipOverlay(deps) {
  const { getContext, resolvePoint, valuesTooltip, overlayRoot, chart, series, onBarHover, onPinChange } = deps;

  /** @type {ReturnType<typeof setTimeout> | null} */
  let longPressTimer = null;
  /** @type {{ x: number, y: number } | null} */
  let longPressOrigin = null;
  let pinned = false;
  let savedHorzCrosshairVisible = true;
  let savedVertCrosshairVisible = true;

  function nearestBar(time) {
    const { bars, barSec = 60 } = getContext();
    return nearestBarForTooltip(bars, time, barSec);
  }

  function buildTooltipHtml(bar, prev) {
    const ctx = getContext();
    const precision = ctx.precision ?? 2;
    const fmt = (n) =>
      Number(n).toLocaleString(undefined, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      });
    const fmtVol = (n) => {
      if (n == null) return "—";
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
      if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
      return String(Math.round(n));
    };

    const up = isBarUp(bar, prev ?? undefined, ctx.colorBarsOnPrevClose);
    const priceCls = barPriceClass(up);
    const priceColor = candleValueColor(ctx.symbol, up);
    const priceStyle = ` style="color:${priceColor}"`;

    const row = (lbl, val, colored = false) => {
      const cls = colored ? priceCls : "";
      const style = colored ? priceStyle : "";
      return `<span class="chart-values-tooltip__row"><span>${lbl}</span><span class="chart-values-tooltip__val ${cls}"${style}>${val}</span></span>`;
    };

    const rows = [
      row("Open", fmt(bar.open), true),
      row("High", fmt(bar.high), true),
      row("Low", fmt(bar.low), true),
      row("Close", fmt(bar.close), true),
    ];

    const { change: chg, pct: chgPct } = barChangeFromPrevClose(bar, prev ?? undefined);
    const chgSign = chg >= 0 ? "+" : "";
    const chgUp = chg >= 0;
    const chgCls = barPriceClass(chgUp);
    const chgColor = candleValueColor(ctx.symbol, chgUp);
    rows.push(
      `<span class="chart-values-tooltip__row"><span>Change</span><span class="chart-values-tooltip__val ${chgCls}" style="color:${chgColor}">${chgSign}${fmt(chg)} (${chgSign}${chgPct.toFixed(2)}%)</span></span>`,
    );
    rows.push(row("Volume", fmtVol(bar.volume), true));
    return rows.join("");
  }

  /** @param {number} clientX @param {number} clientY */
  function positionTooltip(clientX, clientY) {
    const rect = overlayRoot.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const width = valuesTooltip.offsetWidth || 168;
    const height = valuesTooltip.offsetHeight || 170;
    const left = localX + 12 + width <= rect.width ? localX + 12 : localX - width - 12;
    const top = Math.max(8, Math.min(localY + 12, rect.height - height - 8));
    valuesTooltip.style.left = `${Math.max(8, left)}px`;
    valuesTooltip.style.top = `${top}px`;
  }

  /** @param {object} bar @param {number} price */
  function syncCrosshairToPoint(bar, price) {
    if (!chart || !series || !bar) return;
    const ta = getContext().timeAdapter;
    const chartTime = ta ? ta.time.toChart(bar.time) : bar.time;
    chart.setCrosshairPosition(Number.isFinite(price) ? price : bar.close, chartTime, series);
  }

  function syncCrosshairToTime(time, price) {
    if (!chart || !series || time == null) return;
    const ta = getContext().timeAdapter;
    const chartTime = ta ? ta.time.toChart(time) : time;
    chart.setCrosshairPosition(Number.isFinite(price) ? price : 0, chartTime, series);
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{ bar: object | null, prev: object | null, future?: boolean } | null}
   */
  function renderAt(clientX, clientY) {
    const point = resolvePoint(clientX, clientY);
    if (!point) return null;
    const { bar, prev, future = false } = nearestBar(point.time);
    if (!bar) {
      valuesTooltip.hidden = true;
      syncCrosshairToTime(point.time, point.price);
      onBarHover?.(null, null);
      return { bar: null, prev: null, future: true };
    }
    valuesTooltip.innerHTML = buildTooltipHtml(bar, prev);
    valuesTooltip.hidden = false;
    positionTooltip(clientX, clientY);
    if (future) syncCrosshairToTime(point.time, point.price);
    else syncCrosshairToPoint(bar, point.price);
    onBarHover?.(bar, prev);
    return { bar, prev, future };
  }

  function hideValuesTooltip() {
    if (pinned) return;
    valuesTooltip.hidden = true;
    onBarHover?.(null, null);
  }

  function isValuesTooltipPinned() {
    return pinned;
  }

  function unpinValuesTooltip() {
    if (!pinned) {
      valuesTooltip.hidden = true;
      onBarHover?.(null, null);
      return;
    }
    pinned = false;
    valuesTooltip.hidden = true;
    if (chart) {
      chart.applyOptions({
        crosshair: {
          horzLine: { visible: savedHorzCrosshairVisible },
          vertLine: { visible: savedVertCrosshairVisible },
        },
      });
      chart.clearCrosshairPosition?.();
    }
    onPinChange?.(false);
    onBarHover?.(null, null);
  }

  function pinValuesTooltip(clientX, clientY) {
    const hit = renderAt(clientX, clientY);
    if (!hit) return;
    pinned = true;
    if (chart) {
      const crosshair = chart.options().crosshair;
      const horz = crosshair?.horzLine;
      const vert = crosshair?.vertLine;
      savedHorzCrosshairVisible = horz?.visible !== false;
      savedVertCrosshairVisible = vert?.visible !== false;
      chart.applyOptions({
        crosshair: {
          horzLine: { visible: true },
          vertLine: { visible: true },
        },
      });
    }
    onPinChange?.(true);
  }

  /** @param {number} clientX @param {number} clientY */
  function updateValuesTooltipAt(clientX, clientY) {
    if (!pinned) return;
    renderAt(clientX, clientY);
  }

  function clearLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressOrigin = null;
  }

  function scheduleLongPress(clientX, clientY) {
    clearLongPress();
    longPressOrigin = { x: clientX, y: clientY };
    longPressTimer = setTimeout(() => {
      if (!longPressOrigin) return;
      pinValuesTooltip(longPressOrigin.x, longPressOrigin.y);
      clearLongPress();
    }, VALUES_TOOLTIP_LONG_PRESS_MS);
  }

  function cancelLongPressIfMoved(clientX, clientY) {
    if (pinned || !longPressOrigin || !longPressTimer) return;
    const moved = Math.hypot(clientX - longPressOrigin.x, clientY - longPressOrigin.y);
    if (moved > VALUES_TOOLTIP_MOVE_THRESHOLD) clearLongPress();
  }

  return {
    hideValuesTooltip,
    unpinValuesTooltip,
    isValuesTooltipPinned,
    updateValuesTooltipAt,
    clearLongPress,
    scheduleLongPress,
    cancelLongPressIfMoved,
  };
}
