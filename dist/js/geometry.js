/* ============================================================================
   geometry.js  —  the scoring engine
   ----------------------------------------------------------------------------
   Because every *generated* drill knows its own ground-truth target, we can
   score a memory drawing objectively:
     - lines:  signed angle error (deg) + signed length error (%)
     - shapes: size/position-invariant overlap (IoU) + aspect (proportion) error
   Signed errors feed the calibration charts (systematic bias).
   No DOM dependencies except an offscreen <canvas> for rasterising shapes.
   Exposed as window.A.geom
   ========================================================================== */
(function (A) {
  'use strict';
  const geom = {};

  const TAU = Math.PI * 2;
  const toDeg = (r) => r * 180 / Math.PI;

  geom.dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // Total arc length of a polyline.
  geom.pathLength = function (pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += geom.dist(pts[i - 1], pts[i]);
    return L;
  };

  // Resample a polyline to exactly n points, evenly spaced by arc length.
  geom.resample = function (pts, n) {
    if (pts.length < 2) return pts.slice();
    const total = geom.pathLength(pts);
    if (total === 0) return Array.from({ length: n }, () => pts[0].slice());
    const step = total / (n - 1);
    const out = [pts[0].slice()];
    let prev = pts[0], acc = 0, i = 1;
    let target = step;
    while (out.length < n - 1 && i < pts.length) {
      const seg = geom.dist(prev, pts[i]);
      if (acc + seg >= target) {
        const t = (target - acc) / seg;
        const np = [prev[0] + (pts[i][0] - prev[0]) * t,
                    prev[1] + (pts[i][1] - prev[1]) * t];
        out.push(np);
        prev = np; acc = 0; target = step;
      } else {
        acc += seg; prev = pts[i]; i++;
      }
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  };

  // Smallest signed difference a-b mapped to (-180,180].
  function angDiff(a, b) {
    let d = a - b;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    return d;
  }
  geom.angDiff = angDiff;

  // Diagonal of a point set's bounding box — used to reject degenerate input
  // (an accidental tap or a hairline scribble must score 0, not ride the
  // normalisation fallback up to a half-decent score).
  const MIN_EXTENT = 0.02;                 // in design units ([0,1] box)
  function extentOf(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    return Math.hypot(maxX - minX, maxY - minY);
  }
  geom.extentOf = extentOf;

  // Ramer–Douglas–Peucker polyline simplification (keeps [x,y,...] tuples).
  // Used to decimate coalesced Pencil strokes before storing/replaying them —
  // visually identical, an order of magnitude fewer points.
  geom.rdp = function (pts, eps) {
    if (!pts || pts.length < 3) return pts ? pts.slice() : [];
    eps = eps == null ? 0.002 : eps;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const seg = stack.pop(), i0 = seg[0], i1 = seg[1];
      const a = pts[i0], b = pts[i1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy;
      let worst = -1, wd = 0;
      for (let i = i0 + 1; i < i1; i++) {
        const p = pts[i];
        let d;
        if (L2 === 0) d = Math.hypot(p[0] - a[0], p[1] - a[1]);
        else {
          const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
          d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
        }
        if (d > wd) { wd = d; worst = i; }
      }
      if (wd > eps && worst > 0) { keep[worst] = 1; stack.push([i0, worst], [worst, i1]); }
    }
    const out = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
  };

  /* ---- LINE scoring -------------------------------------------------------
     target / user are 2-point segments [[x1,y1],[x2,y2]] (user = stroke ends).
     Orientation is undirected (a line and its 180° flip are the same line),
     so we fold the signed angle error into (-90,90].                         */
  geom.scoreLine = function (target, userPts) {
    if (!userPts || userPts.length < 2 || extentOf(userPts) < MIN_EXTENT) {
      return { score: 0, angleErr: 0, lengthErrPct: -100, angleScore: 0, lengthScore: 0,
               metrics: { degenerate: true } };
    }
    const u0 = userPts[0], u1 = userPts[userPts.length - 1];
    const tAng = toDeg(Math.atan2(target[1][1] - target[0][1], target[1][0] - target[0][0]));
    const uAng = toDeg(Math.atan2(u1[1] - u0[1], u1[0] - u0[0]));
    let aErr = angDiff(uAng, tAng);          // signed, (-180,180]
    if (aErr > 90) aErr -= 180;              // fold (undirected line)
    if (aErr <= -90) aErr += 180;
    const tLen = geom.dist(target[0], target[1]);
    const uLen = geom.dist(u0, u1);
    const lenErrPct = tLen ? (uLen - tLen) / tLen * 100 : 0;

    const angleScore = Math.max(0, 100 - Math.abs(aErr) * 3);     // 33° off → 0 (kept for display)
    const lengthScore = Math.max(0, 100 - Math.abs(lenErrPct) * 1.2);
    // Additive penalty, not a weighted blend: a badly wrong ANGLE is a failed
    // line and must score low even if the length happens to match (the old blend
    // let a perpendicular line score 40 on length alone). ~45° off → 0.
    const score = Math.round(Math.max(0, 100 - Math.abs(aErr) * 2.2 - Math.abs(lenErrPct) * 0.5));
    return {
      score,
      angleErr: +aErr.toFixed(2),          // signed deg (+ = clockwise on screen)
      lengthErrPct: +lenErrPct.toFixed(1), // signed % (+ = too long)
      angleScore: Math.round(angleScore),
      lengthScore: Math.round(lengthScore),
      metrics: { angleErrDeg: +aErr.toFixed(2), lengthErrPct: +lenErrPct.toFixed(1) }
    };
  };

  /* ---- ANGLE-RELATIONSHIP scoring ----------------------------------------
     target/user are arrays of 2-point segments radiating from a shared vertex
     (the generator always puts the vertex at index 0 of each target line).
     What the drill trains is the RELATIONSHIP between the lines, so the score
     blends three components:
       - relative angles: the angular GAPS between neighbouring lines (50%)
       - absolute orientation: how the whole bundle sits in space (30%)
       - relative lengths: each line's length as a ratio of the longest (20%)
     User lines are oriented outward from their common vertex (the endpoint
     cluster), then matched one-to-one to target lines by best assignment
     (n ≤ 3, brute-force permutations). Extra strokes beyond n are ignored;
     too FEW lines are penalised.                                            */
  geom.scoreAngles = function (targetLines, userLines) {
    if (!targetLines.length || !userLines.length) return { score: 0, angleErr: 0, lengthErrPct: 0, metrics: {} };
    userLines = userLines.filter((l) => geom.dist(l[0], l[1]) >= MIN_EXTENT);
    if (!userLines.length) return { score: 0, angleErr: 0, lengthErrPct: 0, metrics: { degenerate: true } };

    // orient user segments outward from their shared vertex: pick, per segment,
    // the endpoint closest to the tightest endpoint cluster as its root
    const ends = [];
    userLines.forEach((l) => { ends.push(l[0], l[1]); });
    let vx = 0, vy = 0;
    if (userLines.length === 1) { vx = userLines[0][0][0]; vy = userLines[0][0][1]; }
    else {
      // vertex ≈ point minimizing summed distance to each segment's nearer endpoint;
      // the endpoint-cloud medoid is a robust, cheap stand-in
      let best = Infinity;
      for (const c of ends) {
        let s = 0;
        for (const l of userLines) s += Math.min(geom.dist(c, l[0]), geom.dist(c, l[1]));
        if (s < best) { best = s; vx = c[0]; vy = c[1]; }
      }
    }
    const orient = (l) => (geom.dist(l[0], [vx, vy]) <= geom.dist(l[1], [vx, vy])) ? l : [l[1], l[0]];
    const dirAng = (l) => toDeg(Math.atan2(l[1][1] - l[0][1], l[1][0] - l[0][0]));
    const segLen = (l) => geom.dist(l[0], l[1]);

    const T = targetLines.map((l) => ({ ang: dirAng(l), len: segLen(l) }));
    const U = userLines.map((l) => { const o = orient(l); return { ang: dirAng(o), len: segLen(o) }; });

    // one-to-one assignment (target i → distinct user j) minimizing total |Δangle|
    const n = T.length, m = U.length;
    const idx = Array.from({ length: m }, (_, j) => j);
    let bestPerm = null, bestCost = Infinity;
    const perms = (arr, k) => {
      if (!k) return [[]];
      const out = [];
      arr.forEach((v, i) => {
        perms(arr.slice(0, i).concat(arr.slice(i + 1)), k - 1).forEach((rest) => out.push([v].concat(rest)));
      });
      return out;
    };
    const k = Math.min(n, m);
    for (const p of perms(idx, k)) {
      let c = 0;
      for (let i = 0; i < k; i++) c += Math.abs(angDiff(U[p[i]].ang, T[i].ang));
      if (c < bestCost) { bestCost = c; bestPerm = p; }
    }
    const matched = [];
    for (let i = 0; i < k; i++) matched.push({ t: T[i], u: U[bestPerm[i]] });

    // absolute orientation error per matched line (signed, full circle)
    const absErrs = matched.map((p) => angDiff(p.u.ang, p.t.ang));
    const meanAbs = absErrs.reduce((a, b) => a + b, 0) / absErrs.length;

    // relative angles: gaps between neighbouring matched lines (needs ≥2)
    let relErrs = [];
    if (matched.length >= 2) {
      const byT = matched.slice().sort((a, b) => a.t.ang - b.t.ang);
      for (let i = 1; i < byT.length; i++) {
        const gT = angDiff(byT[i].t.ang, byT[i - 1].t.ang);
        const gU = angDiff(byT[i].u.ang, byT[i - 1].u.ang);
        relErrs.push(angDiff(gU, gT));
      }
    }
    const meanRel = relErrs.length ? relErrs.reduce((a, b) => a + b, 0) / relErrs.length : meanAbs;

    // relative lengths: each line vs the bundle's longest, target vs user
    const maxT = Math.max.apply(null, matched.map((p) => p.t.len)) || 1;
    const maxU = Math.max.apply(null, matched.map((p) => p.u.len)) || 1;
    const lenErrs = matched.map((p) => ((p.u.len / maxU) - (p.t.len / maxT)) / (p.t.len / maxT) * 100);
    const meanLen = lenErrs.reduce((a, b) => a + b, 0) / lenErrs.length;

    const relAbs = relErrs.length ? relErrs.map(Math.abs).reduce((a, b) => a + b, 0) / relErrs.length
                                  : Math.abs(meanAbs);   // single line: no gaps, fall back to orientation
    const relScore = Math.max(0, 100 - relAbs * 3);
    const absScore = Math.max(0, 100 - absErrs.map(Math.abs).reduce((a, b) => a + b, 0) / absErrs.length * 2.2);
    const lenScore = Math.max(0, 100 - lenErrs.map(Math.abs).reduce((a, b) => a + b, 0) / lenErrs.length * 1.2);
    const missing = Math.max(0, n - m);            // penalise only too FEW lines
    const score = Math.max(0, Math.round(relScore * 0.5 + absScore * 0.3 + lenScore * 0.2 - missing * 15));
    return {
      score,
      angleErr: +meanRel.toFixed(2),
      lengthErrPct: +meanLen.toFixed(1),
      metrics: { meanAngleErrDeg: +meanAbs.toFixed(2),      // absolute-orientation bias (signed)
                 relAngleErrDeg: +meanRel.toFixed(2),        // relative-gap bias (signed)
                 meanLengthErrPct: +meanLen.toFixed(1),      // relative-length bias (signed)
                 lineCountDelta: m - n }
    };
  };

  /* ---- SHAPE normalisation ------------------------------------------------
     Translate centroid → origin, scale by bbox diagonal → 1. Removes absolute
     size and position (a memory drawing may be bigger/shifted) but KEEPS
     aspect ratio and orientation, so those errors still cost overlap.        */
  function bbox(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }
  function centroid(pts) {
    let x = 0, y = 0;
    for (const p of pts) { x += p[0]; y += p[1]; }
    return [x / pts.length, y / pts.length];
  }
  geom.normalizeShape = function (pts) {
    const bb = bbox(pts);
    // translate by the bounding-box CENTRE (not the point-average) so scoring is
    // invariant to how densely the outline is sampled — a hand-drawn stroke has
    // far more points than a few-vertex target, which would skew a point centroid.
    const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
    const diag = Math.hypot(bb.w, bb.h) || 1;
    const norm = pts.map((p) => [(p[0] - cx) / diag, (p[1] - cy) / diag]);
    return { pts: norm, bbox: bb, centroid: [cx, cy], diag, aspect: bb.h ? bb.w / bb.h : 1 };
  };

  // Principal-axis best-fit segment through a stroke (PCA), spanning its extent.
  // Far more faithful to the intended line than raw first/last points.
  geom.bestFitSegment = function (pts) {
    const n = pts.length;
    if (n < 2) return [pts[0] ? pts[0].slice() : [0, 0], pts[0] ? pts[0].slice() : [0, 0]];
    let mx = 0, my = 0;
    for (const p of pts) { mx += p[0]; my += p[1]; }
    mx /= n; my /= n;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const dir = [Math.cos(theta), Math.sin(theta)];
    let tmin = Infinity, tmax = -Infinity;
    for (const p of pts) { const t = (p[0] - mx) * dir[0] + (p[1] - my) * dir[1]; if (t < tmin) tmin = t; if (t > tmax) tmax = t; }
    return [[mx + dir[0] * tmin, my + dir[1] * tmin], [mx + dir[0] * tmax, my + dir[1] * tmax]];
  };

  // Rasterise a closed shape (normalised coords ~[-0.5,0.5]) into a binary grid.
  let _rcanvas = null, _rctx = null;
  function rasterMask(normPts, G) {
    if (!_rcanvas) {
      _rcanvas = (typeof OffscreenCanvas !== 'undefined')
        ? new OffscreenCanvas(G, G)
        : Object.assign(document.createElement('canvas'), { width: G, height: G });
      _rctx = _rcanvas.getContext('2d', { willReadFrequently: true });
    }
    if (_rcanvas.width !== G) { _rcanvas.width = G; _rcanvas.height = G; }
    const ctx = _rctx;
    ctx.clearRect(0, 0, G, G);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    const map = (v) => (v + 0.5) * (G - 2) + 1;   // [-0.5,0.5] → [1,G-1]
    ctx.moveTo(map(normPts[0][0]), map(normPts[0][1]));
    for (let i = 1; i < normPts.length; i++) ctx.lineTo(map(normPts[i][0]), map(normPts[i][1]));
    ctx.closePath();
    ctx.fill();
    const data = ctx.getImageData(0, 0, G, G).data;
    const mask = new Uint8Array(G * G);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) mask[j] = data[i + 3] > 40 ? 1 : 0;
    return mask;
  }

  // Intersection-over-union of two closed shapes (size/position invariant).
  geom.shapeIoU = function (ptsA, ptsB, G) {
    G = G || 220;
    const a = rasterMask(geom.normalizeShape(ptsA).pts, G);
    const b = rasterMask(geom.normalizeShape(ptsB).pts, G);
    let inter = 0, uni = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i] | b[i];
      uni += x;
      inter += a[i] & b[i];
    }
    return uni ? inter / uni : 0;
  };

  // resample a CLOSED polygon's perimeter to n evenly-spaced points
  function resampleClosed(pts, n) { return geom.resample(pts.concat([pts[0]]), n); }
  // mean distance from each point in A to its nearest point in B
  function meanNearest(A, B) {
    let s = 0;
    for (const a of A) {
      let m = Infinity;
      for (const b of B) { const dx = a[0] - b[0], dy = a[1] - b[1]; const d = dx * dx + dy * dy; if (d < m) m = d; }
      s += Math.sqrt(m);
    }
    return A.length ? s / A.length : 0;
  }

  /* ---- SHAPE scoring (contour distance — stroke-count agnostic) -----------
     Filled-area IoU punished shapes drawn from several short strokes (the
     concatenated fill self-intersects). Instead we measure how close the
     user's marks lie to the target outline AND how fully they cover it
     (symmetric Chamfer distance), which is independent of stroke count and
     fill — a faceted block-in scores like a single clean outline.
     Both sets are bbox-normalised, so size/position don't matter but aspect
     (proportion) does.                                                       */
  geom.scoreShape = function (targetPts, userPts) {
    if (!userPts || userPts.length < 3 || extentOf(userPts) < MIN_EXTENT) {
      return { score: 0, iou: 0, aspectErrPct: 0, metrics: { degenerate: true } };
    }
    const T = resampleClosed(targetPts, 96);
    let U;
    if (userPts.length < 60) U = resampleClosed(userPts, 96);            // sparse → densify along outline
    else { const step = Math.ceil(userPts.length / 220); U = userPts.filter((_, i) => i % step === 0); }
    const nt = geom.normalizeShape(T), nu = geom.normalizeShape(U);
    const d1 = meanNearest(nu.pts, nt.pts);   // precision: marks near the outline
    const d2 = meanNearest(nt.pts, nu.pts);   // coverage: whole outline covered
    let chamfer = (d1 + d2) / 2;              // normalised units (bbox diagonal = 1)
    if (chamfer < 0.004) chamfer = 0;         // sampling noise — a perfect copy scores 100
    // Stricter multiplier (was 340, far too lenient — a circle scored 84 against a
    // square and a tiny scribble 56). At 700 a clean hand-drawn copy still scores
    // ~90 while a genuinely wrong contour lands where it should.
    const score = Math.round(Math.max(0, Math.min(100, 100 - chamfer * 700)));
    const sim = score / 100;                  // display/coach consistent with the score
    const aspectErrPct = nt.aspect ? (nu.aspect - nt.aspect) / nt.aspect * 100 : 0;
    return {
      score,
      iou: +sim.toFixed(3),
      aspectErrPct: +aspectErrPct.toFixed(1),
      metrics: { iou: +sim.toFixed(3), chamfer: +chamfer.toFixed(4), aspectErrPct: +aspectErrPct.toFixed(1),
                 targetAspect: +nt.aspect.toFixed(2), userAspect: +nu.aspect.toFixed(2) }
    };
  };

  /* ---- CURVE scoring (open contour, stroke-count agnostic) ---------------
     Like shape scoring but for an OPEN polyline — match the path of the curve
     (its bend/apex) rather than an enclosed area. Symmetric Chamfer, bbox-
     normalised, so size/position don't matter.                              */
  // Similarity transform mapping P's endpoints onto Q's (translate+rotate+scale).
  function endpointAlign(P, Q) {
    const p0 = P[0], pn = P[P.length - 1], q0 = Q[0], qn = Q[Q.length - 1];
    const vpx = pn[0] - p0[0], vpy = pn[1] - p0[1];
    const vqx = qn[0] - q0[0], vqy = qn[1] - q0[1];
    const lp = Math.hypot(vpx, vpy) || 1e-6, lq = Math.hypot(vqx, vqy);
    const s = lq / lp, ang = Math.atan2(vqy, vqx) - Math.atan2(vpy, vpx);
    const c = Math.cos(ang) * s, sn = Math.sin(ang) * s;
    return P.map((p) => { const dx = p[0] - p0[0], dy = p[1] - p0[1]; return [q0[0] + c * dx - sn * dy, q0[1] + sn * dx + c * dy]; });
  }
  // Score an OPEN curve / line of action by how faithfully its BOW matches the
  // target between the same endpoints. We align endpoints (so position, size and
  // orientation don't matter — a memory drawing may be bigger or shifted), resolve
  // draw direction by gross flow, then measure ordered point-to-point deviation
  // normalized by the chord. This correctly penalises a too-straight line, a bow
  // in the wrong place, or an opposite bend — which bbox+nearest-point scoring
  // let slide (a straight line used to score ~97 against an S-curve).
  geom.scoreCurve = function (targetPolyline, userPts) {
    if (!userPts || userPts.length < 2 || extentOf(userPts) < MIN_EXTENT) {
      return { score: 0, iou: 0, metrics: { degenerate: true } };
    }
    const N = 64;
    const T = geom.resample(targetPolyline, N);
    let U = geom.resample(userPts, N);
    const tvx = T[N - 1][0] - T[0][0], tvy = T[N - 1][1] - T[0][1];
    const uvx = U[N - 1][0] - U[0][0], uvy = U[N - 1][1] - U[0][1];
    if (tvx * uvx + tvy * uvy < 0) U = U.slice().reverse();   // drawn the other way → flip
    const bb = bbox(T);
    const scale = Math.max(Math.hypot(tvx, tvy), 0.45 * Math.hypot(bb.w, bb.h), 1e-3);
    const A = endpointAlign(U, T);
    let s = 0; for (let i = 0; i < N; i++) s += Math.hypot(A[i][0] - T[i][0], A[i][1] - T[i][1]);
    const dev = s / N / scale;
    const score = Math.round(Math.max(0, Math.min(100, 100 - dev * 500)));
    const iou = +(score / 100).toFixed(3);   // 0-1 similarity for coach thresholds
    return { score, iou, metrics: { iou, dev: +dev.toFixed(4) } };
  };

  /* ---- FIXED-POSITION curve scoring ---------------------------------------
     Like scoreCurve but WITHOUT endpoint alignment: where the curve sits
     matters. Used for the terminator drill — drawing the shadow boundary on
     the wrong part of the form is a miss, even if the bow shape is right.
     Deviation is normalised by scaleRef (e.g. the form's radius).            */
  geom.scoreCurveFixed = function (targetPolyline, userPts, scaleRef) {
    if (!userPts || userPts.length < 2 || extentOf(userPts) < MIN_EXTENT) {
      return { score: 0, iou: 0, metrics: { degenerate: true } };
    }
    const N = 64;
    const T = geom.resample(targetPolyline, N);
    let U = geom.resample(userPts, N);
    const tvx = T[N - 1][0] - T[0][0], tvy = T[N - 1][1] - T[0][1];
    const uvx = U[N - 1][0] - U[0][0], uvy = U[N - 1][1] - U[0][1];
    if (tvx * uvx + tvy * uvy < 0) U = U.slice().reverse();   // drawn the other way → flip
    const scale = Math.max(scaleRef || 0, 1e-3);
    let s = 0; for (let i = 0; i < N; i++) s += Math.hypot(U[i][0] - T[i][0], U[i][1] - T[i][1]);
    const dev = s / N / scale;
    const score = Math.round(Math.max(0, Math.min(100, 100 - dev * 260)));
    const iou = +(score / 100).toFixed(3);
    return { score, iou, metrics: { iou, dev: +dev.toFixed(4) } };
  };

  /* ---- Convex hull (used by generators & for cleaning user polygons) ----- */
  geom.convexHull = function (points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  };

  A.geom = geom;
})(window.A = window.A || {});
