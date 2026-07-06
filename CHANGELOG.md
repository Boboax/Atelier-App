# Changelog

Atelier follows [Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`:

- **MAJOR** — a fundamental rework, or any change that invalidates saved data / old backups.
- **MINOR** — new drills, modes or features (backward-compatible).
- **PATCH** — bug fixes, polish, copy or content tweaks.

**Release discipline.** The version lives in `build/version.json` — the single
source of truth. `build/build.js` stamps it into the app (`A.VERSION`, shown in
Settings → About) and derives the service-worker cache name, so a bump also
forces installed iPads to update. Every release, in one commit:

1. bump `build/version.json`,
2. add a section here (newest first),
3. tag the commit `vX.Y.Z` (`git tag -a vX.Y.Z -m "…" && git push origin vX.Y.Z`).

No feature reaches `main` without a version bump.

---

## 1.7.0 — Value module, perception suite, zoom & pan

**New training content**
- **Terminator (Light & Shadow)** — the classical value drill, procedurally generated and objectively scored: study a lit form (sphere → egg → cylinder, light direction varies), then draw the shadow line from memory ON the bare form. Both the bow and the position are scored (a new position-fixed curve metric). Completes the line → shape → value arc.
- **Two new perception warm-ups**: Judge curve (bow memory) and Judge value (grey/tone memory), each with its own adaptive level.
- **Discrimination (2AFC staircase)**: "Which line is steeper / longer?" — forced choice with immediate feedback and an adaptive 2-down-1-up staircase that measures the smallest difference your eye can catch. Thresholds tracked in Stats ("Discrimination" card); personal best per kind.

**Drawing & UI**
- **Pinch zoom & pan** on the drawing canvas (two fingers; the pen keeps drawing) with a floating reset chip — lean in for detail on plates and references, step back to judge the whole.
- **Pace setting** (Standard / Relaxed +50%) for learners who find the adaptive study/draw clocks rushed.
- **History filter chips** by drill (with a per-drill progress chart when filtered); the Stats accuracy chart is filterable by drill too.

**Structural fix**
- The scored-drill ladder, session queues and warm-up types are now **derived from the curriculum** instead of hand-maintained lists — gesture had silently been missing from mastery points, weakest-drill targeting and spaced review (the same bug that once hit curve). Rank thresholds rebased to the grown curriculum (Master still ≈ every track at level 5–6).

## 1.6.0 — Scoring re-audit, real-subject scoring, drawing feel & teaching

**Scoring (a full adversarial re-audit of every exercise — several were too generous)**
- **Curve & gesture**: a straight line scored ~97 against an S-curve, an opposite bend ~86. Rewrote to align endpoints and measure the actual bow along the path (position/size/direction-invariant): close copy ~95, loose ~85, too-straight ~75, opposite bend ~50.
- **Lines**: a perpendicular line (90° wrong) scored 40, rescued by matching length. Now an additive-penalty model — a badly wrong angle scores ~0 regardless of length.
- **Shapes**: a circle scored 84 against a square and a tiny scribble 56. Tightened the contour metric — a clean copy still ~90, but a circle ~67, a scribble ~9.
- Gesture reveal no longer shows "Proportion error undefined%" — it reports "Line-of-action match".
- Calibration guard tests added for every scorer so this can't silently regress again.

**Real subjects — objective scoring for the plates**
- New **edge/contour scorer**: a Bargue block-in is thin lines, not a filled silhouette, so it's now scored by how closely your marks follow the plate's lines (position/size-invariant, precision-weighted). Auto-selected when the reference is line-art; filled photos still use silhouette overlap. The block-in drills are no longer self-check-only.

**Drawing feel**
- **Line smoothing** — a positional stabiliser eases hand jitter so straight and curved strokes come out cleaner. Adjustable in Settings (Off / Light / Medium / Strong; Medium default).

**Teaching & clarity**
- The teaching principle now shows its **title inline at the reveal** (no click needed); tapping expands the full why + how.
- Reveal shows where the score sits vs the ~85% level-up mark, flags the level-credit cost of glances **on the Glance button** (−5), and prompts a Redraw with its rationale when a drawing was genuinely off (Lecoq's correct-and-repeat).

## 1.5.0 — Gesture, teaching & real subjects

**New**
- **Gesture (line of action)** drill — a figure pose is shown as its rhythmic line through head, ribcage and pelvis; memorise it and redraw from memory, scored objectively by curve match. Fully offline, no photo library.
- **Teaching layer** — an on-demand "Why & how" card at the reveal, keyed to your dominant error, explaining the principle and how the atelier tradition solves it.
- **Real-subject auto-scoring** out of beta — Otsu auto-thresholding scores a memory drawing against a Bargue plate or imported photo with no manual tuning; "Score against the reference" is now the primary reveal action for image drills.
- **"Today's plan"** home — a warm-up → focus → retention-check checklist generated by the recommendation engine; plan completion (not raw minutes) drives the streak.
- **Then-vs-now** progress comparison; rank-up ceremony; weekly report card; Master's-mark and post-Master "upholding" endgame.
- **Achievements v2** — 26 tiered, long-horizon badges (consistency / mastery / application / self-awareness only).
- Session **finisher**; **spaced review** for reference drills; **interactive onboarding** (learn the loop by doing it).

**Engineering**
- 37 Node unit tests (`node --test test/*.test.js`) + GitHub Actions CI.
- Version stamping from `build/version.json`; build-time guards against module load-order drift.
- Schema-versioned attempt records; Web Share backups; `navigator.storage.persist()`.

## 1.4.0 — The overhaul

- **Apple Pencil engine** rebuilt: single active pointer (palm / second-finger immunity), hover-armed palm rejection, design-space strokes (rotation-proof scoring), incremental rAF rendering with predicted-touch tails, EMA pressure smoothing, snapshot undo, phase-locked canvas.
- **Training science**: retention hold before drawing, daily retention checks, Leitner spaced review, weakest-drill targeting, honest promotion (repeats/recalls/glances can't inflate levels), relational angle scoring, degenerate-input guards, recent-window bias stats, signed calibration.
- **Correctness & PWA**: perfect-copy = 100, profile-safe reset, transactional restore, atomic service-worker install, build-stamped cache versioning.
- **UI**: full dark mode, score-reveal animation, in-app modals, SVG nav icons, WCAG-AA contrast, 44 pt touch targets, DPR-sharp replays.

## 1.3.x — Initial upload

- The Atelier memory-drawing trainer as built in earlier sessions: procedurally-scored drills (lines, angles, curves, polygons, envelopes), Bargue plate course, perception warm-ups, stats, history, offline PWA + single-file build.
