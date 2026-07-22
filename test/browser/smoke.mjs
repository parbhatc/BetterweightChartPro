/**
 * Browser smoke test for BetterWeightChartPro on the ProChart engine.
 * Usage: node test/browser/smoke.mjs [port]
 */
import { chromium } from "playwright";

const PORT = process.argv[2] || "3461";
const URL = `http://127.0.0.1:${PORT}/`;

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const info = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll("canvas")];
  const corner = document.querySelector("[data-prochart-axis-corner]");
  const cornerCanvas = corner?.querySelector("canvas");
  const root = document.querySelector("[data-prochart]");
  const cornerRect = corner?.getBoundingClientRect();
  const rootRect = root?.getBoundingClientRect();
  const painted = canvases.map((c) => {
    if (!c.width || !c.height) return 0;
    try {
      const ctx = c.getContext("2d");
      const data = ctx.getImageData(0, 0, Math.min(c.width, 400), Math.min(c.height, 400)).data;
      let nonZero = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) nonZero++;
      return nonZero;
    } catch {
      return -1;
    }
  });
  return {
    canvasCount: canvases.length,
    painted,
    hasEngineRoot: Boolean(document.querySelector("[data-prochart]")),
    axisCorner: cornerRect && rootRect && cornerCanvas ? {
      cssWidth: cornerRect.width,
      cssHeight: cornerRect.height,
      bitmapWidth: cornerCanvas.width,
      bitmapHeight: cornerCanvas.height,
      rightGap: Math.abs(rootRect.right - cornerRect.right),
      bottomGap: Math.abs(rootRect.bottom - cornerRect.bottom),
    } : null,
    title: document.title,
  };
});

const priceAxisHoverPoint = await page.evaluate(() => {
  const rect = document.querySelector("#chart [data-prochart-axis-corner]")?.getBoundingClientRect();
  return rect ? { x: rect.left + rect.width / 2, y: rect.top - 15 } : null;
});
if (priceAxisHoverPoint) await page.mouse.move(priceAxisHoverPoint.x, priceAxisHoverPoint.y);
await page.waitForTimeout(50);
const axisModeControls = await page.evaluate(() => {
  const host = document.querySelector("#chart [data-prochart-price-axis-modes]");
  const corner = document.querySelector("#chart [data-prochart-axis-corner]");
  if (!host || !corner || host.hidden) return null;
  const hostRect = host.getBoundingClientRect();
  const cornerRect = corner.getBoundingClientRect();
  return {
    width: hostRect.width,
    height: hostRect.height,
    gapToCorner: Math.abs(hostRect.bottom - cornerRect.top),
    buttons: [...host.querySelectorAll("button")].map((button) => {
      const rect = button.getBoundingClientRect();
      return { text: button.textContent, width: rect.width, height: rect.height };
    }),
  };
});

const primaryCorner = page.locator("#chart [data-prochart-axis-corner]");
await primaryCorner.click();
const axisCornerMenuOpen = await page.locator(".ctx-menu--price-scale:not([hidden])").count() === 1;
await page.keyboard.press("Escape");

await page.screenshot({ path: "test/browser/smoke.png", fullPage: false });
await browser.close();

console.log(JSON.stringify(info, null, 2));
console.log("axis mode controls:", JSON.stringify(axisModeControls));
console.log(`axis corner menu: ${axisCornerMenuOpen ? "open" : "missing"}`);
console.log(`console/page errors: ${errors.length}`);
for (const e of errors.slice(0, 25)) console.log("  ERR:", e.slice(0, 300));

const paintedAny = info.painted.some((p) => p > 1000);
const axisModesMatch = axisModeControls
  && Math.abs(axisModeControls.width - 70) < 0.5
  && Math.abs(axisModeControls.height - 29.6) < 0.5
  && axisModeControls.gapToCorner < 0.5
  && axisModeControls.buttons.map((button) => button.text).join("") === "AL";
if (!info.hasEngineRoot || !paintedAny || !info.axisCorner || info.axisCorner.rightGap > 0.5 || info.axisCorner.bottomGap > 0.5 || !axisCornerMenuOpen || !axisModesMatch) {
  console.error("SMOKE FAIL: engine root, painted canvas, or flush axis corner missing");
  process.exit(1);
}
console.log("SMOKE OK");
