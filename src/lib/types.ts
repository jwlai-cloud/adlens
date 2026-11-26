export type Verdict = "safe" | "suspicious" | "scam";
export const VERDICTS: Verdict[] = ["safe", "suspicious", "scam"];

/** Facts read from the page by the injected extractor. Never includes form values. */
export interface PageSignals {
  url: string;
  hostname: string;
  protocol: string;
  title: string;
  /** Visible text, whitespace-collapsed, capped at 6000 chars. */
  text: string;
  maxDiscount: number;
  urgency: string[];
  riskyPayments: string[];
  hasReturnsPolicy: boolean;
  hasPrivacyPolicy: boolean;
  hasContactPage: boolean;
  /** Domains of contact emails shown on the page (not the addresses). */
  emailDomains: string[];
  metaRefresh: boolean;
  cardFieldOnHttp: boolean;
  /** Other hosts that "checkout / buy now / pay" links point to. */
  externalCheckoutHosts: string[];
}

export interface Finding {
  /** 0–100, higher = riskier. */
  score: number;
  reasons: string[];
}

export type Source = "on_device" | "in_cloud" | "community";

export interface TriageResult {
  verdict: Verdict;
  confidence: number;
  reasons: string[];
  source: Source;
  ms: number;
}

export interface DeepResult {
  verdict: Verdict;
  reasons: string[];
  sources: { uri: string; title: string }[];
  ms: number;
}

export interface CommunityEntry {
  verdict: Verdict;
  reasons: string[];
  reports: number;
}
