import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_GPU_RECT_THRESHOLD,
  GPU_DISABLE_RECT_THRESHOLD,
  estimateVisibleGpuRectangles,
  shouldUseGpu,
} from "../public/vendor/prochart/render/gpuPolicy.mjs";

function chartModel({ bars, renderer = "auto", gpuOk = true }) {
  const series = {
    type: "Candlestick",
    options: {
      visible: true,
      chartStyle: "candles",
      wickVisible: true,
    },
    visibleLocalRange() {
      return bars > 0 ? { a: 0, b: bars - 1 } : null;
    },
  };
  return {
    gpu: gpuOk ? { ok: true } : null,
    options: { renderer },
    panes: [{ height: 400, series: [series] }],
  };
}

test("auto renderer keeps ordinary candle viewports on Canvas2D", () => {
  const model = chartModel({ bars: 120 });

  assert.equal(estimateVisibleGpuRectangles(model), 240);
  assert.equal(shouldUseGpu(model), false);
});

test("auto renderer reserves WebGL for large visible geometry batches", () => {
  const bars = Math.ceil(DEFAULT_GPU_RECT_THRESHOLD / 2);
  const model = chartModel({ bars });

  assert.ok(estimateVisibleGpuRectangles(model) >= DEFAULT_GPU_RECT_THRESHOLD);
  assert.equal(shouldUseGpu(model), true);
});

test("explicit renderer choice remains authoritative", () => {
  assert.equal(shouldUseGpu(chartModel({ bars: 1, renderer: "gpu" })), true);
  assert.equal(shouldUseGpu(chartModel({ bars: 2_000, renderer: "cpu" })), false);
  assert.equal(shouldUseGpu(chartModel({ bars: 2_000, gpuOk: false })), false);
});

test("auto renderer uses hysteresis instead of flapping near its threshold", () => {
  const model = chartModel({
    bars: Math.ceil(DEFAULT_GPU_RECT_THRESHOLD / 2),
  });
  assert.equal(shouldUseGpu(model), true);

  const retainedBars = Math.ceil(GPU_DISABLE_RECT_THRESHOLD / 2);
  model.panes[0].series[0].visibleLocalRange = () => ({
    a: 0,
    b: retainedBars - 1,
  });
  assert.equal(shouldUseGpu(model), true);

  model.panes[0].series[0].visibleLocalRange = () => ({
    a: 0,
    b: retainedBars - 2,
  });
  assert.equal(shouldUseGpu(model), false);
});
