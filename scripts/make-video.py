"""Cuts video/raw/{shop,panel}.webm (from record-demo.mjs) into a captioned 1080p draft.

Usage: python3 scripts/make-video.py   ->  video/adlens-demo-draft.mp4
"""
import json
import subprocess
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RAW, OUT = ROOT / "video/raw", ROOT / "video/build"
OUT.mkdir(parents=True, exist_ok=True)
W, H, BG, INK, MUTED, ACCENT = 1920, 1080, (21, 23, 26), (236, 234, 228), (155, 160, 166), (111, 201, 240)
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
# Both recordings start ~1.9 s after the capture script's clock (synced on the red banner / red verdict).
OFF = 2.1  # ponytail: measured per take (red banner / red verdict sync); re-measure after re-recording


def font(path, size):
    return ImageFont.truetype(path, size)


def card(name, lines):
    """lines: list of (text, size, bold, color, gap_after)."""
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    wrapped = []
    for text, size, bold, color, gap in lines:
        f = font(BOLD if bold else REG, size)
        for i, part in enumerate(textwrap.wrap(text, width=max(20, int(1700 / (size * 0.52))))):
            wrapped.append((part, f, color, gap if i == 0 else 0, size))
    total = sum(s * 1.25 + g for _, _, _, g, s in wrapped)
    y = (H - total) / 2
    for part, f, color, gap, size in wrapped:
        w = d.textlength(part, font=f)
        d.text(((W - w) / 2, y), part, font=f, fill=color)
        y += size * 1.25 + gap
    path = OUT / f"{name}.png"
    im.save(path)
    return path


def caption(name, text):
    im = Image.new("RGBA", (W, 104), (12, 13, 15, 235))
    d = ImageDraw.Draw(im)
    f = font(BOLD, 33)
    lines = textwrap.wrap(text, width=96)[:2]
    y = (104 - len(lines) * 42) / 2
    for line in lines:
        d.text(((W - d.textlength(line, font=f)) / 2, y), line, font=f, fill=INK)
        y += 42
    path = OUT / f"cap_{name}.png"
    im.save(path)
    return path


def run(args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def still(name, png, seconds):
    out = OUT / f"{name}.mp4"
    run(["-loop", "1", "-t", str(seconds), "-i", str(png), "-f", "lavfi", "-t", str(seconds), "-i",
         "anullsrc=r=48000:cl=stereo", "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-c:a", "aac",
         "-shortest", str(out)])
    return out


def segment(name, start, end, text):
    a, b = start - OFF, end - OFF
    cap = caption(name, text)
    out = OUT / f"{name}.mp4"
    graph = (
        f"color=c=0x15171a:s={W}x{H}:d={b - a:.2f}[bg];"
        "[0:v]scale=1288:960[s];[1:v]crop=440:788:0:0,scale=537:962[p];"
        "[bg][s]overlay=32:12[t1];[t1][p]overlay=1351:12[t2];[t2][2:v]overlay=0:976,fps=30,format=yuv420p[v]"
    )
    run(["-ss", f"{a:.2f}", "-to", f"{b:.2f}", "-i", str(RAW / "shop.webm"),
         "-ss", f"{a:.2f}", "-to", f"{b:.2f}", "-i", str(RAW / "panel.webm"),
         "-i", str(cap), "-f", "lavfi", "-t", f"{b - a:.2f}", "-i", "anullsrc=r=48000:cl=stereo",
         "-filter_complex", graph, "-map", "[v]", "-map", "3:a", "-t", f"{b - a:.2f}",
         "-c:v", "libx264", "-c:a", "aac", str(out)])
    return out


m = json.loads((RAW / "marks.json").read_text())
parts = [
    still("c1_hook", card("hook", [
        ("Fake shops buy ads.", 84, True, INK, 30),
        ("Brand-name sneakers at 90% off. Bank transfer only.", 44, False, MUTED, 10),
        ("A Gmail support address.", 44, False, MUTED, 10),
        ("Shoppers find out after they pay.", 44, False, MUTED, 0),
    ]), 5.5),
    still("c2_title", card("title", [
        ("AdLens", 120, True, INK, 18),
        ("Is this shop real? Know before you pay.", 50, False, INK, 40),
        ("A Chrome extension: Gemini Nano on-device first, Gemini in the cloud only when needed.", 36, False, ACCENT, 8),
        ("Built with Firebase AI Logic hybrid inference.", 36, False, ACCENT, 0),
    ]), 5.5),
    segment("s1_legit", m["legit"], m["legitDone"] + 4,
            "A normal independent shop: Looks legit. This browser has no Gemini Nano, so the same check ran in the cloud, with personal data removed."),
    segment("s2_fake", m["fake"], m["deepStart"] + 2.5,
            "A fake discount store: Likely a scam. Rule-based red flags plus Gemini: 90% off a brand, bank transfer only, Gmail support."),
    segment("s3_deep", m["deepEnd"] - 1.0, m["deepEnd"] + 4.5,
            "Deep check: Gemini in the cloud re-judges the page and confirms the scam. (Waiting time cut.)"),
    segment("s4_reload", m["reload"] - 0.5, m["reloadDone"] + 4,
            "Second visit: the answer comes instantly from the shared Firestore blocklist. No AI call needed."),
    segment("s5_cloaked", m["cloaked"], m["cloakedDone"] + 3.5,
            "A fake news ad page that sends you to another site to pay: flagged."),
    segment("s6_privacy", m["privacy"] - 0.5, m["end"],
            "On-device only: nothing leaves the browser. This browser can't run Gemini Nano, so AdLens says so instead of quietly using the cloud."),
    still("c3_arch", card("arch", [
        ("How it works", 70, True, INK, 34),
        ("1. Rule-based red flags, in the browser", 33, False, INK, 14),
        ("2. Shared blocklist hit?  Instant answer, no AI call  (Firestore)", 33, False, INK, 14),
        ("3. Triage: Gemini Nano on-device, cloud fallback  (Firebase AI Logic, PREFER_ON_DEVICE)", 33, False, INK, 14),
        ("4. Deep check: Gemini in the cloud opens the page itself  (URL context, fallback models)", 33, False, INK, 14),
        ("5. Confirmed scams go into the shared blocklist  (Firestore + Anonymous Auth + rules)", 33, False, INK, 30),
        ("Remote Config for models and thresholds  ·  App Check on every cloud call  ·  Personal data removed before any cloud call", 27, False, ACCENT, 0),
    ]), 9),
    still("c4_close", card("close", [
        ("AdLens: know before you pay.", 80, True, INK, 36),
        ("github.com/jwlai-cloud/adlens", 48, False, ACCENT, 16),
        ("Firebase AI Logic  ·  Gemini Nano  ·  Firestore  ·  Remote Config  ·  App Check", 34, False, MUTED, 0),
    ]), 6),
]
(OUT / "list.txt").write_text("".join(f"file '{p}'\n" for p in parts))
final = ROOT / "video/adlens-demo-draft.mp4"
run(["-f", "concat", "-safe", "0", "-i", str(OUT / "list.txt"), "-c", "copy", str(final)])
print(final)
