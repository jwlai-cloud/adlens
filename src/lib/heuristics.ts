import type { Finding, PageSignals } from "./types";

// ponytail: small hand-picked lists; move to Remote Config if they need tuning without a release.
const BRANDS = [
  "nike", "adidas", "apple", "samsung", "dyson", "lego", "ray-ban", "lululemon", "gucci",
  "rolex", "pandora", "ugg", "stanley", "yeti", "sony", "bose", "the north face", "new balance",
  "aerostride", // fictional brand used by the demo pages (no real trademarks in the demo video)
];
const RISKY_TLDS = ["shop", "top", "xyz", "store", "buzz", "icu", "online", "site", "click", "vip", "sbs", "cfd"];
const FREE_MAIL = ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "163.com", "qq.com", "proton.me"];

const isLocal = (host: string) => host === "localhost" || host === "127.0.0.1";

/** Deterministic red flags. Cheap, explainable, and gives the model a head start. */
export function scoreSignals(s: PageSignals): Finding {
  const hits: [number, string][] = [];
  const add = (w: number, r: string) => hits.push([w, r]);
  const head = (s.title + " " + s.text.slice(0, 400)).toLowerCase();
  const host = s.hostname.toLowerCase();

  if (s.maxDiscount >= 70) add(25, `Discounts up to ${s.maxDiscount}% off, far below normal retail`);
  else if (s.maxDiscount >= 50) add(10, `Heavy discounts (${s.maxDiscount}% off)`);

  const brand = BRANDS.find((b) => head.includes(b));
  if (brand && !host.replace(/-/g, "").includes(brand.replace(/[\s-]/g, "")) && s.maxDiscount >= 50) {
    add(20, `Sells ${brand.replace(/\b\w/g, (c) => c.toUpperCase())} at deep discounts, but this isn't the brand's site`);
  }

  const tld = host.split(".").pop() ?? "";
  if (RISKY_TLDS.includes(tld)) add(10, `Uses a .${tld} domain, common for throwaway shops`);
  if ((host.match(/-/g) ?? []).length >= 2 || (host.match(/\d/g) ?? []).length >= 3) add(5, "Unusual domain name");

  if (s.urgency.length >= 2) add(10, `Pressure tactics: "${s.urgency.slice(0, 2).join('", "')}"`);
  else if (s.urgency.length === 1) add(5, `Pressure tactic: "${s.urgency[0]}"`);

  if (s.riskyPayments.length) add(25, `Asks for payment by ${s.riskyPayments.slice(0, 2).join(" or ")} (no buyer protection)`);

  if (!s.hasReturnsPolicy) add(10, "No returns or refund policy");
  if (!s.hasContactPage) add(10, "No contact page");
  if (!s.hasPrivacyPolicy) add(5, "No privacy policy");
  if (s.emailDomains.some((d) => FREE_MAIL.includes(d))) add(10, "Support email is a free webmail address");

  if (s.metaRefresh) add(15, "Page auto-redirects (possible cloaking)");
  if (s.externalCheckoutHosts.length) add(15, `Checkout goes to a different site (${s.externalCheckoutHosts[0]})`);

  if (s.cardFieldOnHttp) add(30, "Asks for card details on an insecure (http) page");
  else if (s.protocol === "http:" && !isLocal(host)) add(10, "Page is not secure (http)");

  hits.sort((a, b) => b[0] - a[0]);
  return {
    score: Math.min(100, hits.reduce((n, [w]) => n + w, 0)),
    reasons: hits.map(([, r]) => r),
  };
}
