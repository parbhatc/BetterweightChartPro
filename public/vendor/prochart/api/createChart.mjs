/** createChart factory. */
import { ChartModel } from "./chartModel.mjs";


/**
 * @param {HTMLElement | string} container
 * @param {object} [options]
 */
export function createChart(container, options) {
  const el = typeof container === "string" ? document.getElementById(container) : container;
  if (!el) throw new Error("prochart: container not found");
  const model = new ChartModel(el, options);
  (globalThis.__prochartCharts ||= []).push(model);
  return model.api;
}
