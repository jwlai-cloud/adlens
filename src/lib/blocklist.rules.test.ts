// @vitest-environment node
// Runs against the Firestore + Auth emulators: `npm run test:rules`.
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import { connectFirestoreEmulator, doc, getFirestore, setDoc } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import { lookup, report } from "./blocklist";

const app = initializeApp({ projectId: "demo-adlens", apiKey: "demo-key" }, "rules-test");
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8080);
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("blocklist rules", () => {
  const key = `test-${Date.now()}.example`;

  it("rejects writes when not signed in", async () => {
    await expect(report(db, key, "scam", ["x"])).rejects.toThrow(/permission/i);
  });

  it("lets a signed-in user report, one at a time", async () => {
    await signInAnonymously(auth);
    await report(db, key, "scam", ["fake store"]);
    await report(db, key, "scam", ["fake store"]);
    expect(await lookup(db, key)).toEqual({ verdict: "scam", reasons: ["fake store"], reports: 2 });
  });

  it("rejects forged report counts and 'safe' entries", async () => {
    await expect(
      setDoc(doc(db, "domains", key), { verdict: "scam", reasons: [], reports: 99, updatedAt: new Date() }),
    ).rejects.toThrow(/permission/i);
    await expect(
      setDoc(doc(db, "domains", `other-${key}`), { verdict: "safe", reasons: [], reports: 1, updatedAt: new Date() }),
    ).rejects.toThrow(/permission/i);
  });
});
