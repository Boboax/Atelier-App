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
    const nverts = Math.max(3, Math.min(7, 3 + Math.floor((level - 1) / 1.5)));
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
    if (poly.length < 3) poly = A.geom.convexHull(pts);
    return { kind: 'polygon', polygon: fitToBox(poly, 0.13) };
  };

  /* ---- organic envelopes: blobs like the worksheet shapes ----------------*/
  gen.envelope = function (level) {
    const lobes = Math.max(5, Math.min(9, 4 + Math.floor(level / 1.3)));
    const cx = 0.5, cy = 0.5;
    const ctrl = [];
    const baseR = 0.34;
    const wobble = 0.18 + Math.min(0.28, level * 0.04);
    const aspect = rnd(0.65, 1.5);
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2 + rnd(-0.12, 0.12);
      const r = baseR * (1 + rnd(-wobble, wobble));
      ctrl.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * aspect]);
    }
    const poly = smoothClosed(ctrl, 12);
    return { kind: 'envelope', polygon: fitToBox(poly, 0.12) };
  };

  // Dispatch by exercise key.
  gen.make = function (exKey, level) {
    switch (exKey) {
      case 'line': return gen.line(level);
      case 'angles': return gen.angles(level);
      case 'polygon': return gen.polygon(level);
      case 'envelope': return gen.envelope(level);
      default: return gen.line(level);
    }
  };

  A.gen = gen;
})(window.A = window.A || {});
