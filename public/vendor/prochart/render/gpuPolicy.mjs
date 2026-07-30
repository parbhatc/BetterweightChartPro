const DEFAULT_GPU_RECT_THRESHOLD = 700;
const GPU_DISABLE_RECT_THRESHOLD = Math.floor(
  DEFAULT_GPU_RECT_THRESHOLD * 0.75,
);

function rectanglesPerBar(series) {
  if (series.type === "Histogram") return 1;
  if (series.type === "Bar") return series.options.openVisible === false ? 2 : 3;
  if (series.type === "Candlestick") {
    return series.options.wickVisible === false ? 1 : 2;
  }
  return 0;
}

function usesNativeGpuGeometry(series) {
  if (!series?.options?.visible) return false;
  if (
    series.type === "Candlestick"
    && (series.options.chartStyle ?? "candles") !== "candles"
  ) {
    return false;
  }
  return rectanglesPerBar(series) > 0;
}

/**
 * Estimate the number of GPU rectangles in the current viewport.
 * Stops at the threshold because the coordinator only needs a policy decision.
 */
export function estimateVisibleGpuRectangles(
  model,
  threshold = DEFAULT_GPU_RECT_THRESHOLD,
) {
  let rectangles = 0;
  for (const pane of model.panes) {
    if (pane.height <= 0) continue;
    for (const series of pane.series) {
      if (!usesNativeGpuGeometry(series)) continue;
      const range = series.visibleLocalRange();
      if (!range) continue;
      rectangles += (range.b - range.a + 1) * rectanglesPerBar(series);
      if (rectangles >= threshold) return rectangles;
    }
  }
  return rectangles;
}

/**
 * "auto" keeps small and medium viewports on Canvas2D. Creating, uploading,
 * and compositing a full-size WebGL layer costs more than it saves for those
 * batches, especially when Chromium has fallen back to CPU compositing.
 */
export function shouldUseGpu(model) {
  if (!model.gpu?.ok || model.options.renderer === "cpu") {
    model._autoGpuEnabled = false;
    return false;
  }
  if (model.options.renderer === "gpu") return true;
  const threshold = model._autoGpuEnabled
    ? GPU_DISABLE_RECT_THRESHOLD
    : DEFAULT_GPU_RECT_THRESHOLD;
  const enabled = estimateVisibleGpuRectangles(model, threshold) >= threshold;
  model._autoGpuEnabled = enabled;
  return enabled;
}

export {
  DEFAULT_GPU_RECT_THRESHOLD,
  GPU_DISABLE_RECT_THRESHOLD,
};
