import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const legendCssUrl = new URL("../public/css/indicators/legend.css", import.meta.url);
const paneLegendCssUrl = new URL("../public/css/indicators/studyPaneLegend.css", import.meta.url);
const chartCssUrl = new URL("../public/css/chart.css", import.meta.url);

test("compact legends expose study actions to fine-pointer hover", async () => {
  const [legendCss, paneLegendCss] = await Promise.all([
    readFile(legendCssUrl, "utf8"),
    readFile(paneLegendCssUrl, "utf8"),
  ]);

  for (const css of [legendCss, paneLegendCss]) {
    assert.match(css, /@media \(max-width: 768px\) and \(hover: hover\) and \(pointer: fine\)/);
    assert.match(css, /\.study-legend__item:hover \.study-legend__actions[\s\S]*?opacity: 1;[\s\S]*?visibility: visible;[\s\S]*?pointer-events: auto;/);
    assert.match(css, /\.study-legend__item:hover \.study-legend__tail[\s\S]*?display: inline-flex;/);
  }
});

test("hidden studies and transparent status overlays use fifteen percent opacity", async () => {
  const [legendCss, paneLegendCss, chartCss] = await Promise.all([
    readFile(legendCssUrl, "utf8"),
    readFile(paneLegendCssUrl, "utf8"),
    readFile(chartCssUrl, "utf8"),
  ]);

  assert.match(legendCss, /\.study-legend__item\.is-hidden\s*\{\s*opacity: 0\.15;/);
  assert.match(paneLegendCss, /\.study-legend__item\.is-hidden\s*\{\s*opacity: 0\.15;/);
  assert.match(legendCss, /var\(--status-line-bg, var\(--tv-bg\)\) 15%/);
  assert.match(
    chartCss,
    /\.status-line:not\(\.status-line--bg\) \.status-line__item\s*\{\s*background: color-mix\(in srgb, var\(--tv-bg\) 15%, transparent\);/,
  );
});
