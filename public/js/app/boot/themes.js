export const CHART_THEMES = {
  dark: {
    bg: "#09090b",
    text: "#a1a1aa",
    grid: "#27272a",
    border: "#3f3f46",
    crosshair: "#71717a",
    labelBg: "#18181b",
    up: "#10b981",
    down: "#ef4444",
  },
  light: {
    bg: "#ffffff",
    text: "#0f172a",
    grid: "#f1f5f9",
    border: "#e2e8f0",
    crosshair: "#94a3b8",
    labelBg: "#0f172a",
    up: "#16a34a",
    down: "#dc2626",
  },
};

export const CHART_APPEARANCE_PRESETS = {
  default: {
    canvas: {
      appearancePreset: "default",
      backgroundType: "solid",
      backgroundColor: "#09090b",
      gridLinesMode: "vertAndHorz",
      crosshairColor: "#71717a",
      watermarkColor: "rgba(161, 161, 170, 0.22)",
      scalesTextColor: "#a1a1aa",
      scalesFontSize: "13",
      scalesLineColor: "rgba(242, 242, 242, 0)",
      marginTop: 10,
      marginBottom: 4,
      marginRight: 10,
    },
    symbol: {
      bodyUpColor: "#089981", bodyDownColor: "#f23645",
      bordersUpColor: "#089981", bordersDownColor: "#f23645",
      wickUpColor: "#089981", wickDownColor: "#f23645",
    },
    position: {
      profitColor: "#089981",
      stopColor: "#f23645",
      showPriceLabels: true,
    },
    scales: {
      symbolLabelLineFollowBodyColors: true,
      symbolLabelLineWidth: 1,
      symbolLabelLineStyle: 2,
    },
    statusLine: {
      showBackground: true,
      useChartTextColor: false,
      showVolume: true,
    },
  },
  theme: {
    canvas: {
      appearancePreset: "theme",
      backgroundType: "solid",
      backgroundColor: "#c2baae",
      gridLinesMode: "none",
      crosshairColor: "#9c9c9c",
      watermarkColor: "rgba(80, 83, 94, 0.2)",
      scalesTextColor: "#0f0f0f",
      scalesFontSize: "12",
      scalesLineColor: "rgba(46, 46, 46, 0)",
      marginTop: 10,
      marginBottom: 8,
      marginRight: 10,
    },
    symbol: {
      bodyUpColor: "#b2b5be", bodyDownColor: "#434651",
      bordersUpColor: "#000000", bordersDownColor: "#000000",
      wickUpColor: "#000000", wickDownColor: "#000000",
    },
    position: {
      profitColor: "#376b89",
      stopColor: "#5e6977",
      showPriceLabels: true,
    },
    scales: {
      symbolLabelLineFollowBodyColors: true,
      symbolLabelLineWidth: 1,
      symbolLabelLineStyle: 2,
    },
    statusLine: {
      showBackground: false,
      useChartTextColor: true,
      showVolume: false,
    },
  },
};

/** @param {string} id */
export function chartAppearancePreset(id) {
  return CHART_APPEARANCE_PRESETS[id] ?? null;
}

/** @param {string} [mode] */
export function chartThemeFallback(mode) {
  return CHART_THEMES[mode === "light" ? "light" : "dark"];
}

/** @param {ReturnType<typeof import("../../ui/settings/store.js").createChartSettings>} store @param {"dark" | "light"} mode */
export function applyCanvasPresetForTheme(store, mode) {
  const t = chartThemeFallback(mode);
  const patch = {
    appearancePreset: "none",
    backgroundColor: t.bg,
    backgroundGradientTopColor: mode === "dark" ? "#18181b" : "#ffffff",
    backgroundGradientBottomColor: mode === "dark" ? "#09090b" : "#e2e8f0",
    gridVertColor: mode === "dark" ? "rgba(161, 161, 170, 0.10)" : "rgba(15, 23, 42, 0.06)",
    gridHorzColor: mode === "dark" ? "rgba(161, 161, 170, 0.10)" : "rgba(15, 23, 42, 0.06)",
    crosshairColor: t.crosshair,
    scalesTextColor: t.text,
    scalesLineColor: mode === "dark" ? "rgba(242, 242, 242, 0)" : "rgba(15, 23, 42, 0)",
    watermarkColor: mode === "dark" ? "rgba(161, 161, 170, 0.22)" : "rgba(100, 116, 139, 0.2)",
    attributionLogo: false,
  };
  store.merge({ canvas: patch }, { skipHistory: true });
}
