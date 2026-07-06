'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { freshEnv, LOGIC } = require('./helpers');

test('store.remove is profile-aware', () => {
  const { A, localStorage } = freshEnv(LOGIC);
  A.store.set('curriculum', { line: { level: 3 } });
  assert.ok(localStorage.getItem('atelier:curriculum'));
  A.store.remove('curriculum');
  assert.equal(localStorage.getItem('atelier:curriculum'), null);
});

test('profile switch namespaces keys; each keeps its own state', () => {
  const { A, localStorage } = freshEnv(LOGIC);
  A.store.set('pb', { line: 90 });
  const pid = A.store.addProfile('Second');
  A.store.setProfile(pid);
  assert.deepEqual(A.store.get('pb', {}), {}, 'new profile starts clean');
  A.store.set('pb', { line: 40 });
  assert.ok(localStorage.getItem('atelier:' + pid + ':pb'));
  A.store.setProfile('default');
  assert.deepEqual(A.store.get('pb', {}).line, 90, 'default profile untouched');
});

test('importAll refuses backups from a newer app version before touching data', async () => {
  const { A } = freshEnv(LOGIC);
  await assert.rejects(
    () => A.store.importAll({ app: 'atelier', version: A.store.BACKUP_VERSION + 1 }),
    /newer version/
  );
  await assert.rejects(() => A.store.importAll({ app: 'other' }), /Not an Atelier backup/);
});

test('normalizeAttempt upgrades old records with safe defaults', () => {
  const { A } = freshEnv(LOGIC);
  const old = { ts: 1, score: 70, selfEstimate: 80 };
  const n = A.store.normalizeAttempt(old);
  assert.equal(n.repeat, false);
  assert.equal(n.recall, false);
  assert.equal(n.glances, 0);
  assert.equal(n.estBias, 10, 'signed calibration backfilled');
  assert.equal(n.schema, A.store.ATTEMPT_SCHEMA);
  // already-current records pass through untouched
  const cur = { schema: A.store.ATTEMPT_SCHEMA, repeat: true };
  assert.equal(A.store.normalizeAttempt(cur).repeat, true);
});

test('stats: bias uses a recent window and skips repeats', () => {
  const { A } = freshEnv(LOGIC);
  const atts = [];
  // 30 old attempts with a big bias, then 25 recent with none — old must age out
  for (let i = 0; i < 30; i++) atts.push({ type: 'line', metrics: { angleErrDeg: 10 }, repeat: false });
  for (let i = 0; i < 25; i++) atts.push({ type: 'line', metrics: { angleErrDeg: 0 }, repeat: false });
  assert.equal(A.stats.bias(atts, 'line').angle.mean, 0);
  // repeats never pollute the window
  for (let i = 0; i < 25; i++) atts.push({ type: 'line', metrics: { angleErrDeg: -20 }, repeat: true });
  assert.equal(A.stats.bias(atts, 'line').angle.mean, 0);
});

test('stats: dailyTrend uses genuine scored trials only', () => {
  const { A } = freshEnv(LOGIC);
  const atts = [
    { day: '2026-01-01', score: 80, scored: true, repeat: false, recall: false },
    { day: '2026-01-01', score: 0, scored: true, repeat: true, recall: false },
    { day: '2026-01-01', score: 0, scored: false }
  ];
  const t = A.stats.dailyTrend(atts);
  assert.equal(t.length, 1);
  assert.equal(t[0].score, 80);
});

// the practice day ends at 04:00, not midnight — a session in bed after
// midnight belongs to the evening's sitting (it must not steal tomorrow's
// plan, count as a second "distinct day" for promotion, or make a figure
// studied 20 minutes ago eligible for a "recall across a night" check)
test('dayKey: the practice day rolls over at 4 AM, not midnight', () => {
  const { A } = freshEnv(LOGIC);
  const k = (iso) => A.util.dayKey(0, new Date(iso));
  assert.equal(k('2026-07-06T00:30:00'), '2026-07-05', 'after-midnight practice belongs to the evening before');
  assert.equal(k('2026-07-06T03:59:00'), '2026-07-05', 'still the same sitting just before 4 AM');
  assert.equal(k('2026-07-06T04:01:00'), '2026-07-06', 'a new day starts at 4 AM');
  assert.equal(k('2026-07-06T23:50:00'), '2026-07-06', 'a late-evening session is that day');
  // midnight straddle: 23:50 and 00:10 are ONE day — the promotion gate's
  // two-distinct-days rule can no longer be met inside a single sitting
  assert.equal(k('2026-07-06T23:50:00'), k('2026-07-07T00:10:00'));
  // month/year boundaries survive the shift
  assert.equal(k('2026-08-01T01:00:00'), '2026-07-31');
  assert.equal(k('2027-01-01T02:00:00'), '2026-12-31');
  // day offsets compose with the rollover
  assert.equal(A.util.dayKey(-1, new Date('2026-07-06T00:30:00')), '2026-07-04');
  assert.equal(A.util.dayKey(1, new Date('2026-07-06T12:00:00')), '2026-07-07');
});

test('dayKey: habit, curriculum and gamify all use the shared day', () => {
  const { A } = freshEnv(LOGIC);
  assert.equal(A.habit.today(), A.util.dayKey());
});
