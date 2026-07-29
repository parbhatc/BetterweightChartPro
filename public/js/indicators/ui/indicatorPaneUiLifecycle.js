export class IndicatorPaneUiLifecycle {
  /**
   * @param {(pane: object) => { render: () => void, destroy?: () => void }} createLegend
   */
  constructor(createLegend) {
    this._createLegend = createLegend;
    /** @type {Map<number, { pane: object, statusEl: HTMLElement, legend: { render: () => void, destroy?: () => void } }>} */
    this._legends = new Map();
    /** @type {WeakSet<object>} */
    this._destroyedPanes = new WeakSet();
  }

  /** @param {object} pane */
  ensureLegend(pane) {
    if (!pane?.statusEl || this._destroyedPanes.has(pane)) return null;

    let entry = this._legends.get(pane.index);
    if (entry && (entry.pane !== pane || entry.statusEl !== pane.statusEl)) {
      entry.legend.destroy?.();
      this._legends.delete(pane.index);
      entry = null;
    }

    if (!entry) {
      entry = {
        pane,
        statusEl: pane.statusEl,
        legend: this._createLegend(pane),
      };
      this._legends.set(pane.index, entry);
    }

    return entry.legend;
  }

  /** @param {object} pane */
  destroyPane(pane) {
    if (!pane) return;
    this._destroyedPanes.add(pane);

    const entry = this._legends.get(pane.index);
    if (entry?.pane === pane) {
      entry.legend.destroy?.();
      this._legends.delete(pane.index);
    }

    const overlay = pane._studyLegendOverlay;
    overlay?.destroy?.();
    if (pane._studyLegendOverlay === overlay) {
      pane._studyLegendOverlay = null;
    }
  }
}
