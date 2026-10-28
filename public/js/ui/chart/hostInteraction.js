// A host may retain a mounted chart while showing another route. Only that
// chart's shortcuts and body-mounted controls should become inactive.
const portalOwners = new WeakMap();
const hosts = new Map();
let nextHostId = 0;

export function chartInteractionHost(element) {
  for (let node = element; node; node = node.parentElement) {
    if (portalOwners.has(node)) return portalOwners.get(node);
    if (node.matches?.(".tv-app")) return node;
  }
  return element;
}

export function isChartHostInteractive(element) {
  let node = chartInteractionHost(element);
  if (!node || node.isConnected === false) return false;
  while (node) {
    if (node.hidden || node.hasAttribute?.("hidden") || node.inert || node.hasAttribute?.("inert") || node.getAttribute?.("aria-hidden") === "true") return false;
    node = node.parentElement;
  }
  return true;
}

function ensureHost(element) {
  const host = chartInteractionHost(element);
  if (!host) return null;
  if (hosts.has(host)) return hosts.get(host);
  const id = `bwc-chart-host-${++nextHostId}`;
  host.setAttribute("data-bwc-chart-host", id);
  const record = { host, id, portals: new Map(), active: isChartHostInteractive(host), observer: null };
  function sync() {
    const active = isChartHostInteractive(host);
    const suspended = record.active && !active;
    record.active = active;
    for (const [portal, close] of record.portals) {
      if (suspended) close?.();
      portal.toggleAttribute("data-bwc-host-inactive", !active);
    }
  }
  if (typeof MutationObserver !== "undefined") {
    record.observer = new MutationObserver(sync);
    for (let node = host; node; node = node.parentElement) {
      record.observer.observe(node, { attributes: true, attributeFilter: ["hidden", "inert", "aria-hidden"] });
    }
  }
  hosts.set(host, record);
  return record;
}

/** Associate a body portal with its chart or with an already-owned anchor. */
export function bindChartPortal(portal, owner, onSuspend) {
  let anchor = owner;
  while (anchor && !portalOwners.has(anchor) && !anchor.matches?.(".tv-app")) anchor = anchor.parentElement;
  const record = ensureHost(anchor ?? owner);
  if (!record) return;
  for (const existing of record.portals.keys()) {
    if (existing.isConnected === false) record.portals.delete(existing);
  }
  const previous = portalOwners.get(portal);
  if (previous && previous !== record.host) hosts.get(previous)?.portals.delete(portal);
  portalOwners.set(portal, record.host);
  record.portals.set(portal, onSuspend);
  portal.setAttribute("data-bwc-portal-owned", record.id);
  portal.toggleAttribute("data-bwc-host-inactive", !record.active);
  const doc = portal.ownerDocument;
  if (doc && !doc.getElementById("bwc-host-interaction-style")) {
    const style = doc.createElement("style");
    style.id = "bwc-host-interaction-style";
    style.textContent = "[data-bwc-host-inactive]{display:none!important}";
    doc.head.appendChild(style);
  }
}

export function releaseChartHostInteractions(element) {
  const host = chartInteractionHost(element);
  const record = hosts.get(host);
  if (!record) return;
  record.observer?.disconnect();
  for (const [portal, close] of record.portals) {
    close?.();
    portal.remove();
    portalOwners.delete(portal);
  }
  host.removeAttribute("data-bwc-chart-host");
  hosts.delete(host);
}
