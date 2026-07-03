/* ============================================================================
   gamify.js  —  mastery progression, achievements, personal bests
   ----------------------------------------------------------------------------
   Deliberately rewards CONSISTENCY, MASTERY and SELF-AWARENESS — never speed or
   volume — so the game layer reinforces good practice instead of gaming it.
   No leaderboards (solo practice). Exposed as window.A.game
   ========================================================================== */
(function (A) {
  'use strict';
  const LADDER = ['line', 'angles', 'curve', 'polygon', 'envelope'];   // classical order incl. curves

  // ---- mastery & rank (driven by skill levels, not drill count) ----
  function masteryPoints() {
    let p = 0;
    LADDER.forEach((k) => { p += A.curr.level(k); });
    const pl = A.store.get('percLevel', { angle: 1, prop: 1 });
    p += (pl.angle || 1) + (pl.prop || 1);
    return p;   // min 6 (all level 1)
  }
  const RANKS = [
    { name: 'Novice', at: 0 }, { name: 'Apprentice', at: 10 },
    { name: 'Journeyman', at: 16 }, { name: 'Draughtsman', at: 24 }, { name: 'Master', at: 34 }
  ];
  function rank() {
    const p = masteryPoints(); let cur = RANKS[0], next = null;
    for (let i = 0; i < RANKS.length; i++) { if (p >= RANKS[i].at) { cur = RANKS[i]; next = RANKS[i + 1] || null; } }
    const prog = next ? (p - cur.at) / (next.at - cur.at) : 1;
    return { name: cur.name, index: RANKS.indexOf(cur), total: RANKS.length, points: p, next: next ? next.name : null, nextAt: next ? next.at : null, progress: Math.max(0, Math.min(1, prog)) };
  }

  // ---- achievements (each tied to a real, desirable behaviour) ----
  const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const ACH = [
    { id: 'first90', icon: '◆', name: 'First 90', desc: 'Score 90+ on any drill', test: (c) => c.attempts.some((a) => a.scored && a.score >= 90) },
    { id: 'steady7', icon: '✦', name: 'Steady hand', desc: '7-day practice streak', test: (c) => c.streak >= 7 },
    { id: 'century', icon: '⊛', name: 'Century', desc: '100 drills completed', test: (c) => c.attempts.length >= 100 },
    { id: 'calib', icon: '👁', name: 'Calibrated eye', desc: 'Self-estimate within 5% over 10 drills', test: (c) => { const f = c.attempts.filter((a) => a.estErr != null).slice(-10); return f.length >= 10 && mean(f.map((a) => a.estErr)) <= 5; } },
    { id: 'level', icon: '∠', name: 'Dead level', desc: 'Angle bias under 1° over 20 lines', test: (c) => { const f = c.attempts.filter((a) => a.type === 'line' && a.metrics && a.metrics.angleErrDeg != null).slice(-20); return f.length >= 20 && Math.abs(mean(f.map((a) => a.metrics.angleErrDeg))) < 1; } },
    { id: 'prop', icon: '▱', name: 'True proportion', desc: 'Proportion bias under 3% over 20 shapes', test: (c) => { const f = c.attempts.filter((a) => (a.type === 'polygon' || a.type === 'envelope') && a.metrics && a.metrics.aspectErrPct != null).slice(-20); return f.length >= 20 && Math.abs(mean(f.map((a) => a.metrics.aspectErrPct))) < 3; } },
    { id: 'quick', icon: '⚡', name: 'Quick study', desc: 'Score 85+ on a line with a ≤2s glance', test: (c) => c.attempts.some((a) => a.type === 'line' && a.score >= 85 && a.studySec <= 2) },
    { id: 'envM', icon: '⬡', name: 'Envelope master', desc: 'Reach level 5 in Envelopes', test: () => A.curr.level('envelope') >= 5 },
    { id: 'blockin', icon: '▦', name: 'Block-in', desc: 'Complete 5 Bargue block-ins', test: (c) => c.attempts.filter((a) => a.type === 'bargue').length >= 5 },
    { id: 'fromMem', icon: '☼', name: 'From memory', desc: 'Complete a Master Copy', test: (c) => c.attempts.some((a) => a.type === 'master') }
  ];

  // returns {now:[newly earned defs], earned:{id:ts}, all:ACH}
  function check(attempts) {
    const ctx = { attempts: attempts || [], streak: A.habit.streak() };
    const earned = A.store.get('ach', {});
    const now = [];
    for (const a of ACH) { try { if (a.test(ctx) && !earned[a.id]) { earned[a.id] = Date.now(); now.push(a); } } catch (e) {} }
    if (now.length) A.store.set('ach', earned);
    return { now, earned, all: ACH };
  }

  // ---- personal bests ----
  function personalBest(exKey, score) {
    const pb = A.store.get('pb', {}); const prev = pb[exKey] || 0;
    if (score > prev) { pb[exKey] = score; A.store.set('pb', pb); return { isNew: prev > 0, best: score }; }
    return { isNew: false, best: prev };
  }

  // ---- best streak (motivating, low-risk) ----
  function noteStreak() {
    const s = A.habit.streak(); const best = A.store.get('bestStreak', 0);
    if (s > best) A.store.set('bestStreak', s);
    return { current: s, best: Math.max(s, best) };
  }
  // rank-up detection — celebrate only a genuine INCREASE (ranks can regress if
  // levels drop, and we shouldn't toast "Rank up" for that or on first-ever load)
  function rankUp() {
    const r = rank(); const last = A.store.get('lastRank', null);
    if (last === r.name) return null;
    const idx = (n) => RANKS.findIndex((x) => x.name === n);
    const increased = last && idx(r.name) > idx(last);
    A.store.set('lastRank', r.name);
    return increased ? r.name : null;
  }

  // ---- daily challenge (rotates by date) ----
  function todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dailyChallenge() {
    const pool = LADDER; const d = new Date();
    const idx = (d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()) % pool.length;
    return { day: todayStr(), exKey: pool[idx], target: 3 };
  }
  function dailyProgress(attempts, dc) {
    const n = (attempts || []).filter((a) => a.day === dc.day && a.type === dc.exKey).length;
    return { n, done: Math.min(n, dc.target), complete: n >= dc.target };
  }
  // mark today's challenge complete once (for the toast + a running count)
  function markDailyDoneOnce(dc) {
    const st = A.store.get('dailyDone', {}); if (st.day === dc.day) return false;
    st.day = dc.day; A.store.set('dailyDone', st);
    A.store.set('dailyCount', (A.store.get('dailyCount', 0) || 0) + 1);
    return true;
  }

  // ---- weekly recap ----
  function weeklyRecap(attempts) {
    const now = Date.now(), DAY = 864e5;
    const wk = (attempts || []).filter((a) => now - a.ts < 7 * DAY);
    if (!wk.length) return null;
    const prev = attempts.filter((a) => now - a.ts >= 7 * DAY && now - a.ts < 14 * DAY);
    const avg = (arr) => arr.length ? Math.round(arr.reduce((s, a) => s + a.score, 0) / arr.length) : 0;
    const m = avg(wk);
    return { days: new Set(wk.map((a) => a.day)).size, drills: wk.length, mean: m, delta: prev.length ? m - avg(prev) : null };
  }

  // ---- star tier for the skill map (level 1..maxLevel → 1..5 stars) ----
  function starTier(level) { return Math.max(1, Math.min(5, Math.ceil(level / 2))); }

  // ---- the single recommended next action ----
  // Science: warm-up decrement — a brief perceptual warm-up reinstates seeing after a
  // rest, and the effect decays ~30 min, so we re-suggest it after ~40 min idle (incl.
  // a new bout hours later, or a new day). Then walk the classical ladder (Lines →
  // Angles → Polygons → Envelopes) to a "solid" level before interleaving.
  const GRAD = 3;            // "solid enough to move on" level
  const WARM_MS = 40 * 60 * 1000;
  function recommend(attempts) {
    const now = Date.now();
    const percTs = (attempts || []).filter((a) => a.type === 'perc-angle' || a.type === 'perc-prop').map((a) => a.ts);
    const lastPerc = percTs.length ? Math.max.apply(null, percTs) : 0;
    if (!(lastPerc && now - lastPerc < WARM_MS)) {
      return { step: 'warmup', title: 'Warm up your eye', sub: 'a short perception warm-up (~8 rounds, no drawing) to prime accurate seeing' };
    }
    const order = LADDER;
    const minLvl = Math.min.apply(null, order.map((k) => A.curr.level(k)));
    if (minLvl < GRAD) {                                  // Foundations: walk the ladder
      const pick = order.find((k) => A.curr.level(k) < GRAD) || order[0];
      return { step: 'build', exKey: pick, title: 'Practice ' + A.curr.def(pick).name, sub: 'build accuracy here (Lv ' + A.curr.level(pick) + ')' };
    }
    // Basics solid → Application: bring in the real-subject (Module 4) drills you
    // haven't tried yet, in classical order, then settle into mixed maintenance.
    const m4 = ['contour', 'negative', 'bargue', 'value', 'master'];
    const tried = new Set((attempts || []).map((a) => a.type));
    const nextM4 = m4.find((k) => !tried.has(k));
    if (nextM4) return { step: 'reference', exKey: nextM4, title: 'Try ' + A.curr.def(nextM4).name, sub: 'apply your eye to a real subject' };
    return { step: 'mixed', title: 'Mixed session', sub: 'keep it sharp — interleave drills, revisit the plates' };
  }

  A.game = { masteryPoints, rank, check, ACH, personalBest, noteStreak, rankUp,
             dailyChallenge, dailyProgress, markDailyDoneOnce, weeklyRecap, starTier, recommend,
             rankNames: RANKS.map((r) => r.name) };
})(window.A = window.A || {});
