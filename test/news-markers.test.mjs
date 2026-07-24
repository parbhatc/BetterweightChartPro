import test from "node:test";
import assert from "node:assert/strict";

import { buildNewsTimeScaleMarkers, newsImpactKind } from "../public/js/news/markers.js";
import { buildDemoNewsMarker } from "../public/js/news/demoMarkers.js";

test("news markers group simultaneous events and map ET releases to chart time", () => {
  const releaseUtc = Date.UTC(2026, 5, 11, 12, 30) / 1000; // 08:30 ET (EDT)
  // Custom/static feeds may return bars out of order; marker lookup must still
  // choose the exact release bar instead of relying on input ordering.
  const bars = [{ time: releaseUtc + 60 }, { time: releaseUtc - 60 }, { time: releaseUtc }];
  const markers = buildNewsTimeScaleMarkers({
    bars,
    timeAdapter: { time: { toChart: (utc) => utc + 3600 } },
    newsByDay: {
      "2026-06-11": {
        events: [
          { id: "a", title: "Core CPI m/m", hmEt: "08:30", timeLabel: "8:30am", impact: "High", country: "USD" },
          { id: "b", title: "CPI m/m", hmEt: "08:30", timeLabel: "8:30am", impact: "High", country: "USD" },
        ],
      },
    },
    settings: { enabled: true, displayCurrencies: [], displayImpacts: [] },
  });

  assert.equal(markers.length, 1);
  assert.equal(markers[0].events.length, 2);
  assert.equal(markers[0].time, releaseUtc + 3600);
  assert.equal(markers[0].label, "⚡");
  assert.equal(markers[0].impact, "high");
  assert.equal(markers[0].color, "#f23645");
});

test("news marker filters and impact normalization handle empty and selected paths", () => {
  const releaseUtc = Date.UTC(2026, 5, 11, 12, 30) / 1000;
  const common = {
    bars: [{ time: releaseUtc }],
    timeAdapter: null,
    newsByDay: {
      "2026-06-11": {
        events: [{ title: "Jobless Claims", hmEt: "08:30", impact: "Medium", country: "USD" }],
      },
    },
  };
  assert.equal(newsImpactKind("moderate"), "medium");
  assert.deepEqual(buildNewsTimeScaleMarkers({ ...common, settings: { enabled: false } }), []);
  assert.deepEqual(
    buildNewsTimeScaleMarkers({
      ...common,
      settings: { enabled: true, displayCurrencies: ["EUR"], displayImpacts: [] },
    }),
    [],
  );
  assert.deepEqual(
    buildNewsTimeScaleMarkers({
      ...common,
      settings: { enabled: true, displayCurrencies: [], displayImpacts: ["high"] },
    }),
    [],
  );
});

test("news markers group only matching release times and impacts", () => {
  const releaseUtc = Date.UTC(2026, 5, 11, 12, 30) / 1000;
  const markers = buildNewsTimeScaleMarkers({
    bars: [{ time: releaseUtc }, { time: releaseUtc + 30 * 60 }],
    timeAdapter: null,
    newsByDay: {
      "2026-06-11": {
        events: [
          { title: "Low release A", hmEt: "08:30", timeLabel: "8:30am", impact: "Low", country: "USD" },
          { title: "Low release B", hmEt: "08:30", timeLabel: "8:30am", impact: "Low", country: "USD" },
          { title: "High release", hmEt: "08:30", timeLabel: "8:30am", impact: "High", country: "USD" },
          { title: "Later low release", hmEt: "09:00", timeLabel: "9:00am", impact: "Low", country: "USD" },
        ],
      },
    },
    settings: { enabled: true, displayCurrencies: [], displayImpacts: [] },
  });

  assert.equal(markers.length, 3);
  const lowAt830 = markers.find((marker) => marker.id === "news:2026-06-11:08:30:low");
  const highAt830 = markers.find((marker) => marker.id === "news:2026-06-11:08:30:high");
  const lowAt900 = markers.find((marker) => marker.id === "news:2026-06-11:09:00:low");
  assert.equal(lowAt830?.events.length, 2);
  assert.equal(lowAt830?.color, "#2962ff");
  assert.equal(highAt830?.events.length, 1);
  assert.equal(highAt830?.color, "#f23645");
  assert.equal(lowAt900?.events.length, 1);
  assert.equal(lowAt900?.time, releaseUtc + 30 * 60);
});

test("news markers retain the exact release time between higher-timeframe bars", () => {
  const bar930Utc = Date.UTC(2026, 5, 11, 13, 30) / 1000; // 09:30 ET
  const bar1000Utc = bar930Utc + 30 * 60;
  const markers = buildNewsTimeScaleMarkers({
    bars: [{ time: bar930Utc }, { time: bar1000Utc }],
    timeAdapter: { time: { toChart: (utc) => utc + 3600 } },
    newsByDay: {
      "2026-06-11": {
        events: [
          { title: "Flash PMI", hmEt: "09:45", timeLabel: "9:45am", impact: "High", country: "USD" },
        ],
      },
    },
    settings: { enabled: true, displayCurrencies: [], displayImpacts: [] },
  });

  assert.equal(markers.length, 1);
  assert.equal(markers[0].utcTime, bar930Utc + 15 * 60);
  assert.equal(markers[0].time, bar930Utc + 15 * 60 + 3600);
});

test("demo news marker follows the final chart day and includes popup values", () => {
  const finalUtc = Date.UTC(2026, 6, 19, 18, 30) / 1000;
  const demo = buildDemoNewsMarker([
    { time: finalUtc - 86400 },
    { time: finalUtc - 60 },
    { time: finalUtc },
  ]);

  assert.equal(demo?.day, "2026-07-19");
  assert.equal(demo?.event.impact, "High");
  assert.equal(demo?.event.currency, "USD");
  assert.equal(demo?.event.actual, "3.2%");
});
