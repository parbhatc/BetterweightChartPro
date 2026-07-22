import { clone, deepMerge } from "../core/utils.mjs";
import { LineStyle } from "../core/enums.mjs";


export class PriceLineApi {
  constructor(series, chart, opts) {
    this._series = series;
    this._chart = chart;
    this._options = deepMerge(
      { price: 0, color: "#4c525e", lineWidth: 1, lineStyle: LineStyle.Solid, lineVisible: true, axisLabelVisible: true, title: "", axisLabelColor: "", axisLabelTextColor: "", axisLabelText: "", axisLabelTitle: "", axisSubtitleText: "" },
      opts || {},
    );
  }
  applyOptions(o) { deepMerge(this._options, o || {}); this._chart.invalidate(); }
  options() { return clone(this._options); }
}
