import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { domainKey } from "./blocklist";
import { extractSignals } from "./extract";
import { scoreSignals } from "./heuristics";
import { redact } from "./redact";
import { mergeVerdict, parseVerdictJson } from "./verdict";

function load(name: string) {
  const html = readFileSync(`${process.cwd()}/fixtures/${name}`, "utf8");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(`http://localhost:5174/${name}`);
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  return scoreSignals(extractSignals());
}

describe("fixture pages", () => {
  beforeEach(() => (document.body.innerHTML = ""));

  it("scores the legit shop low", () => {
    const f = load("legit-shop.html");
    expect(f.score).toBeLessThan(25);
  });

  it("scores the fake shop high, for the right reasons", () => {
    const f = load("fake-shop.html");
    expect(f.score).toBeGreaterThanOrEqual(70);
    expect(f.reasons.join(" ")).toMatch(/90% off/);
    expect(f.reasons.join(" ")).toMatch(/bank transfer/);
    expect(f.reasons.join(" ")).toMatch(/Aerostride/);
  });

  it("flags the cloaked ad landing page", () => {
    const f = load("cloaked-landing.html");
    expect(f.score).toBeGreaterThanOrEqual(45);
    expect(f.reasons.join(" ")).toMatch(/redirect|different site/);
  });
});

describe("helpers", () => {
  it("redacts personal data", () => {
    const out = redact("Mail jo@x.com, card 4111 1111 1111 1111, call +61 412 345 678");
    expect(out).not.toMatch(/jo@x\.com|4111|412/);
  });

  it("parses verdict JSON wrapped in prose", () => {
    const v = parseVerdictJson('Sure:\n```json\n{"verdict":"Scam","confidence":1.4,"reasons":["a","b","c","d"]}\n```');
    expect(v).toEqual({ verdict: "scam", confidence: 1, reasons: ["a", "b", "c"] });
  });

  it("won't let the model call a heavily flagged page safe", () => {
    expect(mergeVerdict("safe", { score: 80, reasons: [] }, 45)).toBe("suspicious");
    expect(mergeVerdict("safe", { score: 10, reasons: [] }, 45)).toBe("safe");
  });

  it("builds blocklist keys", () => {
    expect(domainKey("https://www.Shop.example/a/b")).toBe("shop.example");
    expect(domainKey("http://localhost:5174/fake-shop.html")).toBe("localhost|fake-shop.html");
  });
});
