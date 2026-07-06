'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { freshEnv, LOGIC } = require('./helpers');

// perceive.js only touches the DOM inside build()/start(); loading it in Node
// is safe and exposes the pure staircase step for testing
const load = () => freshEnv(LOGIC.concat(['js/perceive.js'])).A;

test('staircase: 2-down-1-up with reversal detection', () => {
  const P = load().Perceive;
  let s = { diff: 14, streak: 0, lastDir: null };
  // one correct: no change yet
  let r = P.stairStep(s, true);
  assert.equal(r.diff, 14); assert.equal(r.streak, 1); assert.equal(r.dir, null);
  // second correct: harder (smaller diff), direction 'down'
  r = P.stairStep({ diff: 14, streak: 1, lastDir: null }, true);
  assert.ok(r.diff < 14); assert.equal(r.streak, 0); assert.equal(r.dir, 'down');
  assert.equal(r.reversal, false, 'first direction is not a reversal');
  // a miss after going down: easier + reversal
  r = P.stairStep({ diff: 10, streak: 0, lastDir: 'down' }, false);
  assert.ok(r.diff > 10); assert.equal(r.dir, 'up'); assert.equal(r.reversal, true);
  // another miss: still up, no reversal
  r = P.stairStep({ diff: 14.5, streak: 0, lastDir: 'up' }, false);
  assert.equal(r.reversal, false);
});

test('staircase converges toward a threshold under a simulated observer', () => {
  const P = load().Perceive;
  // observer that reliably detects diffs >= 6 and guesses below (50/50)
  let s = { diff: 14, streak: 0, lastDir: null };
  let seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const diffs = [];
  for (let i = 0; i < 60; i++) {
    const correct = s.diff >= 6 ? true : rand() < 0.5;
    const r = P.stairStep(s, correct);
    s = { diff: Math.max(1, Math.min(30, r.diff)), streak: r.streak, lastDir: r.lastDir };
    diffs.push(s.diff);
  }
  const tail = diffs.slice(-20);
  const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
  assert.ok(mean > 2 && mean < 12, 'staircase hovers near the true threshold (6): got ' + mean.toFixed(1));
});

test('perceive exposes all warm-up kinds', () => {
  const P = load().Perceive;
  assert.deepEqual(P.kinds, ['angle', 'prop', 'curve', 'value']);
  assert.deepEqual(P.afcKinds, ['angle', 'length']);
});

test('gamify: all perception attempt types count toward the warm-up segment', () => {
  const { A } = freshEnv(LOGIC);
  const day = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  const atts = [];
  ['perc-angle', 'perc-prop', 'perc-curve', 'perc-value', 'afc-angle', 'afc-length'].forEach((t) => {
    atts.push({ ts: Date.now(), day, type: t, scored: true, score: 80, repeat: false, recall: false });
  });
  const plan = A.game.dailyPlan(atts);
  assert.equal(plan.segments[0].done, true, '6 mixed perception rounds complete the warm-up');
});

test('ladder is curriculum-derived: gesture and shade count toward mastery', () => {
  const { A } = freshEnv(LOGIC);
  const base = A.game.masteryPoints();
  // level up gesture and shade via the curriculum — mastery must move
  for (const d of ['2026-01-01', '2026-01-01', '2026-01-02', '2026-01-02', '2026-01-03']) A.curr.recordScore('gesture', 95, d);
  for (const d of ['2026-01-01', '2026-01-01', '2026-01-02', '2026-01-02', '2026-01-03']) A.curr.recordScore('shade', 95, d);
  assert.equal(A.game.masteryPoints(), base + 2, 'both new drills feed mastery points');
  // and weakestDrill can pick them
  const atts = [];
  for (let i = 0; i < 4; i++) atts.push({ type: 'shade', scored: true, score: 40, repeat: false, recall: false, day: '2026-01-03', ts: Date.now() });
  for (let i = 0; i < 4; i++) atts.push({ type: 'line', scored: true, score: 90, repeat: false, recall: false, day: '2026-01-03', ts: Date.now() });
  assert.equal(A.game.weakestDrill(atts).exKey, 'shade');
});
