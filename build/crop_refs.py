#!/usr/bin/env python3
"""Carve single-figure references out of the bundled multi-figure Bargue plates.

A real atelier never shows the whole lithograph sheet next to your paper —
the plate is masked so ONE figure sits beside the drawing (that's the whole
geometry of sight-size). The bundled plates are 2–4-figure sheets, so this
script crops each usable figure into its own reference (category 'cast',
shown first in the sight-size / master-copy / value pickers).

Reads the plates straight out of src/data/refs.js (the original scans live
outside the repo), so it is fully reproducible from a checkout:

    python3 build/crop_refs.py     # rewrites src/data/refs.js in place

Idempotent: existing cast-* entries are stripped and regenerated. Never
touches the plate entries themselves — their ids anchor the Bargue course
and past attempts' refId history.
"""
import base64, io, json, os, re, sys

try:
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit("needs Pillow:  pip3 install Pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
REFS = os.path.join(HERE, "..", "src", "data", "refs.js")

# (source-plate id, new id, title, crop box as fractions l,t,r,b)
# Boxes leave a margin of plate paper around the figure — the mount matters.
CROPS = [
    ("bargue-foot", "cast-foot-fin",   "Foot — finished (Bargue Pl. 10)",   (0.625, 0.10, 0.97, 0.86)),
    ("bargue-foot", "cast-foot-block", "Foot — block-in (Bargue Pl. 10)",   (0.315, 0.10, 0.645, 0.86)),
    ("bargue-hand", "cast-hand-fin",   "Hand — finished (Bargue Pl. 22)",   (0.52, 0.06, 0.87, 0.97)),
    ("bargue-hand", "cast-hand-line",  "Hand — outline (Bargue Pl. 22)",    (0.05, 0.06, 0.48, 0.97)),
    ("bargue-head", "cast-head-fin",   "Dante — finished (Bargue Pl. 34)",  (0.52, 0.10, 0.96, 0.82)),
    ("bargue-head", "cast-head-block", "Dante — block-in (Bargue Pl. 34)",  (0.06, 0.10, 0.48, 0.82)),
    ("bargue-feet", "cast-heel-fin",   "Heel — finished (Bargue Pl. 6)",    (0.46, 0.02, 0.99, 0.52)),
    ("bargue-feet", "cast-sole-fin",   "Foot sole — finished (Bargue Pl. 6)", (0.52, 0.55, 0.94, 0.99)),
]
MAXDIM = 700      # gentle upscale from the small plate scans for a crisp panel
QUALITY = 88

def main():
    src = open(REFS, encoding="utf-8").read()
    head = src[: src.index("[")]
    refs = json.loads(src[src.index("[") : src.rindex("]") + 1])
    refs = [r for r in refs if not r["id"].startswith("cast-")]
    plates = {r["id"]: r for r in refs}

    out = []
    for pid, cid, title, (l, t, rr, b) in CROPS:
        p = plates[pid]
        im = Image.open(io.BytesIO(base64.b64decode(p["src"].split(",", 1)[1]))).convert("RGB")
        w, h = im.size
        im = im.crop((round(l * w), round(t * h), round(rr * w), round(b * h)))
        scale = MAXDIM / max(im.size)
        if scale > 1.0:  # LANCZOS up + a light unsharp so the lithograph grain survives
            im = im.resize((round(im.size[0] * scale), round(im.size[1] * scale)), Image.LANCZOS)
            im = im.filter(ImageFilter.UnsharpMask(radius=1.4, percent=60, threshold=2))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=QUALITY, optimize=True)
        data = buf.getvalue()
        out.append({"id": cid, "title": title, "category": "cast", "group": "Single figure",
                    "w": im.size[0], "h": im.size[1],
                    "src": "data:image/jpeg;base64," + base64.b64encode(data).decode("ascii")})
        print(f"  {cid:16s} {im.size[0]}x{im.size[1]}  {len(data)//1024} KB")

    refs.extend(out)
    body = json.dumps(refs, separators=(",", ": "))
    open(REFS, "w", encoding="utf-8").write(head + body + ";\n")
    print(f"wrote {len(out)} cast refs -> {os.path.relpath(REFS, os.getcwd())}")

if __name__ == "__main__":
    main()
