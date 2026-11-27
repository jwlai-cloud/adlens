"""Builds the AdLens Live demo: video/app (Playwright recording + agent voice),
video/voice/*.wav (narration), video/nano/*.jpg (real Chrome + Gemini Nano screenshots).

Usage: python3 scripts/make-app-video.py  ->  video/adlens-live-demo.mp4
"""
import json
import subprocess
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
V = ROOT / "video"
APP, VOICE, NANO, OUT = V / "app", V / "voice", V / "nano", V / "build2"
OUT.mkdir(exist_ok=True)
W, H = 1920, 1080
BG, INK, MUTED, ACCENT, DEVICE = (20, 22, 26), (240, 238, 232), (160, 165, 172), (116, 203, 241), (181, 170, 255)
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
OFF = 6.2  # ponytail: app.webm starts ~6.2 s after record-app.mjs's clock (checked on frames); re-check after re-recording
m = json.loads((APP / "marks.json").read_text())


def run(args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)]))


def font(path, size):
    return ImageFont.truetype(path, size)


def text_block(d, x, y, text, f, fill, width_chars, line_h):
    for line in textwrap.wrap(text, width=width_chars):
        d.text((x, y), line, font=f, fill=fill)
        y += line_h
    return y


def side_panel(name, title, sub, tag=None, tag_color=ACCENT):
    """Transparent 1920x1080 overlay: headline on the right of the phone."""
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x, y = 960, 380
    if tag:
        f = font(BOLD, 30)
        tw = d.textlength(tag, font=f)
        d.rounded_rectangle([x, y - 70, x + tw + 36, y - 22], radius=24, outline=tag_color, width=3)
        d.text((x + 18, y - 64), tag, font=f, fill=tag_color)
    y = text_block(d, x, y, title, font(BOLD, 68), INK, 24, 80)
    text_block(d, x, y + 18, sub, font(REG, 38), MUTED, 40, 50)
    p = OUT / f"side_{name}.png"
    im.save(p)
    return p


def card(name, lines, images=None):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    if images:  # collage of sample screenshots across the top
        n = len(images)
        tw, th = 300, 434
        gap = 40
        x0 = (W - (n * tw + (n - 1) * gap)) // 2
        for i, p in enumerate(images):
            t = Image.open(p).convert("RGB").resize((tw, th))
            im.paste(t, (x0 + i * (tw + gap), 90))
    y = 600 if images else None
    rows = []
    for text, size, bold, color, gap in lines:
        f = font(BOLD if bold else REG, size)
        for i, part in enumerate(textwrap.wrap(text, width=max(18, int(1650 / (size * 0.52))))):
            rows.append((part, f, color, gap if i == 0 else 0, size))
    total = sum(s * 1.22 + g for _, _, _, g, s in rows)
    y = y if y is not None else (H - total) / 2
    for part, f, color, gap, size in rows:
        d.text(((W - d.textlength(part, font=f)) / 2, y), part, font=f, fill=color)
        y += size * 1.22 + gap
    p = OUT / f"card_{name}.png"
    im.save(p)
    return p


def audio_track(name, length, items):
    """items: [(wav, start_s)] mixed onto silence of `length` seconds."""
    out = OUT / f"a_{name}.wav"
    args = ["-f", "lavfi", "-t", f"{length:.2f}", "-i", "anullsrc=r=48000:cl=mono"]
    filt, labels = [], ["[0:a]"]
    for i, (wav, start) in enumerate(items, 1):
        args += ["-i", str(wav)]
        filt.append(f"[{i}:a]aresample=48000,adelay={int(start * 1000)}[d{i}]")
        labels.append(f"[d{i}]")
    filt.append(f"{''.join(labels)}amix=inputs={len(labels)}:duration=first:normalize=0[a]")
    run([*args, "-filter_complex", ";".join(filt), "-map", "[a]", "-t", f"{length:.2f}", str(out)])
    return out


def still_seg(name, png, length, audio):
    out = OUT / f"{name}.mp4"
    run(["-loop", "1", "-t", f"{length:.2f}", "-i", str(png), "-i", str(audio),
         "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-c:a", "aac", "-ar", "48000", "-shortest", str(out)])
    return out


def app_seg(name, ranges, side, audio, pad_end=0.0):
    """ranges: [(start_mark, end_mark)] cut from app.webm and joined; phone on the left, headline on the right."""
    parts, labels = [], []
    for i, (a, b) in enumerate(ranges):
        parts.append(f"[0:v]trim={a - OFF:.2f}:{b - OFF:.2f},setpts=PTS-STARTPTS,crop=430:900:0:0,scale=480:1004[c{i}]")
        labels.append(f"[c{i}]")
    total = sum(b - a for a, b in ranges) + pad_end
    g = ";".join(parts) + f";{''.join(labels)}concat=n={len(labels)}:v=1:a=0,tpad=stop_mode=clone:stop_duration={pad_end:.2f}[ph];"
    g += f"color=c=0x14161a:s={W}x{H}:d={total:.2f}[bg];[bg][ph]overlay=330:38[t];[t][1:v]overlay=0:0,fps=30,format=yuv420p[v]"
    out = OUT / f"{name}.mp4"
    run(["-i", str(APP / "app.webm"), "-i", str(side), "-i", str(audio), "-filter_complex", g,
         "-map", "[v]", "-map", "2:a", "-t", f"{total:.2f}", "-c:v", "libx264", "-c:a", "aac", "-ar", "48000", str(out)])
    return out, total


def nano_seg(name, shots, side, audio):
    """Real Chrome screenshots (Gemini Nano on-device), centre column cropped, gentle zoom."""
    clips = []
    for i, (img, secs) in enumerate(shots):
        im = Image.open(img).convert("RGB").crop((370, 0, 942, 868)).resize((620, 940))
        canvas = Image.new("RGB", (W, H), BG)
        canvas.paste(im, (300, 70))
        frame = Image.alpha_composite(canvas.convert("RGBA"), Image.open(side)).convert("RGB")
        p = OUT / f"{name}_{i}.png"
        frame.save(p)
        c = OUT / f"{name}_{i}.mp4"
        run(["-loop", "1", "-t", f"{secs:.2f}", "-i", str(p),
             "-vf", f"scale=2112:1188,zoompan=z='min(zoom+0.0007,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={int(secs * 30)}:s={W}x{H}:fps=30,format=yuv420p",
             "-c:v", "libx264", str(c)])
        clips.append(c)
    lst = OUT / f"{name}_list.txt"
    lst.write_text("".join(f"file '{c}'\n" for c in clips))
    silent = OUT / f"{name}_v.mp4"
    run(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(silent)])
    out = OUT / f"{name}.mp4"
    run(["-i", str(silent), "-i", str(audio), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-shortest", str(out)])
    return out


vo = {k: VOICE / f"{k}.wav" for k in ["01", "02", "03", "04", "05", "06", "07", "09", "10"]}
L = {k: dur(p) for k, p in vo.items()}
segs = []

# 1. Hook
t = L["01"] + 1.2
samples = [ROOT / "app-public/samples" / f for f in ["parcel-fee.png", "hi-mum.png", "sneaker-ad.png", "legit-order.png"]]
segs.append(still_seg("s01", card("hook", [("Is this one real?", 76, True, INK, 0)], samples), t, audio_track("s01", t, [(vo["01"], 0.4)])))

# 2. Title
t = L["02"] + 1.4
segs.append(still_seg("s02", card("title", [
    ("AdLens Live", 120, True, INK, 20),
    ("Point your camera at it. Get a plain answer.", 50, False, INK, 36),
    ("Gemini Nano on-device first · Gemini in the cloud when it helps · Firebase AI Logic", 34, False, ACCENT, 0),
]), t, audio_track("s02", t, [(vo["02"], 0.3)])))

# 3. On-device (real Chrome + Gemini Nano screenshots)
t = L["03"] + 1.0
shots = [(NANO / "home.jpg", 2.6), (NANO / "reading.jpg", 3.0), (NANO / "result.jpg", t - 5.6)]
segs.append(nano_seg("s03", shots, side_panel("nano", "Checked on your device", "Gemini Nano runs inside Chrome. The screenshot never leaves the laptop.", "On-device · Gemini Nano", DEVICE),
                     audio_track("s03", t, [(vo["03"], 0.4)])))

# 4. "Hi Mum" on a phone (cloud fallback)
rng = [(m["himum"] - 0.3, m["himumDone"] + 5.0)]
t = sum(b - a for a, b in rng)
segs.append(app_seg("s04", rng, side_panel("himum", "\"Hi Mum, new number\"", "No Gemini Nano on this phone, so the same check runs in the cloud. The badge says so.", "Cloud fallback"),
                    audio_track("s04", t, [(vo["04"], 0.3)]))[0])

# 5. Warn my family
rng = [(m["share"] - 0.2, m["share"] + 2.6), (m["family"] + 0.2, m["family"] + 3.4)]
t = sum(b - a for a, b in rng)
segs.append(app_seg("s05", rng, side_panel("share", "Warn my family", "One link shows them the warning and what to do. Never your photo.", "Firestore"),
                    audio_track("s05", t, [(vo["05"], 0.4)]))[0])

# 6. Ad + deep check of its link
rng = [(m["ad"] - 0.2, m["adDone"] + 1.8), (m["deep"] - 0.3, m["deep"] + 1.8), (m["deepDone"] - 0.6, m["deepDone"] + 3.2)]
t = sum(b - a for a, b in rng)
segs.append(app_seg("s06", rng, side_panel("deep", "Deep check the link", "Gemini in the cloud opens the page itself, so you don't have to. (Wait shortened.)", "Cloud · URL context"),
                    audio_track("s06", t, [(vo["06"], 1.2)]))[0])

# 7. Ask AdLens: typed question, agent uses tools
rng = [(m["ask"] - 0.2, m["askSend"] + 3.0), (m["agentFirstWords"] - 4.0, m["agentFirstWords"])]
t = sum(b - a for a, b in rng)
segs.append(app_seg("s07", rng, side_panel("ask", "Ask AdLens", "A Gemini Live agent with tools: your last scan, link checks, community reports.", "Gemini Live API"),
                    audio_track("s07", t, [(vo["07"], 0.4)]))[0])

# 8. The agent answers in its own voice
agent_wav = APP / "agent.wav"
t = dur(agent_wav) + 1.2
start = m["agentFirstWords"] - 0.3
avail = (m["end"] - OFF + 0.0) - (start - OFF)
seg, _ = app_seg("s08", [(start, start + min(t, avail))], side_panel("agent", "It answers out loud", "Checked the link, looked up reports, and offers to report the scam, only if you agree.", "Agent voice: Gemini Live"),
                 audio_track("s08", t, [(agent_wav, 0.3)]), pad_end=max(0.0, t - avail))
segs.append(seg)

# 9. Architecture
t = L["09"] + 1.2
segs.append(still_seg("s09", card("arch", [
    ("How it works", 70, True, INK, 30),
    ("Scan: Gemini Nano on-device first (PREFER_ON_DEVICE), cloud fallback, second opinion only on your OK", 29, False, INK, 14),
    ("Ask: Gemini Live API with function calling: get_last_scan, check_link, lookup_reports, report_scam", 29, False, INK, 14),
    ("Link check: Gemini + URL context, fallback models  ·  Read aloud: Gemini TTS", 29, False, INK, 14),
    ("Firestore: shared reports + family links (Anonymous Auth, security rules)", 29, False, INK, 28),
    ("Remote Config for every model  ·  App Check on every call  ·  Firebase Hosting", 27, False, ACCENT, 0),
]), t, audio_track("s09", t, [(vo["09"], 0.4)])))

# 10. Close
t = 6.0
segs.append(still_seg("s10", card("close", [
    ("AdLens Live: know before you pay.", 78, True, INK, 34),
    ("adlens-bhai-g1o56.web.app", 52, False, ACCENT, 14),
    ("github.com/jwlai-cloud/adlens", 40, False, MUTED, 0),
]), t, audio_track("s10", t, [(vo["10"], 0.4)])))

lst = OUT / "list.txt"
lst.write_text("".join(f"file '{s}'\n" for s in segs))
joined = OUT / "joined.mp4"
run(["-f", "concat", "-safe", "0", "-i", str(lst), "-c:v", "copy", "-c:a", "aac", "-ar", "48000", str(joined)])
final = V / "adlens-live-demo.mp4"
run(["-i", str(joined), "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "160k", str(final)])
print(final, f"{dur(final):.1f}s")
