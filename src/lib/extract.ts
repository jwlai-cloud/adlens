import type { PageSignals } from "./types";

/**
 * Runs inside the page via chrome.scripting.executeScript, so it must be fully
 * self-contained: no imports, no outer variables, no helpers defined outside.
 */
export function extractSignals(): PageSignals {
  const body = document.body;
  const raw = (body && (body.innerText || body.textContent)) || "";
  const text = raw.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();

  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
  const linkInfo = links.map((a) => ({
    label: ((a.textContent || "") + " " + a.getAttribute("href")).toLowerCase(),
    host: (() => {
      try {
        return new URL(a.href, location.href).hostname;
      } catch {
        return "";
      }
    })(),
  }));
  const linkMatches = (re: RegExp) => linkInfo.some((l) => re.test(l.label));

  const discounts = Array.from(lower.matchAll(/(\d{2})\s?%\s?off/g)).map((m) => Number(m[1]));

  const URGENCY = [
    "only a few left", "left in stock", "hurry", "limited time", "ends in", "ends today",
    "last chance", "selling fast", "people are viewing", "today only", "clearance sale",
  ];
  const PAYMENTS = [
    "bank transfer", "wire transfer", "zelle", "western union", "bitcoin", "crypto",
    "usdt", "gift card", "money order", "cash app",
  ];

  const emailDomains = Array.from(
    new Set(Array.from(text.matchAll(/[\w.+-]+@([\w-]+\.[\w.-]+)/g)).map((m) => m[1].toLowerCase())),
  );

  const externalCheckoutHosts = Array.from(
    new Set(
      linkInfo
        .filter((l) => /checkout|buy now|pay now|order now/.test(l.label) && l.host && l.host !== location.hostname)
        .map((l) => l.host),
    ),
  );

  return {
    url: location.href,
    hostname: location.hostname,
    protocol: location.protocol,
    title: document.title,
    text: text.slice(0, 6000),
    maxDiscount: discounts.length ? Math.max(...discounts) : 0,
    urgency: URGENCY.filter((p) => lower.includes(p)),
    riskyPayments: PAYMENTS.filter((p) => lower.includes(p)),
    hasReturnsPolicy: linkMatches(/return|refund/),
    hasPrivacyPolicy: linkMatches(/privacy/),
    hasContactPage: linkMatches(/contact/),
    emailDomains,
    metaRefresh: !!document.querySelector('meta[http-equiv="refresh" i]'),
    cardFieldOnHttp:
      location.protocol === "http:" &&
      !["localhost", "127.0.0.1"].includes(location.hostname) &&
      !!document.querySelector('input[autocomplete^="cc-"], input[name*="card" i]'),
    externalCheckoutHosts,
  };
}
