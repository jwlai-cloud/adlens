# Implementation Plan: AdLens

Deadline: **Mon Nov 30, 2:00 PM PT** (submission locks; later commits ignored). Target prize: Best Web/Chrome + grand.

## Overview
AdLens is a Chrome extension that tells shoppers whether the shop or ad landing page they are on is a scam. Gemini Nano checks every page on-device (private, free, instant). Only risky pages go to Gemini in the cloud for a grounded verdict with reasons. Confirmed scams feed a shared Firestore blocklist, so the next user gets an instant answer.

## Spec (short)
**User:** online shoppers who click social/search ads; secondary: their less tech-savvy family.

**Must have**
1. Side panel shows a verdict for the current tab: Safe / Suspicious / Scam, top 3 reasons, and an **On-device / Cloud** badge.
2. Triage runs on-device first (`PREFER_ON_DEVICE`); falls back to cloud when Nano is missing, so judges without Nano still see it work.
3. Suspicious or Scam → "Deep check" in the cloud with URL context + Google Search grounding.
4. Shared blocklist: deep-check verdicts stored per domain in Firestore; checked before any model call.
5. Privacy: only URL + extracted signals leave the device, with emails/phones/card-like numbers removed. "On-device only" toggle never calls the cloud.
6. App Check on every cloud call (debug provider, token from gitignored env).

**Out of scope:** auto-blocking pages, accounts/sign-in UI, Android, image generation, Live API.

**Success = demo shows:** legit shop → Safe on-device in <2 s; fake shop → Suspicious on-device → Deep check in cloud → Scam with grounded reasons → second visit instant from blocklist.

## Architecture decisions
- **No ADK / no backend.** Rules require all AI through Firebase AI Logic; the client SDK does hybrid routing. ADK would add a server calling Gemini directly.
- **Side panel hosts all AI.** Chrome's Prompt API is not available in workers, so the MV3 service worker can't run Nano. The side panel (an extension page) runs Firebase AI Logic. Service worker only relays tab events; content script only extracts signals.
- **Two model instances, two routing patterns** (matches what the Firebase team showed):
  - Triage: hybrid `PREFER_ON_DEVICE`, JSON schema output (`onDeviceParams.promptOptions.responseConstraint` + `inCloudParams.generationConfig.responseSchema`), cloud fallback `gemini-3.5-flash-lite`.
  - Deep check: server prompt template (cloud only) with `urlContext` + `googleSearch` tools, model `gemini-3.8-flash`. Templates can't be hybrid; that's fine for this feature.
- **Deterministic heuristics before the model** (domain age hints, price too low, urgency words, payment-only-by-transfer, mismatched brand in title vs domain). Cheap, testable, and gives Nano good input under its ~9k-token limit.
- **Remote Config** holds model names, template ID, risk thresholds. No hard-coded model IDs.
- **Firestore** `domains/{domain}`: verdict, reasons, reportCount, updatedAt. Anonymous Auth for writes; rules allow create/update of known fields only.
- **Build:** Vite + TypeScript + `@crxjs/vite-plugin` (bundles Firebase; MV3 forbids remote code). Vitest for logic tests. Apache-2.0 license.
- **Demo reliability:** three local fixture pages (fake shop, cloaked ad landing, legit shop) served by Vite, so the demo never depends on finding a live scam that day.

## Dependency graph
```
Firebase project (AI Logic, App Check debug, Firestore, Remote Config, Anon Auth)
  └── T1 spike: side panel + hybrid call + inferenceSource badge
        ├── T2 signal extraction (content script) ── fixtures
        │     └── T3 on-device triage verdict
        │           ├── T4 cloud deep check (server template)
        │           │     └── T5 shared blocklist (Firestore)
        │           └── T7 privacy mode + redaction
        └── T6 Remote Config wiring
T8 UI polish + Nano download onboarding ← T3–T7
T9 repo/packaging ← all; T10 video + Devpost ← T9
```

## Task list

### Phase 1 — Foundation + riskiest bit (Wed Nov 25)
**T0: Firebase project setup** (user + agent)
- Accept: project created; `npx -y firebase-tools@latest init ailogic` run; Web app registered; Firestore + Anon Auth + Remote Config enabled; App Check debug token registered.
- Verify: `firebase apps:list` shows web app; console shows AI Logic enabled.
- Size: XS (console work).

**T1: Spike — side panel runs a hybrid prompt** (highest risk)
- Accept: extension loads unpacked; side panel opens on toolbar click; "Test" button calls `generateContent` with `PREFER_ON_DEVICE`; panel shows text + `inferenceSource` (`ON_DEVICE` with Nano flag on, `IN_CLOUD` with it off).
- Verify: `npm run build` clean; manual check both flag states; App Check token accepted (no 403).
- Files: `manifest`, `vite.config.ts`, `src/sidepanel/*`, `src/lib/firebase.ts`. Size: M.
- **If Nano fails in the side panel:** try an offscreen document; if that fails too, pivot to a hosted web app (same code) and keep the extension as a thin launcher. Decide by end of day.

### Checkpoint A (end Wed)
- [ ] Both inference sources observed in the side panel
- [ ] Decision logged: side panel vs fallback

### Phase 2 — Core flow (Thu Nov 26)
**T2: Page signals + fixtures**
- Accept: content script returns `PageSignals` (url, domain, title, visible text ≤ 6k chars, prices, contact info present, payment methods, urgency phrases, outbound links); heuristic pre-score 0–100; three fixture pages.
- Verify: `npm test` — heuristic scores fake > 60, legit < 30 on fixtures.
- Files: `src/content/extract.ts`, `src/lib/heuristics.ts` (+test), `fixtures/*.html`. Size: M.

**T3: On-device triage verdict**
- Accept: on tab change/load, panel shows verdict (safe/suspicious/scam), 3 reasons, badge; toolbar icon badge colour matches; result cached per URL for the session.
- Verify: fixtures give expected verdicts with Nano on and off; schema parse test.
- Files: `src/lib/triage.ts` (+test), `src/sidepanel/*`, `src/background.ts`. Size: M.

**T4: Cloud deep check**
- Accept: server template `adlens-deep-check` (urlContext + googleSearch, JSON output) locked in console; "Deep check" button (auto when suspicious ≥ threshold) shows verdict + cited reasons; badge `Cloud`.
- Verify: fake fixture → scam with reasons; network error → friendly retry with backoff on 429/503.
- Files: `src/lib/deepCheck.ts`, `prompts/deep-check.prompt` (copy of template for the repo). Size: S–M.

### Checkpoint B (end Thu)
- [ ] Full demo path works on fixtures: safe on-device → suspicious → deep check → scam
- [ ] Tests pass, build clean

### Phase 3 — Platform depth (Fri Nov 27)
**T5: Shared blocklist** — Firestore read before triage, write after deep check; Anon Auth; rules restrict fields. Verify: second visit shows "Flagged by N users" with no model call; rules tested in emulator or by a denied bad write. Size: M.

**T6: Remote Config** — model names, template ID, thresholds fetched at startup with defaults. Verify: change threshold in console → behaviour changes after reload. Size: S.

**T7: Privacy mode** — redact emails/phones/card-like numbers before cloud; "On-device only" toggle uses `ONLY_ON_DEVICE` and hides Deep check. Verify: redaction unit test; network tab shows no cloud call in toggle mode. Size: S.

### Checkpoint C (end Fri)
- [ ] All must-haves met; human review of UX

### Phase 4 — Polish + ship (Sat Nov 28 – Sun Nov 29)
**T8: UI polish + onboarding** — Nano status card with "Download on-device model" button (`initializeDeviceModel` on click, progress bar); clear empty/error states; latency shown per verdict. Size: M.

**T9: Repo + packaging** — README (value prop, setup, how Firebase AI Logic is used, Chrome flag steps, testing instructions), LICENSE Apache-2.0, architecture diagram, `.env.example`, zipped build in GitHub Release. Verify: fresh clone → README steps → works. Size: S.

**T10: Video + Devpost** — ≤3 min, first 30 s = who/problem/hybrid; show the On-device → Cloud switch and blocklist hit; English captions; upload to YouTube **by Sun** (processing time). Size: M.

### Final checkpoint (Mon Nov 30, before 12:00 PM PT — 2 h buffer)
- [ ] Repo public, license in About, Firebase AI Logic imported + called
- [ ] Video public on YouTube, ≤3 min
- [ ] Devpost form complete, platform = Web/Chrome
- [ ] No secrets/debug tokens in repo

**Stretch (only if Checkpoint C is green early):** hosted web "paste a link" checker on Firebase Hosting with reCAPTCHA Enterprise App Check (gives judges a no-install path).

## Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Prompt API not usable in side panel | High | T1 spike first; offscreen doc → hosted web app fallback |
| App Check in extension (reCAPTCHA needs a domain) | High | Debug provider (allowed in submission); token via gitignored env; revoke after judging |
| Nano not installed on judge machines | Med | `PREFER_ON_DEVICE` falls back to cloud; video shows both |
| Free-tier rate limits (429) | Med | Blocklist + session cache cut calls; backoff; record video early |
| Server prompt templates are Preview | Med | Keep a plain `ONLY_IN_CLOUD` model with tools as fallback |
| Nano token limit (~9k) | Low | Signals capped at 6k chars + heuristics summary |
| Live scam pages vanish | Low | Local fixtures for demo |

## Open questions
1. Judges' test build: ship the zip with a debug token (revocable, not in repo), or rely on video only? Recommend: zip with a separate revocable token, documented in testing instructions only.
2. Solo or team? Affects parallel tasks (T5/T6/T7 can run in parallel after T3).
