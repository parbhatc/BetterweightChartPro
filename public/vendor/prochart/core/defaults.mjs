import { ColorType, CrosshairMode, LineStyle, LineType, PriceScaleMode } from "./enums.mjs";
import { clone } from "./utils.mjs";

export const TIME_AXIS_HEIGHT = 28;
export const SEPARATOR_H = 1;

export function defaultChartOptions() {
  return {
    width: 0,
    height: 0,
    autoSize: false,
    layout: {
      background: { type: ColorType.Solid, color: "#131722" },
      textColor: "#B2B5BE",
      fontSize: 12,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
      panes: { separatorColor: "#131722", separatorHoverColor: "#131722", enableResize: false },
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: "#1e222d", style: LineStyle.Solid, visible: true },
      horzLines: { color: "#1e222d", style: LineStyle.Solid, visible: true },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: "#758696", width: 1, style: LineStyle.LargeDashed, visible: true, labelVisible: true, labelBackgroundColor: "#4c525e" },
      horzLine: { color: "#758696", width: 1, style: LineStyle.LargeDashed, visible: true, labelVisible: true, labelBackgroundColor: "#4c525e" },
    },
    rightPriceScale: defaultPriceScaleOptions(true),
    leftPriceScale: defaultPriceScaleOptions(false),
    overlayPriceScales: { scaleMargins: { top: 0.2, bottom: 0.1 } },
    timeScale: {
      rightOffset: 0,
      barSpacing: 6,
      minBarSpacing: 0.5,
      maxBarSpacing: 80,
      visible: true,
      timeVisible: false,
      secondsVisible: false,
      borderVisible: true,
      borderColor: "#2B2B43",
      fixLeftEdge: false,
      rightBarStaysOnScroll: false,
      shiftVisibleRangeOnNewBar: true,
      tickMarkFormatter: null,
      timezoneProvider: null,
    },
    localization: { locale: "en-US", timeFormatter: null, priceFormatter: null, dateFormat: "dd MMM 'yy" },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: {
      mouseWheel: true,
      pinch: true,
      axisPressedMouseMove: { time: true, price: true },
      axisDoubleClickReset: { time: true, price: true },
    },
    kineticScroll: { mouse: false, touch: true },
    /** hybrid renderer: "auto" uses WebGL for bulk series geometry when available */
    renderer: "auto",
  };
}

export function defaultPriceScaleOptions(visible) {
  return {
    visible,
    autoScale: true,
    mode: PriceScaleMode.Normal,
    invertScale: false,
    alignLabels: true,
    borderVisible: true,
    borderColor: "#2B2B43",
    scaleMargins: { top: 0.2, bottom: 0.1 },
    entireTextOnly: false,
    ticksVisible: false,
    minimumWidth: 0,
  };
}

function normalizeBoolGroup(v, keys) {
  if (typeof v !== "boolean") return v;
  const o = {};
  for (const k of keys) o[k] = v;
  return o;
}

export function normalizeChartOptions(opts) {
  const o = clone(opts || {});
  if (o.handleScroll !== undefined)
    o.handleScroll = normalizeBoolGroup(o.handleScroll, ["mouseWheel", "pressedMouseMove", "horzTouchDrag", "vertTouchDrag"]);
  if (o.handleScale !== undefined) {
    o.handleScale = normalizeBoolGroup(o.handleScale, ["mouseWheel", "pinch", "axisPressedMouseMove", "axisDoubleClickReset"]);
    if (o.handleScale && typeof o.handleScale.axisPressedMouseMove === "boolean")
      o.handleScale.axisPressedMouseMove = { time: o.handleScale.axisPressedMouseMove, price: o.handleScale.axisPressedMouseMove };
    if (o.handleScale && typeof o.handleScale.axisDoubleClickReset === "boolean")
      o.handleScale.axisDoubleClickReset = { time: o.handleScale.axisDoubleClickReset, price: o.handleScale.axisDoubleClickReset };
  }
  if (o.kineticScroll !== undefined) o.kineticScroll = normalizeBoolGroup(o.kineticScroll, ["mouse", "touch"]);
  return o;
}

export function defaultSeriesOptions(type) {
  const common = {
    visible: true,
    title: "",
    lastValueVisible: true,
    priceLineVisible: true,
    priceLineWidth: 1,
    priceLineColor: "",
    priceLineStyle: LineStyle.Dashed,
    priceLineSource: 0,
    priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    priceScaleId: "right",
    baseLineVisible: false,
    autoscaleInfoProvider: null,
  };
  switch (type) {
    case "Candlestick":
      return { ...common, upColor: "#26a69a", downColor: "#ef5350", wickVisible: true, wickUpColor: "#26a69a", wickDownColor: "#ef5350", borderVisible: true, borderUpColor: "#26a69a", borderDownColor: "#ef5350", borderColor: "", wickColor: "" };
    case "Bar":
      return { ...common, upColor: "#26a69a", downColor: "#ef5350", openVisible: true, thinBars: true };
    case "Line":
      return { ...common, color: "#2196f3", lineWidth: 2, lineStyle: LineStyle.Solid, lineType: LineType.Simple, lineVisible: true, pointMarkersVisible: false, pointMarkersRadius: 4, crosshairMarkerVisible: true, crosshairMarkerRadius: 4, crosshairMarkerBorderColor: "", crosshairMarkerBackgroundColor: "", lastPriceAnimation: 0 };
    case "Area":
      return { ...common, lineColor: "#33D778", topColor: "rgba(51,215,120,0.4)", bottomColor: "rgba(51,215,120,0)", lineWidth: 2, lineStyle: LineStyle.Solid, lineType: LineType.Simple, lineVisible: true, invertFilledArea: false, crosshairMarkerVisible: true, crosshairMarkerRadius: 4, pointMarkersVisible: false };
    case "Baseline":
      return { ...common, baseValue: { type: "price", price: 0 }, topLineColor: "#26a69a", topFillColor1: "rgba(38,166,154,0.28)", topFillColor2: "rgba(38,166,154,0.05)", bottomLineColor: "#ef5350", bottomFillColor1: "rgba(239,83,80,0.05)", bottomFillColor2: "rgba(239,83,80,0.28)", lineWidth: 2, lineStyle: LineStyle.Solid, lineType: LineType.Simple, lineVisible: true, crosshairMarkerVisible: true, crosshairMarkerRadius: 4 };
    case "Histogram":
      return { ...common, color: "#26a69a", base: 0 };
    default:
      return { ...common };
  }
}
