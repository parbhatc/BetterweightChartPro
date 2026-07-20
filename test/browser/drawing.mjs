/** Complete a trendline placement, then drag it and verify it persists. */
import { chromium } from "playwright";

const PORT = process.argv[2] || "3461";
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);

await page.mouse.click(21, 113); // trendline tool
await page.waitForTimeout(500);
await page.mouse.move(400, 500);
await page.mouse.click(400, 500);
await page.waitForTimeout(400);
await page.mouse.move(900, 250, { steps: 10 });
await page.mouse.click(900, 250);
await page.waitForTimeout(800);
await page.screenshot({ path: "test/browser/drawing-placed.png" });

const count1 = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => /drawing/i.test(k)) ?? "") ?? "[]").length ?? -1; } catch { return -2; }
});

// drag the line body
await page.mouse.move(650, 375);
await page.waitForTimeout(200);
await page.mouse.down();
await page.mouse.move(700, 450, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(600);
await page.screenshot({ path: "test/browser/drawing-dragged.png" });

console.log("storedDrawings:", count1, "errors:", errors.length);
for (const e of [...new Set(errors)].slice(0, 10)) console.log("  ERR:", e.slice(0, 250));
await browser.close();
