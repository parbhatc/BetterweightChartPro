import { applyColorOpacity } from "../../../ui/color/picker.js";
import {
  ANCHORED_VWAP_DEFAULTS,
  BARS_PATTERN_DEFAULTS,
  GHOST_FEED_DEFAULTS,
  isForecastSeriesTool,
} from "../../tools/forecast/index.js";
import { setTvCheck } from "../dialog/utils.js";

/** @param {import("../../types.js").UserDrawing} drawing */
export function forecastSeriesDraftFromDrawing(drawing) {
  if (drawing.type === "bars-pattern") return { ...BARS_PATTERN_DEFAULTS, ...drawing };
  if (drawing.type === "ghost-feed") return { ...GHOST_FEED_DEFAULTS, ...drawing };
  if (drawing.type === "anchored-vwap") return { ...ANCHORED_VWAP_DEFAULTS, ...drawing };
  return {};
}

/** @param {HTMLElement} stylePanel */
function ensureForecastSeriesMarkup(stylePanel) {
  let host = stylePanel.querySelector("[data-forecast-series-host]");
  if (host instanceof HTMLElement) return host;
  host = document.createElement("div");
  host.dataset.forecastSeriesHost = "1";
  host.hidden = true;
  host.innerHTML = `
    <div data-bars-pattern-settings hidden>
      <div class="tv-set__section">
        <div class="tv-set__section-head">Data type</div>
        <div class="tv-set__section-body tv-set__section-body--fields">
          <select class="tv-drawing-settings__select" data-pattern-mode aria-label="Bars pattern data type">
            <option value="bars">Bars</option>
            <option value="candles">Candles</option>
          </select>
          <div class="tv-set__field-row">
            <span class="tv-set__field-label">Bars</span>
            <input type="text" class="tv-drawing-settings__input" data-pattern-count inputmode="numeric" />
          </div>
          <div class="tv-set__field-row">
            <span class="tv-set__field-label">Scale</span>
            <input type="text" class="tv-drawing-settings__input" data-pattern-scale inputmode="decimal" />
          </div>
        </div>
      </div>
      <div class="tv-set__section">
        <div class="tv-set__section-head">Colors</div>
        <div class="tv-set__section-body tv-drawing-settings__line-row">
          <button type="button" class="tv-drawing-settings__color-btn tv-drawing-settings__color-btn--compact" data-pattern-up-color aria-label="Bars pattern up color"><span class="tv-drawing-settings__color-swatch" data-pattern-up-swatch></span></button>
          <button type="button" class="tv-drawing-settings__color-btn tv-drawing-settings__color-btn--compact" data-pattern-down-color aria-label="Bars pattern down color"><span class="tv-drawing-settings__color-swatch" data-pattern-down-swatch></span></button>
        </div>
      </div>
      <div class="tv-set__section">
        <div class="tv-set__section-body">
          <div class="tv-set__check-row"><button type="button" class="tv-set__check" data-pattern-flipped role="checkbox" aria-label="Flip pattern"><span class="tv-set__check-box"></span></button><span class="tv-set__check-label">Flip</span></div>
          <div class="tv-set__check-row"><button type="button" class="tv-set__check" data-pattern-mirrored role="checkbox" aria-label="Mirror pattern"><span class="tv-set__check-box"></span></button><span class="tv-set__check-label">Mirror</span></div>
        </div>
      </div>
    </div>
    <div data-ghost-feed-settings hidden>
      <div class="tv-set__section">
        <div class="tv-set__section-head">Ghost feed</div>
        <div class="tv-set__section-body tv-set__section-body--fields">
          <div class="tv-set__field-row"><span class="tv-set__field-label">Bars</span><input type="text" class="tv-drawing-settings__input" data-ghost-count inputmode="numeric" /></div>
          <div class="tv-set__field-row"><span class="tv-set__field-label">Amplitude</span><input type="text" class="tv-drawing-settings__input" data-ghost-amplitude inputmode="decimal" /></div>
        </div>
      </div>
      <div class="tv-set__section">
        <div class="tv-set__section-head">Colors</div>
        <div class="tv-set__section-body tv-drawing-settings__line-row">
          <button type="button" class="tv-drawing-settings__color-btn tv-drawing-settings__color-btn--compact" data-ghost-up-color aria-label="Ghost feed up color"><span class="tv-drawing-settings__color-swatch" data-ghost-up-swatch></span></button>
          <button type="button" class="tv-drawing-settings__color-btn tv-drawing-settings__color-btn--compact" data-ghost-down-color aria-label="Ghost feed down color"><span class="tv-drawing-settings__color-swatch" data-ghost-down-swatch></span></button>
        </div>
      </div>
    </div>
    <div data-anchored-vwap-settings hidden>
      <div class="tv-set__section">
        <div class="tv-set__section-head">Bands</div>
        <div class="tv-set__section-body tv-set__section-body--fields">
          <div class="tv-set__check-row"><button type="button" class="tv-set__check" data-vwap-show-bands role="checkbox" aria-label="VWAP bands"><span class="tv-set__check-box"></span></button><span class="tv-set__check-label">Bands</span></div>
          <div class="tv-set__field-row"><span class="tv-set__field-label">Multiplier</span><input type="text" class="tv-drawing-settings__input" data-vwap-band-multiplier inputmode="decimal" /></div>
          <div class="tv-set__field-row"><span class="tv-set__field-label">Band color</span><button type="button" class="tv-drawing-settings__color-btn tv-drawing-settings__color-btn--compact" data-vwap-band-color aria-label="VWAP band color"><span class="tv-drawing-settings__color-swatch" data-vwap-band-swatch></span></button></div>
        </div>
      </div>
    </div>`;
  stylePanel.appendChild(host);
  return host;
}

/** @param {HTMLElement} root @param {Record<string, unknown>} draft */
export function syncForecastSeriesDialogUi(root, draft) {
  const stylePanel = root.querySelector('[data-panel="style"]');
  if (!(stylePanel instanceof HTMLElement)) return;
  const host = ensureForecastSeriesMarkup(stylePanel);
  const type = String(draft.drawingType ?? "");
  host.hidden = !isForecastSeriesTool(type);
  const bars = host.querySelector("[data-bars-pattern-settings]");
  const ghost = host.querySelector("[data-ghost-feed-settings]");
  const vwap = host.querySelector("[data-anchored-vwap-settings]");
  if (bars instanceof HTMLElement) bars.hidden = type !== "bars-pattern";
  if (ghost instanceof HTMLElement) ghost.hidden = type !== "ghost-feed";
  if (vwap instanceof HTMLElement) vwap.hidden = type !== "anchored-vwap";
  if (host.hidden) return;

  const setValue = (selector, value) => {
    const element = host.querySelector(selector);
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
      element.value = String(value ?? "");
    }
  };
  const setSwatch = (selector, color, opacity) => {
    const element = host.querySelector(selector);
    if (element instanceof HTMLElement) {
      element.style.backgroundColor = applyColorOpacity(String(color), Number(opacity));
    }
  };

  if (type === "bars-pattern") {
    setValue("[data-pattern-mode]", draft.patternMode ?? BARS_PATTERN_DEFAULTS.patternMode);
    setValue("[data-pattern-count]", draft.patternBarsCount ?? BARS_PATTERN_DEFAULTS.patternBarsCount);
    setValue("[data-pattern-scale]", draft.patternScale ?? BARS_PATTERN_DEFAULTS.patternScale);
    setSwatch("[data-pattern-up-swatch]", draft.patternUpColor ?? BARS_PATTERN_DEFAULTS.patternUpColor, draft.patternOpacity ?? BARS_PATTERN_DEFAULTS.patternOpacity);
    setSwatch("[data-pattern-down-swatch]", draft.patternDownColor ?? BARS_PATTERN_DEFAULTS.patternDownColor, draft.patternOpacity ?? BARS_PATTERN_DEFAULTS.patternOpacity);
    setTvCheck(host.querySelector("[data-pattern-flipped]"), Boolean(draft.patternFlipped));
    setTvCheck(host.querySelector("[data-pattern-mirrored]"), Boolean(draft.patternMirrored));
  } else if (type === "ghost-feed") {
    setValue("[data-ghost-count]", draft.ghostBarsCount ?? GHOST_FEED_DEFAULTS.ghostBarsCount);
    setValue("[data-ghost-amplitude]", draft.ghostAmplitude ?? GHOST_FEED_DEFAULTS.ghostAmplitude);
    setSwatch("[data-ghost-up-swatch]", draft.ghostUpColor ?? GHOST_FEED_DEFAULTS.ghostUpColor, draft.ghostOpacity ?? GHOST_FEED_DEFAULTS.ghostOpacity);
    setSwatch("[data-ghost-down-swatch]", draft.ghostDownColor ?? GHOST_FEED_DEFAULTS.ghostDownColor, draft.ghostOpacity ?? GHOST_FEED_DEFAULTS.ghostOpacity);
  } else {
    setValue("[data-vwap-band-multiplier]", draft.vwapBandMultiplier ?? ANCHORED_VWAP_DEFAULTS.vwapBandMultiplier);
    setSwatch("[data-vwap-band-swatch]", draft.vwapBandColor ?? ANCHORED_VWAP_DEFAULTS.vwapBandColor, draft.vwapBandOpacity ?? ANCHORED_VWAP_DEFAULTS.vwapBandOpacity);
    setTvCheck(host.querySelector("[data-vwap-show-bands]"), Boolean(draft.vwapShowBands));
  }
}

/** @param {HTMLElement} root @param {Record<string, unknown>} draft */
export function readForecastSeriesDraftFromUi(root, draft) {
  if (!isForecastSeriesTool(String(draft.drawingType ?? ""))) return {};
  return forecastSeriesDraftFromDrawing(
    /** @type {import("../../types.js").UserDrawing} */ ({
      ...draft,
      type: draft.drawingType,
    }),
  );
}

/**
 * @param {HTMLElement} root
 * @param {{ getDraft: () => Record<string, unknown>, patchDrawing: (patch: Record<string, unknown>) => void, colorPicker: ReturnType<typeof import("../../../ui/color/picker.js").createColorPicker> }} ctx
 */
export function wireForecastSeriesSettings(root, ctx) {
  root.addEventListener("change", (event) => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) return;
    const type = String(ctx.getDraft().drawingType ?? "");
    if (!isForecastSeriesTool(type)) return;
    if (element.matches("[data-pattern-mode]")) ctx.patchDrawing({ patternMode: element.value === "candles" ? "candles" : "bars" });
    else if (element.matches("[data-pattern-count]")) ctx.patchDrawing({ patternBarsCount: Math.max(2, Math.floor(Number(element.value) || 20)) });
    else if (element.matches("[data-pattern-scale]")) ctx.patchDrawing({ patternScale: Math.max(0.01, Number(element.value) || 1) });
    else if (element.matches("[data-ghost-count]")) ctx.patchDrawing({ ghostBarsCount: Math.max(4, Math.floor(Number(element.value) || 16)) });
    else if (element.matches("[data-ghost-amplitude]")) ctx.patchDrawing({ ghostAmplitude: Math.max(0, Number(element.value) || 0) });
    else if (element.matches("[data-vwap-band-multiplier]")) ctx.patchDrawing({ vwapBandMultiplier: Math.max(0, Number(element.value) || 0) });
  });

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const draft = ctx.getDraft();
    const type = String(draft.drawingType ?? "");
    if (!isForecastSeriesTool(type)) return;
    const toggle = target.closest("[data-pattern-flipped], [data-pattern-mirrored], [data-vwap-show-bands]");
    if (toggle instanceof HTMLButtonElement) {
      const next = !toggle.classList.contains("tv-set__check--on");
      setTvCheck(toggle, next);
      if (toggle.matches("[data-pattern-flipped]")) ctx.patchDrawing({ patternFlipped: next });
      else if (toggle.matches("[data-pattern-mirrored]")) ctx.patchDrawing({ patternMirrored: next });
      else ctx.patchDrawing({ vwapShowBands: next });
      return;
    }

    const colorTarget = target.closest("[data-pattern-up-color], [data-pattern-down-color], [data-ghost-up-color], [data-ghost-down-color], [data-vwap-band-color]");
    if (!(colorTarget instanceof HTMLElement)) return;
    let colorKey = "patternUpColor";
    let opacityKey = "patternOpacity";
    let fallbackColor = BARS_PATTERN_DEFAULTS.patternUpColor;
    let fallbackOpacity = BARS_PATTERN_DEFAULTS.patternOpacity;
    if (colorTarget.matches("[data-pattern-down-color]")) {
      colorKey = "patternDownColor";
      fallbackColor = BARS_PATTERN_DEFAULTS.patternDownColor;
    } else if (colorTarget.matches("[data-ghost-up-color]")) {
      colorKey = "ghostUpColor";
      opacityKey = "ghostOpacity";
      fallbackColor = GHOST_FEED_DEFAULTS.ghostUpColor;
      fallbackOpacity = GHOST_FEED_DEFAULTS.ghostOpacity;
    } else if (colorTarget.matches("[data-ghost-down-color]")) {
      colorKey = "ghostDownColor";
      opacityKey = "ghostOpacity";
      fallbackColor = GHOST_FEED_DEFAULTS.ghostDownColor;
      fallbackOpacity = GHOST_FEED_DEFAULTS.ghostOpacity;
    } else if (colorTarget.matches("[data-vwap-band-color]")) {
      colorKey = "vwapBandColor";
      opacityKey = "vwapBandOpacity";
      fallbackColor = ANCHORED_VWAP_DEFAULTS.vwapBandColor;
      fallbackOpacity = ANCHORED_VWAP_DEFAULTS.vwapBandOpacity;
    }
    ctx.colorPicker.openSwatch(
      colorTarget,
      {
        color: String(draft[colorKey] ?? fallbackColor),
        opacity: Number(draft[opacityKey] ?? fallbackOpacity),
      },
      {
        onChange: (value) => {
          ctx.patchDrawing({ [colorKey]: value.color, [opacityKey]: value.opacity });
          syncForecastSeriesDialogUi(root, ctx.getDraft());
        },
      },
    );
  });
}
