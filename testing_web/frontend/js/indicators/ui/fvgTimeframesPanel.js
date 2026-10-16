import { CHECK_SVG, MENU_CHEVRON } from "/js/drawings/settings/dialog/utils.js";
import { ICON_CLOSE } from "/js/indicators/ui/icons.js";
import { normalizeResolutionId, resolutionDisplayTitle } from "/js/chart/resolutionFormat.js";
import { resolutionSec } from "/js/chart/resolutions.js";
import {
  DEFAULT_FVG_TIMEFRAMES,
  normalizeFvgTimeframes,
  resolveFvgTimeframeRows,
} from "./fvgTimeframeRows.js";

export {
  DEFAULT_FVG_TIMEFRAMES,
  normalizeFvgTimeframes,
  resolveFvgTimeframeRows,
} from "./fvgTimeframeRows.js";

const LEGACY_TF_ALIASES = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "10m": "10",
  "15m": "15",
  "30m": "30",
  "45m": "45",
  "1h": "60",
  "2h": "120",
  "3h": "180",
  "4h": "240",
  "1d": "D",
  "1w": "W",
};

/** @param {string} id */
export function coerceFvgResolutionId(id) {
  const s = String(id ?? "").trim();
  if (!s || s === "chart") return s;
  const alias = LEGACY_TF_ALIASES[s] ?? LEGACY_TF_ALIASES[s.toLowerCase()];
  return normalizeResolutionId(alias ?? s);
}

/** @param {string} id */
function resolutionSecForFvg(id) {
  if (!id || id === "chart") return null;
  return resolutionSec(coerceFvgResolutionId(id));
}

/**
 * @param {{ tfSec: number, tfId: string }} layer
 * @param {string | null | undefined} chartResolution
 * @param {number} chartSec
 */
function fvgLayerMatchesChartResolution(layer, chartResolution, chartSec) {
  if (layer.tfId === "chart") return false;
  const chartSecResolved = chartSec || resolutionSecForFvg(chartResolution ?? "") || 0;
  const layerSec = layer.tfSec || resolutionSecForFvg(layer.tfId) || 0;
  if (chartSecResolved > 0 && layerSec === chartSecResolved) return true;
  if (!chartResolution) return false;
  return coerceFvgResolutionId(layer.tfId) === coerceFvgResolutionId(chartResolution);
}

/**
 * @param {object} inputs
 * @param {number} chartSec
 * @returns {{ tfSec: number, tfId: string, label: string, unmitigatedOnly: boolean }[]}
 */
export function resolveFvgLayers(inputs, chartSec) {
  /** @type {{ tfSec: number, tfId: string, label: string, unmitigatedOnly: boolean }[]} */
  const layers = [];
  for (const row of resolveFvgTimeframeRows(inputs)) {
    if (!row.enabled) continue;
    const label = String(row.label ?? "").trim();
    if (!label) continue;
    const tfRaw = row.timeframe ?? "chart";
    const tfId = tfRaw === "chart" ? "chart" : coerceFvgResolutionId(tfRaw);
    const tfSec = tfId === "chart" ? chartSec : resolutionSec(tfId);
    if (!tfSec) continue;
    layers.push({
      tfSec,
      tfId,
      label,
      unmitigatedOnly: row.unmitigatedOnly === true,
    });
  }
  return layers;
}

/**
 * Each explicitly-enabled timeframe row renders its FVGs independently — the per-row enable
 * checkbox is authoritative. Toggling the chart row off must leave the 15m/1h rows intact
 * (and vice-versa). `hideLowerTf` therefore no longer collapses enabled rows to the highest
 * timeframe; a chart layer that exactly duplicates an explicit same-resolution row is still
 * removed by dedupeRedundantChartLayer.
 * @param {{ tfSec: number, tfId: string, label: string }[]} layers
 * @param {object} _inputs
 * @param {number} _chartSec
 */
export function applyHideLowerTfFilter(layers, _inputs, _chartSec) {
  return layers;
}

/**
 * When an explicit timeframe row matches the chart resolution, drop the generic "chart" row.
 * Works for any TF (1m, 15m, 1h, 4h, D, …) — chart + matching explicit row → explicit only.
 * @param {{ tfSec: number, tfId: string, label: string }[]} layers
 * @param {number} chartSec
 * @param {string | null | undefined} [chartResolution]
 */
export function dedupeRedundantChartLayer(layers, chartSec, chartResolution = null) {
  if (!layers.length) return layers;
  const hasExplicitChartTf = layers.some((l) =>
    fvgLayerMatchesChartResolution(l, chartResolution, chartSec),
  );
  if (!hasExplicitChartTf) return layers;
  return layers.filter((l) => l.tfId !== "chart");
}

/** @param {string} tfId @param {{ id: string, label: string }[]} options */
function timeframeOptionLabel(tfId, options) {
  const found = options.find((o) => o.id === tfId);
  if (found) return found.label;
  if (tfId === "chart") return "Chart";
  return resolutionDisplayTitle(tfId);
}

/**
 * @param {import("../types.js").FvgTimeframesInputDef} input
 * @param {object} draftInputs
 * @param {() => { id: string, label: string }[]} getTimeframeOptions
 */
export function renderFvgTimeframesPanel(input, draftInputs, getTimeframeOptions) {
  const disabled = input.disabled?.(draftInputs) ?? false;
  const options = getTimeframeOptions();
  const rows = resolveFvgTimeframeRows(draftInputs);
  const disabledClass = disabled ? " is-disabled" : "";
  const disabledAttr = disabled ? ' disabled aria-disabled="true" tabindex="-1"' : "";

  const rowHtml = rows
    .map((row) => {
      const tf = row.timeframe ?? "chart";
      const tfLabel = timeframeOptionLabel(tf, options);
      const on = row.enabled !== false;
      const unmitigatedOnly = row.unmitigatedOnly === true;
      return `<div class="tv-ind-settings__tf-rule-row" data-tf-rule-row>
      <div class="tv-ind-settings__tf-rule-enable">
        <button type="button" class="tv-set__check${on ? " tv-set__check--on" : ""}" data-tf-enabled role="checkbox" aria-checked="${on ? "true" : "false"}" aria-label="Enable"${disabledAttr}>
          <span class="tv-set__check-box">${on ? CHECK_SVG : ""}</span>
        </button>
      </div>
      <input type="text" class="tv-drawing-settings__input tv-ind-settings__tf-rule-label" data-tf-label placeholder="Label" value="${escapeAttr(row.label)}"${disabledAttr} />
      <button type="button" class="tv-drawing-settings__menu-btn tv-ind-settings__tf-rule-tf" data-tf-timeframe data-value="${escapeAttr(tf)}" aria-haspopup="listbox"${disabledAttr}>
        <span data-tf-timeframe-label>${escapeHtml(tfLabel)}</span>
        <span class="tv-set__select-chev">${MENU_CHEVRON}</span>
      </button>
      <div class="tv-ind-settings__tf-rule-unmitigated">
        <button type="button" class="tv-set__check${unmitigatedOnly ? " tv-set__check--on" : ""}" data-tf-unmitigated role="checkbox" aria-checked="${unmitigatedOnly ? "true" : "false"}" aria-label="Show only untouched FVGs" title="Hide this timeframe's FVG after price first touches it"${disabledAttr}>
          <span class="tv-set__check-box">${unmitigatedOnly ? CHECK_SVG : ""}</span>
        </button>
      </div>
      <button type="button" class="tv-ind-settings__tf-rule-remove" data-tf-remove aria-label="Remove timeframe"${disabledAttr}>${ICON_CLOSE}</button>
    </div>`;
    })
    .join("");

  return `<div class="tv-ind-settings__tf-rules tv-ind-settings__tf-rules--fvg${disabledClass}" data-tf-rules-root data-tf-rules-field="${input.id}">
    <div class="tv-ind-settings__tf-rules-head">
      ${input.title ? `<span class="tv-set__field-label">${input.title}</span>` : "<span></span>"}
      <button type="button" class="tv-ind-settings__tf-rule-add" data-tf-add${disabledAttr}>
        <span class="tv-ind-settings__tf-rule-add-icon" aria-hidden="true">+</span>
        Add timeframe
      </button>
    </div>
    <div class="tv-ind-settings__tf-rules-cols" aria-hidden="true">
      <span></span><span>Label</span><span>Timeframe</span><span>Untouched</span><span></span>
    </div>
    <div class="tv-ind-settings__tf-rules-list" data-tf-rules-list>
      ${rowHtml || `<div class="tv-ind-settings__tf-rules-empty">No timeframes — add one to show FVG layers.</div>`}
    </div>
  </div>`;
}

/** @param {HTMLElement} inputsPanel @param {string} fieldId */
export function readFvgTimeframesFromPanel(inputsPanel, fieldId) {
  const root = inputsPanel.querySelector(`[data-tf-rules-field="${fieldId}"]`);
  if (!root) return null;
  /** @type {Array<{ enabled: boolean, label: string, timeframe: string, unmitigatedOnly: boolean }>} */
  const rows = [];
  root.querySelectorAll("[data-tf-rule-row]").forEach((row) => {
    if (!(row instanceof HTMLElement)) return;
    const labelEl = row.querySelector("[data-tf-label]");
    const tfBtn = row.querySelector("[data-tf-timeframe]");
    const enabledBtn = row.querySelector("[data-tf-enabled]");
    const unmitigatedBtn = row.querySelector("[data-tf-unmitigated]");
    const label = labelEl instanceof HTMLInputElement ? labelEl.value.trim() : "";
    if (!label) return;
    const timeframe =
      tfBtn instanceof HTMLElement ? String(tfBtn.dataset.value ?? "chart") : "chart";
    const enabled =
      enabledBtn instanceof HTMLElement
        ? enabledBtn.classList.contains("tv-set__check--on")
        : true;
    const unmitigatedOnly =
      unmitigatedBtn instanceof HTMLElement
        ? unmitigatedBtn.classList.contains("tv-set__check--on")
        : false;
    rows.push({ enabled, label, timeframe, unmitigatedOnly });
  });
  return rows;
}

/** @param {HTMLElement} list @param {Partial<{ enabled: boolean, label: string, timeframe: string, unmitigatedOnly: boolean }>} [seed] @param {{ id: string, label: string }[]} [options] */
export function appendFvgTimeframeRow(list, seed = {}, options = []) {
  const empty = list.querySelector(".tv-ind-settings__tf-rules-empty");
  empty?.remove();
  const tf = seed.timeframe ?? "chart";
  const tfLabel = timeframeOptionLabel(tf, options);
  const on = seed.enabled !== false;
  const unmitigatedOnly = seed.unmitigatedOnly === true;
  const row = document.createElement("div");
  row.className = "tv-ind-settings__tf-rule-row";
  row.dataset.tfRuleRow = "";
  row.innerHTML = `
    <div class="tv-ind-settings__tf-rule-enable">
      <button type="button" class="tv-set__check${on ? " tv-set__check--on" : ""}" data-tf-enabled role="checkbox" aria-checked="${on ? "true" : "false"}" aria-label="Enable">
        <span class="tv-set__check-box">${on ? CHECK_SVG : ""}</span>
      </button>
    </div>
    <input type="text" class="tv-drawing-settings__input tv-ind-settings__tf-rule-label" data-tf-label placeholder="Label" value="${escapeAttr(seed.label ?? "")}" />
    <button type="button" class="tv-drawing-settings__menu-btn tv-ind-settings__tf-rule-tf" data-tf-timeframe data-value="${escapeAttr(tf)}" aria-haspopup="listbox">
      <span data-tf-timeframe-label>${escapeHtml(tfLabel)}</span>
      <span class="tv-set__select-chev">${MENU_CHEVRON}</span>
    </button>
    <div class="tv-ind-settings__tf-rule-unmitigated">
      <button type="button" class="tv-set__check${unmitigatedOnly ? " tv-set__check--on" : ""}" data-tf-unmitigated role="checkbox" aria-checked="${unmitigatedOnly ? "true" : "false"}" aria-label="Show only untouched FVGs" title="Hide this timeframe's FVG after price first touches it">
        <span class="tv-set__check-box">${unmitigatedOnly ? CHECK_SVG : ""}</span>
      </button>
    </div>
    <button type="button" class="tv-ind-settings__tf-rule-remove" data-tf-remove aria-label="Remove timeframe">${ICON_CLOSE}</button>`;
  list.appendChild(row);
  row.querySelector("[data-tf-label]")?.focus();
}

/** @param {string} s */
function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
