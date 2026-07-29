import { MismatchDirection } from "../core/enums.mjs";

/** Owns crosshair state, coordinate mapping, hit testing, and event delivery. */
export class CrosshairManager {
  constructor(model) {
    this._model = model;
    this.state = {
      visible: false,
      x: -1,
      y: -1,
      logical: null,
      price: null,
      paneIndex: 0,
      external: false,
    };
    this.subscribers = new Set();
    this._notificationFrame = 0;
    this._pendingSourceEvent = null;
  }

  createParam(sourceEvent) {
    const model = this._model;
    const crosshair = this.state;
    const param = {
      point: crosshair.visible ? { x: crosshair.x, y: crosshair.y } : undefined,
      logical: crosshair.visible && crosshair.logical != null
        ? crosshair.logical
        : undefined,
      time: undefined,
      paneIndex: crosshair.paneIndex,
      seriesData: new Map(),
      hoveredSeries: undefined,
      hoveredObjectId: undefined,
      sourceEvent: this._createSourceEventParam(sourceEvent),
    };

    if (!crosshair.visible || crosshair.logical == null) return param;

    const roundedLogical = Math.round(crosshair.logical);
    // Whitespace has an extrapolated time too. Keeping it in the event lets
    // synchronized and pinned crosshairs remain under the pointer in future space.
    param.time = model.timeScale.indexToTime(roundedLogical) ?? undefined;
    this._collectSeriesData(param.seriesData, roundedLogical);
    param.hoveredObjectId = this._hitTestOverlay();
    return param;
  }

  update(x, y, sourceEvent) {
    const model = this._model;
    const crosshair = this.state;
    crosshair.visible = true;
    crosshair.external = false;
    crosshair.x = x;
    crosshair.y = y;
    crosshair.logical = model.timeScale.coordinateToLogical(x);
    crosshair.paneIndex = model.paneIndexAtY(y);
    model.invalidateCrosshairOnly();

    // Pointer events can arrive much faster than the display refresh rate.
    // Keep state current while coalescing subscriber work to one notification
    // per animation frame.
    this._pendingSourceEvent = sourceEvent ?? null;
    if (this._notificationFrame) return;
    this._notificationFrame = requestAnimationFrame(() => {
      this._notificationFrame = 0;
      if (model._destroyed) return;
      const pendingSourceEvent = this._pendingSourceEvent;
      this._pendingSourceEvent = null;
      this._notify(pendingSourceEvent);
    });
  }

  clear(fire = true) {
    if (!this.state.visible) return;
    this.state.visible = false;
    this.state.logical = null;
    this._model.invalidateCrosshairOnly();
    if (fire) this._notify(null);
  }

  setPosition(price, time, seriesApi) {
    const model = this._model;
    const timeScale = model.timeScale;
    const logical = timeScale.timeToIndex(time, true);
    if (logical == null) return;

    const seriesModel = seriesApi && seriesApi._m ? seriesApi._m : null;
    const pane = seriesModel
      ? model.panes[seriesModel.paneIndex]
      : model.panes[0];
    const priceScale = seriesModel
      ? model.priceScaleModelFor(seriesModel)
      : pane?.priceScales.get("right");
    const localY = priceScale ? priceScale.priceToCoordinate(price) : 0;
    const crosshair = this.state;

    crosshair.visible = true;
    crosshair.external = true;
    crosshair.logical = logical;
    crosshair.x = timeScale.logicalToCoordinate(logical);
    crosshair.y = (pane ? pane.top : 0) + (localY ?? 0);
    crosshair.paneIndex = pane ? pane.index : 0;
    model.invalidateCrosshairOnly();
    this._notify(null);
  }

  destroy() {
    if (this._notificationFrame) {
      cancelAnimationFrame(this._notificationFrame);
      this._notificationFrame = 0;
    }
    this._pendingSourceEvent = null;
    this.subscribers.clear();
  }

  _createSourceEventParam(sourceEvent) {
    if (!sourceEvent) return undefined;

    const crosshair = this.state;
    return {
      clientX: sourceEvent.clientX,
      clientY: sourceEvent.clientY,
      pageX: sourceEvent.pageX,
      pageY: sourceEvent.pageY,
      screenX: sourceEvent.screenX,
      screenY: sourceEvent.screenY,
      localX: crosshair.x,
      localY: crosshair.y,
      pointerType: sourceEvent.pointerType,
      ctrlKey: sourceEvent.ctrlKey,
      altKey: sourceEvent.altKey,
      shiftKey: sourceEvent.shiftKey,
      metaKey: sourceEvent.metaKey,
    };
  }

  _collectSeriesData(seriesData, logical) {
    for (const [seriesModel, seriesApi] of this._model.seriesApis) {
      const item = seriesModel.dataByIndex(logical, MismatchDirection.None);
      if (item) seriesData.set(seriesApi, item);
    }
  }

  _hitTestOverlay() {
    const crosshair = this.state;
    const pane = this._model.panes[crosshair.paneIndex];
    if (!pane) return undefined;

    for (const series of pane.series) {
      for (const primitive of series.overlays) {
        if (typeof primitive.hitTest !== "function") continue;
        try {
          const hit = primitive.hitTest(crosshair.x, crosshair.y - pane.top);
          if (hit) return hit.externalId ?? hit;
        } catch {
          // A faulty primitive must not prevent crosshair subscribers from firing.
        }
      }
    }
    return undefined;
  }

  _notify(sourceEvent) {
    if (!this.subscribers.size) return;

    const param = this.createParam(sourceEvent);
    for (const subscriber of this.subscribers) {
      try {
        subscriber(param);
      } catch (error) {
        console.error(error);
      }
    }
  }
}
