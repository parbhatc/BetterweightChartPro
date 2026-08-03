import { registerCustomSettingsClickHandler } from "/js/indicators/ui/customInputPanels.js";
import { appendFvgTimeframeRow } from "./ui/fvgTimeframesPanel.js";
import { applyColorOpacity } from "/js/ui/color/picker.js";
import { appendSizeRuleRow } from "./ui/symbolSizeRulesPanel.js";
import {
  appendSessionLevelRow,
  appendTimeLevelRow,
  SESSION_TIME_OPTIONS,
  sessionTimeOptionLabel,
  timeLevelOptions,
} from "./ui/levelsLayersPanel.js";

/** @param {Event} ev @param {object} ctx */
function handleTestingSettingsClick(ev, ctx) {
  const { target, readDraftFromUi, applyDraft, renderInputsPanel, timeframeOptions, openOptionsMenu, setTvCheck, inputsPanel, colorPicker, draft } =
    ctx;

  const sizeAdd = target.closest("[data-size-rule-add]");
  if (sizeAdd instanceof HTMLElement && !sizeAdd.hasAttribute("disabled")) {
    const list = sizeAdd.closest("[data-size-rules-root]")?.querySelector("[data-size-rules-list]");
    if (list instanceof HTMLElement) appendSizeRuleRow(list);
    readDraftFromUi();
    applyDraft();
    return true;
  }

  const sizeRemove = target.closest("[data-size-rule-remove]");
  if (sizeRemove instanceof HTMLElement && !sizeRemove.hasAttribute("disabled")) {
    sizeRemove.closest("[data-size-rule-row]")?.remove();
    readDraftFromUi();
    applyDraft();
    return true;
  }

  const boxColorPick = target.closest("[data-fvg-box-color-pick]");
  if (boxColorPick instanceof HTMLElement && boxColorPick.dataset.fvgBoxColorPick && !boxColorPick.hasAttribute("disabled")) {
    ev.preventDefault();
    ev.stopPropagation();
    const [tfKey, swatchKind] = boxColorPick.dataset.fvgBoxColorPick.split("|");
    const [side, role] = String(swatchKind ?? "").split("-");
    if (!tfKey || !["bull", "bear"].includes(side) || !["fill", "border"].includes(role)) return true;
    const stem = side === "bull" ? "bull" : "bear";
    const colorKey = role === "border" ? `${stem}BorderColor` : `${stem}Color`;
    const opacityKey = role === "border" ? `${stem}BorderOpacity` : `${stem}Opacity`;
    const globalColorKey = role === "border" ? `${stem}BorderColor` : `${stem}BoxColor`;
    const globalOpacityKey = role === "border" ? `${stem}BorderColorOpacity` : `${stem}BoxColorOpacity`;
    const stored = draft.inputs.fvgBoxColorsByTf?.[tfKey];
    const swatch = inputsPanel.querySelector(`[data-fvg-box-swatch="${tfKey}|${swatchKind}"]`);
    const currentColor = String(stored?.[colorKey] ?? draft.inputs[globalColorKey] ?? swatch?.dataset?.color ?? (side === "bull" ? "#6e7c65" : "#916966"));
    const currentOpacity = Number(stored?.[opacityKey] ?? draft.inputs[globalOpacityKey] ?? swatch?.dataset?.opacity ?? (role === "border" ? 0 : 20));
    colorPicker.openSwatch(boxColorPick, { color: currentColor, opacity: currentOpacity }, {
      onChange: ({ color, opacity }) => {
        if (!draft.inputs.fvgBoxColorsByTf || typeof draft.inputs.fvgBoxColorsByTf !== "object") draft.inputs.fvgBoxColorsByTf = {};
        draft.inputs.fvgBoxColorsByTf[tfKey] = {
          ...(draft.inputs.fvgBoxColorsByTf[tfKey] ?? {}),
          [colorKey]: color,
          [opacityKey]: opacity,
        };
        const changed = inputsPanel.querySelector(`[data-fvg-box-swatch="${tfKey}|${swatchKind}"]`);
        if (changed instanceof HTMLElement) {
          changed.dataset.color = color;
          changed.dataset.opacity = String(opacity);
          changed.style.background = applyColorOpacity(color, opacity);
        }
        applyDraft();
      },
    });
    return true;
  }

  const tfAdd = target.closest("[data-tf-add]");
  if (tfAdd instanceof HTMLElement && !tfAdd.hasAttribute("disabled")) {
    const rootEl = tfAdd.closest("[data-tf-rules-root]");
    const list = rootEl?.querySelector("[data-tf-rules-list]");
    if (list instanceof HTMLElement) {
      appendFvgTimeframeRow(list, { enabled: true, label: "FVG", timeframe: "chart" }, timeframeOptions());
      readDraftFromUi();
      applyDraft();
      renderInputsPanel();
    }
    return true;
  }

  const tfRemove = target.closest("[data-tf-remove]");
  if (tfRemove instanceof HTMLElement && !tfRemove.hasAttribute("disabled")) {
    const row = tfRemove.closest("[data-tf-rule-row]");
    const list = row?.parentElement;
    row?.remove();
    if (list instanceof HTMLElement && !list.querySelector("[data-tf-rule-row]")) {
      const empty = document.createElement("div");
      empty.className = "tv-ind-settings__tf-rules-empty";
      empty.textContent = "No timeframes — add one to show FVG layers.";
      list.appendChild(empty);
    }
    readDraftFromUi();
    applyDraft();
    renderInputsPanel();
    return true;
  }

  const tfEnabled = target.closest("[data-tf-enabled]");
  if (tfEnabled instanceof HTMLElement && !tfEnabled.hasAttribute("disabled")) {
    setTvCheck(tfEnabled, !tfEnabled.classList.contains("tv-set__check--on"));
    readDraftFromUi();
    applyDraft();
    renderInputsPanel();
    return true;
  }

  const fvgExtend = target.closest("[data-fvg-extend]");
  if (fvgExtend instanceof HTMLElement && !fvgExtend.hasAttribute("disabled")) {
    setTvCheck(fvgExtend, !fvgExtend.classList.contains("tv-set__check--on"));
    readDraftFromUi();
    applyDraft();
    return true;
  }

  const tfPick = target.closest("[data-tf-timeframe]");
  if (tfPick instanceof HTMLElement && !tfPick.hasAttribute("disabled")) {
    const current = tfPick.dataset.value ?? "chart";
    openOptionsMenu(tfPick, timeframeOptions(), current, (val) => {
      tfPick.dataset.value = val;
      const label = timeframeOptions().find((o) => o.id === val)?.label ?? val;
      const labelEl = tfPick.querySelector("[data-tf-timeframe-label]");
      if (labelEl) labelEl.textContent = label;
      readDraftFromUi();
      applyDraft();
      renderInputsPanel();
    });
    return true;
  }

  const levelAdd = target.closest("[data-time-level-add]");
  if (levelAdd instanceof HTMLElement && !levelAdd.hasAttribute("disabled")) {
    const rootEl = levelAdd.closest("[data-time-levels-root]");
    const list = rootEl?.querySelector("[data-time-levels-list]");
    if (list instanceof HTMLElement) {
      const opts = timeLevelOptions(timeframeOptions());
      appendTimeLevelRow(list, { enabled: true, label: "4H", layer: "240" }, opts);
      readDraftFromUi();
      applyDraft();
    }
    return true;
  }

  const levelRemove = target.closest("[data-time-level-remove]");
  if (levelRemove instanceof HTMLElement && !levelRemove.hasAttribute("disabled")) {
    const row = levelRemove.closest("[data-time-level-row]");
    const list = row?.parentElement;
    row?.remove();
    if (list instanceof HTMLElement && !list.querySelector("[data-time-level-row]")) {
      const empty = document.createElement("div");
      empty.className = "tv-ind-settings__tf-rules-empty";
      empty.textContent = "No time levels configured.";
      list.appendChild(empty);
    }
    readDraftFromUi();
    applyDraft();
    renderInputsPanel();
    return true;
  }

  const levelEnabled = target.closest("[data-time-level-enabled]");
  if (levelEnabled instanceof HTMLElement && !levelEnabled.hasAttribute("disabled")) {
    setTvCheck(levelEnabled, !levelEnabled.classList.contains("tv-set__check--on"));
    readDraftFromUi();
    applyDraft();
    renderInputsPanel();
    return true;
  }

  const levelPick = target.closest("[data-time-level-tf]");
  if (levelPick instanceof HTMLElement && !levelPick.hasAttribute("disabled")) {
    const current = levelPick.dataset.value ?? "240";
    const opts = timeLevelOptions(timeframeOptions());
    openOptionsMenu(levelPick, opts, current, (val) => {
      levelPick.dataset.value = val;
      const label = opts.find((o) => o.id === val)?.label ?? val;
      const labelEl = levelPick.querySelector("[data-time-level-tf-label]");
      if (labelEl) labelEl.textContent = label;
      readDraftFromUi();
      applyDraft();
      renderInputsPanel();
    });
    return true;
  }

  const sessionAdd = target.closest("[data-session-add]");
  if (sessionAdd instanceof HTMLElement && !sessionAdd.hasAttribute("disabled")) {
    const rootEl = sessionAdd.closest("[data-session-levels-root]");
    const list = rootEl?.querySelector("[data-session-levels-list]");
    if (list instanceof HTMLElement) {
      appendSessionLevelRow(list, { enabled: true, label: "", startTime: "09:30", endTime: "11:00" });
      readDraftFromUi();
      applyDraft();
    }
    return true;
  }

  const sessionRemove = target.closest("[data-session-remove]");
  if (sessionRemove instanceof HTMLElement && !sessionRemove.hasAttribute("disabled")) {
    const row = sessionRemove.closest("[data-session-level-row]");
    const list = row?.parentElement;
    row?.remove();
    if (list instanceof HTMLElement && !list.querySelector("[data-session-level-row]")) {
      const empty = document.createElement("div");
      empty.className = "tv-ind-settings__tf-rules-empty";
      empty.textContent = "No sessions configured.";
      list.appendChild(empty);
    }
    readDraftFromUi();
    applyDraft();
    renderInputsPanel();
    return true;
  }

  const sessionEnabled = target.closest("[data-session-enabled]");
  if (sessionEnabled instanceof HTMLElement && !sessionEnabled.hasAttribute("disabled")) {
    setTvCheck(sessionEnabled, !sessionEnabled.classList.contains("tv-set__check--on"));
    readDraftFromUi();
    applyDraft();
    renderInputsPanel();
    return true;
  }

  const sessionStartPick = target.closest("[data-session-start]");
  if (sessionStartPick instanceof HTMLElement && !sessionStartPick.hasAttribute("disabled")) {
    const current = sessionStartPick.dataset.value ?? "20:00";
    openOptionsMenu(sessionStartPick, SESSION_TIME_OPTIONS, current, (val) => {
      sessionStartPick.dataset.value = val;
      const labelEl = sessionStartPick.querySelector("[data-session-start-label]");
      if (labelEl) labelEl.textContent = sessionTimeOptionLabel(val);
      readDraftFromUi();
      applyDraft();
      renderInputsPanel();
    });
    return true;
  }

  const sessionEndPick = target.closest("[data-session-end]");
  if (sessionEndPick instanceof HTMLElement && !sessionEndPick.hasAttribute("disabled")) {
    const current = sessionEndPick.dataset.value ?? "00:00";
    openOptionsMenu(sessionEndPick, SESSION_TIME_OPTIONS, current, (val) => {
      sessionEndPick.dataset.value = val;
      const labelEl = sessionEndPick.querySelector("[data-session-end-label]");
      if (labelEl) labelEl.textContent = sessionTimeOptionLabel(val);
      readDraftFromUi();
      applyDraft();
      renderInputsPanel();
    });
    return true;
  }

  return false;
}

export function registerTestingSettingsHandlers() {
  registerCustomSettingsClickHandler(handleTestingSettingsClick);
}
