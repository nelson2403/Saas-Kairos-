// Verificação de PWA num navegador real (Edge/Chrome instalado):
//   node scripts/pwa-check.mjs [baseUrl] [pastaScreenshots]
import { chromium } from "playwright-core";
const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? ".";
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge", args: ["--disable-gpu"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(`${base}/login`);
await page.screenshot({ path: `${out}/login-mobile.png` });
const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return { scope: reg.scope, state: reg.active?.state };
});
console.log("service worker:", JSON.stringify(sw));
await page.reload(); // passa a ser controlada pelo SW
const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
console.log("página controlada pelo SW:", controlled);
const caches = await page.evaluate(async () => {
  const names = await caches.keys();
  const out = {};
  for (const n of names) out[n] = (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname);
  return out;
});
console.log("caches:", JSON.stringify(caches));

// Offline: navegação para página não cacheada cai no fallback /offline
await ctx.setOffline(true);
await page.goto(`${base}/admin/estoque`).catch((e) => console.log("goto offline erro:", e.message));
console.log("offline → título:", await page.title());
await page.screenshot({ path: `${out}/offline-mobile.png` });
await ctx.setOffline(false);

const desk = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await desk.goto(`${base}/`);
await desk.screenshot({ path: `${out}/home-desktop.png` });
console.log("erros no console:", errors.length ? errors : "nenhum");
await browser.close();
