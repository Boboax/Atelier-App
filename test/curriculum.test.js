'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { freshEnv, LOGIC, dayKey } = require('./helpers');

test('promotion needs a full window at >=85 across >=2 distinct days', () => {
  const { A } = freshEnv(LOGIC);
  for (let i = 0; i < 5; i++) A.curr.recordScore('line', 95, '2026-01-01');
  assert.equal(A.curr.level('line'), 1, 'same-day scores must not promote');
  // the first score on a SECOND day makes the (rolling) window span 2 days → promote
  const r = A.curr.recordScore('line', 95, '2026-01-02');
  assert.equal(r.changed, true);
  assert.equal(A.curr.level('line'), 2);
});

test('one weak score (<70) blocks promotion even with a high mean', () => {
  const { A } = freshEnv(LOGIC);
  ['2026-01-01', '2026-01-01', '2026-01-02', '2026-01-02'].forEach((d) => A.curr.recordScore('line', 100, d));
  const r = A.curr.recordScore('line', 65, '2026-01-03');   // mean 93, weakest 65
  assert.equal(r.changed, false);
  assert.equal(A.curr.level('line'), 1);
});

test('demotion at window mean <=60, never below level 1', () => {
  const { A } = freshEnv(LOGIC);
  for (let i = 0; i < 5; i++) A.curr.recordScore('line', 40, '2026-01-0' + (i + 1));
  assert.equal(A.curr.level('line'), 1, 'level 1 cannot demote');
  // climb to 2, then collapse
  for (const d of ['2026-02-01', '2026-02-01', '2026-02-02', '2026-02-02', '2026-02-03']) A.curr.recordScore('line', 95, d);
  assert.equal(A.curr.level('line'), 2);
  for (let i = 0; i < 5; i++) A.curr.recordScore('line', 50, '2026-02-1' + i);
  assert.equal(A.curr.level('line'), 1, 'sustained 50s must ease the level back down');
});

test('spaced review: promotion moves the drill up a box; dueIn counts down', () => {
  const { A } = freshEnv(LOGIC);
  for (const d of ['2026-01-01', '2026-01-01', '2026-01-02', '2026-01-02', '2026-01-03']) A.curr.recordScore('line', 95, d);
  assert.equal(A.curr.level('line'), 2);
  // box moved 0→1 → interval 2 days from last practice (2026-01-03)
  assert.equal(A.curr.dueIn('line', '2026-01-03'), 2);
  assert.equal(A.curr.dueIn('line', '2026-01-05'), 0);
  assert.equal(A.curr.dueIn('line', '2026-01-07'), -2);
  const due = A.curr.dueDrills('2026-01-07');
  assert.ok(due.some((d) => d.key === 'line'));
});

test('never-practised scored drills report due now', () => {
  const { A } = freshEnv(LOGIC);
  assert.equal(A.curr.dueIn('polygon', '2026-01-01'), 0);
});

test('reference drills join the schedule via touchRef', () => {
  const { A } = freshEnv(LOGIC);
  assert.equal(A.curr.dueRefs('2026-01-01').length, 0, 'untried refs are not due');
  A.curr.touchRef('bargue', '2026-01-01');
  assert.equal(A.curr.dueIn('bargue', '2026-01-02'), 0, 'box 0 → due after 1 day');
  assert.ok(A.curr.dueRefs('2026-01-05').some((d) => d.key === 'bargue'));
});

test('streak: consecutive days, today optional, rest-day forgiveness after a 7-day run', () => {
  const { A } = freshEnv(LOGIC);
  const goal = A.habit.goalMin();
  const meet = (off) => { const d = A.habit.data(); d.days[dayKey(off)] = { count: 1, secs: goal * 60 }; A.habit.save(d); };
  // 3-day streak ending yesterday; today not yet met
  meet(-1); meet(-2); meet(-3);
  assert.equal(A.habit.streak(), 3);
  // a gap NOT preceded by a 7-day run breaks the streak
  meet(-5);
  assert.equal(A.habit.streak(), 3, 'single missed day without an earned rest breaks the run');
  // now build a 7-day run before the gap → the gap is forgiven as a rest day
  // (streak counts the 11 PRACTICED days; the rest day just preserves continuity)
  for (let i = 5; i <= 12; i++) meet(-i);
  assert.equal(A.habit.streak(), 11, '7-day run earns the missed day as rest');
});

test('plan mode: markPlanDone feeds metGoalOn regardless of minutes', () => {
  const { A } = freshEnv(LOGIC);
  const today = A.habit.today();
  assert.equal(A.habit.metGoalOn(today), false);
  assert.equal(A.habit.markPlanDone(today), true);
  assert.equal(A.habit.markPlanDone(today), false, 'idempotent');
  assert.equal(A.habit.metGoalOn(today), true);
});
