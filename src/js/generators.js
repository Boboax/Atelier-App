/* ============================================================================
   generators.js  —  procedural targets for the auto-scored drills
   ----------------------------------------------------------------------------
   All geometry is produced in a normalised [0,1] x [0,1] "design space"; the
   canvas maps that into a centred square study box. Difficulty scales with the
   exercise level (awkward angles, more vertices, more lobes/concavity).
   Each target is stored verbatim with the attempt so history can replay it.
   Exposed as window.A.gen
   ========================================================================== */
(function (A) {
  'use strict';
  const gen = {};
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Refit a set of points into [pad, 1-pad] preserving aspect ratio.
  function fitToBox(pts, pad) {
    pad = pad == null ? 0.12 : pad;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }
    const w = maxX - minX || 1, h = maxY - minY || 1;
    const s = (1 - 2 * pad) / Math.max(w, h);
    const ox = pad + ((1 - 2 * pad) - w * s) / 2;
    const oy = pad + ((1 - 2 * pad) - h * s) / 2;
    return pts.map((p) => [ox + (p[0] - minX) * s, oy + (p[1] - minY) * s]);
  }

  // Catmull-Rom smoothing of a closed loop → dense polyline (organic look).
  function smoothClosed(pts, perSeg) {
    perSeg = perSeg || 10;
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      for (let t = 0; t < perSeg; t++) {
        const s = t / perSeg, s2 = s * s, s3 = s2 * s;
        out.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * s + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * s2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * s3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * s + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3)
        ]);
      }
    }
    return out;
  }

  // Catmull-Rom smoothing of an OPEN polyline (endpoints clamped) → dense curve.
  function smoothOpen(pts, perSeg) {
    perSeg = perSeg || 12;
    const n = pts.length, out = [];
    const P = (i) => pts[Math.max(0, Math.min(n - 1, i))];
    for (let i = 0; i < n - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let t = 0; t < perSeg; t++) {
        const s = t / perSeg, s2 = s * s, s3 = s2 * s;
        out.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * s + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * s2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * s3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * s + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3)
        ]);
      }
    }
    out.push(pts[n - 1]);
    return out;
  }

  /* ---- single open curve: a simple arc → S-curve → multi-bend -------------*/
  gen.curve = function (level) {
    const start = [rnd(0.15, 0.4), rnd(0.25, 0.75)];
    const end = [rnd(0.6, 0.85), rnd(0.25, 0.75)];
    const bumps = level <= 2 ? 1 : level <= 5 ? 2 : 3;   // arc → S → multi-bend
    const dx = end[0] - start[0], dy = end[1] - start[1], len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;                 // unit perpendicular
    const ctrl = [start];
    let sign = Math.random() < 0.5 ? 1 : -1;
    for (let i = 1; i <= bumps; i++) {
      const t = i / (bumps + 1);
      const amp = rnd(0.12, 0.26) * sign; sign = -sign;  // alternate so S-curves bend both ways
      ctrl.push([start[0] + dx * t + nx * amp, start[1] + dy * t + ny * amp]);
    }
    ctrl.push(end);
    return { kind: 'curve', polyline: fitToBox(smoothOpen(ctrl, 14), 0.13) };
  };

  /* ---- single line: length + angle ---------------------------------------*/
  gen.line = function (level) {
    let ang;
    if (level <= 2) ang = rnd(0, 180);
    else {                                  // avoid easy near-cardinal/45° lines
      do { ang = rnd(0, 180); } while ([0, 45, 90, 135, 180].some((c) => Math.abs(ang - c) < 8));
    }
    const len = rnd(0.35, 0.8) * (level <= 2 ? 0.9 : 1);
    const a = ang * Math.PI / 180;
    const cx = rnd(0.42, 0.58), cy = rnd(0.42, 0.58);
    const dx = Math.cos(a) * len / 2, dy = Math.sin(a) * len / 2;
    return { kind: 'line', lines: [[[cx - dx, cy - dy], [cx + dx, cy + dy]]] };
  };

  /* ---- angle relationships: 2–3 lines from a shared vertex ---------------*/
  gen.angles = function (level) {
    const n = level <= 2 ? 2 : 3;
    const ox = rnd(0.35, 0.65), oy = rnd(0.55, 0.75);
    const lines = [];
    let base = rnd(-160, -110);
    for (let i = 0; i < n; i++) {
      const a = (base + i * rnd(35, 70)) * Math.PI / 180;
      const len = rnd(0.3, 0.6);
      lines.push([[ox, oy], [ox + Math.cos(a) * len, oy + Math.sin(a) * len]]);
    }
    // re-centre the bundle
    const all = lines.flat();
    const fitted = fitToBox(all, 0.14);
    const out = [];
    for (let i = 0; i < lines.length; i++) out.push([fitted[i * 2], fitted[i * 2 + 1]]);
    return { kind: 'angles', lines: out };
  };

  /* ---- polygons: triangles → asymmetric n-gons ---------------------------*/
  gen.polygon = function (level) {
    // Level 1 = triangles only (simplest start). From level 2 a mix appears and the
    // ceiling rises gradually: L2 tri/quad, L3 quad/pentagon … up to heptagons.
    const lo = Math.max(3, Math.min(7, 3 + Math.floor((level - 1) / 2)));
    const hi = level <= 1 ? lo : Math.min(7, lo + 1);
    const nverts = lo + Math.floor(Math.random() * (hi - lo + 1));
    const cx = 0.5, cy = 0.5;
    const concave = level >= 4;
    const start = rnd(0, Math.PI * 2);
    const pts = [];
    for (let i = 0; i < nverts; i++) {
      const a = start + (i / nverts) * Math.PI * 2 + rnd(-0.25, 0.25);
      let r = rnd(0.28, 0.5);
      if (concave && Math.random() < 0.4) r *= rnd(0.45, 0.7);   // pull a vertex in
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * rnd(0.8, 1.2)]);
    }
    let poly = pts;
    if (level <= 2) poly = A.geom.convexHull(pts);
    if (poly.length < 3) poly = pts;          // collinear hull — fall back to the raw ring
    return { kind: 'polygon', polygon: fitToBox(poly, 0.13) };
  };

  /* ---- organic envelopes: real-feeling contours, not uniform blobs --------
     A few low-frequency harmonics shape the radius-by-angle, so each form has
     CHARACTER — asymmetry, a flat here, a bulge there — like a pebble, leaf or
     cast silhouette rather than a lumpy circle. The point is to PERCEIVE the
     contour (where it turns sharply vs flows), the same skill as Module 4's
     Contour drill. Progression: L1 a clean simple ovoid → more & stronger
     harmonics with level, with concave notches appearing from L4. */
  /* ---- curated recognisable outlines (hand, eye, …) ----------------------
     Hand-authored normalised contours of real subjects, so the envelope drill
     isn't only abstract forms. Authored to read well UNSMOOTHED (sharp corners
     at finger tips / eye canthi survive). Each is placed with a small rotation,
     aspect jitter and optional flip so repeats vary but stay recognisable. */
  const SIL = {
    leaf:   { minL: 1, pts: [[0.50,0.04],[0.57,0.16],[0.64,0.34],[0.66,0.52],[0.60,0.70],[0.52,0.86],[0.50,0.93],[0.48,0.86],[0.40,0.70],[0.34,0.52],[0.36,0.34],[0.43,0.16]] },
    eye:    { minL: 1, pts: [[0.05,0.53],[0.17,0.44],[0.32,0.38],[0.48,0.35],[0.64,0.37],[0.80,0.43],[0.94,0.51],[0.80,0.55],[0.64,0.585],[0.48,0.59],[0.32,0.575],[0.17,0.55]] },
    apple:  { minL: 1, pts: [[0.40,0.18],[0.50,0.24],[0.60,0.18],[0.72,0.24],[0.80,0.42],[0.76,0.62],[0.62,0.80],[0.50,0.83],[0.38,0.80],[0.24,0.62],[0.20,0.42],[0.28,0.24]] },
    pear:   { minL: 1, pts: [[0.50,0.10],[0.55,0.18],[0.56,0.30],[0.52,0.40],[0.64,0.54],[0.70,0.70],[0.62,0.84],[0.50,0.88],[0.38,0.84],[0.30,0.70],[0.36,0.54],[0.48,0.40],[0.44,0.30],[0.45,0.18]] },
    lips:   { minL: 2, pts: [[0.04,0.50],[0.16,0.45],[0.28,0.40],[0.40,0.44],[0.50,0.45],[0.60,0.44],[0.72,0.40],[0.84,0.45],[0.96,0.50],[0.82,0.59],[0.64,0.69],[0.50,0.71],[0.36,0.69],[0.18,0.59]] },
    vase:   { minL: 2, pts: [[0.42,0.10],[0.58,0.10],[0.60,0.16],[0.55,0.24],[0.70,0.38],[0.74,0.58],[0.66,0.78],[0.58,0.88],[0.60,0.92],[0.40,0.92],[0.42,0.88],[0.34,0.78],[0.26,0.58],[0.30,0.38],[0.45,0.24],[0.40,0.16]] },
    fish:   { minL: 2, pts: [[0.08,0.50],[0.24,0.40],[0.44,0.36],[0.62,0.40],[0.74,0.47],[0.88,0.34],[0.83,0.50],[0.88,0.66],[0.74,0.53],[0.62,0.60],[0.44,0.64],[0.24,0.60]] },
    mushroom:{minL: 2, pts: [[0.14,0.46],[0.18,0.36],[0.28,0.28],[0.40,0.245],[0.50,0.24],[0.60,0.245],[0.72,0.28],[0.82,0.36],[0.86,0.46],[0.68,0.49],[0.60,0.51],[0.59,0.80],[0.62,0.88],[0.38,0.88],[0.41,0.80],[0.40,0.51],[0.32,0.49]] },
    butterfly:{minL:3, pts: [[0.50,0.18],[0.60,0.10],[0.78,0.08],[0.90,0.22],[0.84,0.38],[0.64,0.44],[0.52,0.46],[0.62,0.56],[0.74,0.72],[0.66,0.88],[0.52,0.78],[0.50,0.62],[0.48,0.78],[0.34,0.88],[0.26,0.72],[0.38,0.56],[0.48,0.46],[0.36,0.44],[0.16,0.38],[0.10,0.22],[0.22,0.08],[0.40,0.10]] },
    hand:   { minL: 4, pts: [
      [0.34,0.97],[0.30,0.74],
      [0.22,0.66],[0.10,0.65],[0.08,0.57],[0.18,0.53],[0.28,0.55],[0.30,0.49],
      [0.32,0.40],[0.34,0.16],[0.40,0.16],[0.43,0.42],
      [0.45,0.39],[0.47,0.08],[0.53,0.08],[0.55,0.40],
      [0.57,0.42],[0.59,0.14],[0.65,0.14],[0.67,0.45],
      [0.69,0.47],[0.73,0.29],[0.78,0.31],[0.75,0.51],
      [0.72,0.74],[0.66,0.97]] }
  };
  // Chaikin corner-cutting: rounds the blocky authored outline into smooth curves
  // (fingertips, valleys, bellies) without overshooting or self-intersecting.
  function chaikin(pts, iters) {
    let p = pts;
    for (let it = 0; it < iters; it++) {
      const out = [], n = p.length;
      for (let i = 0; i < n; i++) {
        const a = p[i], b = p[(i + 1) % n];
        out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      p = out;
    }
    return p;
  }
  function placeSilhouette(pts) {
    let p = pts.map((q) => [q[0], q[1]]);
    if (Math.random() < 0.5) p = p.map((q) => [1 - q[0], q[1]]);   // mirror
    let cx = 0, cy = 0; p.forEach((q) => { cx += q[0]; cy += q[1]; }); cx /= p.length; cy /= p.length;
    const rot = rnd(-0.18, 0.18), asx = rnd(0.9, 1.12), asy = rnd(0.9, 1.12);
    const co = Math.cos(rot), si = Math.sin(rot);
    p = p.map((q) => { const dx = (q[0] - cx) * asx, dy = (q[1] - cy) * asy; return [0.5 + dx * co - dy * si, 0.5 + dx * si + dy * co]; });
    p = chaikin(p, 2);                              // round the facets
    return fitToBox(p, 0.12);
  }
  gen.envelope = function (level) {
    // ~half the time, draw a recognisable real-subject outline (eligible by level);
    // otherwise an abstract organic form. Mix keeps infinite variety + real subjects.
    const names = Object.keys(SIL).filter((n) => SIL[n].minL <= level);
    if (names.length && Math.random() < 0.5) {
      return { kind: 'envelope', polygon: placeSilhouette(SIL[names[Math.floor(Math.random() * names.length)]].pts) };
    }
    const cx = 0.5, cy = 0.5, baseR = 0.34;
    const aspect = rnd(0.62, 1.55);               // elongation — forms aren't circles
    const rot = rnd(0, Math.PI * 2);
    // A k=1 "taper" term is the key: r = 1 + e·cos θ makes a wide end and a narrow end —
    // i.e. an EGG / PEAR / TEARDROP (a recognisable organic form), not a symmetric blob.
    // Higher harmonics (k≥2) then add a waist (gourd), bumps and, with level, concave dips.
    const e1 = rnd(0.2, 0.6);                      // taper strength (egg→teardrop)
    const harm = [{ k: 1, amp: e1, ph: 0 }];
    const nExtra = Math.min(4, Math.floor(level / 2));   // L1:0 clean egg → +1 every 2 levels
    for (let j = 0; j < nExtra; j++) {
      const k = 2 + j;
      harm.push({ k: k, amp: rnd(0.06, 0.15) / (k - 1) * (0.85 + level * 0.06), ph: rnd(0, Math.PI * 2) });
    }
    const N = 72, pts = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      let rr = 1;
      for (let h = 0; h < harm.length; h++) rr += harm[h].amp * Math.cos(harm[h].k * a - harm[h].ph);
      rr = Math.max(0.3, rr);                      // keep r>0 (star-shaped → never self-intersects)
      const r = baseR * rr;
      pts.push([cx + Math.cos(a + rot) * r, cy + Math.sin(a + rot) * r * aspect]);
    }
    return { kind: 'envelope', polygon: fitToBox(pts, 0.12) };
  };

  /* ---- gesture: the line of action through a figure ----------------------
     A pose reads as one rhythmic line before any anatomy. Each authored pose
     is a line-of-action control path plus a head + a couple of mass ovals
     (ribcage/pelvis) shown ONLY during study, so it reads as a figure; the
     learner memorises and redraws the LINE, scored by curve match. Placement
     flips/scales/jitters so repeats vary. Complexity (dynamism) gates by level. */
  const POSES = [
    { minL: 1, loa: [[0.50, 0.13], [0.50, 0.33], [0.52, 0.53], [0.48, 0.72], [0.50, 0.90]], head: [0.50, 0.10, 0.055], masses: [[0.51, 0.36, 0.075, 0.11], [0.49, 0.60, 0.065, 0.10]] },   // standing
    { minL: 1, loa: [[0.46, 0.13], [0.50, 0.33], [0.57, 0.53], [0.50, 0.72], [0.46, 0.90]], head: [0.45, 0.10, 0.055], masses: [[0.49, 0.36, 0.075, 0.11], [0.55, 0.58, 0.065, 0.10]] },   // contrapposto
    { minL: 2, loa: [[0.55, 0.09], [0.50, 0.29], [0.48, 0.50], [0.50, 0.71], [0.52, 0.92]], head: [0.56, 0.07, 0.05], masses: [[0.50, 0.33, 0.07, 0.11], [0.49, 0.60, 0.065, 0.10]] },    // reaching up
    { minL: 2, loa: [[0.40, 0.13], [0.48, 0.31], [0.58, 0.49], [0.54, 0.70], [0.46, 0.90]], head: [0.38, 0.10, 0.055], masses: [[0.47, 0.35, 0.075, 0.10], [0.55, 0.58, 0.065, 0.10]] },   // leaning twist
    { minL: 3, loa: [[0.62, 0.13], [0.52, 0.31], [0.44, 0.49], [0.50, 0.67], [0.42, 0.87]], head: [0.64, 0.10, 0.05], masses: [[0.51, 0.35, 0.075, 0.10], [0.47, 0.58, 0.065, 0.10]] },    // running
    { minL: 3, loa: [[0.40, 0.15], [0.52, 0.30], [0.61, 0.50], [0.52, 0.70], [0.40, 0.88]], head: [0.38, 0.12, 0.055], masses: [[0.50, 0.34, 0.08, 0.10], [0.54, 0.60, 0.065, 0.10]] },   // dancing arc
    { minL: 4, loa: [[0.44, 0.24], [0.54, 0.35], [0.60, 0.50], [0.50, 0.62], [0.40, 0.70]], head: [0.42, 0.21, 0.055], masses: [[0.53, 0.40, 0.08, 0.09], [0.50, 0.58, 0.07, 0.08]] },     // crouching
    { minL: 4, loa: [[0.10, 0.52], [0.32, 0.47], [0.52, 0.53], [0.72, 0.48], [0.90, 0.55]], head: [0.07, 0.52, 0.05], masses: [[0.34, 0.50, 0.10, 0.08], [0.62, 0.51, 0.09, 0.07]] },      // reclining
    { minL: 5, loa: [[0.42, 0.14], [0.50, 0.28], [0.62, 0.44], [0.54, 0.63], [0.42, 0.86]], head: [0.40, 0.11, 0.05], masses: [[0.50, 0.32, 0.075, 0.10], [0.57, 0.55, 0.065, 0.10]] },    // twist reach across
    { minL: 6, loa: [[0.40, 0.22], [0.50, 0.27], [0.63, 0.42], [0.57, 0.62], [0.44, 0.84]], head: [0.38, 0.19, 0.05], masses: [[0.51, 0.33, 0.08, 0.09], [0.58, 0.55, 0.065, 0.10]] }      // backbend
  ];
  function placeGesture(pose) {
    const flip = Math.random() < 0.5;
    const s = rnd(0.92, 1.04);
    const dx = rnd(-0.02, 0.02), dy = rnd(-0.02, 0.02);
    const tx = (p) => {
      let x = flip ? 1 - p[0] : p[0], y = p[1];
      x = 0.5 + (x - 0.5) * s + dx; y = 0.5 + (y - 0.5) * s + dy;
      return [x, y];
    };
    const loaCtrl = pose.loa.map(tx);
    const h = tx([pose.head[0], pose.head[1]]);
    return {
      kind: 'gesture',
      loa: smoothOpen(loaCtrl, 12),
      head: [h[0], h[1], pose.head[2] * s],
      masses: (pose.masses || []).map((m) => { const c = tx([m[0], m[1]]); return [c[0], c[1], m[2] * s, m[3] * s]; })
    };
  }
  gen.gesture = function (level) {
    const pool = POSES.filter((p) => p.minL <= level);
    return placeGesture(pool[Math.floor(Math.random() * pool.length)]);
  };

  /* ---- terminator (light & shadow): the classical value drill --------------
     A simple lit form (sphere → egg → cylinder) with a light direction; the
     ground truth is the TERMINATOR — the boundary where light turns to shadow.
     During study the form renders shaded with a visible core-shadow edge; the
     learner then draws that boundary from memory ON the bare contour. Scored
     position-fixed (scoreCurveFixed): the right bow in the wrong place is a
     miss. Levels: sphere with near-flat light → egg → stronger bow (light
     tilted toward the viewer) → rotated egg → cylinder.                     */
  gen.shade = function (level) {
    const type = level <= 2 ? 'sphere' : level <= 4 ? 'egg' : (level >= 7 && Math.random() < 0.5) ? 'cyl' : 'egg';
    const cx = rnd(0.44, 0.56), cy = rnd(0.44, 0.56);
    let rx, ry, rot = 0;
    if (type === 'sphere') { rx = ry = rnd(0.24, 0.3); }
    else if (type === 'egg') { rx = rnd(0.2, 0.26); ry = rx * rnd(1.2, 1.45); rot = level >= 5 ? rnd(-0.5, 0.5) : 0; }
    else { rx = rnd(0.11, 0.15); ry = rx * rnd(2.2, 2.8); rot = rnd(-0.35, 0.35); }
    // light angle (unit-circle space) — avoid near-vertical-from-top ambiguity a little
    const phi = rnd(0, Math.PI * 2);
    // bow of the terminator: light tilted toward the viewer → stronger curve
    const k = level <= 2 ? rnd(0.12, 0.2) : level <= 5 ? rnd(0.15, 0.3) : rnd(0.2, 0.42);
    const co = Math.cos(rot), si = Math.sin(rot);
    const toDesign = (ux, uy) => {   // unit circle → ellipse → rotate → place
      const ex = ux * rx, ey = uy * ry;
      return [cx + ex * co - ey * si, cy + ex * si + ey * co];
    };
    const u = [Math.cos(phi), Math.sin(phi)];            // toward the light
    const v = [-u[1], u[0]];                              // ⊥ light
    const term = [];
    for (let i = 0; i <= 32; i++) {
      const t = -Math.PI / 2 + (i / 32) * Math.PI;        // pole to pole
      const px = Math.sin(t) * v[0] + Math.cos(t) * k * u[0];
      const py = Math.sin(t) * v[1] + Math.cos(t) * k * u[1];
      term.push(toDesign(px, py));
    }
    const contour = [];
    for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; contour.push(toDesign(Math.cos(a), Math.sin(a))); }
    // shadow region polygon: terminator (−v pole → +v pole) + the silhouette arc
    // back around the dark side (through −u) — used for the study-phase fill
    const shadow = term.slice();
    const av = Math.atan2(v[1], v[0]);
    for (let i = 1; i < 32; i++) { const a = av + (i / 32) * Math.PI; shadow.push(toDesign(Math.cos(a), Math.sin(a))); }
    return { kind: 'shade', polyline: term, contour, shadow,
             form: { type, cx, cy, rx, ry, rot }, light: { x: u[0], y: u[1], k } };
  };

  // Dispatch by exercise key.
  gen.make = function (exKey, level) {
    switch (exKey) {
      case 'line': return gen.line(level);
      case 'curve': return gen.curve(level);
      case 'angles': return gen.angles(level);
      case 'polygon': return gen.polygon(level);
      case 'envelope': return gen.envelope(level);
      case 'gesture': return gen.gesture(level);
      case 'shade': return gen.shade(level);
      default: return gen.line(level);
    }
  };

  A.gen = gen;
})(window.A = window.A || {});
