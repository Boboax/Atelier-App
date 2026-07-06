'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { freshEnv, LOGIC } = require('./helpers');

// gen.make grew an optional third param (correction-set stress). These guards
// pin the contract: 2-arg calls behave exactly as before, stressed targets are
// still valid in-box geometry, and the aspect stress really elongates in the
// biased direction (the point of the correction set).

const inBox = (p) => p[0] >= -0.01 && p[0] <= 1.01 && p[1] >= -0.01 && p[1] <= 1.01;
const bboxAspect = (pts) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }
  return (maxX - minX) / ((maxY - minY) || 1);
};

test('gen.make: 2-arg calls (no stress) still produce every kind', () => {
  const { A } = freshEnv(LOGIC);
  for (const k of ['line', 'angles', 'curve', 'polygon', 'envelope', 'gesture', 'shade']) {
    const t = A.gen.make(k, 3);
    assert.ok(t && t.kind, k + ' generates');
  }
});

test('gen.make: angle/length stress produces valid in-box lines and angle bundles', () => {
  const { A } = freshEnv(LOGIC);
  for (let i = 0; i < 25; i++) {
    for (const stress of [{ kind: 'angle', sign: 1 }, { kind: 'angle', sign: -1 }, { kind: 'length', sign: 1 }, { kind: 'length', sign: -1 }]) {
      const l = A.gen.make('line', 5, stress);
      assert.equal(l.kind, 'line');
      l.lines[0].forEach((p) => assert.ok(inBox(p), 'line endpoint in box'));
      const a = A.gen.make('angles', 5, stress);
      assert.equal(a.kind, 'angles');
      a.lines.forEach((seg) => seg.forEach((p) => assert.ok(inBox(p), 'angle endpoint in box')));
    }
  }
});

test('gen.make: length stress serves the error band — overshooters get short targets, undershooters long', () => {
  const { A } = freshEnv(LOGIC);
  const meanLen = (sign) => {
    let s = 0;
    for (let i = 0; i < 40; i++) {
      const seg = A.gen.make('line', 5, { kind: 'length', sign }).lines[0];
      s += Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]);
    }
    return s / 40;
  };
  assert.ok(meanLen(1) < meanLen(-1), 'short targets for + bias, long for −');
});

test('gen.make: aspect stress elongates polygons and envelopes in the biased direction', () => {
  const { A } = freshEnv(LOGIC);
  const meanAspect = (key, sign) => {
    let s = 0;
    for (let i = 0; i < 40; i++) s += bboxAspect(A.gen.make(key, 4, { kind: 'aspect', sign }).polygon);
    return s / 40;
  };
  for (const key of ['polygon', 'envelope']) {
    const wide = meanAspect(key, 1), tall = meanAspect(key, -1);
    assert.ok(wide > tall, key + ': +bias sets run wider than −bias sets');
    assert.ok(wide > 1, key + ': +bias sets are wide on average');
    assert.ok(tall < 1, key + ': −bias sets are tall on average');
  }
});
