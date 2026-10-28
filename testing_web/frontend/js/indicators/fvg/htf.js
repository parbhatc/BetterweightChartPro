import { resolutionSec } from "/js/chart/resolutions.js";
import { normalizeResolutionId, resolutionDisplayTitle } from "/js/chart/resolutionFormat.js";
import { resolveFvgLayers, resolveFvgTimeframeRows } from "../ui/fvgTimeframesPanel.js";
import { requiredChartBarsWhenNoHtf, requiredHtfBars } from "/js/indicators/security/htfPolicy.js";
import { layerMatchesCorrelatedTfSel } from "./detect.js";

export class FvgHtf {
  /** @param {object} inputs @param {string} [chartResolution] @returns {{ tfId: string, tfSec: number }[]} */
  enabledResolutions(inputs, chartResolution) {
    const chartSec = resolutionSec(chartResolution ?? "1");
    // Every enabled HTF row needs its own data — do not collapse to the highest TF, or lower
    // explicitly-enabled rows (e.g. 15m alongside 1h) render with no HTF bars. Matches
    // applyHideLowerTfFilter: per-row enables are authoritative.
    const out = resolveFvgLayers(inputs, chartSec).filter((l) => l.tfSec > chartSec);
    return [...new Map(out.map(({ tfId, tfSec }) => [tfId, { tfId, tfSec }])).values()];
  }

  /** @param {object} inputs */
  requiredHtfBars(inputs) {
    return requiredHtfBars(inputs);
  }

  /** @param {object} inputs @param {string} [chartResolution] */
  requiredChartBars(inputs, chartResolution) {
    if (inputs.showFvg === false && inputs.showIfvg === false) return 0;
    return requiredChartBarsWhenNoHtf(this.enabledResolutions(inputs, chartResolution), inputs);
  }

  /** @param {object} inputs @param {string} [chartResolution] */
  correlatedLayers(inputs, chartResolution = "1") {
    if (inputs.requireCorrelatedFvg !== true) return [];
    const chartSec = resolutionSec(chartResolution);
    const selected = inputs.correlatedFvgTf ?? "all";
    return resolveFvgLayers(inputs, chartSec).filter((layer) =>
      selected === "all" || layerMatchesCorrelatedTfSel(selected, layer, chartSec),
    );
  }

  /** @param {object} inputs @param {string} [chartResolution] */
  requiresCorrelatedCompare(inputs, chartResolution = "1") {
    return this.correlatedLayers(inputs, chartResolution).length > 0;
  }

  /** @param {object} inputs @param {string} [chartResolution] */
  correlatedResolutions(inputs, chartResolution = "1") {
    const selected = new Set(this.correlatedLayers(inputs, chartResolution).map(({ tfId }) => tfId));
    return this.enabledResolutions(inputs, chartResolution).filter(({ tfId }) => selected.has(tfId));
  }

  /**
   * @param {object} inputs
   * @param {string} [chartResolution]
   * @returns {{ id: string, label: string }[]}
   */
  correlatedTfOptions(inputs, chartResolution = "1") {
    /** @type {{ id: string, label: string }[]} */
    const options = [
      { id: "all", label: "All" },
      { id: "chart", label: `Chart (${resolutionDisplayTitle(chartResolution)})` },
    ];
    const seen = new Set(["all", "chart"]);

    for (const row of resolveFvgTimeframeRows(inputs)) {
      if (!row.enabled) continue;
      const tfId = row.timeframe ?? "chart";
      if (tfId === "chart") continue;
      const key = normalizeResolutionId(tfId);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ id: key, label: resolutionDisplayTitle(tfId) });
    }
    return options;
  }
}

export const fvgHtf = new FvgHtf();
