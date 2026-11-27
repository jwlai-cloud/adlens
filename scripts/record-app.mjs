// Records the hosted AdLens Live web app at phone size for the demo video.
// Playwright Chromium has no Gemini Nano, so this shows the cloud path; the
// on-device segment comes from real Chrome screenshots.
// Usage: node scripts/record-app.mjs [url]   -> video/app/{app.webm, agent.wav, marks.json}
import { chromium } from "playwright";
import { mkdirSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";

const URL = process.argv[2] ?? "https://adlens-bhai-g1o56.web.app/";
const OUT = resolve("video/app");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const marks = {};
const mark = (k) => {
  marks[k] = (Date.now() - t0) / 1000;
  console.log(k, marks[k].toFixed(1));
};
const hold = (s) => new Promise((r) => setTimeout(r, s * 1000));

const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({
  viewport: { width: 430, height: 900 },
  deviceScaleFactor: 2,
  recordVideo: { dir: OUT, size: { width: 860, height: 1800 } },
});
const page = await ctx.newPage();
mark("start");
await page.goto(URL);
await page.waitForSelector(".pill");
await hold(2.5);

async function scan(i, label) {
  mark(`${label}`);
  await page.locator(".sample").nth(i).click();
  await page.waitForFunction(() => /\b(safe|suspicious|scam)\b/.test(document.getElementById("result").className), null, { timeout: 90_000 });
  mark(`${label}Done`);
  await page.evaluate(() => document.getElementById("result").scrollIntoView({ block: "start", behavior: "smooth" }));
  await hold(1.2);
  await page.evaluate(() => window.scrollBy({ top: -60 }));
  await hold(3.5);
  await page.evaluate(() => window.scrollBy({ top: 330, behavior: "smooth" }));
  await hold(3);
}

// 1. "Hi Mum" text
await scan(1, "himum");

// 2. Warn my family -> share link -> open it as the family member
mark("share");
await page.click("#btn-share");
await page.waitForSelector("#share-out input", { timeout: 30_000 });
const shareUrl = await page.inputValue("#share-out input");
await page.evaluate(() => document.getElementById("share-out").scrollIntoView({ block: "center", behavior: "smooth" }));
await hold(3);
mark("family");
await page.goto(shareUrl);
await page.waitForSelector("#shared h2", { timeout: 30_000 });
await hold(4.5);

// 3. Sneaker ad + deep check of its link
await page.goto(URL);
await page.waitForSelector(".pill");
await scan(2, "ad");
mark("deep");
await page.click("#btn-deep");
await page.evaluate(() => document.getElementById("deep-out").scrollIntoView({ block: "center", behavior: "smooth" }));
await page.waitForFunction(() => /Link check/.test(document.getElementById("deep-out").textContent) || /failed/.test(document.getElementById("deep-out").textContent), null, { timeout: 150_000 });
mark("deepDone");
await page.evaluate(() => document.getElementById("deep-out").scrollIntoView({ block: "center", behavior: "smooth" }));
await hold(4);

// 4. Ask AdLens (Gemini Live), typed question, spoken answer + tools
await page.goto(URL);
await page.waitForSelector(".pill");
await page.locator(".sample").nth(0).click(); // parcel fee scan, so get_last_scan has something
await page.waitForFunction(() => /\b(safe|suspicious|scam)\b/.test(document.getElementById("result").className), null, { timeout: 90_000 });
await hold(1.5);
mark("ask");
await page.click('.tabbtn[data-tab="ask"]');
await hold(1.5);
await page.click("#type-input");
await page.keyboard.type("I just got this parcel text. Is the link safe, and has anyone reported it?", { delay: 28 });
await hold(0.5);
mark("askSend");
await page.click("#type-form button");
await page.waitForSelector(".bubble.agent", { timeout: 120_000 });
mark("agentFirstWords");
// wait until the agent finishes its turn (transcript stops growing)
let lastText = "";
for (let i = 0; i < 120; i++) {
  await hold(1);
  const t = await page.evaluate(() => [...document.querySelectorAll(".bubble.agent")].map((b) => b.textContent).join(" | "));
  if (t && t === lastText && i > 4) break;
  lastText = t;
  await page.evaluate(() => document.querySelector(".feed")?.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" }));
}
mark("agentDone");
console.log("agent:", lastText);
await hold(3);
mark("end");

// The agent's real voice (24 kHz PCM chunks kept by the app) -> WAV
const b64 = await page.evaluate(() => {
  const parts = window.__agentAudio ?? [];
  const n = parts.reduce((a, p) => a + p.length, 0);
  const all = new Int16Array(n);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  const bytes = new Uint8Array(all.buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
});
const pcm = Buffer.from(b64, "base64");
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write("WAVE", 8); hdr.write("fmt ", 12);
hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(24000, 24);
hdr.writeUInt32LE(48000, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write("data", 36); hdr.writeUInt32LE(pcm.length, 40);
writeFileSync(`${OUT}/agent.wav`, Buffer.concat([hdr, pcm]));

const vpath = await page.video().path();
await ctx.close();
await browser.close();
renameSync(vpath, `${OUT}/app.webm`);
writeFileSync(`${OUT}/marks.json`, JSON.stringify(marks, null, 2));
console.log("saved", OUT, "agent audio s:", (pcm.length / 48000).toFixed(1));
