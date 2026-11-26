# AdLens todo

## Built (Nov 25)
- [x] T1 Side panel + hybrid triage (`PREFER_ON_DEVICE`, inferenceSource badge)
- [x] T2 Page signals, rule-based red flags, 3 demo pages, unit tests
- [x] T3 Verdict UI + toolbar badge
- [x] T4 Cloud deep check (Google Search + URL context; optional server prompt template)
- [x] T5 Firestore shared blocklist + rules (emulator-tested)
- [x] T6 Remote Config (models, template ID, threshold, auto deep check)
- [x] T7 Privacy: redaction + on-device-only mode
- [x] T8 Nano download button + progress, empty/error states
- [x] T9 README, Apache-2.0 LICENSE, `.env.example`, `npm run zip`
- [x] T10 drafts: docs/SUBMISSION.md, docs/VIDEO.md

## Firebase (Nov 26)
- [x] Project `adlens-bhai-g1o56`, web app, AI Logic, Firestore (nam5), Anonymous Auth, App Check API
- [x] Rules + Remote Config deployed; App Check debug token in `.env.local`
- [x] Live test (dev.html): triage on 3 pages, deep check, blocklist write/read all work (cloud path)
- [x] Free tier: Google Search grounding = 429, so deep check uses URL context; overloaded models → 30 s cap + fallback

## Needs you
- [ ] Load `dist/` unpacked in Chrome, enable Nano flag, run the 3 demo pages
      ← first live check of Nano in the extension side panel (the plan's biggest risk)
- [ ] Optional: create + lock the server prompt template, set `deep_check_template_id`
- [x] Dev App Check token rotated (old one revoked); judges' zip uses its own token
- [ ] **After Dec 16:** revoke the token named "AdLens judges v0.1.0b (revoke after Dec 16)": `npx firebase appcheck:debugtokens:list --app <appId>` then `:delete`
- [x] Test blocklist entry cleared
- [x] Public repo https://github.com/jwlai-cloud/adlens (Apache-2.0 detected), release v0.1.0 with zip
- [x] Draft video: `video/adlens-demo-draft.mp4` (71 s, captions, cloud path; re-make with `node scripts/record-demo.mjs` + `python3 scripts/make-video.py`)
- [ ] Optional: re-record with real Chrome + Nano for the On-device badge, add voice-over
- [ ] Upload video to YouTube (public) by Sun Nov 29
- [ ] Devpost form (docs/SUBMISSION.md), submit by Mon Nov 30 12:00 PM PT
