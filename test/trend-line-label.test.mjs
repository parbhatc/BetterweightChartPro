import test from "node:test";
import assert from "node:assert/strict";

import { renderDrawing } from "../public/js/drawings/primitives/renderers/index.js";
import { newDrawing } from "../public/js/drawings/controller/factory/index.js";

function recordingContext() {
  const calls = { arcs: [], paths: [], rotate: [], translate: [], text: [] };
  let path = [];
  return {
    calls,
    save() {},
    restore() {},
    setLineDash() {},
    beginPath() { path = []; },
    moveTo(x, y) { path.push(["moveTo", x, y]); },
    lineTo(x, y) { path.push(["lineTo", x, y]); },
    stroke() { calls.paths.push(path); },
    arc(x, y, radius, start, end) { calls.arcs.push([x, y, radius, start, end]); },
    fill() {},
    measureText(text) { return { width: String(text).length * 7 }; },
    translate(x, y) { calls.translate.push([x, y]); },
    rotate(angle) { calls.rotate.push(angle); },
    fillText(text, x, y) { calls.text.push([text, x, y]); },
  };
}

function renderLabel(points, type = "trend-line") {
  const ctx = recordingContext();
  renderDrawing(
    ctx,
    {
      id: "labeled-line",
      type,
      points,
      label: "test",
      fontSize: 14,
      textAlignH: "center",
      textAlignV: "top",
    },
    (time) => time,
    (price) => price,
    400,
    300,
  );
  return ctx.calls;
}

test("trend-line text follows the line angle and remains above the line", () => {
  const calls = renderLabel([
    { time: 100, price: 200 },
    { time: 200, price: 100 },
  ]);

  assert.deepEqual(calls.translate, [[150, 150]]);
  assert.equal(calls.rotate.length, 1);
  assert.ok(Math.abs(calls.rotate[0] + Math.PI / 4) < 1e-10);
  // TradingView keeps the complete rotated glyph block above the shaft;
  // the text's top edge is one line-height plus a small gap away.
  assert.deepEqual(calls.text, [["test", 0, -20]]);
});

test("trend-line bottom text starts below the rotated shaft", () => {
  const ctx = recordingContext();
  renderDrawing(
    ctx,
    {
      id: "bottom-labeled-line",
      type: "trend-line",
      points: [
        { time: 100, price: 200 },
        { time: 200, price: 100 },
      ],
      label: "test",
      fontSize: 14,
      textAlignH: "center",
      textAlignV: "bottom",
    },
    (time) => time,
    (price) => price,
    400,
    300,
  );

  assert.deepEqual(ctx.calls.text, [["test", 0, 2]]);
});

test("trend-line center/middle text cuts a padded gap out of the shaft", () => {
  const ctx = recordingContext();
  renderDrawing(
    ctx,
    {
      id: "middle-labeled-line",
      type: "trend-line",
      points: [
        { time: 100, price: 200 },
        { time: 200, price: 100 },
      ],
      label: "test",
      fontSize: 14,
      textAlignH: "center",
      textAlignV: "middle",
    },
    (time) => time,
    (price) => price,
    400,
    300,
  );

  const shaft = ctx.calls.paths[0];
  assert.deepEqual(shaft[0], ["moveTo", 100, 200]);
  assert.deepEqual(shaft[3], ["lineTo", 200, 100]);
  assert.ok(Math.abs(shaft[1][1] - 137.27207793864216) < 1e-10);
  assert.ok(Math.abs(shaft[1][2] - 162.72792206135784) < 1e-10);
  assert.ok(Math.abs(shaft[2][1] - 162.72792206135784) < 1e-10);
  assert.ok(Math.abs(shaft[2][2] - 137.27207793864216) < 1e-10);
  assert.deepEqual(ctx.calls.text[0].slice(0, 2), ["test", 0]);
  assert.ok(Math.abs(ctx.calls.text[0][2] + 6.3) < 1e-10);
});

test("reversed trend-line text is normalized to an upright reading angle", () => {
  const calls = renderLabel([
    { time: 200, price: 100 },
    { time: 100, price: 200 },
  ]);

  assert.equal(calls.rotate.length, 1);
  assert.ok(Math.abs(calls.rotate[0] + Math.PI / 4) < 1e-10);
});

test("non-trend drawing labels remain screen-horizontal", () => {
  const calls = renderLabel([
    { time: 100, price: 200 },
    { time: 200, price: 100 },
  ], "segment");

  assert.deepEqual(calls.rotate, []);
  assert.deepEqual(calls.translate, []);
});

test("horizontal-ray centered text uses the visible ray midpoint and stays clear of the line", () => {
  const calls = renderLabel([
    { time: 100, price: 200 },
  ], "horizontal-ray");

  assert.deepEqual(calls.rotate, []);
  assert.deepEqual(calls.translate, []);
  assert.deepEqual(calls.text, [["test", 250, 170.7]]);
});

test("horizontal-ray left and right text alignment use the ray endpoints", () => {
  const renderAligned = (textAlignH) => {
    const ctx = recordingContext();
    renderDrawing(
      ctx,
      {
        id: `horizontal-ray-${textAlignH}`,
        type: "horizontal-ray",
        points: [{ time: 100, price: 200 }],
        label: "test",
        fontSize: 14,
        textAlignH,
        textAlignV: "top",
      },
      (time) => time,
      (price) => price,
      400,
      300,
    );
    return ctx.calls.text[0];
  };

  assert.deepEqual(renderAligned("left"), ["test", 100, 170.7]);
  assert.deepEqual(renderAligned("right"), ["test", 400, 170.7]);
});

test("horizontal-ray middle text cuts a padded gap out of the line", () => {
  const ctx = recordingContext();
  renderDrawing(
    ctx,
    {
      id: "horizontal-ray-middle-label",
      type: "horizontal-ray",
      points: [{ time: 100, price: 200 }],
      label: "test",
      fontSize: 14,
      textAlignH: "center",
      textAlignV: "middle",
    },
    (time) => time,
    (price) => price,
    400,
    300,
  );

  assert.deepEqual(ctx.calls.paths[0], [
    ["moveTo", 100, 200],
    ["lineTo", 232, 200],
    ["moveTo", 268, 200],
    ["lineTo", 400, 200],
  ]);
  assert.deepEqual(ctx.calls.text, [["test", 250, 193.7]]);
});

test("horizontal-ray middle text leaves its anchor clear for left alignment", () => {
  const ctx = recordingContext();
  renderDrawing(
    ctx,
    {
      id: "horizontal-ray-left-middle-label",
      type: "horizontal-ray",
      points: [{ time: 100, price: 200 }],
      label: "test",
      fontSize: 14,
      textAlignH: "left",
      textAlignV: "middle",
    },
    (time) => time,
    (price) => price,
    400,
    300,
  );

  assert.deepEqual(ctx.calls.paths[0], [
    ["moveTo", 100, 200],
    ["lineTo", 101, 200],
    ["moveTo", 137, 200],
    ["lineTo", 400, 200],
  ]);
  assert.deepEqual(ctx.calls.arcs, [[100, 200, 1.5, 0, Math.PI * 2]]);
  assert.deepEqual(ctx.calls.text, [["test", 105, 193.7]]);
});

test("a newly placed trend line starts with cleared text", () => {
  const points = [
    { time: 100, price: 200 },
    { time: 200, price: 100 },
  ];
  const labeled = newDrawing("trend-line", points);
  labeled.label = "SMT";

  const next = newDrawing("trend-line", points);

  assert.equal(next.label, "");
});
