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
  dark: {
    theme: "dark",
    canvas: {
      appearancePreset: "dark",
      backgroundType: "solid",
      backgroundColor: "#09090b",
      gridVertColor: "rgba(161, 161, 170, 0.10)",
      gridHorzColor: "rgba(161, 161, 170, 0.10)",
      crosshairColor: "#71717a",
      scalesTextColor: "#a1a1aa",
      scalesLineColor: "rgba(242, 242, 242, 0)",
      watermarkColor: "rgba(161, 161, 170, 0.22)",
      attributionLogo: false,
    },
    symbol: {
      bodyUpColor: "#089981", bodyDownColor: "#f23645",
      bordersUpColor: "#089981", bordersDownColor: "#f23645",
      wickUpColor: "#089981", wickDownColor: "#f23645",
    },
  },
  gray: {
    theme: "light",
    canvas: {
      appearancePreset: "gray",
      backgroundType: "solid",
      backgroundColor: "#b9bec8",
      gridVertColor: "rgba(17, 24, 39, 0.13)",
      gridHorzColor: "rgba(17, 24, 39, 0.13)",
      crosshairColor: "#374151",
      scalesTextColor: "#111827",
      scalesLineColor: "rgba(17, 24, 39, 0.22)",
      watermarkColor: "rgba(31, 41, 55, 0.34)",
      attributionLogo: false,
    },
    symbol: {
      bodyUpColor: "#b9bec8", bodyDownColor: "#5f6470",
      bordersUpColor: "#090d14", bordersDownColor: "#090d14",
      wickUpColor: "#090d14", wickDownColor: "#090d14",
    },
  },
  blue: {
    theme: "dark",
    canvas: {
      appearancePreset: "blue",
      backgroundType: "solid",
      backgroundColor: "#08152f",
      gridVertColor: "rgba(96, 165, 250, 0.12)",
      gridHorzColor: "rgba(96, 165, 250, 0.12)",
      crosshairColor: "#60a5fa",
      scalesTextColor: "#dbeafe",
      scalesLineColor: "rgba(96, 165, 250, 0.18)",
      watermarkColor: "rgba(147, 197, 253, 0.25)",
      attributionLogo: false,
    },
    symbol: {
      bodyUpColor: "#22d3ee", bodyDownColor: "#fb7185",
      bordersUpColor: "#22d3ee", bordersDownColor: "#fb7185",
      wickUpColor: "#67e8f9", wickDownColor: "#fda4af",
    },
  },
  light: {
    theme: "light",
    canvas: {
      appearancePreset: "light",
      backgroundType: "solid",
      backgroundColor: "#ffffff",
      gridVertColor: "rgba(15, 23, 42, 0.07)",
      gridHorzColor: "rgba(15, 23, 42, 0.07)",
      crosshairColor: "#94a3b8",
      scalesTextColor: "#0f172a",
      scalesLineColor: "rgba(15, 23, 42, 0.12)",
      watermarkColor: "rgba(100, 116, 139, 0.2)",
      attributionLogo: false,
    },
    symbol: {
      bodyUpColor: "#16a34a", bodyDownColor: "#dc2626",
      bordersUpColor: "#16a34a", bordersDownColor: "#dc2626",
      wickUpColor: "#16a34a", wickDownColor: "#dc2626",
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
