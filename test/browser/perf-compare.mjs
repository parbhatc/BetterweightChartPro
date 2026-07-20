/**
 * Head-to-head perf: BWC original (lightweight-charts fork) vs Pro (ProChart engine).
 * Loads RSI+Volume+EMA on each, then storms wheel-zoom + crosshair moves and
 * measures achieved FPS + average frame time.
 * Usage: node test/browser/perf-compare.mjs <portA> <portB>
 */
import { chromium } from "playwright";

const ports = [process.argv[2] || "3460", process.argv[3] || "3461"];

async function measure(port) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  for (const name of ["RSI", "Volume", "Moving Average Exponential"]) {
    try {
      await page.locator("span.tv-chart-tools__label", { hasText: "Indicators" }).first().click();
      await page.waitForTimeout(500);
      await page.locator("input[placeholder*='earch']").first().fill(name.slice(0, 6));
      await page.waitForTimeout(300);
      await page.locator(".tv-ind-lib__item-title", { hasText: name }).first().click({ timeout: 4000 });
      await page.waitForTimeout(600);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    } catch { /* skip */ }
  }
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const el = document.elementFromPoint(600, 400)?.closest("div") ? document.body : document.body;
    const target = document.elementFromPoint(600, 400);
    let frames = 0;
    let raf; const loop = () => { frames++; raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const t0 = performance.now();
    const N = 400;
    for (let i = 0; i < N; i++) {
      const x = 300 + ((i * 13) % 800);
      const y = 200 + ((i * 7) % 400);
      target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerType: "mouse" }));
      target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
      target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY: i % 2 ? 120 : -120 }));
      if (i % 4 === 0) await new Promise((r) => requestAnimationFrame(r));
    }
    // settle
    await new Promise((r) => setTimeout(r, 100));
    const dt = performance.now() - t0;
    cancelAnimationFrame(raf);
    return { events: N, ms: Math.round(dt), fps: Math.round((frames / dt) * 1000) };
  });

  // long-task style main-thread block measurement during a burst
  const block = await page.evaluate(async () => {
    const target = document.elementFromPoint(600, 400);
    let worst = 0;
    for (let i = 0; i < 60; i++) {
      const a = performance.now();
      target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 600, clientY: 400, deltaY: i % 2 ? 120 : -120 }));
      await new Promise((r) => requestAnimationFrame(r));
      const d = performance.now() - a;
      if (d > worst) worst = d;
    }
    return Math.round(worst * 10) / 10;
  });

  await browser.close();
  return { port, ...result, worstFrameMs: block, errors: errors.length };
}

for (const port of ports) {
  const r = await measure(port);
  console.log(JSON.stringify(r));
}
