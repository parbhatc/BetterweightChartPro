/** Broader e2e: timeframe switch, trendline drawing, settings open, EMA search. */
import { chromium } from "playwright";

const PORT = process.argv[2] || "3461";
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);

// 1) timeframe switch to 5m and back to 1m
await page.locator("text=5m").first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: "test/browser/e2e-5m.png" });

// 2) list EMA-ish indicator names
await page.locator("span.tv-chart-tools__label", { hasText: "Indicators" }).first().click();
await page.waitForTimeout(600);
await page.locator("input[placeholder*='earch']").first().fill("Moving");
await page.waitForTimeout(400);
const names = await page.locator(".tv-ind-lib__item-title").allTextContents();
console.log("indicator names for 'Moving':", JSON.stringify(names));
if (names.length) await page.locator(".tv-ind-lib__item-title").first().click();
await page.keyboard.press("Escape");
await page.waitForTimeout(800);

// 3) draw a trendline: pick tool from left toolbar (2nd button), click two points
const toolButtons = page.locator(".draw-tools__btn, [class*='draw-tools'] button");
console.log("toolbar buttons:", await toolButtons.count());
await page.mouse.click(21, 113); // trendline tool icon
await page.waitForTimeout(400);
await page.mouse.click(400, 500);
await page.waitForTimeout(300);
await page.mouse.click(800, 300);
await page.waitForTimeout(800);
await page.screenshot({ path: "test/browser/e2e-drawing.png" });

// 4) drag the drawing
await page.mouse.move(600, 400);
await page.mouse.down();
await page.mouse.move(650, 450, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(500);

// 5) open chart settings (gear, top right)
await page.mouse.click(1374, 21);
await page.waitForTimeout(800);
await page.screenshot({ path: "test/browser/e2e-settings.png" });
await page.keyboard.press("Escape");

console.log("errors:", errors.length);
for (const e of [...new Set(errors)].slice(0, 20)) console.log("  ERR:", e.slice(0, 250));
await browser.close();
