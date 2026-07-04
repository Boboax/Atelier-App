'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { freshEnv, LOGIC, dayKey } = require('./helpers');

const att = (over) => Object.assign({
  ts: Date.now(), day: dayKey(0), type: 'line', scored: true, level: 1,
  studySec: 5, drawSec: 8, score: 80, selfRated: false, metrics: {},
  glances: 0, repeat: false, recall: false,
  selfEstimate: 75, estErr: 5, target: { kind: 'line', lines: [[[0, 0], [1, 1]]] }, strokes: [[[0, 0], [1, 1]]]
}, over || {});
const percAtt = (over) => att(Object.assign({ type: 'perc-angle', target: null, strokes: [] }, over || {}));

test('recommend: cold start → warm up', () => {
  const { A } = freshEnv(LOGIC);
  assert.equal(A.game.recommend([]).step, 'warmup');
});

test('recommend: warmed + prior-day material → retention check, once per day', () => {
  const { A } = freshEnv(LOGIC);
  const atts = [percAtt(), att({ day: dayKey(-1), ts: Date.now() - 864e5 })];
  assert.equal(A.game.recommend(atts).step, 'recall');
  atts.push(att({ recall: true }));                       // recall done today
  assert.notEqual(A.game.recommend(atts).step, 'recall');
});

test('recommend: warmed, no old material → ladder build with an exercise key', () => {
  const { A } = freshEnv(LOGIC);
  const r = A.game.recommend([percAtt()]);
  assert.equal(r.step, 'build');
  assert.ok(A.curr.def(r.exKey), 'recommends a real drill');
});

test('recommend: stale warm-up (>40 min) re-recommends warming up', () => {
  const { A } = freshEnv(LOGIC);
  const r = A.game.recommend([percAtt({ ts: Date.now() - 60 * 60 * 1000 })]);
  assert.equal(r.step, 'warmup');
});

test('dailyPlan: segments tick off from attempts; recall segment needs material', () => {
  const { A } = freshEnv(LOGIC);
  let plan = A.game.dailyPlan([]);
  assert.equal(plan.segments.length, 2, 'no prior-day material → no recall segment');
  assert.equal(plan.complete, false);
  const atts = [];
  for (let i = 0; i < 6; i++) atts.push(percAtt());
  for (let i = 0; i < 5; i++) atts.push(att());
  atts.push(att({ day: dayKey(-1), ts: Date.now() - 864e5 }));   // yesterday → recall material
  plan = A.game.dailyPlan(atts);
  assert.equal(plan.segments.length, 3);
  assert.equal(plan.segments[0].done, true, 'warm-up done at 6 rounds');
  assert.equal(plan.segments[1].done, true, 'focus done at 5 genuine figures');
  assert.equal(plan.segments[2].done, false, 'recall still open');
  atts.push(att({ recall: true }));
  assert.equal(A.game.dailyPlan(atts).complete, true);
});

test('dailyPlan: repeats and recalls do not count toward focus work', () => {
  const { A } = freshEnv(LOGIC);
  const atts = [];
  for (let i = 0; i < 5; i++) atts.push(att({ repeat: true }));
  const plan = A.game.dailyPlan(atts);
  assert.equal(plan.segments[1].done, false);
});

test('plates: notePlate ratchets best and feeds masteryPoints', () => {
  const { A } = freshEnv(LOGIC);
  const base = A.game.masteryPoints();
  A.game.notePlate('bargue-foot', 90);
  A.game.notePlate('bargue-foot', 70);          // lower — must not regress
  assert.equal(A.game.platesPassed(), 1);
  assert.equal(A.game.masteryPoints(), base + 1);
  A.game.notePlate('not-a-plate', 99);
  assert.equal(A.game.platesPassed(), 1);
});

test('achievements: streak tiers, retention and honest-hand trigger correctly', () => {
  const { A } = freshEnv(LOGIC);
  const goal = A.habit.goalMin();
  for (let i = 0; i < 30; i++) { const d = A.habit.data(); d.days[dayKey(-i)] = { count: 1, secs: goal * 60 }; A.habit.save(d); }
  const atts = [];
  for (let i = 0; i < 10; i++) atts.push(att({ recall: true, score: 85 }));
  for (let i = 0; i < 50; i++) atts.push(att({ level: 6, score: 88 }));
  const res = A.game.check(atts);
  const ids = res.now.map((a) => a.id);
  assert.ok(ids.includes('steady7'), 'steady7');
  assert.ok(ids.includes('steady30'), 'steady30');
  assert.ok(!ids.includes('steady100'), 'not steady100');
  assert.ok(ids.includes('overnight10'), 'overnight10');
  assert.ok(ids.includes('coldRecall'), 'coldRecall (85 recall)');
  assert.ok(ids.includes('honestHand'), 'honestHand');
});

test('achievements: repeats are excluded', () => {
  const { A } = freshEnv(LOGIC);
  const res = A.game.check([att({ repeat: true, score: 95 })]);
  assert.ok(!res.now.some((a) => a.id === 'first90'), 'a repeat 95 must not earn First 90');
});

test('rank: floor is Novice, Master reachable, progress clamped', () => {
  const { A } = freshEnv(LOGIC);
  const r = A.game.rank();
  assert.equal(r.name, 'Novice');
  assert.ok(r.points >= 7);
  assert.ok(r.progress >= 0 && r.progress <= 1);
});

test('weakestDrill: needs 3+ genuine attempts, picks the lowest recent mean', () => {
  const { A } = freshEnv(LOGIC);
  const atts = [];
  for (let i = 0; i < 4; i++) atts.push(att({ type: 'line', score: 90 }));
  for (let i = 0; i < 4; i++) atts.push(att({ type: 'polygon', score: 55 }));
  for (let i = 0; i < 2; i++) atts.push(att({ type: 'curve', score: 10 }));   // only 2 — ignored
  const w = A.game.weakestDrill(atts);
  assert.equal(w.exKey, 'polygon');
});
