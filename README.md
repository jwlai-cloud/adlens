# AdLens Live: is this a scam?

**Try it: https://adlens-bhai-g1o56.web.app** (phone or desktop Chrome)

AdLens Live helps older adults and their families catch scams before they lose money.

- **Point the camera** at a suspicious ad, text message or letter, or share a screenshot. **Gemini Nano checks it on your device**, so the photo of your private messages never leaves your phone.
- **Get plain answers:** "This looks like a scam", why, and what to do now. Tap **Read aloud** to hear it.
- **Ask AdLens out loud.** A **Gemini Live** voice agent talks it through, can see through the camera, checks links in the cloud, looks up reports from other users, and reports scams so others are warned.
- **Warn my family:** send a link that shows the warning and what to do, never your photo.

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/) with Firebase AI Logic. Platform: Web (Chrome). A companion Chrome extension checks shops and ad pages as you browse.

## Why

Scams reach people through ads, texts and letters, and older adults lose the most. They're told "don't click links", but the real question is "is *this* one real?", and they need a plain answer right then, often while a scammer is pushing them to pay. Sending photos of your private messages to a server to find out is its own risk.

## How it uses hybrid inference

| Feature | Where it runs | Firebase AI Logic |
|---|---|---|
| Scan a photo, screenshot or text | **On-device** with Gemini Nano (image input); cloud fallback if the device can't run Nano | `InferenceMode.PREFER_ON_DEVICE`, JSON schema on both sides |
| On-device only mode | **On-device** only, never the cloud | `InferenceMode.ONLY_ON_DEVICE` |
| Second opinion | Cloud, **only when the user taps it** after Nano flags something | `InferenceMode.ONLY_IN_CLOUD` |
| Deep check a link | Cloud: Gemini opens the page itself (URL context), with fallback models | `tools: [{ urlContext: {} }]` |
| Ask AdLens (voice + camera) | Cloud: **Gemini Live API** with function calling | `getLiveGenerativeModel`, `startAudioConversation`, `sendVideoRealtime` |
| Read aloud | Cloud: Gemini TTS | `responseModalities: [AUDIO]` |

The app shows where each answer came from: **On-device · Gemini Nano** or **Cloud**.

### The Live agent's tools
- `get_last_scan`: what the user just scanned
- `check_link`: deep check a web address in the cloud
- `lookup_reports`: has anyone reported this website or phone number?
- `report_scam`: add it to the shared blocklist, only after the user agrees

### Other Firebase
- **Firestore:** shared scam reports (by website or phone number) and "Warn my family" links. Security rules allow fixed-shape writes only (`firestore.rules`, emulator-tested).
- **Anonymous Auth** before any write. **Remote Config** for every model name and threshold. **App Check** on every cloud call.
- **Firebase Hosting** for the app.

### Privacy
- Photos and screenshots are checked on-device when Gemini Nano is available. If it isn't, the badge says Cloud and the photo goes to Gemini in the cloud; turn on **On-device only** to prevent that.
- Shared warnings contain the verdict and advice only, never the image.
- The agent never asks for passwords, card numbers or codes.

## Try it as a judge
1. Open https://adlens-bhai-g1o56.web.app.
2. Tap an example ("Parcel fee", "Hi Mum", "90% off ad", "Order update"), or use Camera, Screenshot or Paste text.
3. For on-device inference on desktop Chrome, enable Gemini Nano in `chrome://flags` (search "Gemma 4 for Built-in AI" or "Prompt API for Gemini Nano"), restart, and reload. The header then says "Gemini Nano ready on this device". Without it, scans use the cloud.
4. Tap **Ask** and allow the microphone to talk to AdLens. Try "I got a text asking me to pay a parcel fee, is it real?"

The hosted demo uses a judging-only App Check debug token, which we'll revoke after judging.

## Run it yourself

Requirements: Node 20+, Chrome 139+, a Firebase project on the free Spark plan.

1. Create a Firebase project and a Web app. Then:
   ```bash
   npx firebase login
   npx firebase use --add
   npx firebase init ailogic --interactive
   npx firebase deploy --only firestore:rules,remoteconfig,auth
   ```
   (`auth` turns on Anonymous sign-in from `firebase.json`.)
2. Register an App Check debug token: `npx firebase appcheck:debugtokens:create --app <appId>`.
3. `cp .env.example .env.local` and fill in the web app config and the token.
4. `npm install`, then `npm run app:dev` for the web app at http://localhost:5176.
5. Deploy: put the token in `.env.web.local`, then run `./scripts/deploy-web.sh`.

### Companion Chrome extension
`npm run build` builds the extension into `dist/`. Load it unpacked in `chrome://extensions`. It checks the shop or ad page you're on with the same hybrid approach, plus rule-based red flags and the shared blocklist. A prebuilt zip is in the [releases](https://github.com/jwlai-cloud/adlens/releases).

## Tests
```bash
npm test             # red-flag rules, redaction, verdict parsing
npm run test:rules   # Firestore security rules against the emulator (needs Java 21+)
```

## Project layout
```
index.html, src/app/            AdLens Live web app
src/lib/scan.ts                 hybrid photo/text scan (Gemini Nano + cloud)
src/lib/agent.ts                Gemini Live voice agent and its tools
src/lib/deepCheck.ts            cloud link check (URL context, fallback models)
src/lib/speech.ts               Read aloud (Gemini TTS)
src/lib/share.ts, blocklist.ts  Firestore: family warnings, shared reports
src/lib/firebase.ts, config.ts  Firebase init, App Check, Remote Config
sidepanel.html, src/sidepanel/  companion Chrome extension
firestore.rules, remoteconfig.template.json, app-public/samples/
```

## Built with
Firebase AI Logic (Gemini Nano via the Chrome Prompt API, Gemini Developer API, Gemini Live API, Gemini TTS), Firestore, Firebase Auth, Remote Config, App Check, Firebase Hosting, TypeScript, Vite. Built with Claude Code and the Firebase Agent Skills.

## License
[Apache-2.0](LICENSE)
