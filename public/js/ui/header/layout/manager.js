import { clampLayoutIdForViewport, DEFAULT_LAYOUT_ID, getLayoutDef, onMobileLayoutViewportChange } from "./definitions.js";
import { chartDebug } from "../../../debug/chart/index.js";

const STORAGE_KEY = "tv-chart-layout-state";

/** @typedef {{ symbol: boolean, interval: boolean, crosshair: boolean, time: boolean, dateRange: boolean, drawings: boolean, indicators: boolean }} SyncSettings */

/** @typedef {{ name: string, layoutId: string, sync: SyncSettings, columnWidths?: Record<string, number[]>, rowHeights?: Record<string, number[]>, drawings?: Record<string, object[]>, indicators?: Record<string, object[]>, chartSettings?: object, toolDefaults?: Record<string, Record<string, unknown>>, drawingTemplates?: import("../../../drawings/toolbars/defaults/layoutTemplates.js").LayoutDrawingTemplates, viewports?: Record<string, object>, createdAt?: number, updatedAt?: number, lastUsedAt?: number }} SavedLayout */

/** @typedef {{ chart: import("prochart").IChartApi, series: import("prochart").ISeriesApi, wrapEl: HTMLElement, chartEl: HTMLElement, destroy: () => void, symbol: string, resolution: string, symbolInfo: object | null, bars: object[] }} SecondaryPane */

/**
 * @param {object} opts
 * @param {HTMLElement} opts.stageEl
 * @param {HTMLElement} opts.primaryWrapEl
 * @param {(index: number) => SecondaryPane} opts.createSecondaryPane
 * @param {(pane: SecondaryPane) => void} opts.destroySecondaryPane
 * @param {(layoutId: string) => void} [opts.onLayoutChange]
 * @param {(index: number) => void} [opts.onActivePaneChange]
 * @param {() => void} [opts.onPaneResize]
 */
export function createLayoutManager(opts) {
  const { stageEl, primaryWrapEl, createSecondaryPane, destroySecondaryPane, onLayoutChange, onActivePaneChange, onPaneResize } = opts;

  const gridEl = document.createElement("div");
  gridEl.className = "tv-layout-grid";
  stageEl.classList.add("tv-stage--with-bottom-bar");
  stageEl.insertBefore(gridEl, primaryWrapEl);
  gridEl.appendChild(primaryWrapEl);

  const replayBar = primaryWrapEl.querySelector(".tv-chart-replay-bar");
  const bottomPaneSlot = primaryWrapEl.querySelector(".tv-bottom-pane-slot");
  const bottomBar = primaryWrapEl.querySelector(".tv-chart-bottom-bar");
  if (replayBar) {
    stageEl.appendChild(replayBar);
  }
  if (bottomPaneSlot) {
    stageEl.appendChild(bottomPaneSlot);
  }
  if (bottomBar) {
    stageEl.appendChild(bottomBar);
  }

  /** @type {SecondaryPane[]} */
  let secondaryPanes = [];
  let layoutId = DEFAULT_LAYOUT_ID;
  let activePaneIndex = 0;
  /** @type {SyncSettings} */
  let sync = {
    symbol: false,
    interval: false,
    crosshair: true,
    time: false,
    dateRange: true,
    drawings: false,
    indicators: false,
  };
  let layoutName = "Unnamed";
  let dirty = false;
  let autoSave = false;
  /** @type {Record<string, object[]> | null} */
  let drawingsSnapshot = null;
  /** @type {Record<string, object[]> | null} */
  let indicatorsSnapshot = null;
  /** @type {object | null} */
  let chartSettingsSnapshot = null;
  /** @type {Record<string, Record<string, unknown>> | null} */
  let toolDefaultsSnapshot = null;
  /** @type {import("../../../drawings/toolbars/defaults/layoutTemplates.js").LayoutDrawingTemplates | null} */
  let drawingTemplatesSnapshot = null;
  /** @type {Record<string, object> | null} */
  let viewportsSnapshot = null;
  /** @type {Record<string, number[]>} */
  let columnWidths = {};
  /** @type {Record<string, number[]>} */
  let rowHeights = {};
  /** @type {HTMLElement[]} */
  let resizeHandles = [];
  let activeResize = null;

  function columnCount(def) {
    return def.cols.split(/\s+/).length;
  }

  function rowCount(def) {
    return def.rows.split(/\s+/).length;
  }

  function fractionsFor(def, axis) {
    const count = axis === "column" ? columnCount(def) : rowCount(def);
    const saved = (axis === "column" ? columnWidths : rowHeights)[def.id];
    if (!Array.isArray(saved) || saved.length !== count ||
      !saved.every((value) => Number.isFinite(value) && value > 0)) {
      return Array(count).fill(1 / count);
    }
    const total = saved.reduce((sum, value) => sum + value, 0);
    return saved.map((value) => value / total);
  }

  function applyColumnWidths(def) {
    gridEl.style.gridTemplateColumns = fractionsFor(def, "column").map((width) => `minmax(0, ${width}fr)`).join(" ");
    positionResizeHandles();
  }

  function applyRowHeights(def) {
    gridEl.style.gridTemplateRows = fractionsFor(def, "row").map((height) => `minmax(0, ${height}fr)`).join(" ");
    positionResizeHandles();
  }

  function positionResizeHandles() {
    const def = getLayoutDef(layoutId);
    const gap = 1;
    const widths = fractionsFor(def, "column");
    const heights = fractionsFor(def, "row");
    const trackWidth = Math.max(0, gridEl.clientWidth - gap * (widths.length - 1));
    const trackHeight = Math.max(0, gridEl.clientHeight - gap * (heights.length - 1));
    for (const handle of resizeHandles) {
      const boundary = Number(handle.dataset.boundary);
      const axis = handle.dataset.axis;
      const fractions = axis === "column" ? widths : heights;
      const used = fractions.slice(0, boundary).reduce((sum, value) => sum + value, 0);
      handle.setAttribute("aria-valuenow", String(Math.round(used * 100)));
      handle.style[axis === "column" ? "left" : "top"] =
        `${used * (axis === "column" ? trackWidth : trackHeight) + gap * (boundary - 0.5)}px`;
      const segment = Number(handle.dataset.segment);
      const crossFractions = axis === "column" ? heights : widths;
      const crossTrack = axis === "column" ? trackHeight : trackWidth;
      const crossStart = crossFractions.slice(0, segment).reduce((sum, value) => sum + value, 0);
      handle.style[axis === "column" ? "top" : "left"] =
        `${crossStart * crossTrack + gap * segment}px`;
      handle.style[axis === "column" ? "height" : "width"] =
        `${crossFractions[segment] * crossTrack}px`;
    }
  }

  function stopResize() {
    if (!activeResize) return;
    document.removeEventListener("pointermove", moveResize);
    document.removeEventListener("pointerup", stopResize);
    document.removeEventListener("pointercancel", stopResize);
    document.body.classList.remove("tv-layout-resizing-columns", "tv-layout-resizing-rows");
    activeResize = null;
    dirty = true;
    persist();
    onPaneResize?.();
  }

  function resizeBoundary(axis, boundary, pointerPosition) {
    const def = getLayoutDef(layoutId);
    const fractions = [...fractionsFor(def, axis)];
    const count = fractions.length;
    const available = (axis === "column" ? gridEl.clientWidth : gridEl.clientHeight) - (count - 1);
    if (available <= 0) return;
    const before = fractions.slice(0, boundary - 1).reduce((sum, value) => sum + value, 0);
    const pair = fractions[boundary - 1] + fractions[boundary];
    const min = Math.min((axis === "column" ? 120 : 80) / available, 0.4 * pair);
    const rect = gridEl.getBoundingClientRect();
    const origin = axis === "column" ? rect.left : rect.top;
    const target = (pointerPosition - origin - (boundary - 0.5)) / available - before;
    fractions[boundary - 1] = Math.max(min, Math.min(pair - min, target));
    fractions[boundary] = pair - fractions[boundary - 1];
    if (axis === "column") {
      columnWidths[layoutId] = fractions;
      applyColumnWidths(def);
    } else {
      rowHeights[layoutId] = fractions;
      applyRowHeights(def);
    }
  }

  function moveResize(event) {
    if (activeResize) resizeBoundary(activeResize.axis, activeResize.boundary,
      activeResize.axis === "column" ? event.clientX : event.clientY);
  }

  function createResizeHandles(def) {
    for (const handle of resizeHandles) handle.remove();
    resizeHandles = [];
    const cols = columnCount(def);
    const rows = rowCount(def);
    if (cols < 2 && rows < 2) return;
    const cells = Array.from({ length: rows }, () => Array(cols).fill(-1));
    def.placements.forEach((placement, index) => {
      const [col, colSpan = 1] = placement.gridColumn.split(" / span ").map(Number);
      const [row, rowSpan = 1] = placement.gridRow.split(" / span ").map(Number);
      for (let y = row - 1; y < row - 1 + rowSpan; y++) {
        for (let x = col - 1; x < col - 1 + colSpan; x++) {
          if (cells[y]?.[x] !== undefined) cells[y][x] = index;
        }
      }
    });
    for (const axis of ["column", "row"]) {
      const boundaries = axis === "column" ? cols : rows;
      const segments = axis === "column" ? rows : cols;
      for (let boundary = 1; boundary < boundaries; boundary++) {
        for (let segment = 0; segment < segments; segment++) {
          const before = axis === "column" ? cells[segment][boundary - 1] : cells[boundary - 1][segment];
          const after = axis === "column" ? cells[segment][boundary] : cells[boundary][segment];
          if (before < 0 || after < 0 || before === after) continue;
          const handle = document.createElement("div");
          handle.className = `tv-layout-${axis}-resizer`;
          handle.dataset.axis = axis;
          handle.dataset.boundary = String(boundary);
          handle.dataset.segment = String(segment);
          handle.setAttribute("role", "separator");
          handle.setAttribute("aria-orientation", axis === "column" ? "vertical" : "horizontal");
          handle.setAttribute("aria-label", `Resize chart ${axis === "column" ? "columns" : "rows"} ${boundary} and ${boundary + 1}`);
          handle.setAttribute("tabindex", "0");
          handle.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || activeResize) return;
            event.preventDefault();
            activeResize = { axis, boundary };
            document.body.classList.add(axis === "column" ? "tv-layout-resizing-columns" : "tv-layout-resizing-rows");
            document.addEventListener("pointermove", moveResize);
            document.addEventListener("pointerup", stopResize);
            document.addEventListener("pointercancel", stopResize);
          });
          handle.addEventListener("keydown", (event) => {
            const negative = axis === "column" ? "ArrowLeft" : "ArrowUp";
            const positive = axis === "column" ? "ArrowRight" : "ArrowDown";
            if (event.key !== negative && event.key !== positive) return;
            event.preventDefault();
            const step = event.shiftKey ? 40 : 10;
            const rect = handle.getBoundingClientRect();
            resizeBoundary(axis, boundary, (axis === "column" ? rect.left : rect.top) + 5 + (event.key === positive ? step : -step));
            dirty = true;
            persist();
            onPaneResize?.();
          });
          gridEl.appendChild(handle);
          resizeHandles.push(handle);
        }
      }
    }
    positionResizeHandles();
  }
  const resizeObserver = typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(positionResizeHandles) : null;
  resizeObserver?.observe(gridEl);

  function applyPlacements() {
    const def = getLayoutDef(layoutId);
    const multi = def.count > 1;
    gridEl.classList.toggle("tv-layout-grid--multi", multi);
    const wraps = [primaryWrapEl, ...secondaryPanes.map((p) => p.wrapEl)];
    wraps.forEach((wrap, i) => {
      const placement = def.placements[i];
      if (!placement) return;
      wrap.style.gridColumn = placement.gridColumn;
      wrap.style.gridRow = placement.gridRow;
      wrap.classList.toggle("tv-chart-wrap--primary", i === 0);
      wrap.classList.toggle("tv-chart-wrap--active", multi && i === activePaneIndex);
    });
    createResizeHandles(def);
    applyColumnWidths(def);
    applyRowHeights(def);
  }

  function setLayout(id, { silent = false } = {}) {
    stopResize();
    id = clampLayoutIdForViewport(id);
    const def = getLayoutDef(id);
    const fromPaneCount = secondaryPanes.length + 1;
    layoutId = def.id;
    if (!silent) dirty = true;

    while (secondaryPanes.length < def.count - 1) {
      const pane = createSecondaryPane(secondaryPanes.length + 1);
      secondaryPanes.push(pane);
      gridEl.appendChild(pane.wrapEl);
    }
    while (secondaryPanes.length > def.count - 1) {
      const pane = secondaryPanes.pop();
      if (pane) destroySecondaryPane(pane);
    }

    applyPlacements();
    chartDebug("layout", "change", {
      id: layoutId,
      fromPaneCount,
      toPaneCount: def.count,
      cols: def.cols,
      rows: def.rows,
      silent,
    });
    if (!silent) onLayoutChange?.(layoutId);
    persist();
  }

  function setActivePane(index) {
    if (activePaneIndex === index) return;
    activePaneIndex = index;
    applyPlacements();
    onActivePaneChange?.(index);
  }

  function getSync() {
    return { ...sync };
  }

  /** @param {Partial<SyncSettings>} next */
  function setSync(next) {
    sync = { ...sync, ...next };
    dirty = true;
    persist();
  }

  function getLayoutName() {
    return layoutName;
  }

  /** @param {string} name @param {{ markDirty?: boolean }} [opts] */
  function setLayoutName(name, opts = {}) {
    layoutName = name.trim() || "Unnamed";
    if (opts.markDirty !== false) {
      dirty = true;
    }
    persist();
  }

  function isDirty() {
    return dirty;
  }

  function markDirty() {
    dirty = true;
    persist();
  }

  /** @param {Record<string, object[]> | null | undefined} drawings */
  function setDrawingsSnapshot(drawings) {
    drawingsSnapshot = drawings ?? null;
    persist();
  }

  function getDrawingsSnapshot() {
    return drawingsSnapshot;
  }

  /** @param {Record<string, object[]> | null | undefined} indicators */
  function setIndicatorsSnapshot(indicators) {
    indicatorsSnapshot = indicators ?? null;
    persist();
  }

  function getIndicatorsSnapshot() {
    return indicatorsSnapshot;
  }

  /** @param {object | null | undefined} settings */
  function setChartSettingsSnapshot(settings) {
    chartSettingsSnapshot = settings ? structuredClone(settings) : null;
    persist();
  }

  function getChartSettingsSnapshot() {
    return chartSettingsSnapshot;
  }

  /** @param {Record<string, Record<string, unknown>> | null | undefined} defaults */
  function setToolDefaultsSnapshot(defaults) {
    toolDefaultsSnapshot =
      defaults && typeof defaults === "object" ? structuredClone(defaults) : null;
    persist();
  }

  function getToolDefaultsSnapshot() {
    return toolDefaultsSnapshot;
  }

  /** @param {import("../../../drawings/toolbars/defaults/layoutTemplates.js").LayoutDrawingTemplates | null | undefined} templates */
  function setDrawingTemplatesSnapshot(templates) {
    drawingTemplatesSnapshot =
      templates && typeof templates === "object" ? structuredClone(templates) : null;
    persist();
  }

  function getDrawingTemplatesSnapshot() {
    return drawingTemplatesSnapshot;
  }

  /** @param {Record<string, object> | null | undefined} viewports */
  function setViewportsSnapshot(viewports) {
    viewportsSnapshot =
      viewports && typeof viewports === "object" ? structuredClone(viewports) : null;
    persist();
  }

  function getViewportsSnapshot() {
    return viewportsSnapshot;
  }

  function getColumnWidths() {
    return structuredClone(columnWidths);
  }

  function setColumnWidths(widths) {
    columnWidths = widths && typeof widths === "object" ? structuredClone(widths) : {};
    applyColumnWidths(getLayoutDef(layoutId));
    persist();
  }

  function getRowHeights() {
    return structuredClone(rowHeights);
  }

  function setRowHeights(heights) {
    rowHeights = heights && typeof heights === "object" ? structuredClone(heights) : {};
    applyRowHeights(getLayoutDef(layoutId));
    persist();
  }

  function markSaved() {
    dirty = false;
    persist();
  }

  function getAutoSave() {
    return autoSave;
  }

  /** @param {boolean} enabled */
  function setAutoSave(enabled) {
    autoSave = Boolean(enabled);
    persist();
  }

  function persist() {
    try {
      const payload = {
        layoutId,
        layoutName,
        sync,
        dirty,
        autoSave,
        drawings: drawingsSnapshot,
        indicators: indicatorsSnapshot,
        chartSettings: chartSettingsSnapshot,
        toolDefaults: toolDefaultsSnapshot,
        drawingTemplates: drawingTemplatesSnapshot,
        viewports: viewportsSnapshot,
        columnWidths,
        rowHeights,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.layoutId) layoutId = clampLayoutIdForViewport(data.layoutId);
      if (data.layoutName) layoutName = data.layoutName;
      if (data.sync) sync = { ...sync, ...data.sync };
      if (data.drawings && typeof data.drawings === "object") drawingsSnapshot = data.drawings;
      if (data.indicators && typeof data.indicators === "object") indicatorsSnapshot = data.indicators;
      if (data.chartSettings && typeof data.chartSettings === "object") chartSettingsSnapshot = data.chartSettings;
      if (data.toolDefaults && typeof data.toolDefaults === "object") toolDefaultsSnapshot = data.toolDefaults;
      if (data.drawingTemplates && typeof data.drawingTemplates === "object") {
        drawingTemplatesSnapshot = data.drawingTemplates;
      }
      if (data.viewports && typeof data.viewports === "object") viewportsSnapshot = data.viewports;
      if (data.columnWidths && typeof data.columnWidths === "object") columnWidths = data.columnWidths;
      if (data.rowHeights && typeof data.rowHeights === "object") rowHeights = data.rowHeights;
      dirty = Boolean(data.dirty);
      if (typeof data.autoSave === "boolean") autoSave = data.autoSave;
    } catch {
      /* ignore */
    }
  }

  function getSecondaryPanes() {
    return [...secondaryPanes];
  }

  restore();
  setLayout(layoutId, { silent: true });

  const stopMobileLayoutWatch = onMobileLayoutViewportChange(() => {
    const clamped = clampLayoutIdForViewport(layoutId);
    if (clamped !== layoutId) setLayout(clamped);
  });

  return {
    getLayoutId: () => layoutId,
    setLayout,
    getSync,
    setSync,
    getLayoutName,
    setLayoutName,
    isDirty,
    markDirty,
    markSaved,
    getAutoSave,
    setAutoSave,
    setDrawingsSnapshot,
    getDrawingsSnapshot,
    setIndicatorsSnapshot,
    getIndicatorsSnapshot,
    setChartSettingsSnapshot,
    getChartSettingsSnapshot,
    setToolDefaultsSnapshot,
    getToolDefaultsSnapshot,
    setDrawingTemplatesSnapshot,
    getDrawingTemplatesSnapshot,
    setViewportsSnapshot,
    getViewportsSnapshot,
    getColumnWidths,
    setColumnWidths,
    getRowHeights,
    setRowHeights,
    setActivePane,
    getActivePaneIndex: () => activePaneIndex,
    getSecondaryPanes,
    getGridEl: () => gridEl,
    destroy: () => {
      stopResize();
      resizeObserver?.disconnect();
      stopMobileLayoutWatch();
    },
  };
}

/** @param {SavedLayout} entry */
export function upsertLayoutLibraryEntry(entry) {
  const saved = loadSavedLayouts();
  const now = Date.now();
  const idx = saved.findIndex((s) => s.name === entry.name);
  if (idx >= 0) {
    const prev = saved[idx];
    saved[idx] = {
      ...entry,
      createdAt: prev.createdAt ?? now,
      updatedAt: now,
      lastUsedAt: prev.lastUsedAt,
    };
  } else {
    saved.push({
      ...entry,
      createdAt: now,
      updatedAt: now,
    });
  }
  saveLayoutLibrary(saved);
}

/** @param {string} name */
export function touchLayoutLastUsed(name) {
  const saved = loadSavedLayouts();
  const idx = saved.findIndex((s) => s.name === name);
  if (idx < 0) return;
  saved[idx] = { ...saved[idx], lastUsedAt: Date.now() };
  saveLayoutLibrary(saved);
}

/** @param {string} name */
export function removeLayoutFromLibrary(name) {
  saveLayoutLibrary(loadSavedLayouts().filter((s) => s.name !== name));
}

/** @param {string} name @returns {boolean} */
export function layoutNameExists(name) {
  return loadSavedLayouts().some((s) => s.name === name.trim());
}

/** @param {string} name @returns {SavedLayout | undefined} */
export function findLayoutByName(name) {
  return loadSavedLayouts().find((s) => s.name === name);
}

/** @returns {SavedLayout[]} */
export function loadSavedLayouts() {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}-library`);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** @param {SavedLayout[]} layouts */
export function saveLayoutLibrary(layouts) {
  try {
    localStorage.setItem(`${STORAGE_KEY}-library`, JSON.stringify(layouts));
  } catch {
    /* ignore */
  }
}
