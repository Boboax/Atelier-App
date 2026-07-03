/* ============================================================================
   canvas.js  —  the drawing surface
   ----------------------------------------------------------------------------
   One <canvas>, redrawn from state. Handles:
     - Apple Pencil via Pointer Events: pressure → stroke width, tilt ignored.
     - Palm rejection: once a pen is seen, touch input stops drawing (it can
       still be used for UI). A "pencilOnly" setting hard-enforces this.
     - A centred square "study box" mapping design space [0,1]² → CSS pixels.
     - Render phases: STUDY (show target), DRAW (blank), REVEAL (target ghosted
       over the user's marks), plus arbitrary reference-image ghosting.
   Exposed as window.A.Surface (constructor).
   ========================================================================== */
(function (A) {
  'use strict';

  function Surface(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = Object.assign({ pencilOnly: false, baseWidth: 3.2, ink: '#1a1a1a' }, opts || {});
    this.strokes = [];          // [{pts:[[x,y,p],...]}]
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
    this._erasePt = null;
    this.measureMode = false;   // comparative measurement (Bargue): drag to lay a caliper
    this.measures = [];         // [{a:[x,y], b:[x,y]}] in design coords; measures[0] = the unit
    this._curMeasure = null;
    this._penSeen = 0;
    this._drawing = false;
    this._cur = null;
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
    c.addEventListener('pointercancel', (e) => this._up(e));
    c.addEventListener('pointerleave', (e) => this._up(e));
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
    const rail = window.matchMedia && window.matchMedia('(orientation:landscape) and (min-width:1000px)').matches;
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
      if (performance.now() - this._penSeen < 1500) return false; // palm rejection
      return true;
    }
    return true; // mouse (desktop testing)
  };

  Surface.prototype._pt = function (e) {
    const r = this._rect || this.canvas.getBoundingClientRect();
    let pr = e.pressure;
    if (e.pointerType !== 'pen' || pr === 0 || pr == null) pr = 0.5; // fallback
    return [e.clientX - r.left, e.clientY - r.top, pr];
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

  // remove stroke points within the eraser radius, splitting strokes as needed
  Surface.prototype._eraseAt = function (p) {
    const R2 = this.eraseR * this.eraseR, out = [];
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
    if (!this._drawing && !this._cropping) this._measure();   // refresh rect (layout may have settled)
    if (this.measureMode) {
      e.preventDefault();
      this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);
      this._measuring = true; const p = this._design(e); this._curMeasure = { a: p, b: p }; this.redraw();
      return;
    }
    if (this.cropMode) {
      e.preventDefault();
      this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);
      this._cropping = true; const p = this._design(e); this.cropRect = [p, p]; this.redraw();
      return;
    }
    if (this.erasing) {
      e.preventDefault();
      this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);
      this._erasingActive = true; const p = this._pt(e); this._erasePt = p; this._eraseAt(p); this.redraw();
      return;
    }
    if (!this.locked && this._accepts(e)) {
      e.preventDefault();
      this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);
      this._drawing = true;
      this._cur = { pts: [this._pt(e)] };
      this.strokes.push(this._cur);
      this._dirty = true;
      this.redraw();
    }
  };
  Surface.prototype._move = function (e) {
    if (this._measuring) { e.preventDefault(); this._curMeasure.b = this._design(e); this.redraw(); return; }
    if (this._cropping) { e.preventDefault(); this.cropRect[1] = this._design(e); this.redraw(); return; }
    if (this._erasingActive) {
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      const pts = (evs && evs.length) ? evs.map((ev) => this._pt(ev)) : [this._pt(e)];
      for (const p of pts) { this._erasePt = p; this._eraseAt(p); }
      this.redraw(); return;
    }
    if (!this._drawing || !this._cur) return;
    e.preventDefault();
    // coalesced events give smoother high-rate Pencil strokes; fall back to the
    // event itself when the coalesced list is empty (some browsers / synthetic events)
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (evs && evs.length) { for (const ev of evs) this._cur.pts.push(this._pt(ev)); }
    else this._cur.pts.push(this._pt(e));
    this.redraw();
  };
  Surface.prototype._up = function (e) {
    // release pointer capture so the NEXT tap reaches the buttons (not the canvas) —
    // otherwise the first tap after a stroke is swallowed and you must tap twice.
    try { if (e && e.pointerId != null && this.canvas.releasePointerCapture) this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
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
    if (this._cur && this._cur.pts.length === 1) {
      // a dot: duplicate so it renders
      this._cur.pts.push(this._cur.pts[0].slice());
    }
    this._cur = null;
    if (this.onStrokeEnd) this.onStrokeEnd();
  };

  /* ---- programmatic state ------------------------------------------------*/
  Surface.prototype.clearMarks = function () { this.strokes = []; this.redraw(); };
  Surface.prototype.undo = function () { this.strokes.pop(); this.redraw(); };
  Surface.prototype.reset = function () {
    this.strokes = []; this.target = null; this.showTarget = false;
    this.revealTarget = false; this.ghost = null; this.ghostStudy = false;
    this.ghostFlip = false;
    this.cropMode = false; this.cropRect = null;
    this.erasing = false; this._erasingActive = false; this._erasePt = null;
    this.measureMode = false; this.measures = []; this._curMeasure = null; this._measuring = false;
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
    return this.strokes.map((s) => s.pts.map((p) => this.toDesign(p)));
  };
  // all points concatenated (for closed-shape scoring), in design coords
  Surface.prototype.pointsDesign = function () {
    const out = [];
    for (const s of this.strokes) for (const p of s.pts) out.push(this.toDesign(p));
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
    ctx.strokeStyle = this.opts.ink; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const s of this.strokes) {
      const pts = s.pts; if (pts.length < 2) continue;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        ctx.beginPath();
        ctx.lineWidth = this.opts.baseWidth * (0.45 + (b[2] || 0.5) * 1.5);
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
    const r = this._rect || this.canvas.getBoundingClientRect();
    ctx.save();
    // transform from the live displayed size (not an assumed dpr) so 1 unit = 1 CSS px
    ctx.setTransform(this.canvas.width / (r.width || 1), 0, 0, this.canvas.height / (r.height || 1), 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
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

    // REVEAL: target in accent over the marks for visual comparison
    if (this.revealTarget && this.target) {
      this._drawTargetGeom(ctx, '#c0392b', null, 2);
    }
    // eraser cursor
    if (this.erasing && this._erasePt) {
      ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(this._erasePt[0], this._erasePt[1], this.eraseR, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
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
