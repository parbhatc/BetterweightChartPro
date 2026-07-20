/** Add indicators via the UI, interact, and measure pan performance. */
import { chromium } from "playwright";

const PORT = process.argv[2] || "3461";
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);

async function addIndicator(name) {
  await page.locator("span.tv-chart-tools__label", { hasText: "Indicators" }).first().click();
  await page.waitForTimeout(600);
  const search = page.locator("input[placeholder*='earch']").first();
  if (await search.count()) await search.fill(name);
  await page.waitForTimeout(400);
  await page.locator(".tv-ind-lib__item-title", { hasText: name }).first().click({ timeout: 4000 });
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

try { await addIndicator("RSI"); } catch (e) { errors.push("addIndicator RSI failed: " + e.message); }
try { await addIndicator("Volume"); } catch (e) { errors.push("addIndicator Volume failed: " + e.message); }
try { await addIndicator("Moving Average Exponential"); } catch (e) { errors.push("addIndicator EMA failed: " + e.message); }
await page.waitForTimeout(1500);
await page.screenshot({ path: "test/browser/indicators.png" });

// pan + zoom interaction
const box = { x: 600, y: 400 };
await page.mouse.move(box.x, box.y);
const t0 = Date.now();
for (let k = 0; k < 3; k++) {
  await page.mouse.down();
  for (let i = 0; i < 20; i++) await page.mouse.move(box.x - i * 12, box.y, { steps: 1 });
  await page.mouse.up();
  await page.mouse.move(box.x, box.y);
}
const panMs = Date.now() - t0;
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); }
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(60); }
await page.waitForTimeout(800);
await page.screenshot({ path: "test/browser/after-interact.png" });

// FPS measurement while continuously panning via synthetic pointer events
const fps = await page.evaluate(async () => {
  const m = (globalThis.__prochartCharts || [])[0];
  if (!m) return null;
  let frames = 0;
  let cb; const count = () => { frames++; cb = requestAnimationFrame(count); };
  cb = requestAnimationFrame(count);
  const t0 = performance.now();
  // simulate 120 scroll steps
  for (let i = 0; i < 120; i++) {
    m.timeScale.scrollBy(i % 2 ? 25 : -25);
    await new Promise((r) => requestAnimationFrame(r));
  }
  const dt = performance.now() - t0;
  cancelAnimationFrame(cb);
  return { fps: (frames / dt) * 1000, ms: dt, framesPerScroll: frames / 120 };
});

console.log("panMs(3 drags):", panMs, "fps:", JSON.stringify(fps));
console.log("errors:", errors.length);
for (const e of [...new Set(errors)].slice(0, 20)) console.log("  ERR:", e.slice(0, 250));
await browser.close();
