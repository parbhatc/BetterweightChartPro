const STORAGE_KEY = "bwc-chart-type-v1";

export const CHART_TYPES = [
  { id: "candles", label: "Candles", icon: `<svg viewBox="0 0 28 28" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M8 7h5v14H8z M10 3h1v4h-1z M10 21h1v4h-1z M17 8h4v10h-4z M18 5h1v3h-1z M18 18h1v5h-1z"/></svg>` },
  { id: "hollow-candles", label: "Hollow candles", icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M17 11v6h3v-6h-3zm-.5-1h4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5z"></path><path d="M18 7h1v3.5h-1zm0 10.5h1V21h-1z"></path><path d="M9 8v12h3V8H9zm-.5-1h4a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5z"></path><path d="M10 4h1v3.5h-1zm0 16.5h1V24h-1z"></path></svg>` },
  { id: "bars", label: "Bars", icon: `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" aria-hidden="true"><path d="M9.5 4v20M5 10h4.5m0 8H14m5-13v18m-4-12h4m0 7h4"/></svg>` },
  { id: "line", label: "Line", icon: `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 20 5-6 4 3 4-8 7 5"/></svg>` },
  { id: "area", label: "Area", icon: `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><defs><linearGradient id="bwcArea" x1="0" y1="0" x2="0" y2="1"><stop stop-color="currentColor" stop-opacity=".45"/><stop offset="1" stop-color="currentColor" stop-opacity=".05"/></linearGradient></defs><path fill="url(#bwcArea)" d="m4 20 5-6 4 3 4-8 7 5v10H4z"/><path fill="none" stroke="currentColor" stroke-width="1.5" d="m4 20 5-6 4 3 4-8 7 5"/></svg>` },
  { id: "baseline", label: "Baseline", icon: `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" aria-hidden="true"><path stroke="currentColor" stroke-opacity=".45" d="M4 14h20"/><path stroke="currentColor" stroke-width="1.5" d="m4 18 5-7 4 3 4-6 7 8"/><path fill="currentColor" fill-opacity=".18" d="m4 18 5-7 4 3 4-6 7 8v-2H4z"/></svg>` },
  { id: "heikin-ashi", label: "Heikin Ashi", icon: `<svg viewBox="0 0 28 28" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M8 8h5v11H8zM10 4h1v4h-1zm0 11h1v8h-1zm8 3h4v8h-4zM19 8h1v5h-1zm0 8h1v8h-1z" opacity=".92"/></svg>` },
];

export function loadChartType() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return CHART_TYPES.some((item) => item.id === value) ? value : "candles";
  } catch {
    return "candles";
  }
}

function saveChartType(value) {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* storage unavailable */ }
}

/** @param {HTMLElement} mountEl @param {{ apply: (type: string) => void, initial?: string }} opts */
export function mountChartTypePicker(mountEl, opts) {
  let value = CHART_TYPES.some((item) => item.id === opts.initial) ? opts.initial : loadChartType();
  let menu = null;
  const wrap = document.createElement("div");
  wrap.className = "tv-chart-type";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tv-chart-type__trigger";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  wrap.appendChild(button);
  mountEl.appendChild(wrap);

  function paint() {
    const active = CHART_TYPES.find((item) => item.id === value) ?? CHART_TYPES[0];
    button.innerHTML = `<span class="tv-chart-type__glyph" aria-hidden="true">${active.icon}</span>`;
    button.title = `Chart type: ${active.label}`;
    button.setAttribute("aria-label", button.title);
  }
  function close() {
    document.removeEventListener("pointerdown", onOutside, true);
    menu?.remove();
    menu = null;
    button.setAttribute("aria-expanded", "false");
  }
  function choose(next) {
    if (!CHART_TYPES.some((item) => item.id === next)) return false;
    value = next;
    saveChartType(value);
    opts.apply(value);
    paint();
    close();
    return true;
  }
  function open() {
    if (menu) return close();
    menu = document.createElement("div");
    menu.className = "tv-chart-type__menu";
    menu.setAttribute("role", "menu");
    for (const item of CHART_TYPES) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "tv-chart-type__item";
      row.setAttribute("role", "menuitemradio");
      row.setAttribute("aria-checked", String(item.id === value));
      row.innerHTML = `<span class="tv-chart-type__glyph" aria-hidden="true">${item.icon}</span><span>${item.label}</span><span class="tv-chart-type__check">${item.id === value ? "✓" : ""}</span>`;
      row.addEventListener("click", () => choose(item.id));
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    const rect = button.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
  }
  function onOutside(event) {
    if (!menu?.contains(event.target) && !wrap.contains(event.target)) close();
  }
  button.addEventListener("click", open);
  paint();
  opts.apply(value);
  return { getValue: () => value, setValue: choose, destroy: () => { close(); wrap.remove(); } };
}
