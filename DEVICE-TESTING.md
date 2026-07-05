# Atelier — iPad device test checklist

Things I can't verify from a headless preview. Run through these on the actual
iPad with the Apple Pencil after each install. ✅ / ❌ / note.

## Install & offline
- [ ] Open `Atelier.html` in **Safari** (from Files/Dropbox, made available offline).
- [ ] **Share → Add to Home Screen**; icon + name look right.
- [ ] Launch from the home-screen icon → opens **full-screen** (no Safari chrome).
- [ ] Turn on **Airplane mode**, relaunch → app still works fully (drills, stats, library).
- [ ] Safe-area: status-bar/notch and home-indicator don't overlap the top bar or bottom controls (portrait **and** landscape).

## Apple Pencil
- [ ] Pencil draws; line **weight varies with pressure** (smoothly — no width banding on slow strokes).
- [ ] **Palm rejection**: rest your hand on the screen while drawing — stray marks don't appear, even when the palm lands **mid-stroke** or **before** the pen on a fresh canvas (with "Apple Pencil only" on in Settings; with it off, the pen still wins for 1.5 s after any pen contact/hover).
- [ ] **Two fingers / pen + finger at once**: a second touch during a stroke does nothing — no zigzag between contact points, the stroke continues cleanly.
- [ ] Fingies: with Pencil-only **off**, a finger draws; with it **on**, a finger does not draw.
- [ ] Fast scribbles stay smooth (coalesced points) — no gaps; latency stays LOW even late in a long/busy drawing (incremental rendering).
- [ ] Tap a **dot** — it renders (Bargue stage 1 plots corner points).
- [ ] **Rotate the iPad mid-drill** — your marks stay aligned with the target/reference (strokes live in design space now).
- [ ] Undo steps back through strokes AND erases AND clears; Clear removes all; Undo can't reach back into a previous phase.
- [ ] An iOS edge-swipe that cancels a fresh touch leaves no accidental mark.
- [ ] Drawing is locked during STUDY and the estimate step (no tracing, no editing after Evaluate).

## Drill loop
- [ ] Self-paced study (low level): timer counts **up**, "I've got it" commits, no auto-hide; "ease off" appears if you stare ~2× your average.
- [ ] Enforced study (level ≥4): timer counts **down** and auto-hides — then a short **"hold it in your mind's eye"** countdown before drawing.
- [ ] Glance re-shows briefly and is **capped at 3**; the reveal notes the level-credit cost of glances used.
- [ ] **Retention check** (Home, from day 2): serves a previous day's figure cold; reveal is framed as retention; no level change.
- [ ] Redraw/Re-study after a reveal is labelled a correction and doesn't change level or personal bests.
- [ ] **Dark mode**: switch iPad appearance — chrome goes dark, drawing paper stays white, everything stays legible.
- [ ] **Gesture drill** (Module 3): the study screen shows a figure (head + mass ovals + line of action); after hiding, drawing the sweep from memory scores sensibly.
- [ ] **Teaching layer**: after a scored reveal, "Why & how" expands a principle card matched to your error.
- [ ] **Real-subject auto-score**: on a Bargue plate or imported photo, "Score against the reference" highlights the subject (auto-tuned) and gives an overlap score; the threshold/invert sliders and panel-select adjust it.
- [ ] Estimate-before-reveal works; reveal card sits at the **bottom** and the red-vs-ink comparison is visible above it.
- [ ] Guides/Flip buttons show on/off state; guides fade out by level.
- [ ] Staged Bargue: envelope → facet → refine, with Reveal at the last stage.

## Reference drills & Auto-score (beta)
- [ ] Pick a Bargue plate / import a photo; ghost overlay + opacity slider work; Flip rotates 180°.
- [ ] **Auto-score**: threshold slider + Invert isolate the subject; "overlap %" + score update live; coverage warning shows when the mask is clearly wrong. (Expect it to work well only on clean, single-subject images — the multi-panel plates won't mask cleanly.)

## Library, stats, history, backup
- [ ] Import a photo from the iPad → appears in **My references**; delete works.
- [ ] Stats charts render; calibration/self-awareness/perception cards appear once you have data.
- [ ] History thumbnails + animated replay play back correctly.
- [ ] **Export backup** saves a `.json` to Files; **Restore** brings data back after a wipe.
- [ ] Settings reflects "drills stored · last backup".

## Watch for
- [ ] A red **error banner** at the top = a runtime error — note its text and send it to me.
- [ ] Performance once you have **100+ saved drills** (History scroll, app launch).
- [ ] After a few weeks unused, check data survived (if not, that's iOS storage eviction — restore from backup).
