import { chartInteractionHost, isChartHostInteractive } from "../chart/hostInteraction.js";

/**
 * Suppress touch/pen long-press context menus. Desktop mouse right-click stays
 * available, including on hybrid touchscreen laptops.
 */

const TOUCH_CONTEXT_WINDOW_MS = 1400;

let installed = false;

function isChartTarget(target) {
  const host = chartInteractionHost(target);
  return Boolean(host?.matches?.(".tv-app") && isChartHostInteractive(host));
}

export function installLongPressContextMenu() {
  if (installed) return;
  installed = true;

  let lastTouchPointerAt = -Infinity;

  document.addEventListener(
    "pointerdown",
    (ev) => {
      if (!isChartTarget(ev.target)) return;
      if (ev.pointerType !== "touch" && ev.pointerType !== "pen") return;
      lastTouchPointerAt = performance.now();
    },
    true,
  );

  // Android may synthesize a trusted contextmenu after touch long-press. Drop
  // only events associated with a recent touch/pen so real mouse right-clicks
  // still work on convertible devices.
  document.addEventListener(
    "contextmenu",
    (ev) => {
      if (!isChartTarget(ev.target)) return;
      if (performance.now() - lastTouchPointerAt >= TOUCH_CONTEXT_WINDOW_MS) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    },
    true,
  );
}
