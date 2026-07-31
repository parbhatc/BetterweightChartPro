import { resolutionDisplayTitle } from "/js/chart/resolutionFormat.js";
import { LEVEL_HTF_PALETTE } from "./palette.js";

/** @typedef {{ tag?: string; hi: string; lo: string }} HtfStyle */

export class LevelsHtfStyles {
  /** @returns {Record<string, HtfStyle>} */
  all() {
    return {
      "240": { tag: "4H", ...LEVEL_HTF_PALETTE["240"] },
      "60": { tag: "1H", ...LEVEL_HTF_PALETTE["60"] },
      "15": { tag: "15m", ...LEVEL_HTF_PALETTE["15"] },
      "5": { tag: "5m", ...LEVEL_HTF_PALETTE["5"] },
      "10": { tag: "10m", ...LEVEL_HTF_PALETTE["10"] },
    };
  }

  /** @param {string} tfId */
  get(tfId) {
    return this.all()[tfId];
  }

  /** @param {string} tfId */
  resolve(tfId) {
    return this.get(tfId) ?? { tag: resolutionDisplayTitle(tfId), ...LEVEL_HTF_PALETTE["240"] };
  }
}

export const levelsHtfStyles = new LevelsHtfStyles();
