import { VERDICTS, type Finding, type Verdict } from "./types";

/** Parses model output into a verdict. Accepts raw JSON or JSON wrapped in prose/code fences. */
export function parseVerdictJson(text: string): { verdict: Verdict; confidence: number; reasons: string[] } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Model returned no JSON");
  const obj = JSON.parse(match[0]);
  const verdict = String(obj.verdict ?? "").toLowerCase() as Verdict;
  if (!VERDICTS.includes(verdict)) throw new Error(`Unknown verdict: ${obj.verdict}`);
  const confidence = Math.max(0, Math.min(1, Number(obj.confidence ?? 0.5)));
  const reasons = Array.isArray(obj.reasons) ? obj.reasons.map(String).filter(Boolean).slice(0, 3) : [];
  return { verdict, confidence, reasons };
}

/**
 * The model has the final say, except it can't call a page "safe" when the
 * deterministic checks found strong red flags. Small on-device models are
 * easy to talk out of suspicion by a well-written scam page.
 */
export function mergeVerdict(model: Verdict, finding: Finding, threshold: number): Verdict {
  if (model === "safe" && finding.score >= threshold) return "suspicious";
  return model;
}
