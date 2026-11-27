import { getGenerativeModel, InferenceMode, Schema, type AI, type GenerativeModel, type Part } from "firebase/ai";
import { withRetry } from "./retry";
import type { Source, Verdict } from "./types";
import { VERDICTS } from "./types";

export const KINDS = ["online_shop", "ad", "text_message", "email", "letter", "social_post", "website", "phone_call", "other"] as const;
export type Kind = (typeof KINDS)[number];

export interface ScanResult {
  verdict: Verdict;
  confidence: number;
  kind: Kind;
  summary: string;
  reasons: string[];
  link: string;
  phone: string;
  actions: string[];
  source: Source;
  ms: number;
}

/** JSON Schema for Gemini Nano (Chrome Prompt API responseConstraint). */
const ON_DEVICE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: VERDICTS },
    confidence: { type: "number" },
    kind: { type: "string", enum: KINDS },
    summary: { type: "string" },
    reasons: { type: "array", items: { type: "string" }, maxItems: 3 },
    link: { type: "string" },
    phone: { type: "string" },
    actions: { type: "array", items: { type: "string" }, maxItems: 3 },
  },
  required: ["verdict", "confidence", "kind", "summary", "reasons", "link", "phone", "actions"],
};

const CLOUD_SCHEMA = Schema.object({
  properties: {
    verdict: Schema.enumString({ enum: [...VERDICTS] }),
    confidence: Schema.number(),
    kind: Schema.enumString({ enum: [...KINDS] }),
    summary: Schema.string(),
    reasons: Schema.array({ items: Schema.string() }),
    link: Schema.string(),
    phone: Schema.string(),
    actions: Schema.array({ items: Schema.string() }),
  },
});

/**
 * Scan model for photos, screenshots and pasted text. Hybrid: Gemini Nano
 * on-device first (the image never leaves the device), cloud fallback when
 * Nano isn't available. onDeviceOnly never calls the cloud.
 */
export function makeScanModel(ai: AI, cloudModel: string, onDeviceOnly: boolean, cloudOnly = false): GenerativeModel {
  return getGenerativeModel(ai, {
    mode: onDeviceOnly ? InferenceMode.ONLY_ON_DEVICE : cloudOnly ? InferenceMode.ONLY_IN_CLOUD : InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }],
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

export const SCAN_PROMPT = `You help older adults and their families spot scams.
Look at what the user captured: a photo or screenshot of an ad, a text message, an email, a letter, a social media post, a website or a shop, or pasted text.
Decide: "scam" only with strong signs (fake prize or debt, pressure to pay now, unusual payment like gift cards or crypto or bank transfer, fake delivery or toll fees, "Hi Mum" new-number requests, impersonation, deals far too good to be true, links that don't match the real company).
"suspicious" if there are real warning signs. Otherwise "safe".
Normal messages are "safe": an order or shipping update from a shop that points to that shop's own website, asks for no payment or login, and has no pressure. A link by itself is not a warning sign.
summary: one plain sentence a grandparent understands.
reasons: up to 3 short reasons (max 14 words each).
link: the main web address shown, or "". phone: the main phone number shown, or "".
actions: up to 3 short steps, starting with a verb (e.g. "Don't click the link", "Call your bank on the number on your card").
Never repeat card numbers, codes or passwords you see.
Reply as JSON.`;

export function parseScan(text: string): Omit<ScanResult, "source" | "ms"> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The AI gave an empty answer. Please try again.");
  const o = JSON.parse(match[0]);
  const verdict = String(o.verdict ?? "").toLowerCase() as Verdict;
  if (!VERDICTS.includes(verdict)) throw new Error(`Unknown verdict: ${o.verdict}`);
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 3) : []);
  return {
    verdict,
    confidence: Math.max(0, Math.min(1, Number(o.confidence ?? 0.5))),
    kind: (KINDS as readonly string[]).includes(o.kind) ? o.kind : "other",
    summary: String(o.summary ?? ""),
    reasons: list(o.reasons),
    link: String(o.link ?? "").trim(),
    phone: String(o.phone ?? "").trim(),
    actions: list(o.actions),
  };
}

/** Scans an image (base64 JPEG/PNG) and/or text. */
export async function runScan(model: GenerativeModel, input: { imageB64?: string; mimeType?: string; text?: string }): Promise<ScanResult> {
  const parts: (string | Part)[] = [SCAN_PROMPT];
  if (input.text) parts.push(`User text:\n"""${input.text.slice(0, 4000)}"""`);
  if (input.imageB64) parts.push({ type: "inlineData", inlineData: { data: input.imageB64, mimeType: input.mimeType ?? "image/jpeg" } });
  const t0 = performance.now();
  const result = await withRetry(() => model.generateContent(parts));
  return {
    ...parseScan(result.response.text()),
    source: result.response.inferenceSource === "on_device" ? "on_device" : "in_cloud",
    ms: Math.round(performance.now() - t0),
  };
}
