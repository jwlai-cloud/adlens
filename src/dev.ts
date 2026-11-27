// Dev-only harness: runs the real pipeline against Firebase on the demo pages.
// Not part of the extension build (vite build only includes sidepanel.html).
import { domainKey, lookup, report } from "./lib/blocklist";
import { loadConfig } from "./lib/config";
import { runDeepCheck } from "./lib/deepCheck";
import { extractSignals } from "./lib/extract";
import { ensureSignedIn, initFirebase } from "./lib/firebase";
import { scoreSignals } from "./lib/heuristics";
import { nanoStatus } from "./lib/nano";
import { makeTriageModel, runTriage } from "./lib/triage";
import type { PageSignals } from "./lib/types";

const out = document.getElementById("out")!;
const log = (label: string, v: unknown) => {
  out.textContent += `\n== ${label}\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}\n`;
  console.log(label, v);
};

function signalsFor(path: string): Promise<PageSignals> {
  return new Promise((resolve, reject) => {
    const f = document.createElement("iframe");
    f.src = path;
    f.onload = () => {
      try {
        // Same serialization chrome.scripting uses: function source run in the page.
        resolve((f.contentWindow as unknown as { eval(s: string): PageSignals }).eval(`(${extractSignals.toString()})()`));
      } catch (e) {
        reject(e);
      } finally {
        f.remove();
      }
    };
    document.body.append(f);
  });
}

async function run() {
  out.textContent = "";
  const s = initFirebase();
  const cfg = await loadConfig(s.app);
  log("config", cfg);
  log("nano", await nanoStatus());
  const triage = makeTriageModel(s.ai, cfg.triage_cloud_model, false);
  for (const page of ["legit-shop.html", "fake-shop.html", "cloaked-landing.html"]) {
    try {
      const sig = await signalsFor(`/fixtures/${page}`);
      const f = scoreSignals(sig);
      const t = await runTriage(triage, sig, f, cfg.flag_threshold);
      log(`${page} triage (risk ${f.score})`, t);
      if (page === "fake-shop.html") {
        const d = await runDeepCheck(s.ai, { model: cfg.deep_check_model, fallbackModel: cfg.deep_check_fallback_model, templateId: cfg.deep_check_template_id, search: cfg.deep_check_search }, sig, f);
        log(`${page} deep check`, d);
        const key = domainKey(sig.url);
        await ensureSignedIn(s.app);
        if (d.verdict !== "safe") await report(s.db, key, d.verdict, d.reasons);
        log(`${page} blocklist`, await lookup(s.db, key));
      }
    } catch (e) {
      log(`${page} ERROR`, String((e as Error)?.stack ?? e));
    }
  }
  // Public page: the cloud fetches it itself via URL context.
  try {
    const sig = {
      url: "https://www.patagonia.com/home/", hostname: "www.patagonia.com", protocol: "https:",
      title: "Patagonia Outdoor Clothing & Gear", text: "Shop outdoor clothing. Free returns. Contact us.",
      maxDiscount: 0, urgency: [], riskyPayments: [], hasReturnsPolicy: true, hasPrivacyPolicy: true,
      hasContactPage: true, emailDomains: [], metaRefresh: false, cardFieldOnHttp: false, externalCheckoutHosts: [],
    };
    log("public deep check", await runDeepCheck(s.ai, { model: cfg.deep_check_model, fallbackModel: cfg.deep_check_fallback_model, templateId: "", search: false }, sig, { score: 0, reasons: [] }));
  } catch (e) {
    log("public deep check ERROR", String((e as Error)?.message ?? e));
  }
  log("done", "ok");
}
document.getElementById("run")!.addEventListener("click", () => void run());

// Probe which cloud model/tool combos the project's free tier allows.
import { getGenerativeModel } from "firebase/ai";
async function probe() {
  out.textContent = "";
  const s = initFirebase();
  const combos: [string, object[]][] = [
    ["gemini-3.8-flash", []],
    ["gemini-3.8-flash", [{ googleSearch: {} }]],
    ["gemini-3.8-flash", [{ urlContext: {} }]],
    ["gemini-4-hydrogen", []],
    ["gemini-4-hydrogen", [{ googleSearch: {} }]],
    ["gemini-3.5-flash-lite", [{ googleSearch: {} }]],
  ];
  for (const [model, tools] of combos) {
    const label = `${model} ${JSON.stringify(tools)}`;
    try {
      const r = await getGenerativeModel(s.ai, { model, tools: tools as never }).generateContent("Reply with the word ok.");
      log(label, `OK: ${r.response.text().slice(0, 40)}`);
    } catch (e) {
      log(label, `ERR: ${String((e as Error).message).slice(0, 160)}`);
    }
  }
  log("probe done", "");
}
const pb = document.createElement("button");
pb.textContent = "Probe models";
pb.onclick = () => void probe();
document.body.insertBefore(pb, out);

// Probe: does the Live API connect on this project (free tier)?
import { getLiveGenerativeModel, ResponseModality } from "firebase/ai";
async function probeLive() {
  out.textContent = "";
  const s = initFirebase();
  for (const model of ["gemini-3.1-flash-live-preview", "gemini-2.5-flash-native-audio-preview-12-2025"]) {
    try {
      const live = getLiveGenerativeModel(s.ai, {
        model,
        generationConfig: { responseModalities: [ResponseModality.AUDIO] },
        tools: [{ functionDeclarations: [{ name: "check_link", description: "Check a URL for scams", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } as never }] }],
      });
      const t0 = performance.now();
      const session = await live.connect();
      await session.sendTextRealtime("Please check the link https://cheap-sneakers.example/sale for me.");
      let got = "";
      for await (const msg of session.receive()) {
        got = JSON.stringify(msg).slice(0, 200);
        if ((msg as { type: string }).type === "toolCall" || (msg as { turnComplete?: boolean }).turnComplete) break;
        if (performance.now() - t0 > 20000) break;
      }
      log(`live ${model}`, `OK ${Math.round(performance.now() - t0)} ms: ${got}`);
      await session.close();
    } catch (e) {
      log(`live ${model}`, `ERR: ${String((e as Error).message).slice(0, 200)}`);
    }
  }
  log("live probe done", "");
}
const lb = document.createElement("button");
lb.textContent = "Probe Live";
lb.onclick = () => void probeLive();
document.body.insertBefore(lb, out);

// Agent test without a microphone: same system prompt + tools, typed input, manual tool loop.
import { SYSTEM, TOOLS, runTool } from "./lib/agent";
async function testAgent() {
  out.textContent = "";
  const s = initFirebase();
  const cfg = await loadConfig(s.app);
  const live = getLiveGenerativeModel(s.ai, {
    model: cfg.live_model,
    systemInstruction: SYSTEM,
    tools: TOOLS as never,
    generationConfig: { responseModalities: [ResponseModality.AUDIO], outputAudioTranscription: {} },
  });
  const session = await live.connect();
  const deps = {
    ai: s.ai, app: s.app, db: s.db, liveModel: cfg.live_model,
    deep: { model: cfg.deep_check_model, fallbackModel: cfg.deep_check_fallback_model, templateId: "", search: false },
    lastScan: () => null, onEvent: () => {},
  };
  await session.sendTextRealtime("I got a text saying my parcel is held and I must pay a fee at https://parcelrush-redelivery.top/pay . Has anyone reported this number, +61 488 220 913? And is the link safe?");
  let said = "";
  const t0 = performance.now();
  for await (const msg of session.receive()) {
    const m = msg as { type: string; functionCalls?: { name: string; args: object; id?: string }[]; outputTranscription?: { text?: string }; turnComplete?: boolean };
    if (m.type === "toolCall") {
      for (const call of m.functionCalls ?? []) {
        const tt = performance.now();
        const result = await runTool(call as never, deps as never).catch((e) => ({ error: String(e.message) }));
        log(`tool ${call.name} ${JSON.stringify(call.args)} (${Math.round(performance.now() - tt)} ms)`, result);
        await session.sendFunctionResponses([{ id: call.id, name: call.name, response: result as object }]);
      }
    }
    if (m.outputTranscription?.text) said += m.outputTranscription.text;
    if (m.turnComplete && said) break;
    if (performance.now() - t0 > 120000) break;
  }
  log("agent said", said || "(no transcript)");
  await session.close();
  log("agent test done", "");
}
const ab = document.createElement("button");
ab.textContent = "Test agent";
ab.onclick = () => void testAgent();
document.body.insertBefore(ab, out);
