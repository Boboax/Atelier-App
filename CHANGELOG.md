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

## 1.15.1 — What "practice time" counts

Two clarity fixes after the number read as suspiciously low. The minutes shown are **focused time** — active study + drawing only, not screen time; reading feedback and thinking between marks aren't counted (by design — it measures practice, not time on the app), so a short daily plan legitimately logs only a few minutes. Labels now say "focused" and drop the misleading 15-min goal line in plan mode (the default): the daily plan is deliberately brief, so a line it can't reach just read as perpetual failure. Also fixed: the day-dots and the practice-time bars marked plan-completed days as "missed" whenever they were under the raw minutes goal — they now honour the real goal (plan completed OR minutes hit), matching the streak.

## 1.15.0 — Practice-time chart

Stats opens with a **Practice time** card: today's total and the past-7-days total up top ("today 17 min · past 7 days 76 min · goal 15 min/day"), and a bars-per-day chart over the last two weeks — quiet days grey, days that met your goal in accent, today highlighted, with a dashed goal line. The data was always tracked (it feeds the streak); now you can see the rhythm.

## 1.14.2 — Curves scored the dots, not the curve

A curve that tracked the target almost perfectly could score **0** — if you'd followed the coaching and dotted the start, apex and end before drawing through them. Those dots were spliced into the front of the scored path, so the scorer traced a zig-zag (dot→dot→dot→curve) instead of your curve. Curve, gesture and terminator scoring now reconstruct the intended open path first — dropping the tiny dot-strokes and chaining the real curve — so dotting your anchors helps your drawing without wrecking the score. (Line and polygon scoring were already order-tolerant and unaffected.)

## 1.14.1 — Discrimination runs feel finite again

The 2AFC discrimination warm-ups felt like they went on forever. 1.11.0 had switched them to end on a *reversal count* and filled the progress ring by reversals — but reversals arrive slowly and unevenly, so the ring stalled for many taps and a run could stretch to 30. Back to a **fixed 18-trial run** with the ring marching visibly 1/18 → 18/18 to a definite end. Reliability is unchanged: the warm start still lands trials near your just-noticeable difference and the score still averages the last reversals.

## 1.14.0 — Flow & finish

A round of design-critique fixes, all about the same standard: every screen should behave like the same considered instrument — in the dark, in the rail, at the reveal.

- **Dark-mode perception fixed**: the warm-up stimuli drew their strokes in `--ink` — cream in dark mode — on a hardcoded white box, so the line being memorised was *invisible all evening*. The stimulus box is now what the canvas already is: literal ink on literal paper, in both themes, through study, reveal and the 2AFC pairs.
- **Sight-size reveal shows the answer, not just the numbers**: at the score, the plate ghosts into the drawing panel at its true position and size (the panels are 1:1, so that spot is exactly where the copy belongs) with your copy's bounding box in accent — "9.5% too high, 34% too small" becomes something the eye can see and the next refine can act on.
- **One warm-up number**: the plan's warm segment said 6, the overlay counted to 8, the Home copy said "~8". A single `WARMUP_N` (8) now drives all three — finishing the warm-up finishes the plan row.
- **History is a gallery again**: perception rounds (`perc-*`/`afc-*`) have no strokes to replay and were landing as blank cards captioned "Perceive:" — they now live only in Stats, and short captions can never keep a trailing colon.
- **Perception overlay parity**: the timer ring hides when no clock is running (judge/reveal, and the drill's budget-less sight-size draw); Again/Done dock into a bottom controls bar like the drill's; the stimulus box grows to `min(520px, 86vw)` — it's the entire content of the screen, it should hold it.
- **Soft enter/exit**: drill and perception overlays fade in (~200 ms) and out (~180 ms) instead of teleporting — the room stays calm at the two most-travelled seams in the app.
- **The landscape rail teaches while you study**: the empty result slot carries a quiet card — *Look for* + the drill's cue in serif + the ~85% level-up reminder — so the study phase says what expert eyes extract, right where the score will land.
- **Journey map honesty**: sight-size is tagged "scored · exact score" (its "self-check" tag contradicted its own reveal) with its best copy shown, and every reference drill shows the same per-image best/stars evidence as its picker, plus its Module 4 rung.
- **The estimate slider stops suggesting**: its randomised start (there to defeat anchoring) rendered like a pre-filled answer — it now sits muted until first touch.
- **Portrait sight-size**: the panel pair lifts to the upper third instead of sinking into a void, and a one-time nudge suggests landscape, where the method actually has room.

## 1.13.0 — Correction sets & the Module 4 ladder

Two more items from the training-science audit, both about the same principle: practice should be *designed around measured performance*, not served generically.

- **Error-specific correction sets** — the app has always recorded *signed* error metrics (a +3° clockwise lean, lines run 8% long, shapes squashed 10% wide) but only ever displayed them. Now they design practice: when the last ~10 genuine attempts show a consistent bias (≥2.5° angle, ≥6% length or aspect, over 6+ figures — a habit, not scatter), the recommendation engine offers a **Correction set**: 5 figures of the drill that produced the evidence, generated to concentrate targets where the error lives (leans get the full compass *including* the near-vertical/near-horizontal plumb references the usual generator avoids; overshooters get short lines, undershooters long; a habitual squash gets elongated forms where proportion can't hide behind near-square). This is the core of deliberate practice (Ericsson): tasks built around the individual's diagnosed weakness. It slots *below* due reviews (decay first) and *above* new material, runs blocked on purpose (remedial part-practice of one fault), and the finish card closes the loop — your measured bias before vs. this set's mean signed error.
- **The Module 4 ladder** — reference drills (contour, negative space, Bargue block-in, value study, master copy) were a *designed plateau*: the same study clock forever, which is exactly Ericsson's "arrested development" — improvement stops once a task feels adequate and automatic. They now carry 3 levels; five completions averaging ≥80 (self-rating or objective score) promote, and the only honest dial a self-checked drill has — the encoding glance — tightens to ×0.7 then ×0.5 of the base seconds. No regression (a weak reference copy is information, not decay), and sight-size stays flat: it has no study clock by design. The practice menu shows each drill's rung.

## 1.12.0 — The atelier look

A full visual overhaul against one brief: every drill, both themes, both orientations, should feel like *a lit white sheet in a dark quiet room* (dark) or a warm atelier (light).

- **Dark-mode drill fixed**: the overlay chrome now sits on themed stage bands — no more cream text and invisible buttons over the white canvas.
- **Paper materiality**: the sheet is warm white with a whisper of grain, a hairline edge and a soft lift off a desk-toned surround that dims with the theme; guide lines unified to one quiet weight.
- **Toolbar hierarchy**: drill tools are compact icon tiles (monoline SVG, matching the nav) with one full primary CTA; landscape gets a proper 2-column tool rail.
- **The reveal breathes**: the target *draws itself in* (~400 ms), the score counts up, and the result card opens compact — the comparison stays visible, details expand on "More ▾".
- **Cohesion**: accent hairline hero instead of the muddy gradient wash; 👤/🔥 emoji replaced with drawn SVG; string/measure overlays in graphite-sepia instead of foreign steel blue; real type scale with eyebrow labels; prose capped at a readable measure.
- **Daily-use polish**: Exercises page teaching prose folds behind "About this ▸"; empty Stats/History get a quiet easel drawing and a real CTA; 44 pt+ touch targets on estimate boxes, small buttons and streak dots; timer ring hides when idle; reference-picker cells framed with a scroll fade.

## 1.11.0 — Performance-contingent training

Difficulty, spacing and promotion now respond to how you actually perform, not just the calendar — the highest-leverage cluster from the full training-science audit.

- **Per-trial difficulty staircase**: the study clock tightens (×0.9) after a ≥90 score and relaxes (×1.15) below 70, keeping every trial near the 85%-rule sweet spot *between* promotions, not just at them.
- **Review-contingent spacing**: passing a *due* review grows the gap; failing it shrinks it (the actual point of Leitner — a weak attempt can no longer silently clear a review). Intervals extend to 30 and 60 days for consolidated skills.
- **Retention gate on promotion**: composite drills (polygons, envelopes, gesture, shadow shapes) hold an earned level-up as *pending* until a cold retention check passes — Lecoq's own standard, memory across a night's sleep. Simple figures (lines, angles, curves) have nothing episodic to recall overnight, so they promote on the window alone — and **retention checks now only ever serve composite figures**.
- **Expanding recall lags**: each drill's retention checks stretch 1 → 3 → 7 → 14 days on success and reset on a clear failure (expanding retrieval; successive relearning).
- **Honest gates**: skips after seeing the figure are counted (first per sitting free, then they enter the window as a weak score); glanced trials are scored and coached but no longer level evidence; the self-estimate no longer anchors at 70% (badge starts at "?", Reveal unlocks on your judgement) — the calibration stats stop being flattered by the anchor.
- **Interleaving by default**: once a drill reaches level 3, its practice set weaves in 2 figures from due/weak drills; mixed sessions weight sampling toward due + weakest; the finisher is your *weakest* drill, not always envelope (contextual interference: blocked feels better, interleaved retains better).
- **Discrimination (2AFC) made reliable**: runs now go to 8 reversals (30-trial cap) with a warm start near your last threshold and a 6-reversal average — enough signal to actually show week-over-week gains. Two new kinds: **Which bows more?** (curve) and **Which is darker?** (value).
- **A brief hold from level 2** (1.5 s) so even early trials draw from encoded memory, not the afterimage; a ~1 s re-encode hold after each manual glance.

## 1.10.0 — Single-figure references

At a real easel you never see a whole lithograph sheet beside your paper — the atelier masks the plate so **one figure** sits next to the drawing. The bundled Bargue plates are multi-figure sheets, which made the sight-size reference panel show two or three subjects at once.

- **8 new single-figure references** carved from the bundled plates (finished foot, block-in foot, finished + outline hand, finished + block-in Dante head, heel, foot sole), category **Single figures**, upscaled and sharpened for the panel.
- The **sight-size picker lists single figures first** (then your own imports, then whole plates); master copy, value study and contour pickers include them too.
- New reproducible pipeline `build/crop_refs.py` — regenerates the crops straight from the plates already embedded in `refs.js` (no external files needed); plate ids and the Bargue course are untouched.

## 1.9.0 — The string you can carry

The sight-size string now works like the real thing — a taut string in two outstretched hands:

- **Carry it**: stretch the string along an edge on the plate, then grab its **middle** and drag — it translates rigidly, angle and length locked, over to your copy to compare against the corresponding edge.
- **Re-aim it**: grab an **end handle** to adjust that end (new angle/length).
- **Read it**: the measured span renders solid with dot handles (the sight-line still extends dashed across both panels), and the readout now shows **angle + length** ("34.2° · 41%"). The panels are 1:1, so the same % *is* the same true length on both sides.
- Lay a new string by dragging on empty canvas; a tap on empty canvas clears it; a tap on the string leaves it (it was a grab). New `geom.distToSeg` helper with guard tests backs the grab detection.

## 1.8.1 — The practice day ends at 4 AM

Fixes the after-midnight session stealing the next day's plan: practising in bed at 00:30 marked *tomorrow's* plan done and ticked its streak day.

- **One shared day key** (`A.util.dayKey`, in storage.js) replaces four duplicated calendar-date computations (curriculum, exercises, gamify, perceive). The day now **rolls over at 04:00**, not midnight — a session after midnight belongs to the evening's sitting.
- This makes "day" mean what every rule intends — *sittings separated by sleep*: the promotion gate's two-distinct-days requirement can no longer be satisfied by one sitting that straddles midnight, and the retention check ("recall across a night's sleep") can no longer serve a figure studied twenty minutes earlier.
- Forward-only: already-stored day stamps are untouched; a plan already credited under the old rule stays credited for that one day.
- Guard tests for the 4 AM boundary (incl. month/year edges and the midnight-straddle promotion loophole).

## 1.8.0 — Sight-size practice

**New mode: Sight-Size Copy (Module 4)** — the classical atelier method as a first-class drill. The plate and your paper sit side by side at the same size, and you copy by pure eye comparison — no hiding, no memory clock; the discipline is the comparison itself.

- **Split 1:1 panels** — reference left, drawing right, identical size (the geometric heart of sight-size: same-size images make differences directly visible).
- **Flick** — flashes the plate over your drawing for a beat: the rapid subject↔drawing comparison, without moving your eyes.
- **Step back** — zooms both panels out onto a desk-tone surround, the digital walk-back-from-the-easel. Drawing is disabled at judging distance; a tap walks you back in. A rhythm nudge appears after a long run of marks without stepping back.
- **The string (optional)** — drag a free-angle line that extends across both panels with a live angle readout ("level" near 0°), the taut-string length-and-angle check between two stretched arms.
- **Exact, position-sensitive scoring** — unlike the memory drills, sight-size demands the copy be *in place*: a new scorer compares edge clouds without normalising position or scale, and reports **signed placement (↔/↕) and size errors** ("9.5% too high, 10% too far left, 34% too small") alongside contour match. Coaching and a new "Trust the flick, not the stare" principle card teach the mark → flick → correct rhythm.
- **Refine loop** — after the score, keep refining the *same* copy and re-score: mark → compare → correct, the method itself.

Also: laying the string or stepping back never counts as a drawn mark; the practice menu labels sight-size "scored" (it is — objectively), and the in-drill help explains the comparison rhythm instead of the study-hide-recall loop.

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
