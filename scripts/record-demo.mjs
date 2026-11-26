// Records a draft demo: the real extension in Playwright Chromium, with the panel
// in its own window watching the shop tab (sidepanel.html?tabId=N).
// Usage: npm run build && npm run fixtures (separate shell) && node scripts/record-demo.mjs
// Output: video/raw/*.webm + video/raw/marks.json (timestamps for the edit).
import { chromium } from "playwright";
import { mkdirSync, rmSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";

const DIST = resolve("dist");
const OUT = resolve("video/raw");
const FIX = "http://localhost:5174";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const marks = {};
const mark = (k) => {
  marks[k] = (Date.now() - t0) / 1000;
  console.log(k, marks[k].toFixed(1));
};
const hold = (s) => new Promise((r) => setTimeout(r, s * 1000));

const ctx = await chromium.launchPersistentContext(resolve("video/.profile"), {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  viewport: { width: 1100, height: 820 },
  recordVideo: { dir: OUT, size: { width: 1100, height: 820 } },
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));

const shop = ctx.pages()[0] ?? (await ctx.newPage());
mark("shopStart");
await shop.goto(`${FIX}/`);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes("5174"))?.id);

const panelP = ctx.waitForEvent("page");
await sw.evaluate(
  (id) => chrome.windows.create({ url: chrome.runtime.getURL(`sidepanel.html?tabId=${id}`), type: "popup", width: 440, height: 820 }),
  tabId,
);
const panel = await panelP;
await panel.setViewportSize({ width: 440, height: 820 });
mark("panelStart");
await panel.waitForLoadState();
await hold(2);

async function verdict(timeout = 90_000) {
  // Wait for the panel to pick up the new page first, so we don't read the previous verdict.
  await panel
    .waitForFunction(() => /loading/.test(document.getElementById("verdict")?.className ?? ""), null, { timeout: 8000 })
    .catch(() => {});
  await panel.waitForFunction(
    () => /\b(safe|suspicious|scam)\b/.test(document.getElementById("verdict")?.className ?? "") ||
      !document.getElementById("error")?.hidden,
    null,
    { timeout },
  );
  return panel.evaluate(() => document.getElementById("verdict-title")?.textContent + " | " + document.getElementById("meta")?.textContent);
}

// 1. Legit shop
mark("legit");
await shop.goto(`${FIX}/legit-shop.html`);
console.log("legit:", await verdict());
mark("legitDone");
await hold(4);

// 2. Fake shop + red flags
mark("fake");
await shop.goto(`${FIX}/fake-shop.html`);
console.log("fake:", await verdict());
mark("fakeDone");
await hold(3);
await panel.click("#flags summary");
await hold(3);

// 3. Deep check
mark("deepStart");
await panel.click("#deep-btn");
await panel.waitForFunction(
  () => document.getElementById("deep-result")?.textContent || !document.getElementById("error")?.hidden,
  null,
  { timeout: 200_000 },
);
mark("deepEnd");
console.log("deep:", await panel.evaluate(() => document.getElementById("deep-result")?.textContent + " | " + document.getElementById("error")?.textContent));
await hold(5);

// 4. Second visit: shared blocklist
mark("reload");
await shop.reload();
console.log("reload:", await verdict());
mark("reloadDone");
await hold(4);

// 5. Cloaked ad landing page
mark("cloaked");
await shop.goto(`${FIX}/cloaked-landing.html`);
console.log("cloaked:", await verdict());
mark("cloakedDone");
await hold(4);

// 6. On-device only mode (this Chromium has no Gemini Nano, so it shows that honestly)
mark("privacy");
await panel.click("#privacy");
await hold(5);
mark("end");

const shopVideo = await shop.video().path();
const panelVideo = await panel.video().path();
await ctx.close();
renameSync(shopVideo, `${OUT}/shop.webm`);
renameSync(panelVideo, `${OUT}/panel.webm`);
writeFileSync(`${OUT}/marks.json`, JSON.stringify(marks, null, 2));
console.log("saved", readdirSync(OUT));
