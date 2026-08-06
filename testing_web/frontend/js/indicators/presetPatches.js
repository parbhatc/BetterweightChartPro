const GRAY = Object.freeze({ bull: "#6e7c65", bear: "#916966" });

/** Palettes owned by the testing application. */
export function testingIndicatorPresetPatch(defId, id) {
  const patches = {
    fvg: {
      inputs: id === "gray" ? {
        indicatorAppearancePreset: "gray",
        showFvgBoxColors: true,
        fvgBoxColorsByTf: {},
        bullBoxColor: GRAY.bull, bullBoxColorOpacity: 20,
        bearBoxColor: GRAY.bear, bearBoxColorOpacity: 20,
        bullBorderColor: GRAY.bull, bullBorderColorOpacity: 0,
        bearBorderColor: GRAY.bear, bearBorderColorOpacity: 0,
        ifvgBoxColor: "#8a8051", ifvgBoxColorOpacity: 20,
        tapBorderColor: "#787b86", tapBorderColorOpacity: 100,
      } : {
        indicatorAppearancePreset: "dark",
        showFvgBoxColors: true,
        fvgBoxColorsByTf: {},
        bullBoxColor: "#4caf50", bullBoxColorOpacity: 15,
        bearBoxColor: "#f23645", bearBoxColorOpacity: 15,
        bullBorderColor: "#4caf50", bullBorderColorOpacity: 50,
        bearBorderColor: "#f23645", bearBorderColorOpacity: 50,
        ifvgBoxColor: "#ffff00", ifvgBoxColorOpacity: 20,
        tapBorderColor: "#787b86", tapBorderColorOpacity: 100,
      },
    },
    levels: {
      inputs: id === "gray" ? {
        indicatorAppearancePreset: "gray",
        previousDayColor: "#8a7654", previousDayColorOpacity: 100,
        previousWeekColor: "#5e7482", previousWeekColorOpacity: 100,
        midpointColor: "#71805b", midpointColorOpacity: 100,
        confHiColor: "#75647d", confHiColorOpacity: 100,
        confLoColor: "#8a7654", confLoColorOpacity: 100,
      } : {
        indicatorAppearancePreset: "dark",
        previousDayColor: "#f59e0b", previousDayColorOpacity: 100,
        previousWeekColor: "#38bdf8", previousWeekColorOpacity: 100,
        midpointColor: "#a3e635", midpointColorOpacity: 100,
        confHiColor: "#9400d3", confHiColorOpacity: 100,
        confLoColor: "#ffaa00", confLoColorOpacity: 100,
      },
    },
  };
  return patches[defId] ?? null;
}
