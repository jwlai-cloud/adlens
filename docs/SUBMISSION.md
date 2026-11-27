# Devpost submission draft

**Name:** AdLens Live
**Tagline:** Point your camera at a suspicious ad, text or letter. Gemini Nano checks it on your device, and a Gemini Live voice agent talks you through what to do.
**Platform:** Web (Chrome)
**Try it:** https://adlens-bhai-g1o56.web.app
**Repo:** https://github.com/jwlai-cloud/adlens
**Video:** <YouTube URL>

## Inspiration
Scams reach people through ads, texts and letters: a parcel "customs fee", a "Hi Mum, this is my new number", brand sneakers at 90% off. Older adults lose the most, and the advice they get ("don't click links") doesn't answer the real question: is *this* one real? They need a plain answer right then, often while someone is pushing them to pay. And sending photos of their private messages to a server to find out is its own risk. We've worked on ad-fraud detection, and we wanted something a grandparent could actually use.

## What it does
- **Scan anything:** point the camera at an ad, a text or a letter, share a screenshot, or paste text. **Gemini Nano reads it on your device**, so private messages stay private. You get "This looks like a scam", why, and up to three steps for what to do now. The badge shows **On-device · Gemini Nano**.
- **Second opinion:** when Nano flags something, one tap asks a bigger Gemini model in the cloud. Nothing is uploaded without that tap.
- **Ask AdLens out loud:** a **Gemini Live** voice agent you can talk to, which can also see through the camera. It uses tools: it looks at your last scan, checks links in the cloud, looks up whether others reported a website or phone number, and reports scams to warn others, only after you agree.
- **Read aloud** for people who find small text hard, using Gemini TTS.
- **Warn my family:** a link that shows the warning and what to do on a relative's phone, never your photo.
- **On-device only** mode for people who never want anything sent to the cloud.

## How we built it
- **Firebase AI Logic hybrid inference** for the scan: `InferenceMode.PREFER_ON_DEVICE` with image and text input, and JSON output enforced on both Gemini Nano (`responseConstraint`) and the cloud model (`responseSchema`). `inferenceSource` drives the On-device / Cloud badge. The second opinion uses `ONLY_IN_CLOUD`, and On-device only mode uses `ONLY_ON_DEVICE`.
- **Gemini Live API** through Firebase AI Logic: `getLiveGenerativeModel` plus `startAudioConversation` for voice, `sendVideoRealtime` for camera frames at one per second, and function calling for the agent's four tools.
- **Cloud link check** with Gemini and the URL context tool, so the model opens the page itself, with a 30-second cap per model and a fallback chain across free models.
- **Gemini TTS** for Read aloud.
- **Firestore** for shared scam reports and family warning links, with Anonymous Auth and security rules that only allow fixed-shape writes (tested against the emulator). **Remote Config** holds every model name. **App Check** protects every cloud call. **Firebase Hosting** serves the app.
- A companion **Chrome extension** checks shop and ad pages as you browse, with rule-based red flags and the same shared blocklist.
- TypeScript and Vite. Built with Claude Code and the Firebase Agent Skills.

## Challenges we ran into
- **Small models over-warn.** Gemini Nano first flagged a normal "your order has shipped" text as suspicious. We tightened the prompt with what normal messages look like, and added the user-approved second opinion, so a false alarm gets a quick check without sending everything to the cloud.
- **Free tier limits.** Google Search grounding returned 429 on every model in a free project, so the link check uses URL context instead. Free models were sometimes overloaded, so the link check retries, caps each call, and falls back to other free models.
- **App Check without a server.** We use the App Check debug provider for the demo, which the hackathon allows, behind a custom provider so no third-party script is needed.

## Accomplishments we're proud of
- The same app works everywhere: fully on-device where Gemini Nano exists, and the cloud fills in where it doesn't, with the badge always saying which.
- A voice agent that takes real actions (checks links, looks up and files reports) instead of only chatting.
- Built for people who aren't tech-savvy: large text, plain words, Read aloud, and family sharing.

## What we learned
- Hybrid isn't just a fallback. "On-device first, cloud only when it helps, and only with permission" is the right shape for anything that touches private messages.
- A small local model plus a clear escalation path beats either one alone.

## What's next
- Native Android (Gemini Nano) and iOS (Apple Foundation Models) apps with a share-sheet "Is this a scam?" action.
- A family circle: alerts when a relative scans something dangerous, with their permission.
- Partnerships with banks and national scam-reporting services, so a report reaches the people who can act.
