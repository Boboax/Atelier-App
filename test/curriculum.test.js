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

test('spaced review is performance-contingent: passing due reviews + promotion grow the gap', () => {
  const { A } = freshEnv(LOGIC);
  for (const d of ['2026-01-01', '2026-01-01', '2026-01-02', '2026-01-02', '2026-01-03']) A.curr.recordScore('line', 95, d);
  assert.equal(A.curr.level('line'), 2);
  // first-ever attempt = a passed due review (box 0→1); promotion on day 3 bumps
  // again (box 1→2) → interval 4 days from last practice (2026-01-03)
  assert.equal(A.curr.dueIn('line', '2026-01-03'), 4);
  assert.equal(A.curr.dueIn('line', '2026-01-07'), 0);
  const due = A.curr.dueDrills('2026-01-09');
  assert.ok(due.some((d) => d.key === 'line'));
});

test('failing a DUE review pulls the interval back in; a weak attempt cannot clear it', () => {
  const { A } = freshEnv(LOGIC);
  A.curr.recordScore('line', 95, '2026-01-01');            // box 0→1 (interval 2)
  assert.equal(A.curr.dueIn('line', '2026-01-03'), 0, 'due after 2 days');
  A.curr.recordScore('line', 40, '2026-01-03');            // failed the review → box 1→0
  assert.equal(A.curr.dueIn('line', '2026-01-04'), 0, 'failure contracts the gap to 1 day');
});

test('per-trial staircase: cruising tightens the study clock, straining relaxes it', () => {
  const { A } = freshEnv(LOGIC);
  const base = A.curr.studySeconds('polygon');
  A.curr.recordScore('polygon', 95, '2026-01-01');
  assert.ok(A.curr.studySeconds('polygon') < base, 'a >=90 score shortens the next look');
  for (let i = 0; i < 8; i++) A.curr.recordScore('polygon', 50, '2026-01-0' + ((i % 8) + 1));
  assert.ok(A.curr.studySeconds('polygon') > base, 'sustained struggle relaxes past nominal');
});

test('retention gate: recallable drills hold promotion until a cold recall passes', () => {
  const { A } = freshEnv(LOGIC);
  let r;
  for (const d of ['2026-01-01', '2026-01-01', '2026-01-02', '2026-01-02', '2026-01-03']) r = A.curr.recordScore('gesture', 95, d);
  assert.equal(r.changed, false, 'window earned but not certified');
  assert.equal(r.pending, true);
  assert.ok(A.curr.pendingPromo('gesture'));
  A.curr.noteRecall('gesture', 75, '2026-01-04');          // the cold recall passes
  r = A.curr.recordScore('gesture', 95, '2026-01-04');
  assert.equal(r.changed, true, 'certified by the recall');
  assert.equal(A.curr.level('gesture'), 2);
  // non-recallable drills (a single line has nothing to recall overnight) skip the gate
  const { A: B } = freshEnv(LOGIC);
  for (const d of ['2026-01-01', '2026-01-01', '2026-01-02', '2026-01-02', '2026-01-03']) r = B.curr.recordScore('line', 95, d);
  assert.equal(r.changed, true, 'line promotes on the window alone');
});

test('recall lags expand on success and reset on failure', () => {
  const { A } = freshEnv(LOGIC);
  assert.equal(A.curr.recallLag('polygon'), 1);
  A.curr.noteRecall('polygon', 80, '2026-01-02');
  assert.equal(A.curr.recallLag('polygon'), 3);
  A.curr.noteRecall('polygon', 85, '2026-01-05');
  assert.equal(A.curr.recallLag('polygon'), 7);
  A.curr.noteRecall('polygon', 30, '2026-01-12');
  assert.equal(A.curr.recallLag('polygon'), 1, 'a clear failure resets the ladder');
  A.curr.noteRecall('line', 90, '2026-01-02');
  assert.equal(A.curr.recallLag('line'), 1, 'non-recallable drills are untouched');
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

// sight-size is a reference drill with an OBJECTIVE score — it must exist in the
// curriculum but stay out of the scored ladder (levels/promotion don't apply:
// there is nothing to memorise faster, only a copy to make truer)
test('sightsize: in curriculum, outside the promotion machinery', () => {
  const { A } = freshEnv(LOGIC);
  const d = A.curr.def('sightsize');
  assert.ok(d, 'sightsize registered');
  assert.equal(d.scored, false);
  assert.equal(d.refCat, 'any');
  const r = A.curr.recordScore('sightsize', 95, '2026-01-01');
  assert.equal(r.changed, false, 'recordScore is a no-op for unscored drills');
  assert.ok(!A.curr.dueDrills('2026-01-05').some((x) => x.key === 'sightsize'),
    'never appears in the scored review queue');
});
