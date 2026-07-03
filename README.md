# Atelier — memory drawing trainer

A fully-offline iPad/Apple-Pencil app for classical visual-memory practice
(Lecoq de Boisbaudran → Bargue → Florence Academy): **study, hide, draw from
memory, correct.** No internet required after it's on the device. Your data
stays only on the device.

## What's here

- **`Atelier.html`** — the whole app in one self-contained file (≈2 MB, includes
  your Bargue plates + worksheets). This is the one to put on the iPad.
- **`src/`** — the editable source (separate CSS/JS/data files + manifest + service
  worker), for development and the "served" PWA install path.
- **`build/`** — `make_refs.py` (embeds images), `make_icons.py`, `build.js`
  (bundles `src/` → `Atelier.html`).

### Rebuild after editing `src/`
```
cd Atelier
python build/make_refs.py    # only if you change bundled images
python build/make_icons.py   # only if you change the icon
node   build/build.js        # regenerates Atelier.html
```

## Put it on the iPad (offline, no App Store)

1. This folder is in Dropbox — open **Dropbox / Files** on the iPad and find
   `Atelier.html` (tap *Make Available Offline* in Dropbox so it's stored locally).
2. Open it in **Safari**.
3. Tap the **Share** button → **Add to Home Screen**.
4. Launch it from the home-screen icon. It now runs full-screen and works with
   no internet.

> The first open needs the file present on the device; after "Add to Home
> Screen" it runs offline like a native app.

## Back up your progress

iPadOS can clear an unused web app's storage after a few weeks. In
**More → Settings → Backup**, tap **Export backup** every so often and save the
`.json` to Files/Dropbox. **Restore from backup** brings it all back.

## The exercises

| Module | Drill | Scoring |
|---|---|---|
| 1 | Lines & Angles, Angle Relationships | objective (angle°, length%) |
| 2 | Polygons | objective (shape overlap, proportion) |
| 3 | Complex Envelopes | objective (shape overlap, proportion) |
| 4 | Negative Space, Bargue Block-In, Value/Terminator, Master Copy | self-rated (ghost the reference back) |

Generated drills know their own ground truth, so they score you objectively and
track **systematic bias** (e.g. "you rotate lines +4° clockwise") in Stats.
As your rolling accuracy holds above 85%, the study glance shortens and
difficulty rises automatically.

## Research-backed training mechanics (v2)

Grounded in drawing-perception studies and motor-learning science:

- **Judge before you see.** Before each reveal you rate your own accuracy; the app
  shows guess-vs-actual and a "self-awareness" trend. (Error self-estimation builds
  the internal error-detector — Chiviacowsky & Wulf.)
- **One coaching cue + faded feedback.** Reveal gives a single corrective ("aim
  anticlockwise"); the full metric breakdown fades out as you level up, so you stop
  depending on it (guidance hypothesis).
- **Mixed sessions.** Interleaved practice (shuffling drill types) feels harder but
  builds more durable, transferable skill than repeating one drill (contextual
  interference). Plus a quick warm-up and a daily "weakest drill" focus.
- **See first.** Perception-only drills (judge an angle / proportion with no drawing)
  attack the real bottleneck — misperception of the subject (Cohen & Bennett). Plus a
  flip/upside-down reference toggle and a contour (edges) drill (Betty Edwards).
- **Beginner on-ramp.** First-run guide, a "?" how-to in every drill, fading sighting
  guides (plumb line, horizon, thirds, angle ticks), and a guided multi-stage Bargue
  block-in (envelope → facet → refine).

Note: "confident single strokes" (a design-drawing idea, not classical) was deliberately
left out as a scored dimension — motor skill is a minor source of drawing error, so the
app optimises perception and self-judgement instead.
