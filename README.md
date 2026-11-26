# AdLens: is this shop real?

AdLens is a Chrome extension that tells shoppers whether the shop or ad landing page they're on is a scam, before they pay.

- **On-device first.** Gemini Nano checks every page in Chrome. It's private, free and works offline.
- **Cloud only when needed.** Risky pages get a deep check from Gemini in the cloud, which opens the page itself (URL context) and sees what a first-time visitor sees.
- **Shared blocklist.** Confirmed scams go into a shared Firestore blocklist, so the next shopper gets an instant answer with no AI call.

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/), Web/Chrome track.

## Why

Fake shops advertise on social and search: brand-name sneakers at 90% off, "free bottle, just pay shipping" landing pages, bank-transfer-only checkouts. Browser protection catches malware and phishing, but not a shop that looks real and never ships. Shoppers need an answer on the page, in plain words, before they pay. They shouldn't have to send their browsing to a server to get it.

## How it works

```
Tab loads ──► content extract (in page) ──► rule-based red flags (0–100)
                                                   │
                                  shared blocklist hit? ──yes──► instant verdict (no AI call)
                                                   │ no
                         Hybrid triage: Gemini Nano on-device  ──(Nano missing)──►  Gemini cloud fallback
                                                   │
                           suspicious / scam ──► Deep check (cloud only): Gemini opens the URL
                                                   │
                                     verdict + sources ──► shared blocklist (Firestore)
```

| Step | Where it runs | Firebase |
|---|---|---|
| Extract page signals | Page (`chrome.scripting`) | none |
| Rule-based red flags | Side panel, local | none |
| Shared blocklist lookup | Cloud | Firestore |
| Triage verdict | **On-device** (Gemini Nano), cloud fallback | AI Logic `InferenceMode.PREFER_ON_DEVICE` |
| On-device-only mode | **On-device** only | AI Logic `InferenceMode.ONLY_ON_DEVICE` |
| Deep check | Cloud | AI Logic + URL context tool (Google Search optional), fallback model, optional server prompt template |
| Report a scam | Cloud | Firestore + anonymous Auth + security rules |
| Model names, thresholds | Cloud | Remote Config |
| Abuse protection | Cloud | App Check (required by AI Logic) |

### How Firebase AI Logic is used
- `src/lib/triage.ts`: a hybrid model with `getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE, onDeviceParams, inCloudParams })`. JSON output is enforced on both sides: `responseConstraint` for Gemini Nano, `responseSchema` for the cloud model. The panel shows `response.inferenceSource`, so you can see whether each verdict came from **On-device** or **Cloud**.
- `src/lib/deepCheck.ts`: cloud-only deep check with `tools: [{ urlContext: {} }]`, so Gemini fetches the page itself and can spot cloaking. If the main model (`gemini-4-hydrogen`) is overloaded, it falls back to `gemini-3.8-flash`. Google Search grounding can be turned on with Remote Config `deep_check_search`, but it needs a billing-enabled project: on the free tier it returns 429. If Remote Config sets `deep_check_template_id`, the check uses a **server prompt template** (`getTemplateGenerativeModel`) instead, so the prompt stays on the server (`prompts/adlens-deep-check.prompt`).
- `src/lib/nano.ts`: `model.initializeDeviceModel()` downloads Gemini Nano from a button click, with a progress bar.
- `src/lib/config.ts`: model IDs come from Remote Config, so they can change without a new release.

### Privacy
- Page content is checked on-device whenever Gemini Nano is available.
- Before anything goes to the cloud, emails, phone numbers and card-like numbers are removed (`src/lib/redact.ts`). Form values are never read.
- **On-device only** mode never calls the cloud. That includes the blocklist lookup, so even the domain stays local.

### Why a side panel
Chrome's Prompt API (Gemini Nano) isn't available in workers, so the extension's service worker only opens the panel. All AI runs in the side panel page.

## Quick test (judges)

1. Download `adlens-chrome-v0.1.0.zip` from the [latest release](https://github.com/jwlai-cloud/adlens/releases/latest) and unzip it.
2. Go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the unzipped folder.
3. Click the AdLens toolbar icon to open the side panel, then browse to any shop.
4. Demo pages: clone this repo, run `npm install && npm run fixtures`, and open http://localhost:5174/.
5. Optional, for on-device inference: enable Gemini Nano in `chrome://flags` (see step 3 under "Load in Chrome" below). Without it, AdLens uses the cloud model and the badge says **Cloud**.

The release build connects to our Firebase project with a judging-only App Check debug token, which we'll revoke after judging.

## Run it

Requirements: Node 20+, Chrome 139+ on desktop, and a Firebase project on the free Spark plan.

### 1. Firebase project (one time)
1. Create a project in the [Firebase console](https://console.firebase.google.com/) and add a **Web app**.
2. Turn on **AI Logic** with the Gemini Developer API (free tier). From the CLI:
   ```bash
   npx -y firebase-tools@latest login
   npx -y firebase-tools@latest use --add
   npx -y firebase-tools@latest init ailogic
   ```
3. Create a **Firestore** database. Turn on **Authentication → Anonymous**.
4. Deploy the security rules and Remote Config defaults:
   ```bash
   npx -y firebase-tools@latest deploy --only firestore:rules,remoteconfig
   ```
5. **App Check → Apps → your web app → Manage debug tokens**: add a token, then copy it.
   - reCAPTCHA can't run inside a Chrome extension, so AdLens uses the App Check debug provider. The hackathon accepts debug tokens.
6. Optional: in **AI Logic → Prompt templates**, create a template from `prompts/adlens-deep-check.prompt`. Lock it, then set Remote Config `deep_check_template_id` to its ID.

### 2. Build
```bash
cp .env.example .env.local   # fill in the web app config and the debug token
npm install
npm run build
```
`.env.local` is gitignored. Never commit the debug token.

### 3. Load in Chrome
1. Go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `dist/`.
2. Click the AdLens toolbar icon to open the side panel.
3. For on-device inference, enable Gemini Nano in `chrome://flags`: search "Gemma 4 for Built-in AI" or "Prompt API for Gemini Nano". Restart Chrome, then click **Download on-device model** in the panel.
   - Without Nano, AdLens still works and uses the cloud model. The badge says **Cloud**.

### 4. Try it on the demo pages
```bash
npm run fixtures   # serves http://localhost:5174/
```
- `legit-shop.html` → **Looks legit**
- `fake-shop.html` → **Likely a scam** → run **Deep check** → reload: the answer now comes from the **Shared blocklist**
- `cloaked-landing.html` → **Be careful** (auto-redirect, checkout on another site)

All demo pages are fictional and local.

## Tests
```bash
npm test             # red-flag rules on the demo pages, redaction, verdict parsing
npm run test:rules   # Firestore security rules against the emulator
```
`test:rules` starts the Firestore emulator, which needs Java 21+. With Homebrew: `brew install openjdk@21`, then `export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"`. The extension itself doesn't need Java.

## Project layout
```
public/manifest.json, background.js   MV3 manifest; service worker opens the side panel
sidepanel.html, src/sidepanel/        UI
src/lib/extract.ts                    runs in the page, reads signals (no form values)
src/lib/heuristics.ts                 rule-based red flags
src/lib/triage.ts                     hybrid Gemini Nano / cloud verdict
src/lib/deepCheck.ts                  cloud deep check (URL context, fallback model)
src/lib/blocklist.ts                  Firestore shared blocklist
src/lib/firebase.ts, config.ts        Firebase init, App Check, Remote Config
firestore.rules, remoteconfig.template.json, prompts/
fixtures/                             demo pages
```

## Built with
Firebase AI Logic (Gemini Nano via Chrome Prompt API, Gemini Developer API), Firestore, Firebase Auth, Remote Config, App Check, TypeScript, Vite. Built with Claude Code and Firebase Agent Skills.

## License
[Apache-2.0](LICENSE)
