import { clone } from "../core/utils.mjs";
import { PriceScaleModel } from "../scale/price.mjs";


export class Pane {
  constructor(chart, index) {
    this.chart = chart;
    this.index = index;
    this.height = 0;           // computed each layout
    this.requestedHeight = 0;  // 0 = flexible
    this.top = 0;
    /** @type {import("./series.mjs").SeriesModel[]} */
    this.series = [];
    /** @type {Map<string, PriceScaleModel>} */
    this.priceScales = new Map();
  }

  scale(id) {
    let s = this.priceScales.get(id);
    if (!s) {
      const chartOpts = this.chart.options;
      const base = id === "right" ? chartOpts.rightPriceScale : id === "left" ? chartOpts.leftPriceScale : chartOpts.overlayPriceScales;
      s = new PriceScaleModel(this.chart, this, id, clone(base));
      this.priceScales.set(id, s);
    }
    return s;
  }

  seriesFor(scaleModel) {
    return this.series.filter((s) => s.options.priceScaleId === scaleModel.id && s.options.visible !== false);
  }
}
