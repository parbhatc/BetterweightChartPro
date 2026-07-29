import { LineStyle } from "../core/enums.mjs";
import { clone, deepMerge } from "../core/utils.mjs";

/** Public facade for a series price line. */
export class PriceLineApi {
  constructor(series, chart, options) {
    this._series = series;
    this._chart = chart;
    this._options = deepMerge(
      {
        price: 0,
        color: "#71717a",
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        lineVisible: true,
        axisLabelVisible: true,
        title: "",
        axisLabelColor: "",
        axisLabelTextColor: "",
        axisLabelText: "",
        axisLabelTitle: "",
        axisSubtitleText: "",
      },
      options || {},
    );
  }

  // --- Options ---

  applyOptions(options) {
    deepMerge(this._options, options || {});
    this._chart.invalidate();
  }

  options() {
    return clone(this._options);
  }
}
