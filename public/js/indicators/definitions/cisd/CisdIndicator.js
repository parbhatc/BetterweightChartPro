import { BarScriptIndicator } from "../../BarScriptIndicator.js";
import { createBool, createColor, createInt, inlinePair } from "../../builders.js";
import { styleColor } from "../../styleColor.js";

const COLORS = {
  bull: "#089981",
  bear: "#f23645",
};

/** Draws candle-close-confirmed changes in the state of price delivery. */
class CisdIndicator extends BarScriptIndicator {

  constructor() {
    super("cisd", "CISD", "Change in State of Delivery");
    this.setOverlayPrimitive("lines");
    this.setGraphicObjects([{ styleKey: "graphicLines", label: "CISD lines", overlay: "lines" }]);
    this.setInputs([
      createInt("minCandles", "Look left (minimum candles)", 3, { min: 1, section: "Detection" }),
      createBool("waitClose", "Wait for candle close", true, { section: "Detection" }),
      createBool("showBullish", "Show bullish CISD", true, { section: "Detection" }),
      createBool("showBearish", "Show bearish CISD", true, { section: "Detection" }),
      inlinePair(
        "Colors",
        createColor("bullColor", "Bullish", { color: COLORS.bull, opacity: 100 }, { store: "style" }),
        createColor("bearColor", "Bearish", { color: COLORS.bear, opacity: 100 }, { store: "style" }),
        { header: "CISD" },
      ),
      createInt("lineWidth", "Line width", 1, { min: 1, section: "Colors", store: "style" }),
    ]);
  }

  mergeStyleDefaults(style) {
    return {
      ...style,
      graphicLines: style.graphicLines ?? true,
      lineWidth: style.lineWidth ?? 1,
      bullColor: style.bullColor ?? COLORS.bull,
      bullColorOpacity: style.bullColorOpacity ?? 100,
      bearColor: style.bearColor ?? COLORS.bear,
      bearColorOpacity: style.bearColorOpacity ?? 100,
    };
  }

  legendParams(instance) {
    const minimum = Math.max(1, Math.floor(Number(instance.inputs?.minCandles) || 3));
    return [`${minimum}+ candles`];
  }

  needsLiveOverlayRefresh(instance) {
    return instance.inputs?.waitClose === false;
  }

  init() {
    this.state.minimum = this.getInt("minCandles", 3, 1);
    this.state.waitClose = this.getBool("waitClose", true);
    this.state.showBullish = this.getBool("showBullish", true);
    this.state.showBearish = this.getBool("showBearish", true);
    this.state.bullColor = styleColor(this.style, "bullColor", COLORS.bull);
    this.state.bearColor = styleColor(this.style, "bearColor", COLORS.bear);
    this.state.width = Math.max(1, Number(this.style.lineWidth) || 1);
    this.state.bearRun = null;
    this.state.bullRun = null;
    this.state.bullCandidate = null;
    this.state.bearCandidate = null;

    this.state.emit = (direction, origin) => {
      const timeEnd = this.chartBars[this.index]?.time;
      if (timeEnd == null) return;
      this.drawLine({
        timeStart: origin.time,
        priceStart: origin.price,
        timeEnd,
        priceEnd: origin.price,
        color: this.state[`${direction}Color`],
        width: this.state.width,
        dash: [4, 3],
        label: "CISD",
        labelPlain: true,
        labelTextColor: this.state[`${direction}Color`],
        labelStyle: direction === "bull" ? "up" : "down",
      });
    };
  }

  onBar(bar) {
    const lastIndex = this.bars.length - 1;
    if (this.state.waitClose && this.index === lastIndex) return;

    const time = this.chartBars[this.index]?.time;
    if (time == null) return;

    const isBear = bar.close < bar.open;
    const isBull = bar.close > bar.open;
    const { minimum } = this.state;

    // The reference is the open of the first candle in the complete,
    // consecutive delivery run. A 3-candle minimum also accepts 4, 5, ... .
    if (!isBear && this.state.bearRun?.count >= minimum) {
      this.state.bullCandidate = {
        time: this.state.bearRun.time,
        price: this.state.bearRun.price,
      };
    }
    if (!isBull && this.state.bullRun?.count >= minimum) {
      this.state.bearCandidate = {
        time: this.state.bullRun.time,
        price: this.state.bullRun.price,
      };
    }

    if (
      this.state.showBullish
      && this.state.bullCandidate
      && bar.close > this.state.bullCandidate.price
    ) {
      this.state.emit("bull", this.state.bullCandidate);
      this.state.bullCandidate = null;
    }
    if (
      this.state.showBearish
      && this.state.bearCandidate
      && bar.close < this.state.bearCandidate.price
    ) {
      this.state.emit("bear", this.state.bearCandidate);
      this.state.bearCandidate = null;
    }

    if (isBear) {
      this.state.bearRun = this.state.bearRun
        ? { ...this.state.bearRun, count: this.state.bearRun.count + 1 }
        : { time, price: bar.open, count: 1 };
      this.state.bullRun = null;
    } else if (isBull) {
      this.state.bullRun = this.state.bullRun
        ? { ...this.state.bullRun, count: this.state.bullRun.count + 1 }
        : { time, price: bar.open, count: 1 };
      this.state.bearRun = null;
    } else {
      this.state.bearRun = null;
      this.state.bullRun = null;
    }
  }
}

BarScriptIndicator.define(CisdIndicator);

export default CisdIndicator;
