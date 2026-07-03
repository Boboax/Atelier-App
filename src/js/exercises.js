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

  function dayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  const lineLen = (s) => A.geom.dist(s[0], s[s.length - 1]);

  // guided block-in stages for reference drills (general → specific)
  const STAGES = {
    bargue: ['Block the outer envelope — the largest straight lines that contain the whole form.',
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
    this._timer = null;
    this.onState = null; this.onTick = null; this.onResult = null;
    surface.onStrokeEnd = () => { if (this.onState) this.onState(this); };
  }

  Drill.prototype._emit = function () { if (this.onState) this.onState(this); };

  Drill.prototype.startExercise = function (exKey, refItem) {
    this.exKey = exKey;
    this.def = A.curr.def(exKey);
    this.level = A.curr.level(exKey);
    this.result = null; this.pending = null; this.sessionIndex = 0;
    this.glanceCount = 0; this.glanceCap = 3;
    this.avgLook = 0;       // recent average look time (for the over-stare nudge)
    A.store.attemptsByType(exKey).then((list) => {
      const looks = list.filter((a) => a.scored && a.studySec > 0).slice(-5).map((a) => a.studySec);
      if (looks.length >= 3) this.avgLook = looks.reduce((a, b) => a + b, 0) / looks.length;
    }).catch(() => {});
    this.ref = refItem || null;
    this.surface.reset();
    this._newTargetGeom();
    this._enterStudy();
  };

  Drill.prototype._newTargetGeom = function () {
    if (this.def.scored) {
      this.target = A.gen.make(this.exKey, this.level);
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
    return !!this.def.scored && this.level <= 3;   // auto
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
    this.studyCap = this.def.scored ? A.curr.studySeconds(this.exKey)
                                    : (this.ref && this.ref.studySec) || this.def.study();
    this.studySec = this.studyCap;
    this.studyRemaining = this.studyCap;
    this.studyElapsed = 0;
    this.glanceCount = 0;
    this.surface.clearMarks();
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

  Drill.prototype._toDraw = function () {
    clearInterval(this._timer);
    // record the ACTUAL look time (self-chosen for beginners) — shrinking it is progress
    this.studySec = +Math.max(0.1, (performance.now() - this._studyStart) / 1000).toFixed(1);
    this.phase = 'draw';
    this.surface.ghostStudy = false;
    this.surface.setGhost(null);        // hide reference
    this.surface.guides = this._computeGuides();
    this.surface.setPhase('draw');      // hide generated target
    this.surface.clearMarks();
    this.stages = (!this.def.scored && STAGES[this.exKey]) ? STAGES[this.exKey] : null;
    this.stage = 0;
    this.drawStart = performance.now();
    this._emit();
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
    }, ms || 600);
  };

  // flip the reference 180° (Edwards: defeats symbol-recognition)
  Drill.prototype.toggleFlip = function () {
    this.surface.ghostFlip = !this.surface.ghostFlip; this.surface.redraw();
    return this.surface.ghostFlip;
  };

  Drill.prototype.canEvaluate = function () {
    if (this.surface.isEmpty()) return false;
    if (this.exKey === 'line') return this.surface.totalPoints() >= 2;
    if (this.exKey === 'polygon' || this.exKey === 'envelope') return this.surface.totalPoints() >= 3;
    return true;
  };

  Drill.prototype._userLineFromLongest = function (strokes) {
    let best = null, bestLen = -1;
    for (const s of strokes) { if (s.length >= 2) { const L = lineLen(s); if (L > bestLen) { bestLen = L; best = s; } } }
    return best;
  };

  Drill.prototype.evaluate = function () {
    if (this.phase !== 'draw' || !this.canEvaluate()) return;
    this.drawSec = (performance.now() - this.drawStart) / 1000;
    const strokes = this.surface.strokesDesign();

    if (this.def.scored) {
      let r;
      if (this.exKey === 'line') {
        const s = this._userLineFromLongest(strokes) || strokes[0];
        r = A.geom.scoreLine(this.target.lines[0], A.geom.bestFitSegment(s));   // PCA best-fit
      } else if (this.exKey === 'angles') {
        const ul = strokes.filter((s) => s.length >= 2).map((s) => A.geom.bestFitSegment(s));
        const angOf = (l) => Math.atan2(l[1][1] - l[0][1], l[1][0] - l[0][0]);
        const ut = ul.slice().sort((a, b) => angOf(a) - angOf(b));
        const tt = this.target.lines.slice().sort((a, b) => angOf(a) - angOf(b));
        r = A.geom.scoreAngles(tt, ut);
      } else {
        // score from ALL strokes combined (a shape drawn in several strokes is fine)
        r = A.geom.scoreShape(this.target.polygon, this.surface.pointsDesign());
      }
      // estimate-before-reveal: hold the result, ask the learner to self-judge
      this.pending = r;
      this.sessionIndex++;
      this.phase = 'estimate';
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
    // faded feedback (guidance hypothesis): full metric breakdown only early on
    // or intermittently; otherwise just the score + one cue.
    const showDetail = (this.level <= 2) || (this.sessionIndex % 3 === 1);
    const adv = A.curr.recordScore(this.exKey, r.score);
    this.level = adv.level;
    this.result = { score: r.score, selfRated: false, metrics: r.metrics,
                    selfEstimate: est, estErr, coaching, showDetail, levelChange: adv };
    this._record(r.score, false, r.metrics, est);
    this.phase = 'reveal';
    this.surface.setPhase('reveal');
    this._emit();
    if (this.onResult) this.onResult(this);
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
    const att = {
      ts: Date.now(), day: dayKey(), type: this.exKey, scored: !!this.def.scored,
      level: this.level, studySec: +this.studySec.toFixed(1), drawSec: +this.drawSec.toFixed(1),
      score: score, selfRated: !!selfRated, metrics: metrics || {},
      glances: this.glanceCount || 0,
      selfEstimate: (selfEstimate == null ? null : selfEstimate),
      estErr: (selfEstimate == null ? null : Math.abs(selfEstimate - score)),
      target: this.target, strokes: this.surface.strokesDesign(),
      refId: this.ref ? this.ref.id : null, refTitle: this.ref ? this.ref.title : null
    };
    A.store.addAttempt(att);
    A.habit.touch((this.studySec || 0) + (this.drawSec || 0));
    this.lastAttempt = att;
  };

  // redraw the SAME target from memory (Lecoq's correct-and-repeat step)
  Drill.prototype.correctAndRedraw = function () {
    this.result = null;
    this.surface.clearMarks();
    this.phase = 'draw';
    this.surface.ghostStudy = false; this.surface.setGhost(null); this.surface.setPhase('draw');
    this.drawStart = performance.now();
    this._emit();
  };

  // re-study the same target (another glance) then draw again
  Drill.prototype.studyAgain = function () {
    this.result = null;
    if (!this.def.scored && this.ref) this.surface.setGhost(this.ref.img, 1);
    this._enterStudy();
  };

  // brand-new target, same exercise
  Drill.prototype.next = function () {
    this.result = null;
    this.level = A.curr.level(this.exKey);
    this.surface.reset();
    this._newTargetGeom();
    this._enterStudy();
  };

  Drill.prototype.stop = function () {
    clearInterval(this._timer);
    this.phase = 'idle';
    this.surface.reset();
    this._emit();
  };

  A.Drill = Drill;
})(window.A = window.A || {});
