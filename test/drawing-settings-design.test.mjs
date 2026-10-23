import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssUrl = new URL("../public/css/drawings/settings/dialog.css", import.meta.url);

test("drawing settings use a compact tabbed dialog instead of a boxed property list", async () => {
  const css = await readFile(cssUrl, "utf8");

  assert.match(css, /\.tv-drawing-settings__tabs\s*\{[\s\S]*?border-bottom:\s*1px solid var\(--tv-border-subtle\)/);
  assert.match(css, /\.tv-drawing-settings__tab\.is-selected::after\s*\{[\s\S]*?background:\s*var\(--tv-accent\)/);
  assert.match(css, /\.tv-drawing-settings__panel\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?border:\s*none;/);
});

test("drawing text editor is fixed-size and cannot be manually expanded", async () => {
  const css = await readFile(cssUrl, "utf8");
  const textareaRule = css.match(/\.tv-drawing-settings__textarea\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(textareaRule, /height:\s*6rem;/);
  assert.match(textareaRule, /min-height:\s*6rem;/);
  assert.match(textareaRule, /max-height:\s*6rem;/);
  assert.match(textareaRule, /resize:\s*none;/);
});

test("drawing toggles render as compact checkboxes", async () => {
  const css = await readFile(cssUrl, "utf8");
  const checkRule = css.match(/\.tv-drawing-settings \.tv-set__check-row \.tv-set__check\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(checkRule, /width:\s*1\.125rem;/);
  assert.match(checkRule, /height:\s*1\.125rem;/);
  assert.match(checkRule, /border-radius:\s*3px;/);
});
