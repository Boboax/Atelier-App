/* ============================================================================
   exercises.js  —  the drill loop (state machine for one attempt)
   ----------------------------------------------------------------------------
   Phases:  STUDY (timed glance) → DRAW (blind, from memory) → REVEAL (score /
   ghost the answer back) → then redraw-to-correct or move on. Scored exercises
   compute objective metrics; reference exercises capture a self-rating.
   The controller is UI-agnostic: it calls onState()/onTick() so ui.js renders.
   Exposed as window.A.Drill (constructor).
   ========================================================================== */
(function (A) {
  'use strict';

  // the 4 AM-rollover practice day — single source of truth in A.util (storage.js)
  function dayKey() { return A.util.dayKey(); }
  const lineLen = (s) => A.geom.dist(s[0], s[s.length - 1]);

  // guided block-in stages for reference drills (general → specific)
  const STAGES = {
    bargue: ['Plot the extreme points — top, bottom, widest left & right — and a light plumb line through the form. (Tap “Measure” to check proportions against a unit.)',
             'Block the outer envelope — the largest straight lines that connect those points.',
             'Facet the big internal divisions inside that envelope.',
             'Refine the contour — round the straights into the true edges.'],
    negative: ['Draw the single largest negative shape.',
               'Add the smaller gaps between the forms.',
               'Check the gaps’ proportions against one another.'],
    contour: ['Trace the contour slowly with your eyes — no drawing yet.',
              'Now draw it from memory in one continuous, unhurried line.'],
    master: ['Block the largest shapes and where they sit.',
             'Add the secondary shapes.',
             'Refine the key details from memory.']
  };

  function Drill(surface) {
    this.surface = surface;
    this.phase = 'idle';
    this.exKey = null; this.def = null; this.level = 1;
    this.target = null; this.ref = null;
    this.studySec = 0; this.studyRemaining = 0;
    this.drawStart = 0; this.drawSec = 0;
    this.sessionIndex = 0;      // scored drills this run (drives faded feedback)
    this.pending = null;        // computed result awaiting the self-estimate
    this.result = null;
    this.ghostOpacity = 0.45;
    this.isRepeat = false;      // redraw/re-study of a SEEN answer — not a memory trial
    this.isRecall = false;      // retention check on a previously-studied target
    this._timer = null;
    this.onState = null; this.onTick = null; this.onResult = null;
    surface.onStrokeEnd = () => {
      // sight-size rhythm: count marks since the last step-back for the nudge
      // (laying the string is a check, not a mark — don't count it)
      if (this.exKey === 'sightsize' && this.phase === 'draw' && !surface.stringMode)
        this.marksSinceStepBack = (this.marksSinceStepBack || 0) + 1;
      if (this.onState) this.onState(this);
    };
  }

  // sight-size: after seeing the score, keep refining the SAME copy — the
  // mark → compare → correct loop is the method itself
  Drill.prototype.refineSightSize = function () {
    if (this.exKey !== 'sightsize') return;
    this.result = null; this.pending = null;
    this.phase = 'draw';
    this.surface.locked = false;
    this.surface.setPhase('draw');
    this.marksSinceStepBack = 0;
    this.drawStart = performance.now();
    this._startDrawTimer();
    this._emit();
  };

  Drill.prototype._emit = function () { if (this.onState) this.onState(this); };

  Drill.prototype.startExercise = function (exKey, refItem, opts) {
    opts = opts || {};
    this.exKey = exKey;
    this.def = A.curr.def(exKey);
    this.level = A.curr.level(exKey);
    // session FINISHER: one level up as a peak-end challenge. Excluded from
    // level promotion (the boost would poison the window) but fully scored.
    this.isFinisher = !!opts.finisher;
    if (this.isFinisher) this.level = Math.min(this.def.maxLevel || 9, this.level + 1);
    // correction-set stress ({kind, sign} from gamify.biasReport): threaded to
    // the generator so targets concentrate where the measured bias lives. Kept
    // on the instance because next() regenerates targets for the rest of the
    // run; a plain startExercise (no opts.stress) clears it.
    this.stress = opts.stress || null;
    this.result = null; this.pending = null; this.sessionIndex = 0;
    this.isRepeat = false; this.isRecall = false;
    this.glanceCount = 0; this.glanceCap = 3;
    this.avgLook = 0;       // recent average look time (for the over-stare nudge)
    A.store.attemptsByType(exKey).then((list) => {
      const looks = list.filter((a) => a.scored && a.studySec > 0).slice(-5).map((a) => a.studySec);
      if (looks.length >= 3) this.avgLook = looks.reduce((a, b) => a + b, 0) / looks.length;
    }).catch(() => {});
    this.ref = refItem || null;
    this.surface.reset();
    // sight-size has no study/hide: the reference stays beside the drawing the
    // whole time — the discipline is comparison, not memory
    if (exKey === 'sightsize') { this._enterSightSize(); return; }
    this._newTargetGeom();
    this._enterStudy();
  };

  Drill.prototype._enterSightSize = function () {
    this.phase = 'draw';
    this.target = null;
    this.surface.sightSize = true;
    this.surface.resize();                       // relayout into the split panels
    this.surface.locked = false;
    this.surface.guides = false;
    this.surface.setTarget(null);
    this.surface.setGhost(this.ref ? this.ref.img : null, 1);
    this.surface.setPhase('draw');
    this.studySec = 0; this.studyElapsed = 0; this.glanceCount = 0; this.glanceCap = 0;
    this.stages = null; this.stage = 0;
    this.drawBudget = null;                      // sight-size is deliberately unhurried
    this.drawElapsed = 0;
    this.drawStart = performance.now();
    this.marksSinceStepBack = 0;                 // feeds the step-back rhythm nudge
    this._startDrawTimer();
    this._emit();
  };

  Drill.prototype._newTargetGeom = function () {
    if (this.def.scored) {
      this.target = A.gen.make(this.exKey, this.level, this.stress || undefined);
      this.surface.setTarget(this.target);
      this.surface.setGhost(null);
    } else {
      this.target = null;
      this.surface.setTarget(null);
      this.surface.setGhost(this.ref ? this.ref.img : null, 1);
    }
  };

  // sighting training wheels: on by setting, auto-fading out as level rises
  Drill.prototype._computeGuides = function () {
    const mode = A.store.get('guidesMode', 'auto');
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    // auto: scaffolds for beginners, and always for Bargue (the plumb/horizon are
    // part of its construction method)
    return (!!this.def.scored && this.level <= 3) || this.exKey === 'bargue';
  };
  Drill.prototype.toggleGuides = function () {
    this.surface.guides = !this.surface.guides; this.surface.redraw();
    return this.surface.guides;
  };

  Drill.prototype._enterStudy = function () {
    this.phase = 'study';
    // self-paced look for beginners (and all reference drills); enforced countdown
    // only once the eye is trained (scored level ≥ 4) — that's where constrained
    // retrieval is the desirable difficulty.
    this.enforced = this.def.scored && this.level >= 4;
    this.selfPaced = !this.enforced;
    // pace preference: 'relaxed' stretches the suggested study/draw times by 50%
    // for learners who find the adaptive defaults rushed — the science stays the
    // same (glances still shrink with level), just on a gentler clock
    const pace = A.store.get('pace', 'standard') === 'relaxed' ? 1.5 : 1;
    // reference drills pass the level: the Module 4 ladder's whole progression
    // IS the shrinking study glance (see curriculum EXERCISES)
    this.studyCap = Math.round((this.def.scored ? A.curr.studySeconds(this.exKey)
                                    : (this.ref && this.ref.studySec) || this.def.study(this.level)) * pace);
    this.studySec = this.studyCap;
    this.studyRemaining = this.studyCap;
    this.studyElapsed = 0;
    this.glanceCount = 0;
    this.surface.clearMarks();
    this.surface.clearUndo();           // phase boundary — undo must not resurrect old marks
    this.surface.locked = true;         // STUDY is for the eyes; tracing would defeat it
    this.surface.guides = this._computeGuides();
    this.surface.ghostStudy = true;
    this.surface.setPhase('study');     // show generated target
    this._emit();
    this._startTimer();
  };

  Drill.prototype._startTimer = function () {
    clearInterval(this._timer);
    this._studyStart = performance.now();
    const tick = () => {
      this.studyElapsed = (performance.now() - this._studyStart) / 1000;
      if (this.enforced) {                       // countdown guillotine
        this.studyRemaining = this.studyCap - this.studyElapsed;
        if (this.studyRemaining <= 0) { this.studyRemaining = 0; this._toDraw(); }
      }
      // self-paced: just count up; the learner commits with "I've got it"
      if (this.onTick) this.onTick(this);
    };
    this._timer = setInterval(tick, 100);
  };

  Drill.prototype.skipStudy = function () { if (this.phase === 'study') this._toDraw(); };

  // Retention hold between hide and draw (scored drills, level ≥ 4): a short
  // "picture it" pause defeats the iconic/afterimage trace, so the drawing has
  // to come from ENCODED visual memory — the thing being trained. Classical
  // practice (Lecoq) pushed this delay out to a full day; here it scales with
  // level. Skipped for beginners so early success stays encouraging.
  Drill.prototype._holdSeconds = function () {
    if (!this.def.scored || this.level < 2) return 0;    // level 1 stays frictionless
    if (this.level < 4) return 1.5;                      // beyond iconic persistence (Sperling)
    return Math.min(12, 3 + (this.level - 4) * 2);       // L4: 3s → L9: 12s (capped)
  };

  Drill.prototype._enterHold = function () {
    clearInterval(this._timer);
    this.phase = 'hold';
    this.holdCap = this._holdSeconds();
    this.holdRemaining = this.holdCap;
    this.surface.locked = true;
    this.surface.ghostStudy = false;
    this.surface.setGhost(null);
    this.surface.setPhase('draw');      // blank paper — hold the image in the mind's eye
    this._emit();
    const start = performance.now();
    this._timer = setInterval(() => {
      this.holdRemaining = this.holdCap - (performance.now() - start) / 1000;
      if (this.holdRemaining <= 0) { this.holdRemaining = 0; this._toDraw(); }
      else if (this.onTick) this.onTick(this);
    }, 100);
  };

  Drill.prototype._toDraw = function () {
    clearInterval(this._timer);
    if (this.phase === 'study') {
      // record the ACTUAL look time (self-chosen for beginners) — shrinking it is progress
      this.studySec = +Math.max(0.1, (performance.now() - this._studyStart) / 1000).toFixed(1);
      if (this._holdSeconds() > 0) { this._enterHold(); return; }
    }
    this.phase = 'draw';
    this.surface.locked = false;
    this.surface.measureMode = false;   // back to drawing (calipers already laid stay visible)
    this.surface.ghostStudy = false;
    this.surface.setGhost(null);        // hide reference
    this.surface.guides = this._computeGuides();
    this.surface.setPhase('draw');      // hide generated target
    this.surface.clearMarks();
    this.surface.clearUndo();           // undo must not reach back past the phase change
    this.stages = (!this.def.scored && STAGES[this.exKey]) ? STAGES[this.exKey] : null;
    this.stage = 0;
    // recall budget: soft target for committing the marks before the memory trace
    // fades (scored drills only — reference copies are deliberately unhurried)
    const dpace = A.store.get('pace', 'standard') === 'relaxed' ? 1.5 : 1;
    this.drawBudget = this.def.scored ? (this.def.draw ? Math.round(this.def.draw * dpace) : null) : null;
    this.drawElapsed = 0;
    this.drawStart = performance.now();
    this._startDrawTimer();
    this._emit();
  };

  // ticks the recall phase so the UI can show elapsed draw time (and the over-budget
  // nudge). Self-paced — it never ends the phase; the learner commits with Evaluate.
  Drill.prototype._startDrawTimer = function () {
    clearInterval(this._timer);
    this._timer = setInterval(() => {
      this.drawElapsed = (performance.now() - this.drawStart) / 1000;
      if (this.onTick) this.onTick(this);
    }, 200);
  };

  // advance the guided block-in stage, with a brief re-glance at the reference
  Drill.prototype.nextStage = function () {
    if (!this.stages) return;
    if (this.stage < this.stages.length - 1) { this.stage++; this.glance(1100, false); this._emit(); }
  };

  Drill.prototype.glancesLeft = function () { return Math.max(0, (this.glanceCap || 0) - (this.glanceCount || 0)); };

  // peek: briefly re-show the study for a "glance" (Rousar: make the most of every glance).
  // Manual peeks are capped (so memory training isn't quietly defeated); the staged
  // block-in's automatic re-glance passes manual=false and is not counted.
  Drill.prototype.glance = function (ms, manual) {
    if (this.phase !== 'draw') return;
    if (manual !== false) {
      if (this.glancesLeft() <= 0) return;
      this.glanceCount = (this.glanceCount || 0) + 1;
      this._emit();
    }
    if (this.def.scored) this.surface.showTarget = true;
    else { this.surface.setGhost(this.ref ? this.ref.img : null, 1); this.surface.ghostStudy = true; }
    this.surface.redraw();
    setTimeout(() => {
      this.surface.showTarget = false; this.surface.ghostStudy = false;
      this.surface.setGhost(null); this.surface.redraw();
      // brief re-encode hold after a manual glance — draw from the refreshed
      // memory, not the fading trace
      if (manual !== false && this.def.scored) {
        this.surface.locked = true;
        setTimeout(() => { if (this.phase === 'draw') { this.surface.locked = false; } }, 900);
      }
    }, ms || 600);
  };

  // flip the reference 180° (Edwards: defeats symbol-recognition)
  Drill.prototype.toggleFlip = function () {
    this.surface.ghostFlip = !this.surface.ghostFlip; this.surface.redraw();
    return this.surface.ghostFlip;
  };

  Drill.prototype.canEvaluate = function () {
    if (this.surface.isEmpty()) return false;
    if (this.exKey === 'line' || this.exKey === 'curve' || this.exKey === 'gesture' || this.exKey === 'shade') return this.surface.totalPoints() >= 2;
    if (this.exKey === 'polygon' || this.exKey === 'envelope') return this.surface.totalPoints() >= 3;
    if (this.exKey === 'sightsize') return this.surface.totalPoints() >= 4;
    return true;
  };

  Drill.prototype._userLineFromLongest = function (strokes) {
    let best = null, bestLen = -1;
    for (const s of strokes) { if (s.length >= 2) { const L = lineLen(s); if (L > bestLen) { bestLen = L; best = s; } } }
    return best;
  };

  Drill.prototype.evaluate = function () {
    if (this.phase !== 'draw' || !this.canEvaluate()) return;
    clearInterval(this._timer);
    this.drawSec = (performance.now() - this.drawStart) / 1000;
    const strokes = this.surface.strokesDesign();

    // sight-size: objective (position-sensitive) score, but still through the
    // estimate-before-reveal step — judging your own copy first is the skill
    if (this.exKey === 'sightsize' && this.ref && this.ref.img) {
      const r = A.imgScore.sightScore(this.ref.img, this.surface.strokesDesign());
      this.pending = r;
      this.sessionIndex++;
      this.phase = 'estimate';
      this.surface.locked = true;
      this._emit();
      return;
    }
    if (this.def.scored) {
      let r;
      if (this.exKey === 'line') {
        // one line may be built from several collinear strokes (a long line is hard
        // to draw in a single pass) — best-fit across ALL points so the full span
        // and angle are measured, not just one segment.
        r = A.geom.scoreLine(this.target.lines[0], A.geom.bestFitSegment(this.surface.pointsDesign()));
      } else if (this.exKey === 'angles') {
        const ul = strokes.filter((s) => s.length >= 2).map((s) => A.geom.bestFitSegment(s));
        const angOf = (l) => Math.atan2(l[1][1] - l[0][1], l[1][0] - l[0][0]);
        const ut = ul.slice().sort((a, b) => angOf(a) - angOf(b));
        const tt = this.target.lines.slice().sort((a, b) => angOf(a) - angOf(b));
        r = A.geom.scoreAngles(tt, ut);
      } else if (this.exKey === 'curve') {
        // openPath: dropping dots + chaining strokes, so dotting the start/end/apex
        // first (as the coach advises) then drawing through them scores the CURVE
        r = A.geom.scoreCurve(this.target.polyline, A.geom.openPath(strokes));
      } else if (this.exKey === 'gesture') {
        r = A.geom.scoreCurve(this.target.loa, A.geom.openPath(strokes));
      } else if (this.exKey === 'shade') {
        // POSITION matters: the shadow line must sit in the right place ON the
        // form, so no endpoint alignment; deviation scaled by the form's radius
        const f = this.target.form;
        r = A.geom.scoreCurveFixed(this.target.polyline, A.geom.openPath(strokes), Math.max(f.rx, f.ry) * 2);
      } else {
        // score from ALL strokes combined (a shape drawn in several strokes is fine)
        r = A.geom.scoreShape(this.target.polygon, this.surface.pointsDesign());
      }
      // estimate-before-reveal: hold the result, ask the learner to self-judge
      this.pending = r;
      this.sessionIndex++;
      this.phase = 'estimate';
      this.surface.locked = true;              // the scored snapshot is final — no edits now
      this.surface.setPhase('draw');           // keep marks, no target yet
      this._emit();
    } else {
      // reference exercise → reveal ghost, await self rating
      this.phase = 'reveal';
      this.surface.setGhost(this.ref ? this.ref.img : null, this.ghostOpacity);
      this.surface.setPhase('draw');           // no generated target
      this._emit();
    }
  };

  // learner submits their self-estimate (0–100) → reveal + record (scored only)
  Drill.prototype.submitEstimate = function (est) {
    if (this.phase !== 'estimate' || !this.pending) return;
    const r = this.pending; this.pending = null;
    const estErr = Math.abs(est - r.score);
    const coaching = A.coach.advice(this.exKey, r.metrics);
    // faded feedback (guidance hypothesis): the metric breakdown thins out as
    // skill grows — every trial at first, then progressively rarer. The learner
    // can always tap "Show breakdown" (self-controlled feedback, OPTIMAL).
    const period = Math.min(6, 1 + Math.ceil(this.level / 2));   // L1-2: every, L3-4: /3 … L9: /6
    const showDetail = (this.level <= 2) || (this.sessionIndex % period === 1);
    // repeats (answer already seen) and retention recalls don't feed the
    // promotion window — only genuine, first-look memory trials certify a level.
    // Manual glances cost level credit: the score stands, but each peek shaves
    // the value the promotion window sees (memory training isn't defeated quietly).
    let adv = { changed: false, level: this.level };
    if (!this.isRepeat && !this.isRecall && !this.isFinisher && !(this.glanceCount > 0)) {
      adv = A.curr.recordScore(this.exKey, r.score, dayKey());
      this.level = adv.level;
    }
    this.result = { score: r.score, selfRated: false, metrics: r.metrics,
                    selfEstimate: est, estErr, coaching, showDetail, levelChange: adv,
                    repeat: this.isRepeat, recall: this.isRecall, finisher: this.isFinisher };
    this._record(r.score, false, r.metrics, est);
    this.phase = 'reveal';
    this.surface.locked = false;
    this.surface.setPhase('reveal');
    if (this.onResult) this.onResult(this);   // bump set/session counters BEFORE rendering
    this._emit();
  };

  Drill.prototype.setGhostOpacity = function (o) {
    this.ghostOpacity = o;
    if (this.phase === 'reveal' && !this.def.scored) { this.surface.setGhost(this.ref ? this.ref.img : null, o); }
  };

  // objective score for a reference drill (silhouette/threshold IoU)
  Drill.prototype.submitObjectiveScore = function (score, metrics) {
    if (this.def.scored) return;
    this.result = { score, selfRated: false, metrics: metrics || {}, objective: true };
    this._record(score, false, metrics || {});
    if (this.onResult) this.onResult(this);
    this._emit();
  };

  Drill.prototype.submitSelfRating = function (score) {
    if (this.def.scored) return;
    this.result = { score, selfRated: true, metrics: {} };
    this._record(score, true, {});
    if (this.onResult) this.onResult(this);
    this._emit();
  };

  Drill.prototype._record = function (score, selfRated, metrics, selfEstimate) {
    // decimate strokes before storing: coalesced Pencil input is ~10× denser
    // than the drawn path needs — RDP keeps replay/thumbnails visually identical
    // while attempts, exports and the History screen stay light
    const strokes = this.surface.strokesDesign().map((s) => A.geom.rdp(s, 0.0015));
    const att = {
      ts: Date.now(), day: dayKey(), type: this.exKey, scored: !!this.def.scored,
      level: this.level, studySec: +this.studySec.toFixed(1), drawSec: +this.drawSec.toFixed(1),
      score: score, selfRated: !!selfRated, metrics: metrics || {},
      glances: this.glanceCount || 0,
      repeat: !!this.isRepeat, recall: !!this.isRecall, finisher: !!this.isFinisher,
      selfEstimate: (selfEstimate == null ? null : selfEstimate),
      estErr: (selfEstimate == null ? null : Math.abs(selfEstimate - score)),
      estBias: (selfEstimate == null ? null : selfEstimate - score),   // signed: + = overconfident
      target: this.target, strokes: strokes,
      refId: this.ref ? this.ref.id : null, refTitle: this.ref ? this.ref.title : null
    };
    A.store.addAttempt(att);
    if (this.isRecall && this.def.scored) A.curr.noteRecall(this.exKey, score, att.day);
    A.habit.touch((this.studySec || 0) + (this.drawSec || 0));
    if (!this.def.scored && !this.isRepeat) A.curr.touchRef(this.exKey, att.day, score);   // spaced review + Module 4 ladder
    if (this.exKey === 'bargue' && att.refId) A.game.notePlate(att.refId, score);   // plate-course best
    this.lastAttempt = att;
  };

  // redraw the SAME target from memory (Lecoq's correct-and-repeat step).
  // Marked as a repeat: the answer has been SEEN, so the attempt is recorded
  // but doesn't feed level promotion, personal bests or bias statistics.
  Drill.prototype.correctAndRedraw = function () {
    this.result = null;
    this.isRepeat = true;
    this.surface.clearMarks();
    this.surface.clearUndo();
    this.phase = 'draw';
    this.surface.locked = false;
    this.surface.ghostStudy = false; this.surface.setGhost(null); this.surface.setPhase('draw');
    this.drawElapsed = 0;
    this.drawStart = performance.now();
    this._startDrawTimer();
    this._emit();
  };

  // re-study the same target (another glance) then draw again — also a repeat
  Drill.prototype.studyAgain = function () {
    this.result = null;
    this.isRepeat = true;
    if (!this.def.scored && this.ref) this.surface.setGhost(this.ref.img, 1);
    this._enterStudy();
  };

  // brand-new target, same exercise
  Drill.prototype.next = function () {
    this.result = null;
    this.isRepeat = false; this.isRecall = false; this.isFinisher = false;
    this.level = A.curr.level(this.exKey);
    this.surface.reset();
    this._newTargetGeom();
    this._enterStudy();
  };

  // RETENTION CHECK — draw a target studied on a PREVIOUS day, cold, with no
  // study phase. This is Lecoq's real test (memory across a night's sleep) and
  // the strongest form of retrieval practice the app can offer. Recorded with
  // recall:true; excluded from level promotion (scores are expected to be lower
  // and shouldn't demote a level earned on same-day trials).
  Drill.prototype.startRecall = function (exKey, target) {
    this.exKey = exKey;
    this.def = A.curr.def(exKey);
    this.level = A.curr.level(exKey);
    this.result = null; this.pending = null; this.sessionIndex = 0;
    this.isRepeat = false; this.isRecall = true; this.isFinisher = false;
    this.stress = null;                            // a recall is never a correction figure
    this.glanceCount = 0; this.glanceCap = 0;      // no peeking — it's a test
    this.avgLook = 0;
    this.ref = null;
    this.surface.reset();
    this.target = target;
    this.surface.setTarget(target);
    this.surface.setGhost(null);
    this.studySec = 0;
    this.phase = 'draw';
    this.surface.locked = false;
    this.surface.guides = false;
    this.surface.setPhase('draw');
    this.stages = null; this.stage = 0;
    this.drawBudget = null;                        // unhurried — recall is hard enough
    this.drawElapsed = 0;
    this.drawStart = performance.now();
    this._startDrawTimer();
    this._emit();
  };

  Drill.prototype.stop = function () {
    clearInterval(this._timer);
    this.phase = 'idle';
    this.surface.locked = false;
    this.surface.reset();
    this._emit();
  };

  A.Drill = Drill;
})(window.A = window.A || {});
