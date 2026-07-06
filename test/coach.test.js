'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { freshEnv } = require('./helpers');

const load = () => freshEnv(['js/geometry.js', 'js/coach.js']).A;

test('advice always returns a string, even with no metrics', () => {
  const c = load().coach;
  for (const k of ['line', 'angles', 'curve', 'polygon', 'envelope']) {
    assert.equal(typeof c.advice(k, {}), 'string');
    assert.equal(typeof c.advice(k), 'string');
  }
});

test('principle picks the dominant error', () => {
  const c = load().coach;
  assert.equal(c.principle('line', { metrics: { angleErrDeg: 8, lengthErrPct: 2 } }), c.PRINCIPLES.angle);
  assert.equal(c.principle('line', { metrics: { angleErrDeg: 1, lengthErrPct: 20 } }), c.PRINCIPLES.length);
  assert.equal(c.principle('envelope', { metrics: { aspectErrPct: 15, iou: 0.9 } }), c.PRINCIPLES.proportion);
  assert.equal(c.principle('envelope', { metrics: { aspectErrPct: 1, iou: 0.4 } }), c.PRINCIPLES.envelope);
  assert.equal(c.principle('curve', { metrics: { iou: 0.5 } }), c.PRINCIPLES.apex);
});

test('principle falls back to calibration then faster when dialled in', () => {
  const c = load().coach;
  assert.equal(c.principle('line', { metrics: { angleErrDeg: 0, lengthErrPct: 0 }, estErr: 20 }), c.PRINCIPLES.calibration);
  assert.equal(c.principle('line', { metrics: { angleErrDeg: 0, lengthErrPct: 0 }, estErr: 3 }), c.PRINCIPLES.faster);
});

// sight-size coaching must read the SIGNED placement metrics the right way round:
// dy>0 = copy sits too low, dx>0 = too far right, sizeErrPct>0 = too large
test('sight-size advice matches metric sign conventions', () => {
  const c = load().coach;
  const low = c.advice('sightsize', { dy: 8, dx: 0, sizeErrPct: 0 });
  assert.match(low, /too low/);
  const highLeft = c.advice('sightsize', { dy: -8, dx: -6, sizeErrPct: 0 });
  assert.match(highLeft, /too high/); assert.match(highLeft, /left/);
  const big = c.advice('sightsize', { dy: 0, dx: 0, sizeErrPct: 12 });
  assert.match(big, /too large/);
  // placed & sized true but weak contour → steer to the flick rhythm, not placement
  const contour = c.advice('sightsize', { dy: 1, dx: 1, sizeErrPct: 1, iou: 0.5 });
  assert.doesNotMatch(contour, /too (low|high|large|small)/);
  // sub-85 score teaches the sight principle
  assert.equal(c.principle('sightsize', { score: 70, metrics: {} }), c.PRINCIPLES.sight);
});

test('every principle card has icon/title/why/how', () => {
  const c = load().coach;
  for (const k of Object.keys(c.PRINCIPLES)) {
    const p = c.PRINCIPLES[k];
    assert.ok(p.icon && p.title && p.why && p.how, k + ' complete');
  }
});
