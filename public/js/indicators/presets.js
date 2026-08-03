const GRAY = Object.freeze({
  bull: "#6e7c65",
  bear: "#916966",
  neutral: "#5e6977",
  blue: "#526b7a",
  gold: "#887f58",
  purple: "#75647d",
});

const DARK = Object.freeze({
  bull: "#089981",
  bear: "#f23645",
  neutral: "#787b86",
  blue: "#2962ff",
  gold: "#ff6d00",
  purple: "#7e57c2",
});

/** @type {Set<(defId: string, presetId: string) => object | null | undefined>} */
const presetProviders = new Set();

/**
 * Registers palettes owned by a connected application without adding its
 * indicator ids or settings to the BWC Pro catalog.
 * @param {(defId: string, presetId: string) => object | null | undefined} provider
 * @returns {() => void}
 */
export function registerIndicatorPresetProvider(provider) {
  if (typeof provider !== "function") throw new TypeError("Indicator preset provider must be a function");
  presetProviders.add(provider);
  return () => presetProviders.delete(provider);
}

/** @param {string} presetId */
export function normalizeIndicatorPresetId(presetId) {
  return ["none", "gray", "dark"].includes(String(presetId)) ? String(presetId) : "none";
}

/**
 * Color-only patches for indicator instances. Detection, visibility, timeframes,
 * line widths, and every other behavioral setting remain untouched.
 * @param {string} defId
 * @param {string} presetId
 */
export function indicatorPresetPatch(defId, presetId) {
  const id = normalizeIndicatorPresetId(presetId);
  if (id === "none") return null;
  for (const provider of presetProviders) {
    const provided = provider(defId, id);
    if (provided) return structuredClone(provided);
  }
  const c = id === "gray" ? GRAY : DARK;
  const paired = (bullKey, bearKey) => ({
    [bullKey]: c.bull,
    [`${bullKey}Opacity`]: 100,
    [bearKey]: c.bear,
    [`${bearKey}Opacity`]: 100,
  });

  const patches = {
    cisd: { style: paired("bullColor", "bearColor") },
    equal_high_low: {
      style: { highColor: c.bear, highColorOpacity: 100, lowColor: c.bull, lowColorOpacity: 100 },
    },
    lrlr_hrlr: {
      style: { lrlrColor: c.bull, lrlrColorOpacity: 100, hrlrColor: c.bear, hrlrColorOpacity: 100 },
    },
    market_structure: {
      style: {
        ...paired("bullBosColor", "bearBosColor"),
        ...paired("bullMssColor", "bearMssColor"),
      },
    },
    smt: {
      style: {
        highColor: id === "gray" ? c.bear : "#ff1100",
        highColorOpacity: 100,
        lowColor: c.bull,
        lowColorOpacity: 100,
        highLabelBg: id === "gray" ? c.bear : "#ff1100",
        highLabelBgOpacity: 80,
        lowLabelBg: c.bull,
        lowLabelBgOpacity: 80,
      },
    },
    order_block_detector: {
      style: {
        bullFillColor: id === "gray" ? c.bull : "#169400",
        bullFillColorOpacity: 20,
        bullBorderColor: id === "gray" ? c.bull : "#169400",
        bullBorderColorOpacity: 100,
        bullAverageColor: c.neutral,
        bullAverageColorOpacity: 63,
        bearFillColor: id === "gray" ? c.bear : "#ff1100",
        bearFillColorOpacity: 20,
        bearBorderColor: id === "gray" ? c.bear : "#ff1100",
        bearBorderColorOpacity: 100,
        bearAverageColor: c.neutral,
        bearAverageColorOpacity: 63,
      },
    },
    htf_power_of_three: {
      style: id === "gray" ? {
        indicatorAppearancePreset: "gray",
        bullBodyColor: "#b2b5be", bullBodyColorOpacity: 100,
        bearBodyColor: "#434651", bearBodyColorOpacity: 100,
        bullBorderColor: "#000000", bullBorderColorOpacity: 100,
        bearBorderColor: "#000000", bearBorderColorOpacity: 100,
        bullWickColor: "#000000", bullWickColorOpacity: 100,
        bearWickColor: "#000000", bearWickColorOpacity: 100,
        openLineColor: c.neutral, openLineColorOpacity: 100,
        highLowLineColor: c.neutral, highLowLineColorOpacity: 100,
        priceTextColor: "#0f0f0f", priceTextColorOpacity: 100,
        infoBgColor: "#434651", infoBgColorOpacity: 100,
        infoTextColor: "#f2f2f2", infoTextColorOpacity: 100,
      } : {
        indicatorAppearancePreset: "dark",
        bullBodyColor: "#4caf50", bullBodyColorOpacity: 100,
        bearBodyColor: "#000000", bearBodyColorOpacity: 100,
        bullBorderColor: "#5d606b", bullBorderColorOpacity: 100,
        bearBorderColor: "#000000", bearBorderColorOpacity: 100,
        bullWickColor: "#5d606b", bullWickColorOpacity: 100,
        bearWickColor: "#5d606b", bearWickColorOpacity: 100,
        openLineColor: "#787b86", openLineColorOpacity: 50,
        highLowLineColor: "#787b86", highLowLineColorOpacity: 50,
        priceTextColor: "#d1d4dc", priceTextColorOpacity: 100,
        infoBgColor: "#d1d4dc", infoBgColorOpacity: 100,
        infoTextColor: "#000000", infoTextColorOpacity: 100,
      },
    },
    ema: {
      style: id === "gray"
        ? { emaColor: c.blue, smoothedColor: c.gold, upperColor: c.bull, lowerColor: c.bull, bbFillColor: c.bull }
        : { emaColor: "#2962ff", smoothedColor: "#fdd835", upperColor: "#4caf50", lowerColor: "#4caf50", bbFillColor: "#4caf50" },
    },
    bollinger_bands: {
      style: id === "gray"
        ? { basisColor: c.bear, upperColor: c.blue, lowerColor: c.blue, backgroundColor: c.blue }
        : { basisColor: "#f23645", upperColor: "#2962ff", lowerColor: "#2962ff", backgroundColor: "#2962ff" },
    },
    volume: {
      style: id === "gray"
        ? { growingColor: c.bull, fallingColor: c.bear, maColor: c.blue }
        : { growingColor: "#26a69a", fallingColor: "#ef5350", maColor: "#2962ff" },
    },
    rsi: {
      style: id === "gray"
        ? { rsiColor: c.purple, smoothedColor: c.gold, smoothingUpperColor: c.bull, smoothingLowerColor: c.bull, upperColor: c.neutral, middleColor: c.neutral, lowerColor: c.neutral, rsiBgFillColor: c.purple, smoothingBbFillColor: c.bull }
        : { rsiColor: "#7e57c2", smoothedColor: "#fdd835", smoothingUpperColor: "#4caf50", smoothingLowerColor: "#4caf50", upperColor: "#787b86", middleColor: "#787b86", lowerColor: "#787b86", rsiBgFillColor: "#7e57c2", smoothingBbFillColor: "#4caf50" },
    },
    macd: {
      style: id === "gray"
        ? { histColor0: c.bull, histColor1: "#9aa594", histColor2: "#b99b98", histColor3: c.bear, macdColor: c.blue, signalColor: c.gold, zeroColor: c.neutral }
        : { histColor0: "#26a69a", histColor1: "#b2dfdb", histColor2: "#ffcdd2", histColor3: "#ff5252", macdColor: "#2962ff", signalColor: "#ff6d00", zeroColor: "#787b86" },
    },
    vwap: {
      style: id === "gray"
        ? { vwapColor: c.blue, upper1Color: c.bull, lower1Color: c.bull, upper2Color: c.gold, lower2Color: c.gold, upper3Color: c.purple, lower3Color: c.purple, band1FillColor: c.bull, band2FillColor: c.gold, band3FillColor: c.purple }
        : { vwapColor: "#2962ff", upper1Color: "#4caf50", lower1Color: "#4caf50", upper2Color: "#f57c00", lower2Color: "#f57c00", upper3Color: "#7b1fa2", lower3Color: "#7b1fa2", band1FillColor: "#4caf50", band2FillColor: "#f57c00", band3FillColor: "#7b1fa2" },
    },
    volume_profile: {
      inputs: id === "gray"
        ? { upColor: c.bull, downColor: c.bear, valueAreaUpColor: c.blue, valueAreaDownColor: c.purple, pocColor: c.bear }
        : { upColor: "#26a69a", downColor: "#ec407a", valueAreaUpColor: "#00bcd4", valueAreaDownColor: "#f06292", pocColor: "#f23645" },
    },
  };

  const patch = patches[defId];
  return patch ? structuredClone(patch) : null;
}
