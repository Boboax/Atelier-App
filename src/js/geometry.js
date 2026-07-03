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

  /* ---- LINE scoring -------------------------------------------------------
     target / user are 2-point segments [[x1,y1],[x2,y2]] (user = stroke ends).
     Orientation is undirected (a line and its 180° flip are the same line),
     so we fold the signed angle error into (-90,90].                         */
  geom.scoreLine = function (target, userPts) {
    const u0 = userPts[0], u1 = userPts[userPts.length - 1];
    const tAng = toDeg(Math.atan2(target[1][1] - target[0][1], target[1][0] - target[0][0]));
    const uAng = toDeg(Math.atan2(u1[1] - u0[1], u1[0] - u0[0]));
    let aErr = angDiff(uAng, tAng);          // signed, (-180,180]
    if (aErr > 90) aErr -= 180;              // fold (undirected line)
    if (aErr <= -90) aErr += 180;
    const tLen = geom.dist(target[0], target[1]);
    const uLen = geom.dist(u0, u1);
    const lenErrPct = tLen ? (uLen - tLen) / tLen * 100 : 0;

    const angleScore = Math.max(0, 100 - Math.abs(aErr) * 3);     // 33° off → 0
    const lengthScore = Math.max(0, 100 - Math.abs(lenErrPct) * 1.2); // 83% off → 0
    const score = Math.round(angleScore * 0.6 + lengthScore * 0.4);
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
     target/user are arrays of 2-point segments. Score = mean of per-line line
     scores (matched by index) plus a bonus for getting the *relative* angle
     between the first two lines right.                                       */
  geom.scoreAngles = function (targetLines, userLines) {
    const n = Math.min(targetLines.length, userLines.length);
    if (n === 0) return { score: 0, angleErr: 0, lengthErrPct: 0, metrics: {} };
    let sAngle = 0, sLen = 0, sScore = 0;
    for (let i = 0; i < n; i++) {
      const r = geom.scoreLine(targetLines[i], userLines[i]);
      sAngle += r.angleErr; sLen += r.lengthErrPct; sScore += r.score;
    }
    // penalty for missing/extra lines
    const countPenalty = Math.abs(targetLines.length - userLines.length) * 12;
    const score = Math.max(0, Math.round(sScore / n - countPenalty));
    return {
      score,
      angleErr: +(sAngle / n).toFixed(2),
      lengthErrPct: +(sLen / n).toFixed(1),
      metrics: { meanAngleErrDeg: +(sAngle / n).toFixed(2),
                 meanLengthErrPct: +(sLen / n).toFixed(1),
                 lineCountDelta: userLines.length - targetLines.length }
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

  /* ---- SHAPE scoring ------------------------------------------------------
     IoU is the primary similarity. We curve it so that a "good" memory copy
     (IoU≈0.8) lands around 90, since perfect overlap from memory is rare.
     Aspect error is reported signed (+ = drawn too wide).                    */
  geom.scoreShape = function (targetPts, userPts) {
    if (userPts.length < 3) return { score: 0, iou: 0, aspectErrPct: 0, metrics: {} };
    const iou = geom.shapeIoU(targetPts, userPts);
    const nt = geom.normalizeShape(targetPts), nu = geom.normalizeShape(userPts);
    const aspectErrPct = nt.aspect ? (nu.aspect - nt.aspect) / nt.aspect * 100 : 0;
    // Curve: IoU 0→0, 0.5→55, 0.8→90, 0.95→99
    const score = Math.round(Math.max(0, Math.min(100, Math.pow(iou, 0.62) * 100)));
    return {
      score,
      iou: +iou.toFixed(3),
      aspectErrPct: +aspectErrPct.toFixed(1),
      metrics: {
        iou: +iou.toFixed(3),
        aspectErrPct: +aspectErrPct.toFixed(1),
        targetAspect: +nt.aspect.toFixed(2),
        userAspect: +nu.aspect.toFixed(2)
      }
    };
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
