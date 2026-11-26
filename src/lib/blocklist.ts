import { doc, getDoc, increment, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import type { CommunityEntry, Verdict } from "./types";

/**
 * Blocklist key: the hostname. Local demo pages share "localhost", so for
 * those the path is included. Firestore IDs can't contain "/".
 */
export function domainKey(url: string): string {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const key = host === "localhost" || host === "127.0.0.1" ? host + u.pathname : host;
  return key.replace(/\//g, "|");
}

export async function lookup(db: Firestore, key: string): Promise<CommunityEntry | null> {
  const snap = await getDoc(doc(db, "domains", key));
  if (!snap.exists()) return null;
  const d = snap.data();
  return { verdict: d.verdict, reasons: d.reasons ?? [], reports: d.reports ?? 0 };
}

/** Adds one report. Only suspicious/scam verdicts from a cloud deep check are stored. */
export async function report(db: Firestore, key: string, verdict: Verdict, reasons: string[]): Promise<void> {
  if (verdict === "safe") return;
  await setDoc(
    doc(db, "domains", key),
    { verdict, reasons: reasons.slice(0, 3), reports: increment(1), updatedAt: serverTimestamp() },
    { merge: true },
  );
}
