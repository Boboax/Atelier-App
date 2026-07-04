#!/usr/bin/env python
"""Generate Atelier app icons (paper-toned square with a serif 'A.')."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "assets")
os.makedirs(OUT, exist_ok=True)
PAPER = (246, 243, 236); INK = (35, 32, 27); ACCENT = (180, 83, 42)

FONTS = ["georgiab.ttf", "pala.ttf", "palab.ttf", "timesbd.ttf", "constanb.ttf", "Georgia.ttf"]
def load_font(size):
    for f in FONTS:
        p = os.path.join(r"C:\Windows\Fonts", f)
        if os.path.exists(p):
            try: return ImageFont.truetype(p, size)
            except Exception: pass
    return ImageFont.load_default()

def make(size):
    pad = max(2, size // 16)
    im = Image.new("RGB", (size, size), PAPER)
    d = ImageDraw.Draw(im)
    # subtle inner frame
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=size // 7,
                        outline=INK, width=max(2, size // 64))
    font = load_font(int(size * 0.62))
    txt = "A"
    bb = d.textbbox((0, 0), txt, font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    x = (size - tw) / 2 - bb[0]
    y = (size - th) / 2 - bb[1] - size * 0.03
    d.text((x, y), txt, font=font, fill=INK)
    # accent dot
    r = max(3, size // 22)
    d.ellipse([size * 0.66, size * 0.62, size * 0.66 + r * 2, size * 0.62 + r * 2], fill=ACCENT)
    return im

for sz, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]:
    make(sz).save(os.path.join(OUT, name))
    print("wrote", name)
print("icons in", os.path.abspath(OUT))
