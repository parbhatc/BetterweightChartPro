/**
 * Pointer / wheel / touch interactions, tuned to TradingView feel:
 *  - left-click drag on the plot pans 1:1 with the cursor (px-exact)
 *  - mouse wheel zooms ×1.1 per notch (100 deltaY), anchored at the cursor
 *  - trackpad horizontal deltas scroll; pinch zooms
 *  - price-axis drag rescales around center; time-axis drag stretches bar spacing
 *  - double-click on an axis resets it
 *  - kinetic scroll is time-based (frame-rate independent → identical feel
 *    on 60 Hz and 165 Hz displays)
 */

/** TV-style wheel zoom: ×1.1 per 100 deltaY */
const WHEEL_ZOOM_BASE = 1.1;
export const TOUCH_TRACKING_LONG_PRESS_MS = 240;
export const TOUCH_TRACKING_CANCEL_DISTANCE = 5;
/** TradingView desktop drags stop on pointer release; touch swipes retain momentum. */
export const TRADINGVIEW_KINETIC_SCROLL = Object.freeze({ mouse: false, touch: true });

/** Match TradingView's axis scale affordances: time stretches horizontally,
 * while price rescales vertically. */
export function chartCursorForZone(zone) {
  if (zone === "time") return "ew-resize";
  if (zone === "left" || zone === "right") return "ns-resize";
  return "";
}

/** Lightweight Charts tracking-mode movement: preserve the crosshair origin
 * and add only the current gesture delta on both axes. */
export function trackingCrosshairPosition(origin, gestureStart, current, bounds = {}) {
  const clamp = (value, min, max) => Math.min(Math.max(value, min ?? -Infinity), max ?? Infinity);
  return {
    x: clamp(origin.x + (current.x - gestureStart.x), bounds.minX, bounds.maxX),
    y: clamp(origin.y + (current.y - gestureStart.y), bounds.minY, bounds.maxY),
  };
}

/**
 * A tap inside the plot should reposition an already pinned mobile crosshair,
 * not make it appear to vanish at random. Tapping outside the plot remains the
 * deliberate dismissal gesture.
 */
export function mobilePinnedCrosshairReleaseAction({
  wasCrosshairOnly,
  crosshairWasPinnedAtStart,
  wasDrag,
  wasPlot,
}) {
  if (!wasCrosshairOnly || !crosshairWasPinnedAtStart || wasDrag) return null;
  return wasPlot ? "retain" : "dismiss";
}

export function bindEvents(m) {
  const el = m.root;
  const eventBindings = [];
  let disposed = false;
  let dragging = null;
  let pinch = null;
  let touchCrosshairPinned = false;
  let touchTrackingTimer = null;
  let plotPanFrame = 0;
  let pendingPlotPan = null;
  let deferredMouseCrosshair = null;
  let mousePanCrosshairHidden = false;
  const pointers = new Map();
  const inputRootRect = () => m.inputRootRect?.() ?? el.getBoundingClientRect();
  const inputPoint = (event) => {
    if (typeof m.inputPoint === "function") return m.inputPoint(event);
    const rect = inputRootRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };
  const listen = (type, listener, options) => {
    el.addEventListener(type, listener, options);
    eventBindings.push({ type, listener, options });
  };

  const clearTouchTrackingTimer = () => {
    if (touchTrackingTimer == null) return;
    clearTimeout(touchTrackingTimer);
    touchTrackingTimer = null;
  };

  const rectPos = (event, cachedPoint) => {
    const point = cachedPoint ?? inputPoint(event);
    return { x: point.x - (m._leftW || 0), y: point.y };
  };

  const zoneAt = (event, cachedPoint) => {
    const point = cachedPoint ?? inputPoint(event);
    const cx = point.x;
    const cy = point.y;
    const rightX = m.width - (m._rightW || 0);
    if (m.options.timeScale.visible && cy >= m.height - m.timeAxisHeight()) return "time";
    if ((m._rightW || 0) > 0 && cx >= rightX) return "right";
    if ((m._leftW || 0) > 0 && cx <= (m._leftW || 0)) return "left";
    return "plot";
  };

  const updateAxisHoverCursor = (event, cachedPoint) => {
    if (event.pointerType !== "mouse" || !el.style) return;
    const zone = dragging?.zone ?? zoneAt(event, cachedPoint);
    el.style.cursor = chartCursorForZone(zone);
  };

  const applyPendingPlotPan = () => {
    plotPanFrame = 0;
    const pending = pendingPlotPan;
    pendingPlotPan = null;
    if (!pending) return;

    const hs = m.options.handleScroll;
    const horzOk = pending.isTouch ? hs.horzTouchDrag !== false : hs.pressedMouseMove !== false;
    const vertOk = pending.isTouch ? hs.vertTouchDrag !== false : hs.pressedMouseMove !== false;
    if (horzOk && pending.dx !== 0) m.timeScale.scrollBy(-pending.dx);
    if (vertOk && pending.dy !== 0) {
      const pane = m.panes[pending.paneIndex];
      if (pane) {
        for (const scale of pane.priceScales.values()) {
          if (!scale.options.autoScale) scale.panByPixels(-pending.dy);
        }
      }
    }

    if (pending.isTouch) {
      m.clearCrosshair();
    } else {
      deferredMouseCrosshair = { pos: pending.pos, event: pending.event };
      if (!mousePanCrosshairHidden) {
        mousePanCrosshairHidden = true;
        m.clearCrosshair(false);
      }
    }
  };

  const flushPendingPlotPan = () => {
    if (plotPanFrame) cancelAnimationFrame(plotPanFrame);
    applyPendingPlotPan();
  };

  const queuePlotPan = (dx, dy, paneIndex, isTouch, pos, event) => {
    if (pendingPlotPan) {
      pendingPlotPan.dx += dx;
      pendingPlotPan.dy += dy;
      pendingPlotPan.pos = pos;
      pendingPlotPan.event = event;
    } else {
      pendingPlotPan = { dx, dy, paneIndex, isTouch, pos, event };
    }
    if (!plotPanFrame) plotPanFrame = requestAnimationFrame(applyPendingPlotPan);
  };

  listen("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && m.options.handleScale.pinch) {
      flushPendingPlotPan();
      clearTouchTrackingTimer();
      const pts = [...pointers.values()];
      pinch = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), barSpacing: m.timeScale.barSpacing };
      dragging = null;
      return;
    }
    const point = inputPoint(e);
    const zone = zoneAt(e, point);
    const pos = rectPos(e, point);
    m._stopKinetic();
    dragging = {
      zone,
      crosshairOnly: e.pointerType === "touch" && touchCrosshairPinned,
      crosshairWasPinnedAtStart: e.pointerType === "touch" && touchCrosshairPinned,
      crosshairOriginX: m.crosshair.x,
      crosshairOriginY: m.crosshair.y,
      crosshairPaneIndex: m.crosshair.paneIndex,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: performance.now(),
      vx: 0, // px per ms
      moved: false,
      paneIndex: m.paneIndexAtY(pos.y),
      startBarSpacing: m.timeScale.barSpacing,
    };
    if (e.pointerType === "touch" && zone === "plot" && !touchCrosshairPinned) {
      clearTouchTrackingTimer();
      touchTrackingTimer = setTimeout(() => {
        touchTrackingTimer = null;
        if (!dragging || dragging.zone !== "plot" || dragging.moved || pointers.size !== 1) return;
        const trackedPos = rectPos(e);
        m.updateCrosshair(trackedPos.x, trackedPos.y, e);
        touchCrosshairPinned = true;
        dragging.crosshairOnly = true;
        dragging.crosshairOriginX = trackedPos.x;
        dragging.crosshairOriginY = trackedPos.y;
        dragging.crosshairPaneIndex = m.paneIndexAtY(trackedPos.y);
      }, TOUCH_TRACKING_LONG_PRESS_MS);
    }
    try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
  });

  listen("pointermove", (e) => {
    if (e.pointerType === "mouse") touchCrosshairPinned = false;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinch.dist > 0) {
        m.timeScale.barSpacing = pinch.barSpacing * (dist / pinch.dist);
        m.timeScale.clampBarSpacing();
        m.invalidate();
        m.timeScale.notifyRangeChange();
      }
      return;
    }
    const point = inputPoint(e);
    updateAxisHoverCursor(e, point);
    const pos = rectPos(e, point);
    if (dragging) {
      const dx = e.clientX - dragging.lastX;
      const dy = e.clientY - dragging.lastY;
      const now = performance.now();
      const dt = Math.max(1, now - dragging.lastT);
      // exponential moving average of velocity (px/ms), time-based
      const alpha = 1 - Math.exp(-dt / 50);
      dragging.vx = (1 - alpha) * dragging.vx + alpha * (dx / dt);
      dragging.lastX = e.clientX;
      dragging.lastY = e.clientY;
      dragging.lastT = now;
      const gestureDistance = Math.abs(e.clientX - dragging.startX) + Math.abs(e.clientY - dragging.startY);
      if (gestureDistance >= TOUCH_TRACKING_CANCEL_DISTANCE && !dragging.crosshairOnly) {
        dragging.moved = true;
        clearTouchTrackingTimer();
      } else if (gestureDistance > 2 && dragging.crosshairOnly) {
        dragging.moved = true;
      }

      // Match Lightweight Charts: sub-threshold touch movement waits for the
      // long-press decision instead of accidentally panning or showing a cursor.
      if (e.pointerType === "touch" && !dragging.crosshairOnly && gestureDistance < TOUCH_TRACKING_CANCEL_DISTANCE) {
        return;
      }

      if (dragging.zone === "plot" && !dragging.crosshairOnly) {
        const isTouch = e.pointerType === "touch";
        // High-polling mice can emit far more pointer events than display
        // frames. Preserve the full 2D gesture distance, but fan out range
        // notifications and chart work at most once per animation frame.
        queuePlotPan(dx, dy, dragging.paneIndex, isTouch, pos, e);
      } else if (dragging.zone === "time") {
        // TV: dragging right stretches (zoom in), anchored at the right edge
        if (m.options.handleScale.axisPressedMouseMove?.time !== false && dx !== 0) {
          const total = e.clientX - dragging.startX;
          m.timeScale.barSpacing = dragging.startBarSpacing * Math.exp(total / 200);
          m.timeScale.clampBarSpacing();
          m.invalidate();
          m.timeScale.notifyRangeChange();
        }
      } else {
        if (m.options.handleScale.axisPressedMouseMove?.price !== false && dy !== 0) {
          const pane = m.panes[dragging.paneIndex];
          const scale = pane?.priceScales.get(dragging.zone);
          if (scale) scale.scaleAroundCenter(Math.exp(dy / 200));
        }
      }
    }
    if (dragging?.crosshairOnly) {
      const trackedPane = m.panes[dragging.crosshairPaneIndex];
      const tracked = trackingCrosshairPosition(
        { x: dragging.crosshairOriginX, y: dragging.crosshairOriginY },
        { x: dragging.startX, y: dragging.startY },
        { x: e.clientX, y: e.clientY },
        {
          minX: 0,
          maxX: Math.max(0, m.paneWidth() - 1),
          minY: trackedPane?.top ?? 0,
          maxY: trackedPane
            ? Math.max(trackedPane.top, trackedPane.top + trackedPane.height - 1)
            : Math.max(0, m.height - m.timeAxisHeight() - 1),
        },
      );
      m.updateCrosshair(tracked.x, tracked.y, e);
    } else if (dragging?.zone === "plot") {
      // Ordinary mouse plot pans hide the crosshair until release; touch pans
      // clear it in the queued frame.
    } else if (dragging || zoneAt(e, point) === "plot") m.updateCrosshair(pos.x, pos.y, e);
    else m.clearCrosshair();
  });

  const endPointer = (e) => {
    flushPendingPlotPan();
    if (deferredMouseCrosshair) {
      const { pos, event } = deferredMouseCrosshair;
      deferredMouseCrosshair = null;
      mousePanCrosshairHidden = false;
      m.updateCrosshair(pos.x, pos.y, event);
    }
    clearTouchTrackingTimer();
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (dragging) {
      const wasPlot = dragging.zone === "plot";
      const vx = dragging.vx;
      const isTouch = e.pointerType === "touch";
      const kinetic = m.options.kineticScroll;
      const kineticOn = isTouch ? kinetic.touch !== false : kinetic.mouse === true;
      if (wasPlot && !dragging.crosshairOnly && kineticOn && Math.abs(vx) > 0.15 && dragging.moved) m._startKinetic(vx);
      dragging = null;
    }
  };
  listen("pointerup", (e) => {
    const point = inputPoint(e);
    const pos = rectPos(e, point);
    const wasDrag = dragging && dragging.moved;
    const wasPlot = dragging?.zone === "plot";
    const wasCrosshairOnly = Boolean(dragging?.crosshairOnly);
    const crosshairWasPinnedAtStart = Boolean(dragging?.crosshairWasPinnedAtStart);
    endPointer(e);
    if (e.pointerType === "touch") {
      const pinnedReleaseAction = mobilePinnedCrosshairReleaseAction({
        wasCrosshairOnly,
        crosshairWasPinnedAtStart,
        wasDrag,
        wasPlot,
      });
      if (pinnedReleaseAction === "retain") {
        m.updateCrosshair(pos.x, pos.y, e);
        touchCrosshairPinned = true;
        return;
      }
      if (pinnedReleaseAction === "dismiss") {
        touchCrosshairPinned = false;
        m.clearCrosshair();
        return;
      }
      if (wasCrosshairOnly && wasPlot) {
        // Releasing tracking leaves the selected candle pinned.
        touchCrosshairPinned = true;
        return;
      }
      if (touchCrosshairPinned) {
        // The next ordinary tap dismisses the pinned crosshair.
        touchCrosshairPinned = false;
        m.clearCrosshair();
        return;
      }
      if (!wasDrag && wasPlot) {
        // Preserve chart/drawing click subscribers without leaving a crosshair
        // behind after an ordinary mobile tap.
        m.updateCrosshair(pos.x, pos.y, e);
        const param = m._crosshairParam(e);
        for (const fn of m._clickSubs) { try { fn(param); } catch (err) { console.error(err); } }
        m.clearCrosshair();
      }
      return;
    }
    if (!wasDrag && zoneAt(e, point) === "plot") {
      m.updateCrosshair(pos.x, pos.y, e);
      const param = m._crosshairParam(e);
      for (const fn of m._clickSubs) { try { fn(param); } catch (err) { console.error(err); } }
    }
  });
  listen("pointercancel", endPointer);
  listen("pointerleave", (e) => {
    m.invalidateInputRootRect?.();
    if (el.style) el.style.cursor = "";
    if (!dragging && !(e.pointerType === "touch" && touchCrosshairPinned)) m.clearCrosshair();
  });

  listen("dblclick", (e) => {
    const zone = zoneAt(e);
    const reset = m.options.handleScale.axisDoubleClickReset;
    if (zone === "time" && reset?.time !== false) m.timeScale.reset();
    else if ((zone === "left" || zone === "right") && reset?.price !== false) {
      const pos = rectPos(e);
      const pane = m.panes[m.paneIndexAtY(pos.y)];
      pane?.priceScales.get(zone)?.resetScale();
    }
    const param = m._crosshairParam(e);
    for (const fn of m._dblClickSubs) { try { fn(param); } catch (err) { console.error(err); } }
  });

  listen(
    "wheel",
    (e) => {
      const zone = zoneAt(e);
      if (zone !== "plot") return; // app installs its own axis-wheel handlers
      const scaleOn = m.options.handleScale.mouseWheel !== false;
      const scrollOn = m.options.handleScroll.mouseWheel !== false;
      if (!scaleOn && !scrollOn) return;
      e.preventDefault();
      let dy = e.deltaY;
      let dx = e.deltaX;
      if (e.deltaMode === 1) { dy *= 16; dx *= 16; }
      else if (e.deltaMode === 2) { dy *= m.height; dx *= m.width; }
      const pos = rectPos(e);
      if (Math.abs(dx) > Math.abs(dy)) {
        if (scrollOn) {
          m.timeScale.scrollBy(dx);
          // Trackpads pan without emitting pointermove. Re-map the stationary
          // cursor so its time label and hover state follow the new viewport.
          m.updateCrosshair(pos.x, pos.y, e);
        }
        return;
      }
      if (!scaleOn) return;
      // TV zoom speed: ×1.1 per wheel notch (deltaY 100), anchored at cursor
      const factor = Math.pow(WHEEL_ZOOM_BASE, -dy / 100);
      m.timeScale.zoomAt(pos.x, factor);
    },
    { passive: false },
  );

  return () => {
    if (disposed) return;
    disposed = true;
    clearTouchTrackingTimer();
    if (plotPanFrame) {
      cancelAnimationFrame(plotPanFrame);
      plotPanFrame = 0;
    }
    pendingPlotPan = null;
    deferredMouseCrosshair = null;
    dragging = null;
    pinch = null;
    pointers.clear();
    if (el.style) el.style.cursor = "";
    for (const { type, listener, options } of eventBindings) {
      el.removeEventListener(type, listener, options);
    }
    eventBindings.length = 0;
  };
}

/** time-based kinetic scroll — identical feel at any refresh rate */
export function startKinetic(m, vxPxPerMs) {
  stopKinetic(m);
  let v = vxPxPerMs;
  let last = performance.now();
  const TAU = 325; // ms decay constant (TV/iOS-like)
  const step = (now) => {
    const dt = Math.min(64, now - last);
    last = now;
    m.timeScale.scrollBy(-v * dt);
    v *= Math.exp(-dt / TAU);
    if (Math.abs(v) < 0.02) { m._kinetic = null; return; }
    m._kinetic = requestAnimationFrame(step);
  };
  m._kinetic = requestAnimationFrame(step);
}

export function stopKinetic(m) {
  if (m._kinetic) cancelAnimationFrame(m._kinetic);
  m._kinetic = null;
}
