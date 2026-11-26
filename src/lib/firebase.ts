import { initializeApp, type FirebaseApp } from "firebase/app";
import { CustomProvider, initializeAppCheck } from "firebase/app-check";
import { getAI, GoogleAIBackend, type AI } from "firebase/ai";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth/web-extension";

declare global {
  // eslint-disable-next-line no-var
  var FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean | undefined;
}

export interface Services {
  app: FirebaseApp;
  ai: AI;
  db: Firestore;
}

const env = import.meta.env;

export function initFirebase(): Services {
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
  if (!config.apiKey || !config.appId) {
    throw new Error("Firebase config missing. Copy .env.example to .env.local, fill it in, and rebuild.");
  }
  const app = initializeApp(config);

  // App Check is required by Firebase AI Logic. reCAPTCHA can't run in an
  // extension (MV3 blocks remote scripts and chrome-extension:// isn't a
  // domain), so we use the debug provider, which the hackathon accepts.
  // The CustomProvider is never asked for a token while a debug token is set.
  globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG_TOKEN || true;
  initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: () => Promise.reject(new Error("Set VITE_APPCHECK_DEBUG_TOKEN in .env.local")),
    }),
    isTokenAutoRefreshEnabled: true,
  });

  return {
    app,
    ai: getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true }),
    db: getFirestore(app),
  };
}

let signedIn: Promise<unknown> | undefined;
/** Anonymous sign-in, only needed before writing to the shared blocklist. */
export function ensureSignedIn(app: FirebaseApp): Promise<unknown> {
  signedIn ??= signInAnonymously(getAuth(app));
  return signedIn;
}
