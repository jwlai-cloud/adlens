import type { GenerativeModel } from "firebase/ai";
import { domainKey, lookup, report } from "../lib/blocklist";
import { loadConfig, type AppConfig } from "../lib/config";
import { runDeepCheck } from "../lib/deepCheck";
import { extractSignals } from "../lib/extract";
import { ensureSignedIn, initFirebase, type Services } from "../lib/firebase";
import { scoreSignals } from "../lib/heuristics";
import { downloadNano, nanoStatus } from "../lib/nano";
import { makeTriageModel, runTriage } from "../lib/triage";
import type { CommunityEntry, DeepResult, Finding, PageSignals, Source, TriageResult, Verdict } from "../lib/types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface Check {
  tabId: number;
  url: string;
  key: string;
  signals: PageSignals;
  finding: Finding;
  community?: CommunityEntry | null;
  triage?: TriageResult;
  deep?: DeepResult;
}

let services: Services;
let cfg: AppConfig;
let triageModel: GenerativeModel;
let onDeviceOnly = false;
let runId = 0;
let current: Check | null = null;
// ponytail: per-session in-memory cache; chrome.storage.session if checks should survive panel reloads.
const cache = new Map<string, Check>();

const LABELS: Record<Verdict, { icon: string; title: string }> = {
  safe: { icon: "✓", title: "Looks legit" },
  suspicious: { icon: "?", title: "Be careful" },
  scam: { icon: "!", title: "Likely a scam" },
};

// ---------- rendering (textContent only: model output is never parsed as HTML) ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function pill(text: string, cls = "") {
  return el("span", text, `pill ${cls}`);
}

function sourcePill(source: Source) {
  if (source === "on_device") return pill("● On-device · Gemini Nano", "on_device");
  if (source === "community") return pill("● Shared blocklist", "community");
  return pill(`● Cloud · ${cfg.triage_cloud_model}`, "in_cloud");
}

function setVerdict(state: Verdict | "idle" | "loading", title: string, sub: string, reasons: string[] = [], meta: HTMLElement[] = []) {
  const card = $("verdict");
  card.className = `card verdict ${state}`;
  $("verdict-icon").textContent = state === "idle" ? "" : state === "loading" ? "…" : LABELS[state].icon;
  $("verdict-title").textContent = title;
  $("verdict-sub").textContent = sub;
  $("reasons").replaceChildren(...reasons.map((r) => el("li", r)));
  $("meta").replaceChildren(...meta);
}

function showError(msg: string) {
  const e = $("error");
  e.textContent = msg;
  e.hidden = !msg;
}

function render(c: Check) {
  showError("");
  const f = c.finding;

  // Red flags from the deterministic checks.
  $("flags").hidden = false;
  $("flag-score").textContent = `${f.score}/100`;
  $("flag-list").replaceChildren(...(f.reasons.length ? f.reasons : ["None found"]).map((r) => el("li", r)));

  // Main verdict: deep check > community > triage.
  if (c.deep) {
    setVerdict(c.deep.verdict, LABELS[c.deep.verdict].title, "Confirmed by a cloud deep check.", c.deep.reasons, [
      pill("● Cloud · deep check", "in_cloud"),
      pill(`${c.deep.ms} ms`),
    ]);
  } else if (c.community) {
    setVerdict(
      c.community.verdict,
      LABELS[c.community.verdict].title,
      `Already flagged by ${c.community.reports} AdLens ${c.community.reports === 1 ? "check" : "checks"}. No AI call needed.`,
      c.community.reasons,
      [sourcePill("community")],
    );
  } else if (c.triage) {
    const t = c.triage;
    setVerdict(t.verdict, LABELS[t.verdict].title, `${Math.round(t.confidence * 100)}% confident · from page content`, t.reasons, [
      sourcePill(t.source),
      pill(`${t.ms} ms`),
      pill(`Risk ${f.score}/100`),
    ]);
  }

  // Deep check panel (never shown in on-device-only mode).
  $("deep").hidden = onDeviceOnly;
  const btn = $<HTMLButtonElement>("deep-btn");
  btn.disabled = false;
  btn.textContent = c.deep ? "Run again" : "Run deep check";
  const out = $("deep-result");
  out.replaceChildren();
  if (c.deep) {
    out.append(el("p", `Deep check: ${LABELS[c.deep.verdict].title}`));
    if (c.deep.sources.length) {
      const ul = el("ul", undefined, "sources");
      for (const s of c.deep.sources) {
        if (!/^https?:/.test(s.uri)) continue;
        const a = el("a", s.title);
        a.href = s.uri;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        const li = el("li");
        li.append(a);
        ul.append(li);
      }
      out.append(el("p", "Sources", "muted"), ul);
    }
  }

  const verdict = c.deep?.verdict ?? c.community?.verdict ?? c.triage?.verdict;
  if (verdict) setBadge(c.tabId, verdict);
}

function setBadge(tabId: number, v: Verdict) {
  const colors: Record<Verdict, string> = { safe: "#1f7a4d", suspicious: "#d98a00", scam: "#b3261e" };
  const text: Record<Verdict, string> = { safe: "OK", suspicious: "?", scam: "!" };
  chrome.action.setBadgeText({ tabId, text: text[v] }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: colors[v] }).catch(() => {});
}

// ---------- Gemini Nano status ----------

async function refreshNano() {
  const status = await nanoStatus();
  const box = $("nano");
  const btn = $<HTMLButtonElement>("nano-download");
  const msg: Record<string, string> = {
    available: "",
    downloadable: "Gemini Nano isn't downloaded yet. Checks use Gemini in the cloud (personal data removed) until it is.",
    downloading: "Downloading Gemini Nano… checks use the cloud meanwhile.",
    unavailable: onDeviceOnly
      ? "This browser can't run Gemini Nano, so on-device-only checks won't work. Enable it in chrome://flags, or turn off On-device only."
      : "This browser can't run Gemini Nano. Checks use Gemini in the cloud, with personal data removed.",
  };
  box.hidden = status === "available";
  $("nano-text").textContent = msg[status];
  btn.hidden = status !== "downloadable";
}

$("nano-download").addEventListener("click", async () => {
  const bar = $<HTMLProgressElement>("nano-progress");
  bar.hidden = false;
  $("nano-download").hidden = true;
  try {
    await downloadNano(triageModel, (p) => (bar.value = p));
  } catch (e) {
    showError(`Download failed: ${(e as Error).message}`);
  }
  bar.hidden = true;
  await refreshNano();
});

// ---------- checks ----------

async function checkActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const id = ++runId;
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    current = null;
    $("site").textContent = "—";
    $("deep").hidden = $("flags").hidden = $("community").hidden = true;
    setVerdict("idle", "Open a shop or ad page", "AdLens checks the current tab automatically.");
    return;
  }

  $("site").textContent = new URL(tab.url).hostname;
  const cached = cache.get(tab.url);
  if (cached?.triage || cached?.community || cached?.deep) {
    current = { ...cached, tabId: tab.id };
    return render(current);
  }

  try {
    setVerdict("loading", "Reading the page…", "");
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractSignals });
    const signals = res.result as PageSignals;
    const check: Check = {
      tabId: tab.id,
      url: tab.url,
      key: domainKey(tab.url),
      signals,
      finding: scoreSignals(signals),
    };
    current = check;
    cache.set(tab.url, check);

    // 1. Shared blocklist (skipped in on-device-only mode: even the domain stays local).
    if (!onDeviceOnly) {
      check.community = await lookup(services.db, check.key).catch((e) => {
        console.warn("Blocklist lookup failed", e);
        return null;
      });
      if (id !== runId) return;
      if (check.community) return render(check);
    }

    // 2. Hybrid triage: Gemini Nano on-device, cloud fallback.
    setVerdict("loading", onDeviceOnly ? "Checking on-device…" : "Checking…", "Looking for scam signs");
    check.triage = await runTriage(triageModel, signals, check.finding, cfg.flag_threshold);
    if (id !== runId) return;
    render(check);

    if (cfg.auto_deep_check && check.triage.verdict !== "safe" && !onDeviceOnly) void deepCheck();
  } catch (e) {
    if (id !== runId) return;
    const msg = (e as Error).message ?? String(e);
    setVerdict("idle", "Couldn't check this page", "");
    showError(
      onDeviceOnly && /device|available|LanguageModel/i.test(msg)
        ? "Gemini Nano isn't ready. Download it above, or turn off On-device only."
        : msg,
    );
  }
}

async function deepCheck() {
  const c = current;
  if (!c || onDeviceOnly) return;
  const btn = $<HTMLButtonElement>("deep-btn");
  btn.disabled = true;
  btn.textContent = "Checking in the cloud…";
  try {
    c.deep = await runDeepCheck(
      services.ai,
      { model: cfg.deep_check_model, fallbackModel: cfg.deep_check_fallback_model, templateId: cfg.deep_check_template_id, search: cfg.deep_check_search },
      c.signals,
      c.finding,
    );
    if (current?.url === c.url) render(c);
    // 3. Share confirmed bad verdicts so the next user gets an instant answer.
    if (c.deep.verdict !== "safe") {
      try {
        await ensureSignedIn(services.app);
        await report(services.db, c.key, c.deep.verdict, c.deep.reasons);
        const box = $("community");
        box.hidden = false;
        box.textContent = "Added to the shared AdLens blocklist. The next shopper gets this answer instantly.";
      } catch (e) {
        console.warn("Blocklist report failed", e);
      }
    }
  } catch (e) {
    showError(`Deep check failed: ${(e as Error).message}`);
    btn.disabled = false;
    btn.textContent = "Try again";
  }
}

$("deep-btn").addEventListener("click", () => void deepCheck());

$<HTMLInputElement>("privacy").addEventListener("change", async (ev) => {
  onDeviceOnly = (ev.target as HTMLInputElement).checked;
  await chrome.storage.local.set({ onDeviceOnly });
  triageModel = makeTriageModel(services.ai, cfg.triage_cloud_model, onDeviceOnly);
  cache.clear();
  $("community").hidden = true;
  await refreshNano();
  await checkActiveTab();
});

// ---------- boot ----------

async function boot() {
  try {
    services = initFirebase();
  } catch (e) {
    setVerdict("idle", "Setup needed", "");
    return showError((e as Error).message);
  }
  onDeviceOnly = Boolean((await chrome.storage.local.get("onDeviceOnly")).onDeviceOnly);
  $<HTMLInputElement>("privacy").checked = onDeviceOnly;
  cfg = await loadConfig(services.app);
  triageModel = makeTriageModel(services.ai, cfg.triage_cloud_model, onDeviceOnly);
  await refreshNano();

  chrome.tabs.onActivated.addListener(() => void checkActiveTab());
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    if (info.status === "complete" && tab.active) {
      if (tab.url) cache.delete(tab.url);
      void checkActiveTab();
    }
  });
  await checkActiveTab();
}

void boot();
