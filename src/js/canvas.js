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
    this.opts = Object.assign({ pencilOnly: false, baseWidth: 3.2, ink: '#1a1a1a' }, opts || {});
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
    const s = Math.min(r.width * (rail ? 0.97 : 0.94), availH * (rail ? 0.97 : 0.98));
    this.box = { x: (r.width - s) / 2, y: top + (availH - s) / 2, s: s };
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

  // event → [designX, designY, smoothedPressure]
  Surface.prototype._pt = function (e, first) {
    const r = this._rect || this.canvas.getBoundingClientRect();
    let pr = e.pressure;
    if (e.pointerType !== 'pen' || pr === 0 || pr == null) pr = 0.5; // fallback
    // EMA: Pencil pressure is noisy at coalesced rates — smooth it so the
    // stroke width tapers instead of banding
    this._emaP = first ? pr : (0.35 * pr + 0.65 * this._emaP);
    const d = this.toDesign([e.clientX - r.left, e.clientY - r.top]);
    return [d[0], d[1], this._emaP];
  };

  Surface.prototype._design = function (e) {
    const r = this._rect || this.canvas.getBoundingClientRect();
    return this.toDesign([e.clientX - r.left, e.clientY - r.top]);
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
    const R = this.eraseR / (this.box.s || 1), R2 = R * R, out = [];
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
    if (this._activeId != null) return;       // one pointer owns the surface at a time
    if (!this._drawing && !this._cropping) this._measure();   // refresh rect (layout may have settled)
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
    if (this._activeId != null && e.pointerId !== this._activeId) return;
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
    if (this._activeId != null && e && e.pointerId != null && e.pointerId !== this._activeId) return;
    // release pointer capture so the NEXT tap reaches the buttons (not the canvas) —
    // otherwise the first tap after a stroke is swallowed and you must tap twice.
    try { if (e && e.pointerId != null && this.canvas.releasePointerCapture) this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    this._activeId = null;
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

  Surface.prototype._setStrokeTransform = function (ctx) {
    const r = this._rect || this.canvas.getBoundingClientRect();
    ctx.setTransform(this.canvas.width / (r.width || 1), 0, 0, this.canvas.height / (r.height || 1), 0, 0);
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
    this._undoStack = [];
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

  Surface.prototype._drawGhost = function (ctx, opacity) {
    const g = this.ghost; if (!g || !g.img) return;
    const im = g.img;
    const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    if (!iw || !ih) return;
    const s = Math.min(this.box.s / iw, this.box.s / ih);
    const w = iw * s, h = ih * s;
    const x = this.box.x + (this.box.s - w) / 2, y = this.box.y + (this.box.s - h) / 2;
    ctx.save(); ctx.globalAlpha = opacity;
    if (this.ghostFlip) {     // 180° rotation defeats symbol-recognition (Edwards)
      const cx = this.box.x + this.box.s / 2, cy = this.box.y + this.box.s / 2;
      ctx.translate(cx, cy); ctx.rotate(Math.PI); ctx.translate(-cx, -cy);
    }
    ctx.drawImage(im, x, y, w, h); ctx.restore();
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
    // transform from the live displayed size (not an assumed dpr) so 1 unit = 1 CSS px
    this._setStrokeTransform(ctx);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    // study-box frame (subtle)
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1;
    ctx.strokeRect(this.box.x, this.box.y, this.box.s, this.box.s);
    ctx.restore();

    // sighting training wheels
    if (this.guides) this._drawGuides(ctx);

    // reference ghost (study or self-check)
    if (this.ghost) this._drawGhost(ctx, this.ghostStudy ? 1 : this.ghost.opacity);

    // generated target during STUDY (worksheet-grey)
    if (this.showTarget && this.target) {
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
      ctx.beginPath(); ctx.arc(c[0], c[1], this.eraseR, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    // comparative-measurement calipers (above marks, below crop UI)
    if (this.measures.length || this._curMeasure) this._drawMeasures(ctx);
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
