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
    title: document.title,
  };
});

await page.screenshot({ path: "test/browser/smoke.png", fullPage: false });
await browser.close();

console.log(JSON.stringify(info, null, 2));
console.log(`console/page errors: ${errors.length}`);
for (const e of errors.slice(0, 25)) console.log("  ERR:", e.slice(0, 300));

const paintedAny = info.painted.some((p) => p > 1000);
if (!info.hasEngineRoot || !paintedAny) {
  console.error("SMOKE FAIL: engine root or painted canvas missing");
  process.exit(1);
}
console.log("SMOKE OK");
