/** @param {import("prochart").ISeriesApi} series @param {string} [context] */
export function patchSeriesPrimitiveLogging(series, context = "") {
  if (series.__bwcPrimitiveLogging) return series;

  const attach = series.attachPrimitive.bind(series);
  const detach = series.detachPrimitive.bind(series);

  series.attachPrimitive = (primitive) => {
    if (globalThis.__BWC_LOG_PRIMITIVES__ === true) {
      console.log("[BWC] attachPrimitive", {
        context,
        primitive: primitive?.constructor?.name ?? primitive,
        primitive,
      });
    }
    return attach(primitive);
  };

  series.detachPrimitive = (primitive) => {
    if (globalThis.__BWC_LOG_PRIMITIVES__ === true) {
      console.log("[BWC] detachPrimitive", {
        context,
        primitive: primitive?.constructor?.name ?? primitive,
        primitive,
      });
    }
    return detach(primitive);
  };

  series.__bwcPrimitiveLogging = true;
  return series;
}

/** @param {import("prochart").IChartApi} chart @param {string} [context] */
export function patchChartPrimitiveLogging(chart, context = "") {
  if (chart.__bwcPrimitiveLogging) return chart;

  const addSeries = chart.addSeries.bind(chart);
  chart.addSeries = (...args) => {
    const series = addSeries(...args);
    patchSeriesPrimitiveLogging(series, context);
    return series;
  };

  chart.__bwcPrimitiveLogging = true;
  return chart;
}
