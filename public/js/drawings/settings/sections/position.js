import { createTvMenu } from "../menu/tv.js";
import { applyColorOpacity } from "../../../ui/color/picker.js";
import { MENU_CHEVRON, setTvCheck, syncLineStylePreview } from "../dialog/utils.js";
import { fmtDrawingPrice } from "../../tools/line/info.js";
import {
  POSITION_INPUT_DEFAULTS,
  POSITION_QTY_PRECISION_ITEMS,
  POSITION_RISK_UNIT_ITEMS,
  POSITION_STYLE_DEFAULTS,
  POSITION_STATS_FIELD_ITEMS,
  computePositionQty,
  isPositionTool,
  pointsFromPositionInputs,
  positionInputsDraftFromDrawing,
  positionStatsSummaryLabel,
  resolvePositionStatsFields,
} from "../../tools/position/barrel.js";

/** @param {HTMLElement} inputsPanel */
export function ensurePositionInputsMarkup(inputsPanel) {
  if (inputsPanel.dataset.positionReady === "1" && inputsPanel.dataset.lastInputsTool === "position") {
    return;
  }
  inputsPanel.dataset.positionReady = "1";
  inputsPanel.dataset.lastInputsTool = "position";
  delete inputsPanel.dataset.regressionReady;
  inputsPanel.innerHTML = `
    <div class="tv-set__section">
      <div class="tv-set__section-body tv-set__section-body--fields">
        <div class="tv-set__field-row">
          <span class="tv-set__field-label">Account size</span>
          <div class="tv-position-input-wrap">
            <input type="text" class="tv-drawing-settings__input" data-position-account-size inputmode="decimal" value="1000" />
            <span class="tv-position-input-unit">USD</span>
          </div>
        </div>
        <div class="tv-set__field-row">
          <span class="tv-set__field-label">Lot size</span>
          <input type="text" class="tv-drawing-settings__input" data-position-lot-size inputmode="decimal" value="1" />
        </div>
        <div class="tv-set__field-row">
          <span class="tv-set__field-label">Risk</span>
          <div class="tv-position-input-wrap tv-position-input-wrap--split">
            <input type="text" class="tv-drawing-settings__input" data-position-risk inputmode="decimal" value="25.00" />
            <button type="button" class="tv-drawing-settings__menu-btn tv-position-unit-btn" data-position-risk-unit-btn aria-haspopup="listbox">
              <span data-position-risk-unit-label>%</span>
              <span class="tv-set__select-chev">${MENU_CHEVRON}</span>
            </button>
          </div>
        </div>
        <div class="tv-set__field-row">
          <span class="tv-set__field-label">Entry price</span>
          <input type="text" class="tv-drawing-settings__input" data-position-entry-price inputmode="decimal" />
        </div>
        <div class="tv-set__field-row">
          <span class="tv-set__field-label">Leverage</span>
          <input type="text" class="tv-drawing-settings__input" data-position-leverage inputmode="decimal" value="10000.0" />
        </div>
      </div>
    </div>
    <div class="tv-set__section">
      <div class="tv-set__section-head">Profit level</div>
      <div class="tv-set__section-body tv-set__section-body--fields">
        <div class="tv-set__field-row">
          <span class="tv-set__field-label">Ticks</span>
          <input type="text" class="tv-drawing-settings__input" data-position-profit-ticks inputmode="numeric" />
        </div>
        <div class="tv-set__field-row">
          <span class="tv-set__field-label">Price</span>
          <input type="text" class="tv-drawing-settings__input" data-position-profit-price inputmode="decimal" />
        </div>
      </div>
    </div>
    <div class="tv-set__section">
      <div class="tv-set__section-head">Stop level</div>
      <div class="tv-set__section-body tv-set__section-body--fields">
        <div class="tv-set__field-row">
          <span class="tv-set__field-label">Ticks</span>
          <input type="text" class="tv-drawing-settings__input" data-position-stop-ticks inputmode="numeric" />
        </div>
        <div class="tv-set__field-row">
          <span class="tv-set__field-label">Price</span>
          <input type="text" class="tv-drawing-settings__input" data-position-stop-price inputmode="decimal" />
        </div>
      </div>
    </div>
    <div class="tv-set__section">
      <div class="tv-set__section-body tv-set__section-body--fields">
        <div class="tv-set__field-row">
          <span class="tv-set__field-label">QTY precision</span>
          <div class="tv-set__select-wrap">
            <button type="button" class="tv-drawing-settings__menu-btn" data-position-qty-precision-btn aria-haspopup="listbox">
              <span data-position-qty-precision-label>Default</span>
              <span class="tv-set__select-chev">${MENU_CHEVRON}</span>
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

/** @param {HTMLElement} root @param {Record<string, unknown>} draft @param {number} [precision] */
export function syncPositionInputsUi(root, draft, precision = 2) {
  const inputsPanel = root.querySelector('[data-panel="inputs"]');
  if (!(inputsPanel instanceof HTMLElement)) return;
  ensurePositionInputsMarkup(inputsPanel);

  const inputs = positionInputsDraftFromDrawing(
    /** @type {import("../../types.js").UserDrawing} */ (draft),
    precision,
  );

  const setVal = (sel, val) => {
    const el = inputsPanel.querySelector(sel);
    if (el instanceof HTMLInputElement) el.value = String(val ?? "");
  };

  setVal("[data-position-account-size]", inputs.positionAccountSize);
  setVal("[data-position-lot-size]", inputs.positionLotSize);
  setVal("[data-position-risk]", Number(inputs.positionRisk).toFixed(2));
  setVal("[data-position-entry-price]", fmtDrawingPrice(inputs.positionEntryPrice, precision));
  setVal("[data-position-leverage]", inputs.positionLeverage);
  setVal("[data-position-profit-ticks]", inputs.positionProfitTicks);
  setVal("[data-position-profit-price]", fmtDrawingPrice(inputs.positionProfitPrice, precision));
  setVal("[data-position-stop-ticks]", inputs.positionStopTicks);
  setVal("[data-position-stop-price]", fmtDrawingPrice(inputs.positionStopPrice, precision));

  const riskUnitLabel = inputsPanel.querySelector("[data-position-risk-unit-label]");
  const riskUnit = POSITION_RISK_UNIT_ITEMS.find((item) => item.id === inputs.positionRiskUnit);
  if (riskUnitLabel instanceof HTMLElement) {
    riskUnitLabel.textContent = riskUnit?.label ?? "%";
  }

  const qtyPrecisionLabel = inputsPanel.querySelector("[data-position-qty-precision-label]");
  const qtyPrecision = POSITION_QTY_PRECISION_ITEMS.find((item) => item.id === inputs.positionQtyPrecision);
  if (qtyPrecisionLabel instanceof HTMLElement) {
    qtyPrecisionLabel.textContent = qtyPrecision?.label ?? "Default";
  }
}

/** @param {HTMLElement} root @param {Record<string, unknown>} draft */
export function syncPositionDialogUi(root, draft) {
  const drawingType = String(draft.drawingType ?? "");
  const show = isPositionTool(drawingType);

  const inputsTab = root.querySelector('[data-tab="inputs"]');
  const textTab = root.querySelector('[data-tab="text"]');
  const coordsTab = root.querySelector('[data-tab="coordinates"]');
  if (inputsTab instanceof HTMLElement) inputsTab.hidden = !show;
  if (textTab instanceof HTMLElement) textTab.hidden = show;
  if (coordsTab instanceof HTMLElement) coordsTab.hidden = show;

  root.querySelectorAll("[data-position-section]").forEach((el) => {
    if (el instanceof HTMLElement) el.hidden = !show;
  });
  root.querySelectorAll("[data-trendline-section]").forEach((el) => {
    if (el instanceof HTMLElement && show) el.hidden = true;
  });
  root.querySelectorAll("[data-line-section]").forEach((el) => {
    if (el instanceof HTMLElement) el.hidden = show;
  });

  if (!show) return;

  syncPositionInputsUi(root, draft);

  const statsFields = resolvePositionStatsFields(/** @type {import("../../types.js").UserDrawing} */ (draft));
  const statsLabel = root.querySelector("[data-position-stats-label]");
  if (statsLabel instanceof HTMLElement) {
    statsLabel.textContent = positionStatsSummaryLabel(statsFields);
  }

  const priceLabelsBtn = root.querySelector("[data-position-price-labels-btn]");
  if (priceLabelsBtn instanceof HTMLButtonElement) {
    setTvCheck(priceLabelsBtn, draft.showPriceLabels !== false);
  }

  const alwaysShowBtn = root.querySelector("[data-position-always-show-stats-btn]");
  if (alwaysShowBtn instanceof HTMLButtonElement) {
    setTvCheck(alwaysShowBtn, Boolean(draft.alwaysShowStats));
  }

  const compactStatsBtn = root.querySelector("[data-position-compact-stats-btn]");
  if (compactStatsBtn instanceof HTMLButtonElement) {
    setTvCheck(compactStatsBtn, Boolean(draft.compactStatsMode));
  }

  syncLineStylePreview(root.querySelector("[data-position-line-preview]"), {
    color: String(draft.color ?? POSITION_STYLE_DEFAULTS.color),
    opacity: Number(draft.colorOpacity ?? POSITION_STYLE_DEFAULTS.colorOpacity),
    width: Number(draft.lineWidth ?? POSITION_STYLE_DEFAULTS.lineWidth),
    style: Number(draft.lineStyle ?? POSITION_STYLE_DEFAULTS.lineStyle),
  });

  const profitSwatch = root.querySelector("[data-position-profit-swatch]");
  if (profitSwatch instanceof HTMLElement) {
    profitSwatch.style.backgroundColor = applyColorOpacity(
      String(draft.profitColor ?? POSITION_STYLE_DEFAULTS.profitColor),
      Number(draft.profitOpacity ?? POSITION_STYLE_DEFAULTS.profitOpacity),
    );
  }

  const stopSwatch = root.querySelector("[data-position-stop-swatch]");
  if (stopSwatch instanceof HTMLElement) {
    stopSwatch.style.backgroundColor = applyColorOpacity(
      String(draft.stopColor ?? POSITION_STYLE_DEFAULTS.stopColor),
      Number(draft.stopOpacity ?? POSITION_STYLE_DEFAULTS.stopOpacity),
    );
  }

  const textSwatch = root.querySelector("[data-position-text-swatch]");
  if (textSwatch instanceof HTMLElement) {
    textSwatch.style.backgroundColor = applyColorOpacity(
      String(draft.textColor ?? POSITION_STYLE_DEFAULTS.textColor),
      Number(draft.textColorOpacity ?? POSITION_STYLE_DEFAULTS.textColorOpacity),
    );
  }

  const fontSizeEl = root.querySelector("[data-position-font-size]");
  if (fontSizeEl instanceof HTMLSelectElement) {
    fontSizeEl.value = String(draft.fontSize ?? 12);
  }
}

/** @param {HTMLElement} root */
function readPositionInputsFromUi(root) {
  const panel = root.querySelector('[data-panel="inputs"]');
  if (!(panel instanceof HTMLElement)) return {};

  const num = (sel) => {
    const el = panel.querySelector(sel);
    if (!(el instanceof HTMLInputElement)) return undefined;
    const v = Number(el.value);
    return Number.isFinite(v) ? v : undefined;
  };

  return {
    positionAccountSize: num("[data-position-account-size]"),
    positionLotSize: num("[data-position-lot-size]"),
    positionRisk: num("[data-position-risk]"),
    positionEntryPrice: num("[data-position-entry-price]"),
    positionLeverage: num("[data-position-leverage]"),
    positionProfitTicks: num("[data-position-profit-ticks]"),
    positionProfitPrice: num("[data-position-profit-price]"),
    positionStopTicks: num("[data-position-stop-ticks]"),
    positionStopPrice: num("[data-position-stop-price]"),
  };
}

/** @param {HTMLElement} root @param {Record<string, unknown>} draft @param {number} [precision] */
export function readPositionDraftFromUi(root, draft, precision = 2) {
  const drawingType = String(draft.drawingType ?? "");
  if (!isPositionTool(drawingType)) return {};

  const priceLabelsBtn = root.querySelector("[data-position-price-labels-btn]");
  const alwaysShowBtn = root.querySelector("[data-position-always-show-stats-btn]");
  const compactStatsBtn = root.querySelector("[data-position-compact-stats-btn]");
  const fontSizeEl = root.querySelector("[data-position-font-size]");
  const inputs = readPositionInputsFromUi(root);

  const merged = {
    ...draft,
    ...inputs,
    positionRiskUnit: draft.positionRiskUnit ?? POSITION_INPUT_DEFAULTS.positionRiskUnit,
    positionQtyPrecision: draft.positionQtyPrecision ?? POSITION_INPUT_DEFAULTS.positionQtyPrecision,
  };

  const rebuilt = pointsFromPositionInputs(
    /** @type {import("../../types.js").UserDrawing} */ ({ ...merged, type: drawingType, points: draft.points }),
    merged,
    precision,
  );

  const withPoints = {
    ...merged,
    points: rebuilt.points,
    positionEntryPrice: rebuilt.positionEntryPrice,
    type: drawingType,
  };
  const positionQty = computePositionQty(/** @type {import("../../types.js").UserDrawing} */ (withPoints));

  return {
    ...inputs,
    points: rebuilt.points,
    positionEntryPrice: rebuilt.positionEntryPrice,
    positionQty,
    positionRiskUnit: merged.positionRiskUnit,
    positionQtyPrecision: merged.positionQtyPrecision,
    showPriceLabels: priceLabelsBtn?.classList.contains("tv-set__check--on") ?? draft.showPriceLabels,
    alwaysShowStats: alwaysShowBtn?.classList.contains("tv-set__check--on") ?? draft.alwaysShowStats,
    compactStatsMode:
      compactStatsBtn?.classList.contains("tv-set__check--on") ?? draft.compactStatsMode,
    fontSize:
      fontSizeEl instanceof HTMLSelectElement ? Number(fontSizeEl.value) || 12 : draft.fontSize,
    statsFields: draft.statsFields,
    color: draft.color,
    colorOpacity: draft.colorOpacity,
    lineWidth: draft.lineWidth,
    lineStyle: draft.lineStyle,
    profitColor: draft.profitColor,
    profitOpacity: draft.profitOpacity,
    stopColor: draft.stopColor,
    stopOpacity: draft.stopOpacity,
    textColor: draft.textColor,
    textColorOpacity: draft.textColorOpacity,
  };
}

/** @param {import("../../types.js").UserDrawing} drawing @param {number} [precision] */
export function positionDraftFromDrawing(drawing, precision = 2) {
  if (!isPositionTool(drawing.type)) return {};
  return {
    ...positionInputsDraftFromDrawing(drawing, precision),
    showPriceLabels: drawing.showPriceLabels !== false,
    alwaysShowStats: Boolean(drawing.alwaysShowStats),
    compactStatsMode: Boolean(drawing.compactStatsMode),
    color: drawing.color ?? POSITION_STYLE_DEFAULTS.color,
    colorOpacity: drawing.colorOpacity ?? POSITION_STYLE_DEFAULTS.colorOpacity,
    lineWidth: drawing.lineWidth ?? POSITION_STYLE_DEFAULTS.lineWidth,
    lineStyle: drawing.lineStyle ?? POSITION_STYLE_DEFAULTS.lineStyle,
    profitColor: drawing.profitColor ?? POSITION_STYLE_DEFAULTS.profitColor,
    profitOpacity: drawing.profitOpacity ?? POSITION_STYLE_DEFAULTS.profitOpacity,
    stopColor: drawing.stopColor ?? POSITION_STYLE_DEFAULTS.stopColor,
    stopOpacity: drawing.stopOpacity ?? POSITION_STYLE_DEFAULTS.stopOpacity,
    textColor: drawing.textColor ?? POSITION_STYLE_DEFAULTS.textColor,
    textColorOpacity: drawing.textColorOpacity ?? POSITION_STYLE_DEFAULTS.textColorOpacity,
    fontSize: drawing.fontSize ?? 12,
    statsFields: resolvePositionStatsFields(drawing),
  };
}

/**
 * @param {HTMLElement} root
 * @param {{ getDraft: () => Record<string, unknown>, patchDrawing: (patch: Record<string, unknown>) => void, colorPicker: ReturnType<typeof import("../../../ui/color/picker.js").createColorPicker>, getPrecision?: () => number }} ctx
 */
export function wirePositionSettings(root, ctx) {
  const tvMenu = createTvMenu();

  function patchFromInputs(extra = {}) {
    const draft = ctx.getDraft();
    if (!isPositionTool(String(draft.drawingType ?? ""))) return;
    const precision = ctx.getPrecision?.() ?? 2;
    const inputs = readPositionInputsFromUi(root);
    const merged = { ...draft, ...inputs, ...extra };
    const rebuilt = pointsFromPositionInputs(
      /** @type {import("../../types.js").UserDrawing} */ ({
        ...merged,
        type: draft.drawingType,
        points: draft.points,
      }),
      merged,
      precision,
    );
    const next = { ...inputs, ...extra, points: rebuilt.points, positionEntryPrice: rebuilt.positionEntryPrice };
    const positionQty = computePositionQty(
      /** @type {import("../../types.js").UserDrawing} */ ({
        ...merged,
        ...next,
        type: draft.drawingType,
      }),
    );
    ctx.patchDrawing({ ...next, positionQty });
    syncPositionInputsUi(root, ctx.getDraft(), precision);
  }

  root.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (
      !t.matches(
        "[data-position-account-size], [data-position-lot-size], [data-position-risk], [data-position-entry-price], [data-position-leverage], [data-position-profit-ticks], [data-position-profit-price], [data-position-stop-ticks], [data-position-stop-price], [data-position-font-size]",
      )
    ) {
      return;
    }
    if (t.matches("[data-position-font-size]")) {
      ctx.patchDrawing({ fontSize: Number(t.value) || 12 });
      return;
    }
    patchFromInputs();
  });

  root.addEventListener("keydown", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement) || ev.key !== "Enter") return;
    if (
      !t.matches(
        "[data-position-account-size], [data-position-lot-size], [data-position-risk], [data-position-entry-price], [data-position-leverage], [data-position-profit-ticks], [data-position-profit-price], [data-position-stop-ticks], [data-position-stop-price]",
      )
    ) {
      return;
    }
    ev.preventDefault();
    patchFromInputs();
  });

  root.addEventListener("click", (ev) => {
    const riskUnitBtn = ev.target.closest("[data-position-risk-unit-btn]");
    if (riskUnitBtn instanceof HTMLElement) {
      const draft = ctx.getDraft();
      tvMenu.open(riskUnitBtn, POSITION_RISK_UNIT_ITEMS, {
        activeId: String(draft.positionRiskUnit ?? "percent"),
        onSelect: (id) => {
          ctx.patchDrawing({ positionRiskUnit: id });
          patchFromInputs({ positionRiskUnit: id });
        },
      });
      return;
    }

    const qtyPrecisionBtn = ev.target.closest("[data-position-qty-precision-btn]");
    if (qtyPrecisionBtn instanceof HTMLElement) {
      const draft = ctx.getDraft();
      tvMenu.open(qtyPrecisionBtn, POSITION_QTY_PRECISION_ITEMS, {
        activeId: String(draft.positionQtyPrecision ?? "default"),
        onSelect: (id) => {
          ctx.patchDrawing({ positionQtyPrecision: id });
          patchFromInputs({ positionQtyPrecision: id });
        },
      });
      return;
    }

    const statsBtn = ev.target.closest("[data-position-stats-btn]");
    if (statsBtn instanceof HTMLElement) {
      const draft = ctx.getDraft();
      const fields = resolvePositionStatsFields(/** @type {import("../../types.js").UserDrawing} */ (draft));
      tvMenu.openCheckboxMenu(
        statsBtn,
        POSITION_STATS_FIELD_ITEMS.map((item) => ({ id: item.id, label: item.label })),
        {
          checked: fields,
          onChange: (id, checked) => {
            const next = {
              ...resolvePositionStatsFields(
                /** @type {import("../../types.js").UserDrawing} */ (ctx.getDraft()),
              ),
            };
            next[id] = checked;
            ctx.patchDrawing({ statsFields: next });
            syncPositionDialogUi(root, ctx.getDraft());
          },
        },
      );
      return;
    }

    const priceLabelsBtn = ev.target.closest("[data-position-price-labels-btn]");
    if (priceLabelsBtn instanceof HTMLButtonElement) {
      setTvCheck(priceLabelsBtn, !priceLabelsBtn.classList.contains("tv-set__check--on"));
      ctx.patchDrawing({ showPriceLabels: priceLabelsBtn.classList.contains("tv-set__check--on") });
      return;
    }

    const alwaysShowBtn = ev.target.closest("[data-position-always-show-stats-btn]");
    if (alwaysShowBtn instanceof HTMLButtonElement) {
      setTvCheck(alwaysShowBtn, !alwaysShowBtn.classList.contains("tv-set__check--on"));
      ctx.patchDrawing({ alwaysShowStats: alwaysShowBtn.classList.contains("tv-set__check--on") });
      return;
    }

    const compactStatsBtn = ev.target.closest("[data-position-compact-stats-btn]");
    if (compactStatsBtn instanceof HTMLButtonElement) {
      setTvCheck(compactStatsBtn, !compactStatsBtn.classList.contains("tv-set__check--on"));
      ctx.patchDrawing({ compactStatsMode: compactStatsBtn.classList.contains("tv-set__check--on") });
      return;
    }

    const lineStyleBtn = ev.target.closest("[data-position-line-style]");
    if (lineStyleBtn instanceof HTMLElement) {
      const draft = ctx.getDraft();
      ctx.colorPicker.openLine(
        lineStyleBtn,
        {
          color: String(draft.color ?? POSITION_STYLE_DEFAULTS.color),
          opacity: Number(draft.colorOpacity ?? POSITION_STYLE_DEFAULTS.colorOpacity),
          width: Number(draft.lineWidth ?? POSITION_STYLE_DEFAULTS.lineWidth),
          style: Number(draft.lineStyle ?? POSITION_STYLE_DEFAULTS.lineStyle),
        },
        {
          showOpacity: true,
          showLineStyle: true,
          onChange: (value) => {
            ctx.patchDrawing({
              color: value.color,
              colorOpacity: value.opacity,
              lineWidth: value.width,
              lineStyle: value.style,
            });
            syncPositionDialogUi(root, ctx.getDraft());
          },
        },
      );
      return;
    }

    const profitColorBtn = ev.target.closest("[data-position-profit-color]");
    if (profitColorBtn instanceof HTMLElement) {
      const draft = ctx.getDraft();
      ctx.colorPicker.openSwatch(
        profitColorBtn,
        {
          color: String(draft.profitColor ?? POSITION_STYLE_DEFAULTS.profitColor),
          opacity: Number(draft.profitOpacity ?? POSITION_STYLE_DEFAULTS.profitOpacity),
        },
        {
          onChange: (value) => {
            ctx.patchDrawing({ profitColor: value.color, profitOpacity: value.opacity });
            syncPositionDialogUi(root, ctx.getDraft());
          },
        },
      );
      return;
    }

    const stopColorBtn = ev.target.closest("[data-position-stop-color]");
    if (stopColorBtn instanceof HTMLElement) {
      const draft = ctx.getDraft();
      ctx.colorPicker.openSwatch(
        stopColorBtn,
        {
          color: String(draft.stopColor ?? POSITION_STYLE_DEFAULTS.stopColor),
          opacity: Number(draft.stopOpacity ?? POSITION_STYLE_DEFAULTS.stopOpacity),
        },
        {
          onChange: (value) => {
            ctx.patchDrawing({ stopColor: value.color, stopOpacity: value.opacity });
            syncPositionDialogUi(root, ctx.getDraft());
          },
        },
      );
      return;
    }

    const textColorBtn = ev.target.closest("[data-position-text-color]");
    if (textColorBtn instanceof HTMLElement) {
      const draft = ctx.getDraft();
      ctx.colorPicker.openSwatch(
        textColorBtn,
        {
          color: String(draft.textColor ?? POSITION_STYLE_DEFAULTS.textColor),
          opacity: Number(draft.textColorOpacity ?? POSITION_STYLE_DEFAULTS.textColorOpacity),
        },
        {
          onChange: (value) => {
            ctx.patchDrawing({ textColor: value.color, textColorOpacity: value.opacity });
            syncPositionDialogUi(root, ctx.getDraft());
          },
        },
      );
    }
  });
}
