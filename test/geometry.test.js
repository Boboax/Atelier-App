'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { freshEnv } = require('./helpers');

const load = () => freshEnv(['js/geometry.js', 'js/generators.js']).A;
const sq = [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]];

test('identical shapes score 100; degenerate input scores 0', () => {
  const g = load().geom;
  assert.equal(g.scoreShape(sq, sq.map((p) => p.slice())).score, 100);
  assert.equal(g.scoreLine([[0.2, 0.5], [0.8, 0.5]], [[0.5, 0.5], [0.5, 0.5]]).score, 0);
  assert.equal(g.scoreCurve([[0, 0], [1, 1]], [[0.5, 0.5], [0.5, 0.5]]).score, 0);
  assert.equal(g.scoreShape(sq, [[0.5, 0.5], [0.5, 0.5], [0.501, 0.5]]).score, 0);
});

test('scale/translation invariance; aspect error signed', () => {
  const g = load().geom;
  const half = sq.map((p) => [0.25 + (p[0] - 0.5) * 0.5, 0.25 + (p[1] - 0.5) * 0.5]);
  assert.ok(g.scoreShape(sq, half).score >= 95);
  const wide = [[0.1, 0.4], [0.9, 0.4], [0.9, 0.6], [0.1, 0.6]];
  const w = g.scoreShape(sq, wide);
  assert.ok(w.score < 70);
  assert.ok(w.aspectErrPct > 0, '+ = too wide');
});

test('angle relationships: direction-agnostic, relational, missing-line penalty', () => {
  const g = load().geom;
  const V = [0.5, 0.6];
  const mk = (deg, len) => [V, [V[0] + Math.cos(deg * Math.PI / 180) * len, V[1] + Math.sin(deg * Math.PI / 180) * len]];
  const T = [mk(-150, 0.4), mk(-90, 0.5), mk(-30, 0.35)];
  assert.equal(g.scoreAngles(T, T.map((l) => [l[0].slice(), l[1].slice()])).score, 100);
  assert.equal(g.scoreAngles(T, T.map((l) => [l[1].slice(), l[0].slice()])).score, 100, 'reversed strokes');
  const rot = g.scoreAngles(T, [mk(-140, 0.4), mk(-80, 0.5), mk(-20, 0.35)]);
  assert.ok(Math.abs(rot.metrics.relAngleErrDeg) < 0.5, 'rigid rotation → gaps unchanged');
  const gap = g.scoreAngles(T, [mk(-150, 0.4), mk(-70, 0.5), mk(-30, 0.35)]);
  assert.ok(rot.score > gap.score, 'rigid rotation beats a broken gap');
  assert.ok(g.scoreAngles(T, [T[0], T[1]]).score < 100, 'missing line penalised');
});

test('line scoring: signed errors fold correctly', () => {
  const g = load().geom;
  const r = g.scoreLine([[0.2, 0.5], [0.8, 0.5]], [[0.2, 0.5], [0.78, 0.6]]);
  assert.ok(r.angleErr > 0, 'downward tilt = clockwise = positive');
  assert.equal(g.angDiff(359, 1), -2);
});

test('rdp: 10x+ decimation, endpoints kept', () => {
  const g = load().geom;
  const dense = Array.from({ length: 400 }, (_, i) => [i / 399, 0.5 + Math.sin(i / 399 * 4) * 0.2]);
  const slim = g.rdp(dense, 0.002);
  assert.ok(slim.length * 10 <= dense.length);
  assert.deepEqual(slim[0], dense[0]);
  assert.deepEqual(slim[slim.length - 1], dense[dense.length - 1]);
});

test('line scoring: a wrong angle is not rescued by matching length', () => {
  const g = load().geom;
  const T = [[0.2, 0.5], [0.8, 0.5]];
  assert.equal(g.scoreLine(T, [[0.2, 0.5], [0.8, 0.5]]).score, 100);
  assert.equal(g.scoreLine(T, [[0.5, 0.2], [0.5, 0.8]]).score, 0, 'perpendicular, same length must be ~0 not 40');
  assert.ok(g.scoreLine(T, [[0.2, 0.5], [0.79, 0.6]]).score >= 72, 'a ~10deg miss stays high');
  assert.ok(g.scoreLine(T, [[0.2, 0.5], [0.76, 0.7]]).score < 65, 'a ~20deg miss is clearly penalised');
});

test('shape scoring is strict enough to distinguish wrong contours', () => {
  const g = load().geom;
  const sq = [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]];
  const circle = Array.from({ length: 24 }, (_, i) => { const a = i / 24 * 6.283; return [0.5 + 0.22 * Math.cos(a), 0.5 + 0.22 * Math.sin(a)]; });
  const scribble = [[0.5, 0.5], [0.52, 0.51], [0.51, 0.53]];
  assert.equal(g.scoreShape(sq, sq.map((p) => p.slice())).score, 100);
  assert.ok(g.scoreShape(sq, sq.map((p) => [p[0] + 0.02, p[1] - 0.02])).score >= 88, 'a clean copy stays high');
  assert.ok(g.scoreShape(sq, circle).score < 75, 'a circle is clearly not a square: ' + g.scoreShape(sq, circle).score);
  assert.ok(g.scoreShape(sq, scribble).score < 25, 'a tiny scribble scores low: ' + g.scoreShape(sq, scribble).score);
});

test('curve scoring rewards the bow, not bbox overlap (no more straight-line-scores-97)', () => {
  const g = load().geom;
  // a strongly bowed S line of action
  const T = [[0.5, 0.08], [0.6, 0.28], [0.44, 0.5], [0.58, 0.72], [0.5, 0.92]];
  const good = [[0.5, 0.08], [0.585, 0.29], [0.45, 0.5], [0.565, 0.71], [0.5, 0.92]];
  const straight = [[0.5, 0.08], [0.5, 0.3], [0.5, 0.5], [0.5, 0.7], [0.5, 0.92]];
  const opposite = [[0.5, 0.08], [0.4, 0.28], [0.56, 0.5], [0.42, 0.72], [0.5, 0.92]];
  const shifted = good.map((p) => [p[0] + 0.12, p[1] - 0.06]);
  const reversed = good.slice().reverse();
  const sc = (u) => g.scoreCurve(T, u).score;
  assert.equal(sc(T), 100, 'identical = 100');
  assert.ok(sc(good) >= 90, 'a close copy still scores high: ' + sc(good));
  assert.ok(sc(shifted) >= 88, 'position/scale invariant: ' + sc(shifted));
  assert.ok(sc(reversed) >= 88, 'draw-direction invariant: ' + sc(reversed));
  assert.ok(sc(straight) < 82, 'a straight line must NOT score like the S: ' + sc(straight));
  assert.ok(sc(opposite) < 65, 'an opposite bend must score poorly: ' + sc(opposite));
  assert.ok(sc(good) - sc(straight) >= 12, 'good clearly beats straight');
});

test('gesture: authored poses valid across levels; line of action scores by curve match', () => {
  const A = load();
  const g = A.geom, gen = A.gen;
  let bad = 0;
  for (let i = 0; i < 500; i++) {
    const t = gen.gesture(1 + (i % 9));
    if (t.kind !== 'gesture' || !t.loa || t.loa.length < 3) { bad++; continue; }
    if (t.loa.some((p) => !isFinite(p[0]) || !isFinite(p[1]))) bad++;
    if (!t.head || t.head.length !== 3) bad++;
    const s = g.scoreCurve(t.loa, t.loa.map((p) => [p[0] + (Math.random() - 0.5) * 0.03, p[1] + (Math.random() - 0.5) * 0.03])).score;
    if (!isFinite(s) || s < 0 || s > 100) bad++;
  }
  assert.equal(bad, 0);
  const t0 = gen.gesture(1);
  assert.ok(g.scoreCurve(t0.loa, t0.loa.map((p) => p.slice())).score >= 99, 'identical LoA ~100');
  assert.equal(g.scoreCurve(t0.loa, [[0.5, 0.5], [0.5, 0.5]]).score, 0, 'a tap scores 0');
});

test('gesture: level 1 offers only the simplest poses, level 9 the full set', () => {
  const gen = load().gen;
  // higher levels must never fail to produce a pose
  for (let lv = 1; lv <= 9; lv++) assert.ok(gen.gesture(lv).loa.length > 3, 'level ' + lv);
});

test('scoreCurveFixed: position matters (terminator drill)', () => {
  const g = load().geom;
  const T = [[0.4, 0.35], [0.45, 0.5], [0.4, 0.65]];      // a bow on the left of a form
  assert.equal(g.scoreCurveFixed(T, T.map((p) => p.slice()), 0.5).score, 100);
  const shifted = T.map((p) => [p[0] + 0.25, p[1]]);       // same bow, wrong place
  assert.ok(g.scoreCurveFixed(T, shifted, 0.5).score < 60, 'misplaced terminator must score low: ' + g.scoreCurveFixed(T, shifted, 0.5).score);
  const near = T.map((p) => [p[0] + 0.02, p[1]]);
  assert.ok(g.scoreCurveFixed(T, near, 0.5).score >= 85, 'a near miss stays high');
  assert.equal(g.scoreCurveFixed(T, [[0.5, 0.5], [0.5, 0.5]], 0.5).score, 0, 'tap = 0');
});

test('shade generator: valid forms, terminator on the form, shadow polygon closed', () => {
  const gen = load().gen;
  for (let i = 0; i < 300; i++) {
    const t = gen.shade(1 + (i % 9));
    assert.equal(t.kind, 'shade');
    assert.ok(t.polyline.length >= 10, 'terminator sampled');
    assert.ok(t.contour.length >= 24, 'contour sampled');
    assert.ok(t.shadow.length > t.polyline.length, 'shadow region includes the arc back');
    const all = t.polyline.concat(t.contour, t.shadow);
    assert.ok(all.every((p) => isFinite(p[0]) && isFinite(p[1])), 'finite');
    // terminator endpoints sit on (or very near) the contour
    const onC = (pt) => t.contour.some((c) => Math.hypot(c[0] - pt[0], c[1] - pt[1]) < 0.08);
    assert.ok(onC(t.polyline[0]) && onC(t.polyline[t.polyline.length - 1]), 'terminator spans the form');
  }
});

test('generators: no NaN, polygons valid, scores in range (fuzz 2400)', () => {
  const A = load();
  const g = A.geom, gen = A.gen;
  const noisy = (ps) => ps.map((p) => [p[0] + (Math.random() - 0.5) * 0.05, p[1] + (Math.random() - 0.5) * 0.05]);
  let bad = 0;
  for (let i = 0; i < 2400; i++) {
    const kind = ['line', 'angles', 'curve', 'polygon', 'envelope', 'gesture'][i % 6];
    const t = gen.make(kind, 1 + (i % 9));
    const pts = t.polygon || t.polyline || t.loa || t.lines.flat();
    if (pts.some((p) => !isFinite(p[0]) || !isFinite(p[1]))) bad++;
    if (t.polygon && t.polygon.length < 3) bad++;
    let s;
    if (kind === 'line') s = g.scoreLine(t.lines[0], noisy(t.lines[0])).score;
    else if (kind === 'angles') s = g.scoreAngles(t.lines, t.lines.map(noisy)).score;
    else if (kind === 'curve') s = g.scoreCurve(t.polyline, noisy(t.polyline)).score;
    else if (kind === 'gesture') s = g.scoreCurve(t.loa, noisy(t.loa)).score;
    else s = g.scoreShape(t.polygon, noisy(t.polygon)).score;
    if (!isFinite(s) || s < 0 || s > 100) bad++;
  }
  assert.equal(bad, 0);
});

// distToSeg backs the string tool's grab detection (end-grab vs mid-grab vs new)
test('distToSeg: segment distance, not infinite-line distance', () => {
  const { A } = freshEnv(['js/geometry.js']);
  const g = A.geom;
  assert.equal(g.distToSeg([0.5, 0.5], [0, 0.5], [1, 0.5]), 0, 'on the segment');
  assert.ok(Math.abs(g.distToSeg([0.5, 0.7], [0, 0.5], [1, 0.5]) - 0.2) < 1e-9, 'perpendicular offset');
  // beyond the ends the distance is to the ENDPOINT (an infinite line would say 0)
  assert.ok(Math.abs(g.distToSeg([1.3, 0.5], [0, 0.5], [1, 0.5]) - 0.3) < 1e-9, 'past b');
  assert.ok(Math.abs(g.distToSeg([-0.4, 0.5], [0, 0.5], [1, 0.5]) - 0.4) < 1e-9, 'past a');
  assert.ok(Math.abs(g.distToSeg([0.3, 0.4], [0.3, 0.1], [0.3, 0.1]) - 0.3) < 1e-9, 'degenerate segment = point');
});
