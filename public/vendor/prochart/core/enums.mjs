/** Public enums and series-type tokens. */

export const ColorType = { Solid: "solid", VerticalGradient: "gradient" };
export const CrosshairMode = { Normal: 0, Magnet: 1, Hidden: 2 };
export const LineStyle = { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 };
export const LineType = { Simple: 0, WithSteps: 1, Curved: 2 };
export const PriceScaleMode = { Normal: 0, Logarithmic: 1, Percentage: 2, IndexedTo100: 3 };
export const TickMarkType = { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 };
export const MismatchDirection = { NearestLeft: -1, None: 0, NearestRight: 1 };

/** Series-type tokens (identity objects, matched with ===). */
export const CandlestickSeries = { type: "Candlestick" };
export const BarSeries = { type: "Bar" };
export const LineSeries = { type: "Line" };
export const AreaSeries = { type: "Area" };
export const HistogramSeries = { type: "Histogram" };
export const BaselineSeries = { type: "Baseline" };

export const version = () => "prochart-2.0.0";
