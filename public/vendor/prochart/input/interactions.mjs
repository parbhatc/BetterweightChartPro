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

export function bindEvents(m) {
  const el = m.root;
  let dragging = null;
  let pinch = null;
  const pointers = new Map();

  const rectPos = (e) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left - (m._leftW || 0), y: e.clientY - r.top };
  };

  const zoneAt = (e) => {
    const r = el.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const rightX = m.width - (m._rightW || 0);
    if (m.options.timeScale.visible && cy >= m.height - m.timeAxisHeight()) return "time";
    if ((m._rightW || 0) > 0 && cx >= rightX) return "right";
    if ((m._leftW || 0) > 0 && cx <= (m._leftW || 0)) return "left";
    return "plot";
  };

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && m.options.handleScale.pinch) {
      const pts = [...pointers.values()];
      pinch = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), barSpacing: m.timeScale.barSpacing };
      dragging = null;
      return;
    }
    const zone = zoneAt(e);
    const pos = rectPos(e);
    m._stopKinetic();
    dragging = {
      zone,
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
    try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
  });

  el.addEventListener("pointermove", (e) => {
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
    const pos = rectPos(e);
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
      if (Math.abs(e.clientX - dragging.startX) + Math.abs(e.clientY - dragging.startY) > 2) dragging.moved = true;

      if (dragging.zone === "plot") {
        const hs = m.options.handleScroll;
        const isTouch = e.pointerType === "touch";
        const horzOk = isTouch ? hs.horzTouchDrag !== false : hs.pressedMouseMove !== false;
        const vertOk = isTouch ? hs.vertTouchDrag !== false : hs.pressedMouseMove !== false;
        if (horzOk && dx !== 0) m.timeScale.scrollBy(-dx); // 1:1 px pan, TV-style
        if (vertOk && dy !== 0) {
          const pane = m.panes[dragging.paneIndex];
          if (pane) {
            for (const scale of pane.priceScales.values()) {
              if (!scale.options.autoScale) scale.panByPixels(-dy);
            }
          }
        }
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
    if (zoneAt(e) === "plot" || dragging) m.updateCrosshair(pos.x, pos.y, e);
    else m.clearCrosshair();
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (dragging) {
      const wasPlot = dragging.zone === "plot";
      const vx = dragging.vx;
      const isTouch = e.pointerType === "touch";
      const kinetic = m.options.kineticScroll;
      const kineticOn = isTouch ? kinetic.touch !== false : kinetic.mouse === true;
      if (wasPlot && kineticOn && Math.abs(vx) > 0.15 && dragging.moved) m._startKinetic(vx);
      dragging = null;
    }
  };
  el.addEventListener("pointerup", (e) => {
    const pos = rectPos(e);
    const wasDrag = dragging && dragging.moved;
    endPointer(e);
    if (!wasDrag && zoneAt(e) === "plot") {
      m.updateCrosshair(pos.x, pos.y, e);
      const param = m._crosshairParam(e);
      for (const fn of m._clickSubs) { try { fn(param); } catch (err) { console.error(err); } }
    }
  });
  el.addEventListener("pointercancel", endPointer);
  el.addEventListener("pointerleave", () => {
    if (!dragging) m.clearCrosshair();
  });

  el.addEventListener("dblclick", (e) => {
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

  el.addEventListener(
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
      if (Math.abs(dx) > Math.abs(dy)) {
        if (scrollOn) m.timeScale.scrollBy(dx);
        return;
      }
      if (!scaleOn) return;
      const pos = rectPos(e);
      // TV zoom speed: ×1.1 per wheel notch (deltaY 100), anchored at cursor
      const factor = Math.pow(WHEEL_ZOOM_BASE, -dy / 100);
      m.timeScale.zoomAt(pos.x, factor);
    },
    { passive: false },
  );
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
