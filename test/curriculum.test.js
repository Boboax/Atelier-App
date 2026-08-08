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

test('Module 4 ladder: five scores >=80 promote a reference drill and shrink its study glance', () => {
  const { A } = freshEnv(LOGIC);
  const d = A.curr.def('bargue');
  assert.equal(d.maxLevel, 3, 'reference drills carry a 3-level ladder');
  const s1 = d.study(1);
  for (let i = 0; i < 5; i++) A.curr.touchRef('bargue', '2026-01-0' + (i + 1), 85);
  assert.equal(A.curr.level('bargue'), 2, 'a full window averaging >=80 promotes');
  assert.ok(d.study(2) < s1, 'level 2 tightens the study clock (×0.7)');
  assert.ok(d.study(3) < d.study(2), 'level 3 tighter still (×0.5)');
  // the window cleared on promotion → five MORE strong scores reach the cap and stop
  for (let i = 0; i < 5; i++) A.curr.touchRef('bargue', '2026-01-1' + i, 90);
  assert.equal(A.curr.level('bargue'), 3);
  for (let i = 0; i < 5; i++) A.curr.touchRef('bargue', '2026-01-2' + i, 95);
  assert.equal(A.curr.level('bargue'), 3, 'never past maxLevel');
});

test('Module 4 ladder: a sub-80 window does not promote; sight-size stays flat', () => {
  const { A } = freshEnv(LOGIC);
  for (let i = 0; i < 5; i++) A.curr.touchRef('bargue', '2026-01-0' + (i + 1), 75);
  assert.equal(A.curr.level('bargue'), 1, 'mean 75 must not promote');
  for (let i = 0; i < 5; i++) A.curr.touchRef('sightsize', '2026-01-0' + (i + 1), 95);
  assert.equal(A.curr.level('sightsize'), 1, 'sightsize has no ladder (maxLevel 1)');
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

// scaffolds are withdrawn ONE PER LEVEL, not all at once (guidance hypothesis:
// support must fade, but stacking every removal into one step is a cliff)
test('guideTier: staged withdrawal, crudest aid first, plumb last', () => {
  const { A } = freshEnv(LOGIC);
  const t = (lv) => A.curr.guideTier('line', lv, 'auto');
  assert.deepEqual(t(1), { thirds: true, clock: true, plumb: true }, 'L1 fully scaffolded');
  assert.deepEqual(t(2), { thirds: false, clock: true, plumb: true }, 'L2 loses the thirds grid');
  assert.deepEqual(t(3), { thirds: false, clock: false, plumb: true }, 'L3 loses the angle clock');
  // L4 is where the study clock becomes an enforced countdown — the last
  // references stay so two difficulties don't land in the same step
  assert.deepEqual(t(4), { thirds: false, clock: false, plumb: true }, 'L4 keeps plumb (timer step)');
  assert.equal(t(5), null, 'L5 stands alone');
  assert.equal(t(9), null);
  // Bargue keeps everything — the plumb line is part of that construction method
  assert.deepEqual(A.curr.guideTier('bargue', 9, 'auto'), { thirds: true, clock: true, plumb: true });
  // explicit settings override the ladder in both directions
  assert.equal(A.curr.guideTier('line', 1, 'off'), null);
  assert.deepEqual(A.curr.guideTier('line', 9, 'on'), { thirds: true, clock: true, plumb: true });
  // unscored reference drills have no generated target to scaffold
  assert.equal(A.curr.guideTier('master', 1, 'auto'), null);
});

test('guideDropped names the support each level-up removes (auto only)', () => {
  const { A } = freshEnv(LOGIC);
  assert.match(A.curr.guideDropped('line', 2, 'auto'), /thirds/);
  assert.match(A.curr.guideDropped('line', 3, 'auto'), /angle clock/);
  assert.equal(A.curr.guideDropped('line', 4, 'auto'), '', 'L4 removes no guide (enforced timer instead)');
  assert.match(A.curr.guideDropped('line', 5, 'auto'), /plumb/);
  assert.equal(A.curr.guideDropped('line', 6, 'auto'), '', 'nothing left to remove');
  assert.equal(A.curr.guideDropped('line', 2, 'on'), '', 'not when guides are pinned on');
  assert.equal(A.curr.guideDropped('bargue', 2, 'auto'), '', 'bargue keeps its scaffolds');
});

// data repair: attempts hit by the ordered-path scoring bugs (a faithful curve
// built from dots/overlapping strokes scored 0) are rescored from their stored
// target+strokes, and the promotion window is rebuilt from corrected history
test('repairOpenCurveScores: rescues bug victims, leaves honest scores alone', () => {
  const { A } = freshEnv(LOGIC);
  const T = [[0.15, 0.4], [0.35, 0.72], [0.5, 0.82], [0.65, 0.72], [0.85, 0.4]];
  const copy = T.map((p) => [p[0] + 0.008, p[1] + 0.008]);
  const dots = [[[0.15, 0.4], [0.151, 0.401]], [[0.5, 0.82], [0.501, 0.821]]];
  const straight = [[[0.15, 0.4], [0.85, 0.4]]];
  const att = (id, ts, score, strokes, extra) => Object.assign(
    { id, ts, day: '2026-07-1' + (id % 9), type: 'curve', scored: true,
      target: { polyline: T }, strokes, score, metrics: {}, repeat: false, recall: false, glances: 0 }, extra);
  const attempts = [
    att(1, 1000, 0, dots.concat([copy])),                    // bug victim: dots + faithful copy scored 0
    att(2, 2000, 0, [copy.slice(2, 5), copy.slice(0, 3), copy.slice(3)]), // bug victim: overlapping strokes
    att(3, 3000, 12, straight, {}),                          // honestly bad — must NOT be inflated
    att(4, 4000, 91, [copy], { selfEstimate: 80 }),          // already fine
    att(5, 5000, 0, dots.concat([copy]), { glances: 2 }),    // victim but glanced → rescored, excluded from window
  ];
  const r = A.curr.repairOpenCurveScores(attempts);
  const ids = r.updates.map((u) => u.id).sort();
  assert.deepEqual(ids, [1, 2, 5], 'exactly the bug victims are corrected');
  for (const u of r.updates) assert.ok(u.score >= 85, 'rescored to the true value: ' + u.score);
  // window rebuilt from genuine attempts only (no glanced #5), corrected values in place
  const w = r.windows.curve.map((x) => x.s);
  assert.equal(w.length, 4);
  assert.ok(w[0] >= 85 && w[1] >= 85, 'corrected scores enter the window');
  assert.equal(w[2], 12, 'the honest low score stays');
  assert.equal(w[3], 91);
  // applying writes the window + resets the staircase pace
  A.curr.recordScore('curve', 95, '2026-07-01');   // put some pace state in place first
  A.curr.applyRepairWindows(r.windows);
  assert.deepEqual(A.curr.window('curve').map((x) => x.s), w);
  assert.equal(A.curr.studySeconds('curve'), A.curr.def('curve').study(1), 'pace back to neutral');
  // nothing to repair → empty plan
  assert.deepEqual(A.curr.repairOpenCurveScores([att(9, 1, 90, [copy])]).updates, []);
});

// the curve construction ladder: full scaffold -> facets internalized -> direct
// sweep; the facet withdrawal avoids L4 (the enforced-countdown step)
test('curveStagePlan: staged at the bottom, direct sweep at the summit', () => {
  const { A } = freshEnv(LOGIC);
  for (const l of [1, 2, 3, 4]) assert.deepEqual(A.curr.curveStagePlan(l), ['chord', 'facet', 'round'], 'L' + l);
  for (const l of [5, 6]) assert.deepEqual(A.curr.curveStagePlan(l), ['chord', 'round'], 'L' + l);
  for (const l of [7, 8, 9]) assert.equal(A.curr.curveStagePlan(l), null, 'L' + l);
});
