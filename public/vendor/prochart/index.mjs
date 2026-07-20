/**
 * ProChart — an original, dependency-free hybrid CPU+GPU charting engine
 * for BetterWeightChartPro. Written from scratch for this project (no code
 * from lightweight-charts or any other charting library).
 *
 * Structure:
 *   core/    enums, defaults, shared utils, price formatting, timezone provider
 *   scale/   time scale (logical index model) and price scales
 *   data/    series models + series/price-line APIs
 *   layout/  panes
 *   render/  frame renderer, overlay render target, WebGL bulk renderer
 *   input/   pointer/wheel/touch interactions (TradingView-tuned), kinetic scroll
 *   api/     chart model + public chart API + createChart
 */

export {
  ColorType,
  CrosshairMode,
  LineStyle,
  LineType,
  PriceScaleMode,
  TickMarkType,
  MismatchDirection,
  CandlestickSeries,
  BarSeries,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  BaselineSeries,
  version,
} from "./core/enums.mjs";

export { createFastTimezoneProvider } from "./core/tz.mjs";
export { createChart } from "./api/chart.mjs";

import { createChart } from "./api/chart.mjs";
import { version } from "./core/enums.mjs";
export default { createChart, version };
