import { getGenerativeModel, InferenceMode, Schema, type AI, type GenerativeModel } from "firebase/ai";
import { redact } from "./redact";
import { withRetry } from "./retry";
import type { Finding, PageSignals, TriageResult } from "./types";
import { mergeVerdict, parseVerdictJson } from "./verdict";

/** JSON Schema for Gemini Nano (Chrome Prompt API responseConstraint). */
const ON_DEVICE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["safe", "suspicious", "scam"] },
    confidence: { type: "number" },
    reasons: { type: "array", items: { type: "string" }, maxItems: 3 },
  },
  required: ["verdict", "confidence", "reasons"],
};

/** Same shape for the cloud fallback model. */
const CLOUD_SCHEMA = Schema.object({
  properties: {
    verdict: Schema.enumString({ enum: ["safe", "suspicious", "scam"] }),
    confidence: Schema.number(),
    reasons: Schema.array({ items: Schema.string() }),
  },
});

/**
 * Triage model. Hybrid: Gemini Nano on-device first, cloud model when Nano
 * isn't available. With onDeviceOnly the page content never leaves the device.
 */
export function makeTriageModel(ai: AI, cloudModel: string, onDeviceOnly: boolean): GenerativeModel {
  return getGenerativeModel(ai, {
    mode: onDeviceOnly ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      },
      promptOptions: { responseConstraint: ON_DEVICE_SCHEMA },
    },
    inCloudParams: {
      model: cloudModel,
      generationConfig: { responseMimeType: "application/json", responseSchema: CLOUD_SCHEMA, temperature: 0.2 },
    },
  });
}

export function buildTriagePrompt(s: PageSignals, f: Finding): string {
  // ponytail: excerpt capped at 3500 chars to stay well under Nano's ~9k-token window.
  return `You check online shops and ad landing pages for scams (fake stores, counterfeit sellers, cloaked ads, payment fraud).
Judge the page below. Answer "scam" only with strong evidence, "suspicious" when there are real red flags, otherwise "safe".
Give up to 3 short reasons a shopper would understand (max 15 words each).

URL: ${s.url}
Title: ${s.title}
Automated red flags (risk ${f.score}/100): ${f.reasons.length ? f.reasons.join("; ") : "none"}

Page text excerpt:
"""
${redact(s.text).slice(0, 3500)}
"""

Reply as JSON: {"verdict": "safe|suspicious|scam", "confidence": 0-1, "reasons": ["..."]}`;
}

export async function runTriage(
  model: GenerativeModel,
  s: PageSignals,
  f: Finding,
  threshold: number,
): Promise<TriageResult> {
  const t0 = performance.now();
  const result = await withRetry(() => model.generateContent(buildTriagePrompt(s, f)));
  const parsed = parseVerdictJson(result.response.text());
  return {
    ...parsed,
    verdict: mergeVerdict(parsed.verdict, f, threshold),
    source: result.response.inferenceSource === "on_device" ? "on_device" : "in_cloud",
    ms: Math.round(performance.now() - t0),
  };
}
