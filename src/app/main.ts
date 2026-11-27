import type { GenerativeModel } from "firebase/ai";
import { startConversation, targetKey, type AgentEvent, type Conversation } from "../lib/agent";
import { lookup } from "../lib/blocklist";
import { loadConfig, type AppConfig } from "../lib/config";
import { runDeepCheck } from "../lib/deepCheck";
import { ensureSignedIn, initFirebase, type Services } from "../lib/firebase";
import { downloadNano, nanoStatus, type NanoStatus } from "../lib/nano";
import { makeScanModel, runScan, type ScanResult } from "../lib/scan";
import { loadWarning, shareWarning, type SharedWarning } from "../lib/share";
import { speak, stopSpeaking } from "../lib/speech";
import type { PageSignals, Verdict } from "../lib/types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => {
  const e = document.createElement(tag);
  if (text) e.textContent = text; // model output is only ever set as text, never HTML
  if (cls) e.className = cls;
  return e;
};

const TITLES: Record<Verdict, { icon: string; title: string }> = {
  safe: { icon: "✓", title: "Looks safe" },
  suspicious: { icon: "?", title: "Be careful" },
  scam: { icon: "!", title: "This looks like a scam" },
};
const KIND_LABEL: Record<string, string> = {
  online_shop: "Online shop", ad: "Ad", text_message: "Text message", email: "Email", letter: "Letter",
  social_post: "Social media post", website: "Website", phone_call: "Phone call", other: "Message",
};

let svc: Services;
let cfg: AppConfig;
let scanModel: GenerativeModel;
let onDeviceOnly = false;
let nano: NanoStatus = "unavailable";
let last: ScanResult | null = null;
let lastInput: { imageB64?: string; text?: string } | null = null;
let conv: Conversation | null = null;

function showError(msg = "") {
  $("error").textContent = msg;
  $("error").hidden = !msg;
}

// ---------- engine status (on-device vs cloud) ----------

async function refreshEngine() {
  nano = await nanoStatus(true);
  const box = $("engine");
  box.replaceChildren();
  const pill = (t: string, c: string) => el("span", t, `pill ${c}`);
  if (nano === "available") box.append(pill("● Gemini Nano ready on this device", "on_device"));
  else if (onDeviceOnly) box.append(pill("On-device only, but Gemini Nano isn't available here", ""));
  else box.append(pill("● Gemini in the cloud (this device can't run Gemini Nano)", "in_cloud"));
  if (nano === "downloadable") {
    const b = el("button", "Download Gemini Nano", "btn ghost");
    b.onclick = async () => {
      b.disabled = true;
      try {
        await downloadNano(scanModel, (p) => (b.textContent = `Downloading ${Math.round(p * 100)}%`));
      } catch (e) {
        showError(`Download failed: ${(e as Error).message}`);
      }
      void refreshEngine();
    };
    box.append(b);
  }
}

// ---------- check (scan) ----------

function toJpegB64(source: CanvasImageSource, w: number, h: number): string {
  const scale = Math.min(1, 1024 / Math.max(w, h)); // ponytail: 1024 px cap keeps on-device input small
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85).split(",")[1];
}

async function imageToB64(src: string): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return toJpegB64(img, img.naturalWidth, img.naturalHeight);
}

function renderResult(r: ScanResult | null, state: "loading" | "done" = "done") {
  const card = $("result");
  card.hidden = false;
  if (state === "loading" || !r) {
    card.className = "card result loading";
    $("v-icon").textContent = "…";
    $("v-kind").textContent = "";
    $("v-title").textContent = onDeviceOnly || nano === "available" ? "Checking on your device…" : "Checking…";
    $("v-summary").textContent = "";
    $("v-reasons").replaceChildren();
    $("v-todo").hidden = true;
    $("v-found").replaceChildren();
    $("v-meta").replaceChildren();
    $("v-community").hidden = true;
    $("deep-out").hidden = $("share-out").hidden = true;
    for (const id of ["btn-speak", "btn-ask", "btn-share", "btn-deep", "btn-second"]) $(id).hidden = true;
    return;
  }
  card.className = `card result ${r.verdict}`;
  $("v-icon").textContent = TITLES[r.verdict].icon;
  $("v-kind").textContent = KIND_LABEL[r.kind] ?? "Message";
  $("v-title").textContent = TITLES[r.verdict].title;
  $("v-summary").textContent = r.summary;
  $("v-reasons").replaceChildren(...r.reasons.map((x) => el("li", x)));
  $("v-todo").hidden = !r.actions.length;
  $("v-actions").replaceChildren(...r.actions.map((x) => el("li", x)));
  $("v-found").replaceChildren(
    ...(r.link ? [el("span", `Link: ${r.link}`, "chip")] : []),
    ...(r.phone ? [el("span", `Phone: ${r.phone}`, "chip")] : []),
  );
  $("v-meta").replaceChildren(
    r.source === "on_device"
      ? el("span", "● On-device · Gemini Nano · nothing left your device", "pill on_device")
      : el("span", `● Cloud · ${cfg.scan_cloud_model}`, "pill in_cloud"),
    el("span", `${(r.ms / 1000).toFixed(1)} s`, "pill"),
  );
  $("btn-speak").hidden = $("btn-ask").hidden = false;
  $("btn-share").hidden = onDeviceOnly || r.verdict === "safe";
  $("btn-deep").hidden = onDeviceOnly || !r.link;
  // Hybrid escalation: Nano answered on-device and flagged it; offer the bigger cloud model, only on the user's OK.
  $("btn-second").hidden = onDeviceOnly || r.source !== "on_device" || r.verdict === "safe";
}

async function scan(input: { imageB64?: string; text?: string; previewSrc?: string }) {
  showError();
  stopSpeaking();
  const prev = $<HTMLImageElement>("preview");
  prev.hidden = !input.previewSrc;
  if (input.previewSrc) prev.src = input.previewSrc;
  renderResult(null, "loading");
  if (nano === "available" || onDeviceOnly) $("v-summary").textContent = "Gemini Nano is reading it on your device. Nothing is uploaded.";
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  lastInput = { imageB64: input.imageB64, text: input.text };
  try {
    last = await runScan(scanModel, input);
    renderResult(last);
    // Community reports for the link or phone found (skipped in on-device-only mode).
    const target = last.link || last.phone;
    if (target && !onDeviceOnly) {
      const c = await lookup(svc.db, targetKey(target)).catch(() => null);
      if (c) {
        const p = $("v-community");
        p.hidden = false;
        p.textContent = `Reported as a ${c.verdict} by ${c.reports} AdLens ${c.reports === 1 ? "user" : "users"}.`;
      }
    }
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    $("result").hidden = true;
    showError(
      onDeviceOnly && /device|available|LanguageModel/i.test(msg)
        ? "Gemini Nano isn't available on this device. Turn off On-device only to check in the cloud."
        : `Couldn't check that: ${msg}`,
    );
  }
}

// camera
let stream: MediaStream | null = null;
async function openCamera(video: HTMLVideoElement, facing: "environment" | "user" = "environment") {
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 } }, audio: false });
  video.srcObject = stream;
  await video.play();
}
function closeCamera(video: HTMLVideoElement) {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}

$("btn-camera").onclick = async () => {
  $("paste").hidden = true;
  $("camera").hidden = false;
  try {
    await openCamera($<HTMLVideoElement>("video"));
  } catch (e) {
    $("camera").hidden = true;
    showError(`Camera not available: ${(e as Error).message}. Try Screenshot instead.`);
  }
};
$("btn-cam-cancel").onclick = () => {
  closeCamera($<HTMLVideoElement>("video"));
  $("camera").hidden = true;
};
$("btn-snap").onclick = () => {
  const v = $<HTMLVideoElement>("video");
  const b64 = toJpegB64(v, v.videoWidth, v.videoHeight);
  closeCamera(v);
  $("camera").hidden = true;
  void scan({ imageB64: b64, previewSrc: `data:image/jpeg;base64,${b64}` });
};
$<HTMLInputElement>("file").onchange = async (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  void scan({ imageB64: await imageToB64(url), previewSrc: url });
  (ev.target as HTMLInputElement).value = "";
};
$("btn-text").onclick = () => {
  $("camera").hidden = true;
  $("paste").hidden = false;
  $("text").focus();
};
$("btn-text-cancel").onclick = () => ($("paste").hidden = true);
$("btn-check-text").onclick = () => {
  const t = $<HTMLTextAreaElement>("text").value.trim();
  if (t) void scan({ text: t });
};
for (const b of document.querySelectorAll<HTMLButtonElement>(".sample")) {
  b.onclick = async () => {
    const src = b.dataset.src!;
    void scan({ imageB64: await imageToB64(src), previewSrc: src });
  };
}

// result actions
function spokenText(r: { verdict: Verdict; summary: string; actions: string[] }) {
  return `${TITLES[r.verdict].title}. ${r.summary} ${r.actions.length ? "What to do now: " + r.actions.join(". ") + "." : ""}`;
}
$("btn-speak").onclick = async () => {
  if (!last) return;
  const b = $<HTMLButtonElement>("btn-speak");
  b.disabled = true;
  b.textContent = "Speaking…";
  try {
    await speak(svc.ai, cfg.tts_model, spokenText(last));
  } catch (e) {
    showError(`Couldn't read aloud: ${(e as Error).message}`);
  }
  b.disabled = false;
  b.textContent = "Read aloud";
};
$("btn-second").onclick = async () => {
  if (!lastInput) return;
  const b = $<HTMLButtonElement>("btn-second");
  b.disabled = true;
  b.textContent = "Asking Gemini in the cloud…";
  try {
    const cloud = makeScanModel(svc.ai, cfg.scan_cloud_model, false, true);
    const before = last?.verdict;
    last = await runScan(cloud, lastInput);
    renderResult(last);
    const p = $("v-community");
    p.hidden = false;
    p.textContent = before && before !== last.verdict
      ? `Second opinion changed the answer: Gemini Nano said "${TITLES[before].title}".`
      : "Second opinion from Gemini in the cloud agrees with the on-device check.";
  } catch (e) {
    showError(`Second opinion failed: ${(e as Error).message}`);
  }
  b.disabled = false;
  b.textContent = "Second opinion in the cloud";
};
$("btn-deep").onclick = async () => {
  if (!last?.link) return;
  const b = $<HTMLButtonElement>("btn-deep");
  const out = $("deep-out");
  b.disabled = true;
  b.textContent = "Opening the link in the cloud…";
  out.hidden = false;
  out.replaceChildren(el("p", "Gemini in the cloud is opening the link safely, so you don't have to.", "muted"));
  try {
    const url = /^https?:\/\//i.test(last.link) ? last.link : `https://${last.link}`;
    const host = new URL(url).hostname;
    const signals: PageSignals = {
      url, hostname: host, protocol: "https:", title: "", text: last.summary,
      maxDiscount: 0, urgency: [], riskyPayments: [], hasReturnsPolicy: true, hasPrivacyPolicy: true,
      hasContactPage: true, emailDomains: [], metaRefresh: false, cardFieldOnHttp: false, externalCheckoutHosts: [],
    };
    const d = await runDeepCheck(
      svc.ai,
      { model: cfg.deep_check_model, fallbackModel: cfg.deep_check_fallback_model, templateId: cfg.deep_check_template_id, search: cfg.deep_check_search },
      signals,
      { score: 0, reasons: last.reasons },
    );
    out.replaceChildren(
      el("h3", `Link check: ${TITLES[d.verdict].title}`),
      ...d.reasons.map((x) => el("p", `• ${x}`)),
      el("span", `● Cloud · deep check · ${(d.ms / 1000).toFixed(1)} s`, "pill in_cloud"),
    );
  } catch (e) {
    out.replaceChildren(el("p", `Link check failed: ${(e as Error).message}`, "error"));
  }
  b.disabled = false;
  b.textContent = "Deep check the link";
};
$("btn-share").onclick = async () => {
  if (!last) return;
  const b = $<HTMLButtonElement>("btn-share");
  b.disabled = true;
  try {
    await ensureSignedIn(svc.app);
    const id = await shareWarning(svc.db, last);
    const url = `${location.origin}${location.pathname}?share=${id}`;
    const out = $("share-out");
    out.hidden = false;
    const input = el("input");
    input.value = url;
    input.readOnly = true;
    out.replaceChildren(el("p", "Send this link to your family. It shows the warning and what to do, not your photo.", "muted"), input);
    if (navigator.share) await navigator.share({ title: "AdLens warning", text: `${TITLES[last.verdict].title}: ${last.summary}`, url }).catch(() => {});
    else await navigator.clipboard?.writeText(url).catch(() => {});
  } catch (e) {
    showError(`Couldn't create the link: ${(e as Error).message}`);
  }
  b.disabled = false;
};
$("btn-ask").onclick = () => {
  switchTab("ask");
  if (!conv) void toggleMic();
};

// ---------- shared warning view ----------

async function showShared(id: string) {
  const w: SharedWarning | null = await loadWarning(svc.db, id).catch(() => null);
  const box = $("shared");
  box.hidden = false;
  if (!w) {
    box.replaceChildren(el("p", "This warning link has expired or doesn't exist."));
    return;
  }
  const btn = el("button", "Read aloud", "btn");
  btn.onclick = () => void speak(svc.ai, cfg.tts_model, spokenText(w)).catch((e) => showError(String(e.message)));
  box.className = `card shared result ${w.verdict}`;
  box.replaceChildren(
    el("p", "A family member wants you to see this", "kind"),
    el("h2", TITLES[w.verdict].title),
    el("p", w.summary, "summary"),
    ...(w.actions.length ? [el("h3", "What to do now"), (() => { const ol = el("ol"); ol.append(...w.actions.map((a) => el("li", a))); return ol; })()] : []),
    ...(w.link ? [el("p", `Don't open: ${w.link}`, "chip")] : []),
    btn,
  );
}

// ---------- ask (Gemini Live) ----------

const TOOL_LABEL: Record<string, string> = {
  get_last_scan: "Looking at what you scanned",
  check_link: "Checking the link",
  lookup_reports: "Looking up reports from other people",
  report_scam: "Reporting the scam",
};
function onAgentEvent(e: AgentEvent) {
  const feed = $("feed");
  let card = feed.querySelector<HTMLElement>(`[data-ev="${CSS.escape(JSON.stringify(e.args) + e.tool)}"]`);
  if (!card) {
    card = el("div", undefined, "event");
    card.dataset.ev = JSON.stringify(e.args) + e.tool;
    feed.prepend(card);
  }
  const target = String(e.args.url ?? e.args.target ?? "");
  const r = e.result as Record<string, unknown> | undefined;
  const status = e.error
    ? `Couldn't finish: ${e.error}`
    : !r
      ? "Working…"
      : e.tool === "check_link"
        ? `${TITLES[(r.verdict as Verdict) ?? "suspicious"].title}${(r.reportedBy as number) ? ` · reported by ${r.reportedBy}` : ""}`
        : e.tool === "lookup_reports"
          ? r.reported ? `Reported ${r.reports} time(s) as ${r.verdict}` : "No reports yet"
          : e.tool === "report_scam"
            ? "Reported. Other AdLens users will be warned."
            : r.none ? "Nothing scanned yet" : `Last scan: ${TITLES[(r.verdict as Verdict) ?? "safe"].title}`;
  card.replaceChildren(el("strong", `${TOOL_LABEL[e.tool] ?? e.tool}${target ? `: ${target}` : ""}`), el("span", status, "muted"));
}

let frameTimer: number | undefined;
async function setLiveCamera(on: boolean) {
  const v = $<HTMLVideoElement>("live-video");
  clearInterval(frameTimer);
  if (!on) {
    closeCamera(v);
    v.hidden = true;
    return;
  }
  try {
    await openCamera(v);
    v.hidden = false;
    // Gemini Live takes about 1 frame per second.
    frameTimer = window.setInterval(() => {
      if (conv && v.videoWidth) void conv.sendFrame(toJpegB64(v, v.videoWidth, v.videoHeight)).catch(() => {});
    }, 1000);
  } catch (e) {
    $<HTMLInputElement>("live-cam").checked = false;
    showError(`Camera not available: ${(e as Error).message}`);
  }
}
$<HTMLInputElement>("live-cam").onchange = (ev) => void setLiveCamera((ev.target as HTMLInputElement).checked);

async function toggleMic() {
  const btn = $("btn-mic");
  showError();
  if (conv) {
    await conv.stop();
    conv = null;
    btn.setAttribute("aria-pressed", "false");
    $("mic-label").textContent = "Start talking";
    $("mic-status").textContent = "Conversation ended.";
    return;
  }
  if (onDeviceOnly) return showError("Talking uses Gemini Live in the cloud. Turn off On-device only to talk.");
  $("mic-label").textContent = "Connecting…";
  try {
    conv = await startConversation({
      ai: svc.ai,
      app: svc.app,
      db: svc.db,
      liveModel: cfg.live_model,
      deep: { model: cfg.deep_check_model, fallbackModel: cfg.deep_check_fallback_model, templateId: cfg.deep_check_template_id, search: cfg.deep_check_search },
      lastScan: () => last,
      onEvent: onAgentEvent,
    });
    btn.setAttribute("aria-pressed", "true");
    $("mic-label").textContent = "Stop";
    $("mic-status").textContent = last ? "Listening. Try: \"Is what I just scanned a scam?\"" : "Listening. Ask about a message, a call or a website.";
    if (last) void conv.session.sendTextRealtime("The user just scanned something with AdLens. Briefly greet them and offer to explain the result.");
  } catch (e) {
    conv = null;
    $("mic-label").textContent = "Start talking";
    showError(`Couldn't start the conversation: ${(e as Error).message}`);
  }
}
$("btn-mic").onclick = () => void toggleMic();

// ---------- tabs, privacy, boot ----------

function switchTab(name: "check" | "ask") {
  $("tab-check").hidden = name !== "check";
  $("tab-ask").hidden = name !== "ask";
  for (const b of document.querySelectorAll<HTMLButtonElement>(".tabbtn")) b.classList.toggle("active", b.dataset.tab === name);
  if (name === "check" && conv) void toggleMic();
  if (name === "check") void setLiveCamera(false).then(() => ($<HTMLInputElement>("live-cam").checked = false));
}
for (const b of document.querySelectorAll<HTMLButtonElement>(".tabbtn")) b.onclick = () => switchTab(b.dataset.tab as "check" | "ask");

$<HTMLInputElement>("privacy").onchange = async (ev) => {
  onDeviceOnly = (ev.target as HTMLInputElement).checked;
  localStorage.setItem("onDeviceOnly", onDeviceOnly ? "1" : "");
  scanModel = makeScanModel(svc.ai, cfg.scan_cloud_model, onDeviceOnly);
  if (onDeviceOnly && conv) await toggleMic();
  if (last) renderResult(last);
  await refreshEngine();
};

async function boot() {
  try {
    svc = initFirebase();
  } catch (e) {
    return showError((e as Error).message);
  }
  try {
    onDeviceOnly = localStorage.getItem("onDeviceOnly") === "1";
  } catch {
    /* storage blocked */
  }
  $<HTMLInputElement>("privacy").checked = onDeviceOnly;
  cfg = await loadConfig(svc.app);
  scanModel = makeScanModel(svc.ai, cfg.scan_cloud_model, onDeviceOnly);
  await refreshEngine();
  const share = new URLSearchParams(location.search).get("share");
  if (share) void showShared(share);
}
void boot();
