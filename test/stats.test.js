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
