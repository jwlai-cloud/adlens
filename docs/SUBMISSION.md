# Devpost submission draft

**Name:** AdLens: is this shop real?
**Tagline:** A Chrome extension that spots fake shops and scam ad pages on-device with Gemini Nano, and calls Gemini in the cloud only when it needs to dig deeper.
**Platform:** Web (Chrome)
**Repo:** <GitHub URL>  **Video:** <YouTube URL>  **Test build:** <GitHub Release zip>

## Inspiration
Fake shops buy ads on social media and search. They show brand-name sneakers at 90% off, a "free bottle, just pay shipping" story dressed up as news, or a checkout that only takes bank transfers. Browser protection catches malware and phishing, but not a shop that looks real and never ships. We work in ad-fraud detection, and we kept seeing the same patterns reach real shoppers. We wanted the answer on the page, before anyone pays, without sending everyone's browsing to a server.

## What it does
Open any shop or ad landing page and the AdLens side panel gives a verdict: **Looks legit**, **Be careful** or **Likely a scam**, with up to three reasons in plain words.
- Every page is checked **on-device by Gemini Nano**. A badge shows whether each verdict came from the device or the cloud.
- If Nano isn't available, the same check falls back to Gemini in the cloud, with personal data removed first.
- On risky pages, **Deep check** asks Gemini in the cloud to open the page itself, the way a first-time visitor would, and judge it. That catches cloaked pages that show the extension one thing and shoppers another.
- Confirmed scams go into a **shared blocklist**. The next shopper gets the answer instantly, with no AI call at all.
- **On-device only** mode never touches the cloud, for people who want full privacy.

## How we built it
- **Firebase AI Logic** hybrid inference in a Chrome extension side panel:
  - Triage uses `InferenceMode.PREFER_ON_DEVICE`, with JSON output enforced on both Gemini Nano (`responseConstraint`) and the cloud fallback (`responseSchema`).
  - `inferenceSource` drives the On-device / Cloud badge.
  - `initializeDeviceModel()` gives users a one-click Nano download with progress.
- **Deep check** is cloud only. It uses Gemini with the **URL context** tool, with a fallback model for when the main one is overloaded. It can also run as a **server prompt template**, so the prompt stays on the server. Google Search grounding is one Remote Config switch away for a billing-enabled project.
- **Rule-based red flags** run before the model: extreme discounts, brand-name goods on a non-brand domain, bank-transfer-only payment, missing returns or contact pages, auto-redirects, checkout on another domain. They're cheap and explainable, and they give a small on-device model a strong starting point within its token limit.
- **Firestore** holds the shared blocklist. **Anonymous Auth** and security rules allow exactly one report per write, in a fixed shape; we tested the rules against the emulator.
- **Remote Config** holds model names and thresholds. **App Check** protects every cloud call.
- TypeScript and Vite, Manifest V3. Built with Claude Code and the Firebase Agent Skills.

## Challenges we ran into
- **Where Nano can run.** Chrome's Prompt API isn't available in workers, so the extension's service worker can't run Gemini Nano. We moved all AI into the side panel page.
- **App Check in an extension.** reCAPTCHA needs a web domain and loads a remote script, which Manifest V3 blocks. We used the App Check debug provider, which the hackathon allows, behind a custom provider, so no remote code ships.
- **Free tier limits.** Google Search grounding returned 429 on every model in a free project. So the deep check uses URL context by default and keeps Search behind a Remote Config switch. Free cloud models were also overloaded at times, so the deep check retries, caps each call at 30 s, and falls back to a second free model.
- **Small models are easy to persuade.** A well-written scam page can talk an on-device model into "safe". The rule-based score sets a floor: a page with strong red flags can't be called safe.

## Accomplishments we're proud of
- The same verdict works on any machine. It's fully on-device where Nano exists, and the cloud fills in where it doesn't, with no extra code paths in the UI.
- The shared blocklist makes the product cheaper the more it's used: repeat visits cost no AI calls.
- Privacy is built in, not added later: redaction before any cloud call, and a true on-device-only mode.

## What we learned
- Hybrid isn't just a fallback. "On-device first, escalate only when needed" is the right shape for anything that runs on every page load.
- Deterministic checks plus a small local model beat either one alone.

## What's next
- iOS and Android share-sheet versions: share a link or a screenshot of an ad and ask "Is this shop real?" It would run Apple Foundation Models or Gemini Nano on-device, with the same cloud deep check and blocklist.
- Optional reporting of scam ads to the ad platform, building on our ad-fraud work.
- Chrome Web Store release.
