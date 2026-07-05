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
node   build/build.js        # regenerates dist/ AND Atelier.html
```
`build.js` is the one build step: it refreshes `dist/` from `src/`, stamps
`A.VERSION` (from `build/version.json`) and the service-worker cache name +
`A.BUILD` from the clock — so every deploy automatically invalidates the
previous offline cache — and fails if the module load-order lists drift.
Never edit `dist/` by hand.

Tests: `node --test test/*.test.js` (leveling gate, spaced scheduler, streak,
recommendation engine, plan, scoring, backup guards) — run by GitHub Actions
on every push. `src/tests.html` is the in-browser/on-iPad smoke page.

## Put it on the iPad (offline, no App Store)

The recommended route is hosting `dist/` (Netlify/GitHub Pages) and "Add to
Home Screen" from Safari — see **DEPLOY.md** for the 3-minute walkthrough.
The single-file `Atelier.html` route also works: open it in Safari from
Files/Dropbox → Share → **Add to Home Screen** → it runs full-screen and
offline like a native app.

## Back up your progress

iPadOS can clear an unused web app's storage after a few weeks. In
**More → Settings → Backup**, tap **Export backup** every so often and save the
`.json` to Files/Dropbox. **Restore from backup** brings it all back.

## The exercises

| Module | Drill | Scoring |
|---|---|---|
| 1 | Lines & Angles, Angle Relationships, Curves | objective (angle°, length%, curve match) |
| 2 | Polygons | objective (shape overlap, proportion) |
| 3 | Complex Envelopes, Gesture (Line of Action) | objective (contour / line-of-action match) |
| 4 | Negative Space, Bargue Block-In, Value/Terminator, Master Copy | objective auto-score against the reference (silhouette overlap), or self-rated |

Generated drills know their own ground truth, so they score you objectively and
track **systematic bias** (e.g. "you rotate lines +4° clockwise") in Stats.
As your rolling accuracy holds above 85%, the study glance shortens and
difficulty rises automatically.

## Research-backed training mechanics (v3)

Grounded in drawing-perception studies and motor-learning science:

- **Judge before you see.** Before each reveal you rate your own accuracy; the app
  shows guess-vs-actual, a "self-awareness" trend and your signed calibration
  (over/under-confidence). (Error self-estimation builds the internal
  error-detector — Chiviacowsky & Wulf.)
- **One coaching cue + faded feedback + a teaching layer.** Reveal gives a single
  corrective ("aim anticlockwise"); the full metric breakdown appears less and
  less often as you level up (guidance hypothesis) — but a "Show breakdown"
  button keeps it available on request (self-controlled feedback, OPTIMAL
  theory). A "Why & how" card, keyed to your dominant error, teaches the
  principle behind the fix and how the atelier tradition solves it.
- **Gesture (line of action).** A figure pose is shown as its single rhythmic
  line through head, ribcage and pelvis; you memorise the line and redraw it
  from memory, scored by curve match — the core of figure drawing, trained the
  Atelier way.
- **Objective scoring of real subjects.** Memory drawings of Bargue plates and
  imported photos are auto-scored by silhouette overlap (auto-tuned threshold),
  extending measured feedback beyond abstract shapes; self-rating remains the
  fallback.
- **Retention hold.** From level 4 a short "picture it" pause sits between hide
  and draw, so the drawing comes from encoded memory, not the afterimage. And a
  daily **Retention check** re-serves a figure you studied on a previous day —
  cold, no study — Lecoq's real test.
- **Spaced review.** Each drill carries a Leitner-style review interval
  (1→2→4→7→14 days); the recommendation engine serves the most-overdue drill
  before anything new (distributed practice).
- **Mixed sessions.** Interleaved practice (shuffling drill types) feels harder but
  builds more durable, transferable skill than repeating one drill (contextual
  interference). Plus a quick warm-up, a daily challenge that targets your
  **weakest drill**, and a fatigue watch that suggests stopping when accuracy
  sags (short high-quality sessions beat massed grinding).
- **Honest promotion.** Only genuine first-look memory trials feed the level
  gate (85% sustained across ≥2 days); correction redraws are recorded but
  excluded, and each mid-drill glance costs level credit.
- **See first.** Perception-only drills (judge an angle / proportion with no drawing)
  attack the real bottleneck — misperception of the subject (Cohen & Bennett) —
  with randomised start anchors so you judge the quantity, not the distance from
  a fixed anchor. Plus a flip/upside-down reference toggle and a contour (edges)
  drill (Betty Edwards).
- **Beginner on-ramp.** First-run guide, a "?" how-to in every drill, fading sighting
  guides (plumb line, horizon, thirds, angle ticks), a guided multi-stage Bargue
  block-in (envelope → facet → refine), and an "ease off" nudge when a study
  stare runs past ~2× your own average glance.
- **Comfort.** Full dark mode for evening practice (the drawing paper stays
  white); a 7-day streak earns a rest day so one missed evening doesn't zero
  the habit.

Note: "confident single strokes" (a design-drawing idea, not classical) was deliberately
left out as a scored dimension — motor skill is a minor source of drawing error, so the
app optimises perception and self-judgement instead.
