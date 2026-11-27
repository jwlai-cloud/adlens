# Demo video (AdLens Live)

File: `video/adlens-live-demo.mp4` (about 1:46, 1080p). Narration: Junwei's Personal Voice via `say`. Scene 8 is the agent's real Gemini Live voice.

Rebuild:
```bash
node scripts/record-app.mjs           # phone-size capture of the hosted app + agent audio
python3 scripts/make-app-video.py     # cut, headlines, narration, loudness
```
On-device screenshots live in `video/nano/` (taken from real Chrome with Gemini Nano).

| # | Scene | Headline | Narration |
|---|---|---|---|
| 01 | Hook: the four sample scams | Is this one real? | Every day, scammers text, email and advertise to older people. A parcel fee. A "Hi Mum, this is my new number." Sneakers at ninety percent off. The question is always the same. Is this one real? |
| 02 | Title card | AdLens Live | This is AdLens Lyve. Point your camera at it, and get a plain answer. |
| 03 | On-device: real Chrome + Gemini Nano screenshots | Checked on your device | On a laptop with Gemini Nano, Chrome checks the screenshot right on the device. Nothing is uploaded. It says this looks like a scam, explains why, and tells you exactly what to do now. |
| 04 | Phone: "Hi Mum" scan (cloud fallback) | "Hi Mum, new number" | On a phone without Gemini Nano, the same check runs in the cloud, and the badge says so. Here's a "Hi Mum" text from a new number. AdLens spots the family impersonation trick. |
| 05 | Warn my family -> family view | Warn my family | Tap "Warn my family" and send them a link. They see the warning and what to do. Never your photo. |
| 06 | 90% off ad -> deep check the link | Deep check the link | When there's a link, AdLens can check it in the cloud. Gemini opens the page itself, so you don't have to. |
| 07 | Ask tab: typed question, tool cards | Ask AdLens | And you can just ask. AdLens uses the Gemini Lyve API. It's an agent with tools. It looks at your last scan, checks the link, and looks up reports from other people. |
| 08 | Agent answers in its own voice (Gemini Live audio, recorded) | It answers out loud | (agent voice) |
| 09 | How it works card | How it works | Under the hood, it's Firebase AI Logic hybrid inference. On-device first for private scans, and the cloud only when it helps. Gemini Lyve with function calling. Firestore for shared reports and family links. Remote Config for every model. And App Check on every call. |
| 10 | Close: URL + repo | AdLens Live: know before you pay. | AdLens Lyve. Know before you pay. |
