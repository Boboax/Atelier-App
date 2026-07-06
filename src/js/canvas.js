/* ============================================================================
   canvas.js  —  the drawing surface
   ----------------------------------------------------------------------------
   One <canvas>, redrawn from state. Handles:
     - Apple Pencil via Pointer Events: pressure → stroke width (EMA-smoothed),
       coalesced events for full 120–240 Hz input, predicted events for a
       lower-latency stroke tail, tilt ignored.
     - One active pointer at a time (pointerId-owned), so a palm or second
       finger can never corrupt a stroke in progress.
     - Palm rejection: pen contact OR hover re-arms a touch-ignore window; a
       "pencilOnly" setting hard-enforces it.
     - Strokes stored in design space [0,1]² (not CSS px), so rotation/resize
       mid-drill keeps marks, target, scoring and replay aligned.
     - Incremental rendering: during a stroke only the new segments are drawn;
       full redraws happen on state changes. rAF-batched.
     - A centred square "study box" mapping design space [0,1]² → CSS pixels.
     - Render phases: STUDY (show target), DRAW (blank), REVEAL (target ghosted
       over the user's marks), plus arbitrary reference-image ghosting.
     - Snapshot undo (stroke, erase and clear are all undoable).
   Exposed as window.A.Surface (constructor).
   ========================================================================== */
(function (A) {
  'use strict';

  const UNDO_MAX = 24;

  function Surface(canvas, opts) {
    this.canvas = canvas;
    // alpha:false — we always paint an opaque paper background, so an opaque
    // buffer composites cheaper; desynchronized shaves a frame where supported.
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    // smooth: 0 = raw, higher = more stabilisation (eases hand jitter so straight
    // and curved lines come out cleaner). 0.5 = a balanced default.
    this.opts = Object.assign({ pencilOnly: false, baseWidth: 3.2, ink: '#1a1a1a', smooth: 0.5 }, opts || {});
    this.strokes = [];          // [{pts:[[x,y,p],...]}] in DESIGN coords
    this.target = null;         // generated target (design coords) or null
    this.showTarget = false;    // STUDY phase
    this.revealTarget = false;  // REVEAL phase (draw target over user marks)
    this.ghost = null;          // {img, opacity} reference image overlay
    this.ghostStudy = false;    // show ghost at full study opacity
    this.box = { x: 0, y: 0, s: 1 };
    this.guides = false;        // sighting training wheels (plumb/horizon/thirds)
    this.cropMode = false;      // drag-select a region (e.g. one Bargue panel)
    this.cropRect = null;
    this.erasing = false;       // point eraser: drag over marks to remove them
    this.eraseR = 16;           // eraser radius (CSS px)
    this._erasePt = null;       // design coords
    this.measureMode = false;   // comparative measurement (Bargue): drag to lay a caliper
    this.measures = [];         // [{a:[x,y], b:[x,y]}] in design coords; measures[0] = the unit
    this._curMeasure = null;
    this.locked = false;        // set by the drill: no marks during STUDY/ESTIMATE
    this.sightSize = false;     // split layout: reference panel (left) + drawing panel (right) at 1:1
    this.refBox = null;         // the reference panel rect (sight-size mode)
    this.stepBack = false;      // zoomed-out judging view — drawing disabled
    this._flickUntil = 0;       // flash the reference over the drawing (eye-flick check)
    this.stringLine = null;     // the taut-string check: {a,b} design pts, spans both panels
    this.stringMode = false;
    this.view = { z: 1, tx: 0, ty: 0 };   // pinch zoom/pan (two-finger touch)
    this.onViewChange = null;   // notified when zoom starts/ends (UI reset button)
    this.onStepBack = null;     // notified on step-back enter/exit (sight-size UI refresh)
    this._touchPts = new Map(); // live touch positions (for pinch), independent of drawing
    this._pinch = null;
    this._penSeen = 0;
    this._drawing = false;
    this._cur = null;
    this._activeId = null;      // the one pointer we own right now
    this._emaP = 0.5;           // pressure EMA state for the active stroke
    this._drawnIdx = 0;         // last segment index committed by the incremental renderer
    this._predicted = null;     // predicted tail points (cleaned by full redraw on up)
    this._raf = 0;
    this._needFull = false;
    this._undoStack = [];
    this.cssW = 0; this.cssH = 0;
    this._dpr = window.devicePixelRatio || 1;
    this._bind();
    this.resize();
  }

  Surface.prototype._bind = function () {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e));
    c.addEventListener('pointercancel', (e) => this._up(e, true));
    c.addEventListener('pointerleave', (e) => this._up(e));
    // Pencil hover (M2/Pro) re-arms palm rejection before the tip ever lands
    c.addEventListener('pointerover', (e) => { if (e.pointerType === 'pen') this._penSeen = performance.now(); });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 60));
  };

  // Measure the canvas's CURRENT on-screen rect and size the backing store to it.
  // The SAME rect is used for pointer mapping and the draw transform, so the pen
  // tip and the ink always coincide — even if the in-app browser (e.g. Documents)
  // settles its layout after launch or reports a non-standard pixel ratio.
  Surface.prototype._measure = function () {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this._rect = r;
    this._dpr = window.devicePixelRatio || 1;
    const needW = Math.max(1, Math.round(r.width * this._dpr));
    const needH = Math.max(1, Math.round(r.height * this._dpr));
    if (this.canvas.width !== needW) this.canvas.width = needW;   // assigning clears, so guard
    if (this.canvas.height !== needH) this.canvas.height = needH;
    this.cssW = r.width; this.cssH = r.height;
    // landscape side-rail layout: canvas owns its cell (reserve ~nothing); portrait:
    // reserve room for the top instructor bar and bottom controls so the box is visible.
    const rail = window.matchMedia && window.matchMedia('(orientation:landscape) and (min-width:900px)').matches;
    const top = rail ? 10 : 72, bottom = rail ? 10 : 108;
    const availH = Math.max(80, r.height - top - bottom);
    if (this.sightSize) {
      // sight-size: two equal panels side by side — reference left, drawing
      // right, SAME scale by construction (the whole point of the method)
      const gap = 14;
      const s = Math.min((r.width - gap) / 2 * 0.96, availH * 0.96);
      const mx = (r.width - 2 * s - gap) / 2;
      const y = top + (availH - s) / 2;
      this.refBox = { x: mx, y, s };
      this.box = { x: mx + s + gap, y, s };
    } else {
      this.refBox = null;
      const s = Math.min(r.width * (rail ? 0.97 : 0.94), availH * (rail ? 0.97 : 0.98));
      this.box = { x: (r.width - s) / 2, y: top + (availH - s) / 2, s: s };
    }
  };

  Surface.prototype.resize = function () {
    this._measure();
    this.redraw();
  };

  // design [0,1] → css px and back
  Surface.prototype.toPx = function (p) {
    return [this.box.x + p[0] * this.box.s, this.box.y + p[1] * this.box.s];
  };
  Surface.prototype.toDesign = function (p) {
    return [(p[0] - this.box.x) / this.box.s, (p[1] - this.box.y) / this.box.s];
  };

  /* ---- pointer handling --------------------------------------------------*/
  Surface.prototype._accepts = function (e) {
    if (e.pointerType === 'pen') { this._penSeen = performance.now(); return true; }
    if (e.pointerType === 'touch') {
      if (this.opts.pencilOnly) return false;
      if (!e.isPrimary) return false;                             // second finger = never ink
      if (performance.now() - this._penSeen < 1500) return false; // palm rejection
      return true;
    }
    return true; // mouse (desktop testing)
  };

  Surface.prototype._capture = function (e) {
    try { this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
  };

  // client coords → CONTENT CSS px (inverting the effective view transform)
  Surface.prototype._content = function (clientX, clientY) {
    const r = this._rect || this.canvas.getBoundingClientRect();
    const v = this._effView();
    return [(clientX - r.left - v.tx) / v.z, (clientY - r.top - v.ty) / v.z];
  };

  // event → [designX, designY, smoothedPressure]
  Surface.prototype._pt = function (e, first) {
    let pr = e.pressure;
    if (e.pointerType !== 'pen' || pr === 0 || pr == null) pr = 0.5; // fallback
    // EMA: Pencil pressure is noisy at coalesced rates — smooth it so the
    // stroke width tapers instead of banding
    this._emaP = first ? pr : (0.35 * pr + 0.65 * this._emaP);
    const c = this._content(e.clientX, e.clientY);
    const raw = this.toDesign(c);
    // positional stabiliser: ease the point toward the pen so hand jitter is
    // damped (k=1 raw, lower k = smoother). Makes straight/curved lines cleaner.
    const k = this._posK == null ? 1 : this._posK;
    if (first || !this._emaPos) this._emaPos = [raw[0], raw[1]];
    else { this._emaPos[0] += (raw[0] - this._emaPos[0]) * k; this._emaPos[1] += (raw[1] - this._emaPos[1]) * k; }
    return [this._emaPos[0], this._emaPos[1], this._emaP];
  };

  Surface.prototype._design = function (e) {
    return this.toDesign(this._content(e.clientX, e.clientY));
  };

  /* ---- pinch zoom & pan (two-finger touch; pen keeps drawing) ------------ */
  Surface.prototype._clampView = function () {
    const v = this.view;
    v.z = Math.max(1, Math.min(6, v.z));
    v.tx = Math.max(this.cssW * (1 - v.z), Math.min(0, v.tx));
    v.ty = Math.max(this.cssH * (1 - v.z), Math.min(0, v.ty));
    if (v.z < 1.02) { v.z = 1; v.tx = 0; v.ty = 0; }
  };
  Surface.prototype.resetView = function () {
    this.view = { z: 1, tx: 0, ty: 0 };
    this.redraw();
    if (this.onViewChange) this.onViewChange(1);
  };
  Surface.prototype._maybeStartPinch = function () {
    if (this._touchPts.size !== 2) return;
    // a young accidental touch stroke gives way to the pinch (Procreate-style)
    if (this._drawing && this._cur && this._cur.pts.length < 12) {
      this.strokes.pop(); this._undoStack.pop();
      this._drawing = false; this._cur = null; this._activeId = null; this._predicted = null;
    }
    if (this._drawing) return;                 // pen stroke in progress — pen wins
    const pts = Array.from(this._touchPts.values());
    const r = this._rect || this.canvas.getBoundingClientRect();
    this._pinch = {
      d0: Math.max(8, Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1])),
      z0: this.view.z, tx0: this.view.tx, ty0: this.view.ty,
      m0: [(pts[0][0] + pts[1][0]) / 2 - r.left, (pts[0][1] + pts[1][1]) / 2 - r.top]
    };
  };
  Surface.prototype._doPinch = function () {
    const p = this._pinch; if (!p || this._touchPts.size < 2) return;
    const pts = Array.from(this._touchPts.values());
    const r = this._rect || this.canvas.getBoundingClientRect();
    const d = Math.max(8, Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]));
    const m = [(pts[0][0] + pts[1][0]) / 2 - r.left, (pts[0][1] + pts[1][1]) / 2 - r.top];
    const z = p.z0 * d / p.d0;
    // keep the content point that started under the fingers anchored to them
    const cx = (p.m0[0] - p.tx0) / p.z0, cy = (p.m0[1] - p.ty0) / p.z0;
    this.view.z = z;
    this.view.tx = m[0] - cx * this.view.z;
    this.view.ty = m[1] - cy * this.view.z;
    this._clampView();
    this._scheduleFull();
    if (this.onViewChange) this.onViewChange(this.view.z);
  };
  // displayed rect of the current ghost image, in design coords (0..1 of the box)
  Surface.prototype.ghostRectDesign = function () {
    const g = this.ghost; if (!g || !g.img) return { x: 0, y: 0, w: 1, h: 1 };
    const im = g.img, iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    const s = Math.min(this.box.s / iw, this.box.s / ih), w = iw * s, h = ih * s;
    return { x: ((this.box.s - w) / 2) / this.box.s, y: ((this.box.s - h) / 2) / this.box.s, w: w / this.box.s, h: h / this.box.s };
  };

  /* ---- undo (snapshot-based: stroke, erase and clear all restore) -------- */
  Surface.prototype._snapshot = function () {
    this._undoStack.push(this.strokes.map((s) => ({ pts: s.pts.slice() })));
    if (this._undoStack.length > UNDO_MAX) this._undoStack.shift();
  };
  Surface.prototype.undo = function () {
    if (this._drawing || !this._undoStack.length) return;
    this.strokes = this._undoStack.pop();
    this.redraw();
  };
  Surface.prototype.canUndo = function () { return this._undoStack.length > 0 && !this._drawing; };

  // remove stroke points within the eraser radius, splitting strokes as needed
  Surface.prototype._eraseAt = function (p) {
    const R = this.eraseR / ((this.box.s || 1) * (this.view.z || 1)), R2 = R * R, out = [];
    for (const s of this.strokes) {
      let run = [];
      for (const pt of s.pts) {
        const dx = pt[0] - p[0], dy = pt[1] - p[1];
        if (dx * dx + dy * dy <= R2) { if (run.length >= 2) out.push({ pts: run }); run = []; }
        else run.push(pt);
      }
      if (run.length >= 2) out.push({ pts: run });
    }
    this.strokes = out;
  };
  Surface.prototype.toggleEraser = function () { this.erasing = !this.erasing; this._erasePt = null; if (this.erasing) this.measureMode = false; this.redraw(); return this.erasing; };

  /* ---- comparative measurement (Bargue caliper) -------------------------- */
  Surface.prototype._mlen = function (m) { return Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]); };
  Surface.prototype.unitLen = function () { return this.measures.length ? this._mlen(this.measures[0]) : null; };
  Surface.prototype.toggleMeasure = function () { this.measureMode = !this.measureMode; if (this.measureMode) this.erasing = false; this.redraw(); return this.measureMode; };
  Surface.prototype.clearMeasures = function () { this.measures = []; this._curMeasure = null; this.redraw(); };

  Surface.prototype._down = function (e) {
    // pinch tracking is independent of drawing/palm logic: any second finger
    // starts a zoom, even in pencil-only mode (touch never inks there anyway)
    if (e.pointerType === 'touch') {
      this._touchPts.set(e.pointerId, [e.clientX, e.clientY]);
      if (this._touchPts.size === 2) { e.preventDefault(); this._maybeStartPinch(); if (this._pinch) return; }
    }
    if (this._activeId != null) return;       // one pointer owns the surface at a time
    // stepped back = judging distance: you can't mark from across the room —
    // any tap walks you back to the easel instead
    if (this.stepBack) { e.preventDefault(); this.stepBack = false; this.redraw(); if (this.onStepBack) this.onStepBack(false); return; }
    if (!this._drawing && !this._cropping) this._measure();   // refresh rect (layout may have settled)
    if (this.stringMode) {
      e.preventDefault();
      this._capture(e);
      this._activeId = e.pointerId;
      this._stringing = true;
      const p = this._design(e); this.stringLine = { a: p, b: p };
      this.redraw();
      return;
    }
    if (this.measureMode) {
      e.preventDefault();
      this._capture(e);
      this._activeId = e.pointerId;
      this._measuring = true; const p = this._design(e); this._curMeasure = { a: p, b: p }; this.redraw();
      return;
    }
    if (this.cropMode) {
      e.preventDefault();
      this._capture(e);
      this._activeId = e.pointerId;
      this._cropping = true; const p = this._design(e); this.cropRect = [p, p]; this.redraw();
      return;
    }
    if (this.erasing && !this.locked) {
      e.preventDefault();
      this._capture(e);
      this._activeId = e.pointerId;
      this._snapshot();                        // erase gestures are undoable
      this._erasingActive = true; const p = this._design(e); this._erasePt = p; this._eraseAt(p); this.redraw();
      return;
    }
    if (!this.locked && this._accepts(e)) {
      e.preventDefault();
      this._capture(e);
      this._activeId = e.pointerId;
      this._snapshot();
      this._drawing = true;
      // stabiliser strength for this stroke (clamped so it can never fully freeze)
      this._posK = 1 - Math.max(0, Math.min(0.8, this.opts.smooth == null ? 0.5 : this.opts.smooth));
      this._emaPos = null;
      this._cur = { pts: [this._pt(e, true)] };
      this.strokes.push(this._cur);
      this._drawnIdx = 0;
      this._predicted = null;
      this.redraw();
    } else {
      e.preventDefault();                      // rejected pointer: suppress iOS side effects
    }
  };

  Surface.prototype._move = function (e) {
    if (e.pointerType === 'pen') this._penSeen = performance.now();  // palm guard mid-stroke
    if (e.pointerType === 'touch' && this._touchPts.has(e.pointerId)) {
      this._touchPts.set(e.pointerId, [e.clientX, e.clientY]);
      if (this._pinch) { e.preventDefault(); this._doPinch(); return; }
    }
    if (this._activeId != null && e.pointerId !== this._activeId) return;
    if (this._stringing) { e.preventDefault(); this.stringLine.b = this._design(e); this._scheduleFull(); return; }
    if (this._measuring) { e.preventDefault(); this._curMeasure.b = this._design(e); this._scheduleFull(); return; }
    if (this._cropping) { e.preventDefault(); this.cropRect[1] = this._design(e); this._scheduleFull(); return; }
    if (this._erasingActive) {
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      const pts = (evs && evs.length) ? evs.map((ev) => this._design(ev)) : [this._design(e)];
      for (const p of pts) { this._erasePt = p; this._eraseAt(p); }
      this._scheduleFull(); return;
    }
    if (!this._drawing || !this._cur) return;
    e.preventDefault();
    // coalesced events give smoother high-rate Pencil strokes; fall back to the
    // event itself when the coalesced list is empty (some browsers / synthetic events)
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (evs && evs.length) { for (const ev of evs) this._cur.pts.push(this._pt(ev)); }
    else this._cur.pts.push(this._pt(e));
    // predicted tail: one point ahead cuts perceived Pencil lag; any error is
    // overwritten by the real path next frame and cleaned by the full redraw on up
    let pred = null;
    if (e.pointerType === 'pen' && e.getPredictedEvents) {
      const ps = e.getPredictedEvents();
      if (ps && ps.length) pred = this._pt(ps[0]);
    }
    this._predicted = pred;
    this._scheduleStroke();
  };

  Surface.prototype._up = function (e, cancelled) {
    if (e && e.pointerType === 'touch') {
      this._touchPts.delete(e.pointerId);
      if (this._pinch && this._touchPts.size < 2) {
        this._pinch = null;
        this._clampView(); this._scheduleFull();
        if (this.onViewChange) this.onViewChange(this.view.z);
        return;
      }
    }
    if (this._activeId != null && e && e.pointerId != null && e.pointerId !== this._activeId) return;
    // release pointer capture so the NEXT tap reaches the buttons (not the canvas) —
    // otherwise the first tap after a stroke is swallowed and you must tap twice.
    try { if (e && e.pointerId != null && this.canvas.releasePointerCapture) this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    this._activeId = null;
    if (this._stringing) {
      this._stringing = false;
      if (this.stringLine && this._mlen({ a: this.stringLine.a, b: this.stringLine.b }) < 0.02) this.stringLine = null;   // a tap clears it
      this.redraw();
      if (this.onStrokeEnd) this.onStrokeEnd();
      return;
    }
    if (this._measuring) {
      this._measuring = false;
      const m = this._curMeasure; this._curMeasure = null;
      if (m && this._mlen(m) > 0.02) this.measures.push(m);   // ignore tiny taps; first becomes the unit
      this.redraw();
      if (this.onStrokeEnd) this.onStrokeEnd();                // refresh controls (unit may now exist)
      return;
    }
    if (this._cropping) { this._cropping = false; this.cropMode = false; if (this.onCropEnd) this.onCropEnd(this.cropRect); return; }
    if (this._erasingActive) { this._erasingActive = false; this._erasePt = null; this.redraw(); if (this.onStrokeEnd) this.onStrokeEnd(); return; }
    if (!this._drawing) return;
    this._drawing = false;
    this._predicted = null;
    if (cancelled && this._cur && this._cur.pts.length < 4) {
      // a system gesture stole the pointer mid-tap — drop the accidental mark
      this.strokes.pop();
      this._undoStack.pop();
    } else if (this._cur && this._cur.pts.length === 1) {
      // a dot: duplicate so it renders (drawn as a filled disc, see _drawStrokes)
      this._cur.pts.push(this._cur.pts[0].slice());
    }
    this._cur = null;
    this.redraw();                              // clean any predicted-tail overshoot
    if (this.onStrokeEnd) this.onStrokeEnd();
  };

  /* ---- rAF-batched rendering scheduler ------------------------------------
     During an active stroke only the NEW segments are appended on top of the
     existing raster (the ink is opaque), so cost per frame is constant instead
     of growing with the drawing. Everything else takes the full redraw path. */
  Surface.prototype._scheduleStroke = function () {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (this._needFull) { this._needFull = false; this.redraw(); return; }
      this._appendSegments();
    });
  };
  Surface.prototype._scheduleFull = function () {
    this._needFull = true;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0; this._needFull = false; this.redraw();
    });
  };

  // effective view: step-back overrides the pinch with a centered zoom-out —
  // the digital walk-away-from-the-easel (detail filters out, structure remains)
  Surface.prototype._effView = function () {
    if (!this.stepBack) return this.view;
    const z = 0.55;
    return { z, tx: this.cssW * (1 - z) / 2, ty: this.cssH * (1 - z) / 2 };
  };
  Surface.prototype._setStrokeTransform = function (ctx) {
    const r = this._rect || this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / (r.width || 1), sy = this.canvas.height / (r.height || 1);
    const v = this._effView();   // pinch zoom/pan composes on top of the DPR mapping
    ctx.setTransform(sx * v.z, 0, 0, sy * v.z, sx * v.tx, sy * v.ty);
  };
  Surface.prototype.toggleStepBack = function () {
    this.stepBack = !this.stepBack;
    this.redraw();
    if (this.onStepBack) this.onStepBack(this.stepBack);
    return this.stepBack;
  };
  // eye-flick: flash the reference over the DRAWING panel for a beat — the
  // fast subject↔drawing comparison of sight-size, without moving the eyes
  Surface.prototype.flick = function (ms) {
    this._flickUntil = performance.now() + (ms || 700);
    this.redraw();
    setTimeout(() => this.redraw(), (ms || 700) + 30);
  };
  Surface.prototype.toggleString = function () {
    this.stringMode = !this.stringMode;
    if (this.stringMode) { this.erasing = false; this.measureMode = false; }
    else this.stringLine = null;
    this.redraw();
    return this.stringMode;
  };
  Surface.prototype._segWidth = function (a, b) {
    const p = ((a[2] == null ? 0.5 : a[2]) + (b[2] == null ? 0.5 : b[2])) / 2;
    return this.opts.baseWidth * (0.45 + p * 1.5);
  };

  Surface.prototype._appendSegments = function () {
    const s = this._cur; if (!s) return;
    const pts = s.pts, ctx = this.ctx;
    ctx.save();
    this._setStrokeTransform(ctx);
    ctx.strokeStyle = this.opts.ink; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (let i = Math.max(1, this._drawnIdx + 1); i < pts.length; i++) {
      const a = this.toPx(pts[i - 1]), b = this.toPx(pts[i]);
      ctx.beginPath();
      ctx.lineWidth = this._segWidth(pts[i - 1], pts[i]);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    this._drawnIdx = pts.length - 1;
    if (this._predicted && pts.length) {
      const a = this.toPx(pts[pts.length - 1]), b = this.toPx(this._predicted);
      ctx.beginPath();
      ctx.lineWidth = this._segWidth(pts[pts.length - 1], this._predicted);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.restore();
  };

  /* ---- programmatic state ------------------------------------------------*/
  Surface.prototype.clearMarks = function () {
    if (this.strokes.length) this._snapshot();
    this.strokes = []; this.redraw();
  };
  Surface.prototype.clearUndo = function () { this._undoStack = []; };
  Surface.prototype.reset = function () {
    this.strokes = []; this.target = null; this.showTarget = false;
    this.revealTarget = false; this.ghost = null; this.ghostStudy = false;
    this.ghostFlip = false;
    this.cropMode = false; this.cropRect = null;
    this.erasing = false; this._erasingActive = false; this._erasePt = null;
    this.measureMode = false; this.measures = []; this._curMeasure = null; this._measuring = false;
    this.sightSize = false; this.refBox = null; this.stepBack = false;
    this.stringLine = null; this.stringMode = false; this._stringing = false; this._flickUntil = 0;
    this._undoStack = [];
    this.view = { z: 1, tx: 0, ty: 0 }; this._pinch = null;
    if (this.onViewChange) this.onViewChange(1);
    this._measure();   // layout may switch between single-box and sight-size split
    this.redraw();
  };
  Surface.prototype.setTarget = function (t) { this.target = t; this.redraw(); };
  Surface.prototype.setPhase = function (phase) {
    this.showTarget = (phase === 'study');
    this.revealTarget = (phase === 'reveal');
    this.redraw();
  };
  Surface.prototype.setGhost = function (img, opacity) {
    this.ghost = img ? { img, opacity: opacity == null ? 0.4 : opacity } : null;
    this.redraw();
  };

  /* ---- export user marks for scoring ------------------------------------*/
  // strokes as separate polylines in DESIGN coords (x,y only)
  Surface.prototype.strokesDesign = function () {
    return this.strokes.map((s) => s.pts.map((p) => [p[0], p[1]]));
  };
  // all points concatenated (for closed-shape scoring), in design coords
  Surface.prototype.pointsDesign = function () {
    const out = [];
    for (const s of this.strokes) for (const p of s.pts) out.push([p[0], p[1]]);
    return out;
  };
  Surface.prototype.isEmpty = function () { return this.strokes.length === 0; };
  Surface.prototype.totalPoints = function () {
    return this.strokes.reduce((n, s) => n + s.pts.length, 0);
  };

  /* ---- rendering ---------------------------------------------------------*/
  Surface.prototype._drawTargetGeom = function (ctx, color, fill, lineW) {
    const t = this.target; if (!t) return;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = lineW || 2.5;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (t.kind === 'line' || t.kind === 'angles') {
      for (const ln of t.lines) {
        const a = this.toPx(ln[0]), b = this.toPx(ln[1]);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    } else if (t.kind === 'shade') {
      // reveal: the true terminator over the user's marks (contour is drawn
      // separately in redraw so it's visible in every phase)
      ctx.beginPath();
      const s0 = this.toPx(t.polyline[0]); ctx.moveTo(s0[0], s0[1]);
      for (let i = 1; i < t.polyline.length; i++) { const p = this.toPx(t.polyline[i]); ctx.lineTo(p[0], p[1]); }
      ctx.stroke();
    } else if (t.kind === 'gesture') {
      // head + mass ovals only during STUDY (they make it read as a figure);
      // the line of action is the thing memorised, redrawn and scored
      if (this.showTarget && t.head) {
        ctx.save(); ctx.globalAlpha = 0.5;
        const drawOval = (cx, cy, rx, ry) => { const c = this.toPx([cx, cy]); ctx.beginPath(); ctx.ellipse(c[0], c[1], rx * this.box.s, ry * this.box.s, 0, 0, Math.PI * 2); ctx.stroke(); };
        drawOval(t.head[0], t.head[1], t.head[2], t.head[2]);
        (t.masses || []).forEach((m) => drawOval(m[0], m[1], m[2], m[3]));
        ctx.restore();
      }
      ctx.beginPath();
      const g0 = this.toPx(t.loa[0]); ctx.moveTo(g0[0], g0[1]);
      for (let i = 1; i < t.loa.length; i++) { const p = this.toPx(t.loa[i]); ctx.lineTo(p[0], p[1]); }
      ctx.lineWidth = (lineW || 2.5) + 1; ctx.stroke();
    } else if (t.polyline) {            // open curve — stroke, no fill, no close
      ctx.beginPath();
      const q0 = this.toPx(t.polyline[0]); ctx.moveTo(q0[0], q0[1]);
      for (let i = 1; i < t.polyline.length; i++) { const p = this.toPx(t.polyline[i]); ctx.lineTo(p[0], p[1]); }
      ctx.stroke();
    } else if (t.polygon) {
      ctx.beginPath();
      const p0 = this.toPx(t.polygon[0]); ctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < t.polygon.length; i++) { const p = this.toPx(t.polygon[i]); ctx.lineTo(p[0], p[1]); }
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.stroke();
    }
    ctx.restore();
  };

  Surface.prototype._drawStrokes = function (ctx) {
    ctx.save();
    ctx.strokeStyle = this.opts.ink; ctx.fillStyle = this.opts.ink;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const s of this.strokes) {
      const pts = s.pts; if (pts.length < 2) continue;
      // a dot (two ~coincident points): zero-length strokes don't render in
      // Safari, so draw a filled disc instead
      if (pts.length === 2 && Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) * this.box.s < 1) {
        const c = this.toPx(pts[0]);
        ctx.beginPath();
        ctx.arc(c[0], c[1], this._segWidth(pts[0], pts[1]) / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      for (let i = 1; i < pts.length; i++) {
        const a = this.toPx(pts[i - 1]), b = this.toPx(pts[i]);
        ctx.beginPath();
        ctx.lineWidth = this._segWidth(pts[i - 1], pts[i]);
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    }
    ctx.restore();
  };

  // the terminator drill's form: bare contour in every phase (you place the
  // shadow ON the form); during STUDY, a lit rendering with a clear core-shadow
  // edge — the thing to memorise.
  Surface.prototype._drawShadeForm = function (ctx, study) {
    const t = this.target; if (!t || t.kind !== 'shade') return;
    const path = (pts, close) => {
      ctx.beginPath();
      const p0 = this.toPx(pts[0]); ctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < pts.length; i++) { const p = this.toPx(pts[i]); ctx.lineTo(p[0], p[1]); }
      if (close) ctx.closePath();
    };
    ctx.save();
    if (study) {
      const f = t.form, L = t.light;
      const c = this.toPx([f.cx, f.cy]);
      const R = Math.max(f.rx, f.ry) * this.box.s;
      // lit-side highlight: offset radial gradient inside the silhouette
      path(t.contour, true); ctx.save(); ctx.clip();
      const hx = c[0] + L.x * R * 0.45, hy = c[1] + L.y * R * 0.45;
      const grad = ctx.createRadialGradient(hx, hy, R * 0.08, c[0], c[1], R * 1.25);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.55, '#e9e2d4'); grad.addColorStop(1, '#c9c1b0');
      ctx.fillStyle = grad; ctx.fillRect(c[0] - R * 2, c[1] - R * 2, R * 4, R * 4);
      // core shadow beyond the terminator — the boundary being memorised
      path(t.shadow, true); ctx.fillStyle = 'rgba(64,54,42,0.34)'; ctx.fill();
      ctx.restore();
    }
    // the bare form contour (all phases)
    path(t.contour, true);
    ctx.strokeStyle = study ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.6; ctx.stroke();
    ctx.restore();
  };

  Surface.prototype._drawGhost = function (ctx, opacity, intoBox) {
    const g = this.ghost; if (!g || !g.img) return;
    const b = intoBox || this.box;
    const im = g.img;
    const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    if (!iw || !ih) return;
    const s = Math.min(b.s / iw, b.s / ih);
    const w = iw * s, h = ih * s;
    const x = b.x + (b.s - w) / 2, y = b.y + (b.s - h) / 2;
    ctx.save(); ctx.globalAlpha = opacity;
    if (this.ghostFlip) {     // 180° rotation defeats symbol-recognition (Edwards)
      const cx = b.x + b.s / 2, cy = b.y + b.s / 2;
      ctx.translate(cx, cy); ctx.rotate(Math.PI); ctx.translate(-cx, -cy);
    }
    ctx.drawImage(im, x, y, w, h); ctx.restore();
  };

  // the taut string: a straight check-line laid at ANY angle, extended across
  // BOTH panels — compare an alignment or slope on the plate against the same
  // place in the drawing, exactly like a string stretched between the hands.
  // Held horizontal it is the classical level line.
  Surface.prototype._drawString = function (ctx) {
    const s = this.stringLine; if (!s) return;
    const a = this.toPx(s.a), b = this.toPx(s.b);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy); if (L < 2) return;
    const ux = dx / L, uy = dy / L;
    const ext = (this.cssW + this.cssH) * 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(42,107,138,0.85)'; ctx.lineWidth = 1.5; ctx.setLineDash([9, 6]);
    ctx.beginPath();
    ctx.moveTo(a[0] - ux * ext, a[1] - uy * ext);
    ctx.lineTo(a[0] + ux * ext, a[1] + uy * ext);
    ctx.stroke();
    ctx.setLineDash([]);
    // angle readout (from horizontal, folded to ±90°)
    let deg = Math.atan2(dy, dx) * 180 / Math.PI;
    if (deg > 90) deg -= 180; if (deg <= -90) deg += 180;
    const lab = Math.abs(deg) < 0.75 ? 'level' : deg.toFixed(1) + '°';
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - 12;
    ctx.font = '600 12px ui-sans-serif, system-ui, -apple-system, sans-serif';
    const tw = ctx.measureText(lab).width + 8;
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(mx - tw / 2, my - 9, tw, 17);
    ctx.fillStyle = 'rgba(42,107,138,1)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lab, mx, my);
    ctx.restore();
  };

  // plumb line, horizon, rule-of-thirds and a faint angle-clock ring — the
  // measuring scaffolds an atelier beginner is taught, faded out by level.
  Surface.prototype._drawGuides = function (ctx) {
    const b = this.box, cx = b.x + b.s / 2, cy = b.y + b.s / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const x = b.x + b.s * i / 3, y = b.y + b.s * i / 3;
      ctx.beginPath(); ctx.moveTo(x, b.y); ctx.lineTo(x, b.y + b.s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(b.x, y); ctx.lineTo(b.x + b.s, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.13)';
    ctx.beginPath(); ctx.moveTo(cx, b.y); ctx.lineTo(cx, b.y + b.s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b.x, cy); ctx.lineTo(b.x + b.s, cy); ctx.stroke();
    // angle-clock ticks every 15°
    const R = b.s * 0.13;
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    for (let d = 0; d < 180; d += 15) {
      const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(cx + c * R * 0.82, cy + s * R * 0.82); ctx.lineTo(cx + c * R, cy + s * R);
      ctx.moveTo(cx - c * R * 0.82, cy - s * R * 0.82); ctx.lineTo(cx - c * R, cy - s * R);
      ctx.stroke();
    }
    ctx.restore();
  };

  // comparative-measurement calipers: line + end ticks + a ratio label. The first
  // measure is the UNIT (shown as "1u"); every other reads "×N.NN" of that unit —
  // the heart of Bargue sighting ("this span is 1.4 units").
  Surface.prototype._drawMeasures = function (ctx) {
    const list = this.measures.slice(); if (this._curMeasure) list.push(this._curMeasure);
    if (!list.length) return;
    const unit = this.measures.length ? this._mlen(this.measures[0]) : null;
    ctx.save();
    ctx.lineWidth = 1.5; ctx.font = '600 12px ui-sans-serif, system-ui, -apple-system, sans-serif';
    for (let i = 0; i < list.length; i++) {
      const m = list[i], isUnit = (i === 0);
      const a = this.toPx(m.a), b = this.toPx(m.b), len = this._mlen(m);
      const color = isUnit ? '#b4532a' : '#2a6b8a';
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * 6, ny = dx / L * 6;
      ctx.beginPath(); ctx.moveTo(a[0] - nx, a[1] - ny); ctx.lineTo(a[0] + nx, a[1] + ny); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(b[0] - nx, b[1] - ny); ctx.lineTo(b[0] + nx, b[1] + ny); ctx.stroke();
      const lab = isUnit ? '1u' : (unit ? '×' + (len / unit).toFixed(2) : '');
      if (lab) {
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, tw = ctx.measureText(lab).width + 8;
        ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fillRect(mx - tw / 2, my - 9, tw, 17);
        ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(lab, mx, my);
        ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      }
    }
    ctx.restore();
  };

  Surface.prototype.redraw = function () {
    const ctx = this.ctx;
    ctx.save();
    // raw clear first: when stepped back (zoomed out) the paper floats on a
    // desk-toned surround, so the whole viewport must be painted
    const r0 = this._rect || this.canvas.getBoundingClientRect();
    ctx.setTransform(this.canvas.width / (r0.width || 1), 0, 0, this.canvas.height / (r0.height || 1), 0, 0);
    ctx.fillStyle = this.stepBack ? '#dcd6c9' : '#ffffff';
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    // transform from the live displayed size (not an assumed dpr) so 1 unit = 1 CSS px
    this._setStrokeTransform(ctx);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    // study-box frame (subtle)
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1;
    ctx.strokeRect(this.box.x, this.box.y, this.box.s, this.box.s);
    ctx.restore();

    // sight-size: the reference panel, always fully visible, same scale
    if (this.sightSize && this.refBox) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 1;
      ctx.strokeRect(this.refBox.x, this.refBox.y, this.refBox.s, this.refBox.s);
      ctx.restore();
      if (this.ghost) this._drawGhost(ctx, 1, this.refBox);
      // eye-flick: the reference flashed over the DRAWING panel for a beat
      if (this._flickUntil > performance.now() && this.ghost) this._drawGhost(ctx, 0.45, this.box);
    }

    // sighting training wheels
    if (this.guides) this._drawGuides(ctx);

    // reference ghost (study or self-check) — sight-size draws it in its own panel above
    if (this.ghost && !this.sightSize) this._drawGhost(ctx, this.ghostStudy ? 1 : this.ghost.opacity);

    // terminator drill: the form itself is always visible (shaded during study)
    if (this.target && this.target.kind === 'shade') {
      this._drawShadeForm(ctx, this.showTarget);
    } else if (this.showTarget && this.target) {
      // generated target during STUDY (worksheet-grey)
      this._drawTargetGeom(ctx, 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.10)', 2.5);
    }

    // the user's marks
    this._drawStrokes(ctx);
    if (this._cur) this._drawnIdx = this._cur.pts.length - 1;   // incremental renderer resumes from here

    // REVEAL: target in accent over the marks for visual comparison
    if (this.revealTarget && this.target) {
      this._drawTargetGeom(ctx, '#c0392b', null, 2);
    }
    // eraser cursor
    if (this.erasing && this._erasePt) {
      const c = this.toPx(this._erasePt);
      ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(c[0], c[1], this.eraseR / (this.view.z || 1), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    // comparative-measurement calipers (above marks, below crop UI)
    if (this.measures.length || this._curMeasure) this._drawMeasures(ctx);
    // the taut-string check line (spans both panels)
    if (this.stringLine) this._drawString(ctx);
    // crop selection rectangle
    if (this.cropRect) {
      const a = this.toPx(this.cropRect[0]), b = this.toPx(this.cropRect[1]);
      ctx.save(); ctx.strokeStyle = '#b4532a'; ctx.setLineDash([6, 4]); ctx.lineWidth = 2;
      ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      ctx.restore();
    }
    ctx.restore();
  };

  A.Surface = Surface;
})(window.A = window.A || {});
