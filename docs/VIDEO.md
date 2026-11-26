# Demo video script (target 2:40, hard limit 3:00)

Record at 1920×1080. Chrome with the AdLens side panel open, demo pages from `npm run fixtures`. Add English captions. Upload to YouTube **by Sunday Nov 29**, because processing can take hours.

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:20 | A social feed with a "brand sneakers 90% off" ad, then a click | "Fake shops buy ads. Brand sneakers at 90% off, a checkout that only takes bank transfer. Shoppers find out after they pay. AdLens tells them before." |
| 0:20–0:35 | Title card: AdLens + "Gemini Nano on-device · Gemini in the cloud · Firebase AI Logic" | "AdLens is a Chrome extension. Gemini Nano checks every page on your device. Gemini in the cloud only steps in when it needs to dig deeper." |
| 0:35–0:55 | `legit-shop.html` → green **Looks legit**, zoom on the **On-device · Gemini Nano** pill and the ms timing | "A normal shop: checked on-device in under a second. Nothing left the laptop." |
| 0:55–1:25 | `fake-shop.html` → red **Likely a scam**, reasons, then expand the red flags | "This one: brand-name sneakers at 90% off on a site that isn't the brand's, bank transfer only, a Gmail support address. Rule-based checks plus Gemini Nano, still on-device." |
| 1:25–1:55 | Click **Run deep check** → cloud verdict | "For risky pages, Deep check sends only the URL, title, red flags and a short redacted excerpt to Gemini in the cloud, which opens the page itself, like a first-time visitor, and confirms the verdict." |
| 1:55–2:10 | Reload the fake shop → **Shared blocklist** pill, "No AI call needed" | "The result goes into a shared blocklist in Firestore. The next shopper gets the answer instantly, with no AI call at all." |
| 2:10–2:25 | Turn off the Nano flag (or use a second profile) → same page shows the **Cloud** pill. Then turn on **On-device only** | "No Gemini Nano on this machine? The same check runs in the cloud, with personal data removed first. Want full privacy? On-device only never touches the cloud." |
| 2:25–2:40 | Architecture diagram from the README | "Firebase AI Logic hybrid inference, URL context, Firestore, Remote Config and App Check. AdLens: know before you pay." |

Tips
- Show the On-device → Cloud switch early. Judges may only watch the video.
- No real brand logos on screen. The demo pages use text only.
