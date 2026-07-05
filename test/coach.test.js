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

test('every principle card has icon/title/why/how', () => {
  const c = load().coach;
  for (const k of Object.keys(c.PRINCIPLES)) {
    const p = c.PRINCIPLES[k];
    assert.ok(p.icon && p.title && p.why && p.how, k + ' complete');
  }
});
