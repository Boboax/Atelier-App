'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { freshEnv } = require('./helpers');

const charts = () => freshEnv(['js/stats.js']).A.charts;

test('dayTime chart: empty vs populated, goal line, today bar', () => {
  const c = charts();
  assert.match(c.dayTime([]), /No data/);
  const series = [
    { day: '2026-07-01', mins: 12, met: true },
    { day: '2026-07-02', mins: 3, met: false },
    { day: '2026-07-03', mins: 0, met: false },
    { day: '2026-07-04', mins: 20, met: true }   // today (last)
  ];
  const svg = c.dayTime(series, { goal: 15 });
  assert.match(svg, /^<svg/);
  assert.equal((svg.match(/<rect/g) || []).length, 4, 'one bar per day');
  assert.match(svg, /stroke-dasharray/, 'goal line drawn');
  assert.match(svg, /goal 15m/);
  assert.match(svg, /07-01/); assert.match(svg, /07-04/);   // first + last day labels
});

test('dayTime: no goal line when goal is 0', () => {
  const c = charts();
  const svg = c.dayTime([{ day: '2026-07-04', mins: 5, met: false }], { goal: 0 });
  assert.doesNotMatch(svg, /stroke-dasharray/);
});

// engagedSeconds: reconstruct real working time from timestamps — gaps between
// drills count as practice (drawing/guessing/reading), long gaps are breaks
test('engagedSeconds: sums within-session gaps, ignores long breaks', () => {
  const s = freshEnv(['js/stats.js']).A.stats;
  const t0 = 1000000000000;   // fixed base (no Date.now in tests)
  const at = (sec, extra) => Object.assign({ day: 'D', ts: t0 + sec * 1000, studySec: 4, drawSec: 8 }, extra);
  // 4 drills ~40s apart in one sitting, then a 20-min break, then 2 more
  const a = [at(0), at(40), at(85), at(130), at(130 + 1200), at(130 + 1240)];
  const eng = s.engagedSeconds(a, 'D');
  // first drill (12s focused) + 40 + 45 + 45 + [break→12s focused] + 40 = 194
  assert.ok(Math.abs(eng - 194) < 1, 'engaged ' + eng);
  // vs focused-only would be 6 × 12 = 72s — engaged is meaningfully higher
  assert.ok(eng > 72 * 1.5, 'engaged exceeds focused-only');
  assert.equal(s.engagedSeconds([], 'D'), 0);
  assert.equal(s.engagedSeconds(a, 'OTHER'), 0);
});
