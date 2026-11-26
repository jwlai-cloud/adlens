import { getGenerativeModel, getTemplateGenerativeModel, type AI, type GenerateContentResult } from "firebase/ai";
import { redact } from "./redact";
import { withRetry } from "./retry";
import type { DeepResult, Finding, PageSignals } from "./types";
import { parseVerdictJson } from "./verdict";

// ponytail: fixed 30 s cap; an overloaded model can take minutes to fail. A timeout skips straight to the fallback model.
const TIMEOUT_MS = 30_000;

/** Only these leave the device for a deep check: URL, title, red flags, redacted excerpt. */
export function deepCheckInputs(s: PageSignals, f: Finding) {
  return {
    url: s.url,
    domain: s.hostname,
    title: s.title,
    redFlags: f.reasons.join("; ") || "none",
    excerpt: redact(s.text).slice(0, 1500),
  };
}

function deepPrompt(v: ReturnType<typeof deepCheckInputs>, search: boolean): string {
  return `You are a fraud analyst checking whether an online shop or ad landing page is a scam.
Fetch the URL and judge what a first-time visitor actually gets: is it the same shop, a redirect, a different checkout, missing policies?
${search ? "Use Google Search to look for scam reports, reviews, domain age, and whether the brand's official site is different.\n" : "Use what you know about common scam patterns and the real brand's official domains.\n"}
URL: ${v.url}
Domain: ${v.domain}
Title: ${v.title}
On-device red flags: ${v.redFlags}
Page excerpt: """${v.excerpt}"""

Reply with only JSON: {"verdict": "safe|suspicious|scam", "confidence": 0-1, "reasons": ["up to 3 short reasons citing what you found"]}`;
}

/**
 * Cloud-only deep check. The model fetches the page itself (URL context tool),
 * so it sees what a fresh visitor sees, which exposes cloaking. Google Search
 * grounding is optional: it needs a billing-enabled project (free tier returns 429).
 * Uses a server prompt template when one is configured in Remote Config
 * (prompt stays on the server), otherwise the same prompt from the client.
 */
export async function runDeepCheck(
  ai: AI,
  opts: { model: string; fallbackModel?: string; templateId: string; search: boolean },
  s: PageSignals,
  f: Finding,
): Promise<DeepResult> {
  const t0 = performance.now();
  const vars = deepCheckInputs(s, f);
  // The cloud can't fetch local/private pages (it just times out), so only offer URL context for public ones.
  const fetchable = !/^(localhost|127\.|10\.|192\.168\.|\[?::1)/.test(s.hostname);
  const tools = [...(fetchable ? [{ urlContext: {} }] : []), ...(opts.search ? [{ googleSearch: {} }] : [])];
  const call = (model: string) => (): Promise<GenerateContentResult> =>
    opts.templateId
      ? getTemplateGenerativeModel(ai).generateContent({ templateId: opts.templateId, templateVariables: vars }, { timeout: TIMEOUT_MS })
      : getGenerativeModel(ai, { model, tools, generationConfig: { temperature: 0.2 } }).generateContent(
          deepPrompt(vars, opts.search),
          { timeout: TIMEOUT_MS },
        );

  // Try each model in turn (main, then the comma-separated fallbacks) while Gemini is overloaded.
  const models = opts.templateId
    ? [opts.model]
    : [opts.model, ...(opts.fallbackModel ?? "").split(",").map((m) => m.trim()).filter(Boolean)];
  let result: GenerateContentResult | undefined;
  let lastError: unknown;
  for (const model of models) {
    try {
      result = await withRetry(call(model), 2);
      break;
    } catch (e) {
      lastError = e;
      console.warn(`Deep check: ${model} failed`, e);
    }
  }
  if (!result) {
    const msg = String((lastError as Error)?.message ?? lastError);
    throw new Error(
      /timeout|429|500|503|high demand|overloaded/i.test(msg) ? "Gemini is busy right now. Try again in a minute." : msg,
    );
  }
  const parsed = parseVerdictJson(result.response.text());
  const cand = result.response.candidates?.[0];
  const searched = (cand?.groundingMetadata?.groundingChunks ?? []).map((c) => ({
    uri: c.web?.uri ?? "",
    title: c.web?.title ?? c.web?.uri ?? "",
  }));
  if (cand?.urlContextMetadata) console.debug("URL context", cand.urlContextMetadata);
  const fetched = (cand?.urlContextMetadata?.urlMetadata ?? [])
    .filter((m) => m.retrievedUrl && String(m.urlRetrievalStatus ?? "").includes("SUCCESS"))
    .map((m) => ({ uri: m.retrievedUrl!, title: `Fetched: ${m.retrievedUrl}` }));
  const sources = [...searched, ...fetched].filter((c) => c.uri).slice(0, 4);
  return { verdict: parsed.verdict, reasons: parsed.reasons, sources, ms: Math.round(performance.now() - t0) };
}
