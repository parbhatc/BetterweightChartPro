import { timeTicks } from "./sub/axisRenderer.mjs";

/** Shares immutable tick snapshots between grid and axis passes in one frame. */
export class RenderFrameTickCache {
  constructor(model) {
    this._model = model;
    this._timeTicksByWidth = new Map();
    this._priceTicksByScale = new Map();
  }

  timeTicks(plotWidth) {
    if (!this._timeTicksByWidth.has(plotWidth)) {
      this._timeTicksByWidth.set(
        plotWidth,
        timeTicks(this._model, plotWidth),
      );
    }
    return this._timeTicksByWidth.get(plotWidth);
  }

  priceTicks(scale) {
    if (!this._priceTicksByScale.has(scale)) {
      this._priceTicksByScale.set(scale, scale.ticks());
    }
    return this._priceTicksByScale.get(scale);
  }
}
