import { addDoc, collection, doc, getDoc, serverTimestamp, type Firestore } from "firebase/firestore";
import type { ScanResult } from "./scan";

export type SharedWarning = Pick<ScanResult, "verdict" | "kind" | "summary" | "reasons" | "actions" | "link">;

/** Saves a warning anyone with the link can open. Only the verdict and advice are shared, never the image. */
export async function shareWarning(db: Firestore, r: ScanResult): Promise<string> {
  const data: SharedWarning = {
    verdict: r.verdict,
    kind: r.kind,
    summary: r.summary.slice(0, 300),
    reasons: r.reasons.slice(0, 3).map((s) => s.slice(0, 200)),
    actions: r.actions.slice(0, 3).map((s) => s.slice(0, 200)),
    link: r.link.slice(0, 300),
  };
  const ref = await addDoc(collection(db, "shares"), { ...data, createdAt: serverTimestamp() });
  return ref.id;
}

export async function loadWarning(db: Firestore, id: string): Promise<SharedWarning | null> {
  const snap = await getDoc(doc(db, "shares", id));
  return snap.exists() ? (snap.data() as SharedWarning) : null;
}
