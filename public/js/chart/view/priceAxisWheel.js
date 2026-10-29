import { lwcPaneIndexAtY } from "../pane/studyScale.js";

/**
 * Axis wheels run on the chart container before the engine's plot-wheel input.
 * Publish the same relative zoom gesture as an axis drag so layout peers can
 * follow without copying an instrument's prices or changing its scale margins.
 * @param {{ el: HTMLElement, chart: object, series: object }} deps
 */
export function mountPriceAxisWheel({ el, chart, series }) {
  const onWheel = (event) => {
    const rect = el.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const rightWidth = chart.priceScale("right").width();
    const leftWidth = chart.priceScale("left").width();
    const zone = rightWidth > 0 && x >= rect.width - rightWidth ? "right"
      : leftWidth > 0 && x <= leftWidth ? "left" : null;
    if (!zone) return;

    event.preventDefault();
    event.stopPropagation();
    // Study panes own independent axes; they must not move the main candles.
    if (lwcPaneIndexAtY(chart, y) !== 0) return;

    const height = rect.height || 400;
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= height;
    if (!Number.isFinite(delta) || delta === 0) return;
    const step = Math.min(0.012, Math.max(0.0008, Math.abs(delta) / height * 0.055));
    const factor = Math.exp((delta < 0 ? -1 : 1) * step * 2);

    // Release the shared auto preference before changing the range. Its
    // synchronous settings subscriber must not overwrite the wheel gesture.
    el.dispatchEvent(new CustomEvent("prochart-price-scale-manual", {
      bubbles: true, detail: { paneIndex: 0, zone },
    }));
    series.priceScale().scaleAroundCenter(factor);
    el.dispatchEvent(new CustomEvent("prochart-price-axis-scale", {
      bubbles: true, detail: { paneIndex: 0, zone, factor },
    }));
  };
  el.addEventListener("wheel", onWheel, { passive: false, capture: true });
  return () => el.removeEventListener("wheel", onWheel, { capture: true });
}
