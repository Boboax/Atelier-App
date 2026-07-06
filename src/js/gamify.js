/* ============================================================================
   gamify.js  —  mastery progression, achievements, personal bests
   ----------------------------------------------------------------------------
   Deliberately rewards CONSISTENCY, MASTERY and SELF-AWARENESS — never speed or
   volume — so the game layer reinforces good practice instead of gaming it.
   No leaderboards (solo practice). Exposed as window.A.game
   ========================================================================== */
(function (A) {
  'use strict';
  // The scored-drill ladder is DERIVED from the curriculum (call-time), so a
  // newly added scored drill can never be silently left out of mastery points,
  // weakest-drill targeting or spaced review again (it happened twice: curve,
  // then gesture).
  const LADDER = () => A.curr.EXERCISES.filter((e) => e.scored).map((e) => e.key);

  // ---- mastery & rank (driven by skill levels + passed plates, never volume) ----
  function masteryPoints() {
    let p = 0;
    LADDER().forEach((k) => { p += A.curr.level(k); });
    const pl = A.store.get('percLevel', { angle: 1, prop: 1 });
    ['angle', 'prop', 'curve', 'value'].forEach((k) => { p += (pl[k] || 1); });
    p += platesPassed();   // application layer counts too (max +4)
    return p;              // floor 11 (all level 1), ceiling ~99
  }
  // Thresholds sit against the point FLOOR (every track starts at level 1:
  // 7 drills + 4 perception kinds = 11 points) and the ~99 ceiling. Master ≈
  // every track around level 5-6 — the same standard as before the curriculum grew.
  const RANKS = [
    { name: 'Novice', at: 0 }, { name: 'Apprentice', at: 15 },
    { name: 'Journeyman', at: 27 }, { name: 'Draughtsman', at: 40 }, { name: 'Master', at: 56 }
  ];
  function rank() {
    const p = masteryPoints(); let cur = RANKS[0], next = null;
    for (let i = 0; i < RANKS.length; i++) { if (p >= RANKS[i].at) { cur = RANKS[i]; next = RANKS[i + 1] || null; } }
    const prog = next ? (p - cur.at) / (next.at - cur.at) : 1;
    return { name: cur.name, index: RANKS.indexOf(cur), total: RANKS.length, points: p, next: next ? next.name : null, nextAt: next ? next.at : null, progress: Math.max(0, Math.min(1, prog)) };
  }

  // ---- achievements v2 -------------------------------------------------------
  // Tiered and long-horizon (weeks → a year), all still rewarding ONLY
  // consistency, mastery, application and self-awareness — never volume or
  // speed. Locked badges are visible (a goal horizon), regression is never
  // badged, and the one "come back" badge rewards recovery, not guilt.
  const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const lvl = (k) => A.curr.level(k);
  const allLv = (n) => LADDER().every((k) => lvl(k) >= n);
  const anyLv = (n) => LADDER().some((k) => lvl(k) >= n);
  const percLv = () => A.store.get('percLevel', { angle: 1, prop: 1 });
  // Monday-aligned week index of a 'YYYY-MM-DD' key (alignment consistency is
  // what matters, not calendar correctness)
  const weekIdx = (day) => { const p = day.split('-'); return Math.floor((Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5 - 4) / 7); };
  const ACH = [
    // consistency
    { id: 'steady7', icon: '✦', name: 'Steady hand', desc: '7-day practice streak', test: (c) => c.streak >= 7 },
    { id: 'steady30', icon: '✦✦', name: 'Month of mornings', desc: '30-day practice streak', test: (c) => c.streak >= 30 },
    { id: 'steady100', icon: '✦✦✦', name: 'The hundred days', desc: '100-day practice streak', test: (c) => c.streak >= 100 },
    { id: 'returner', icon: '↩', name: 'The return', desc: 'Come back after 2+ weeks away', test: (c) => {
      const days = c.uniqueDays;
      for (let i = 1; i < days.length; i++) { if ((Date.parse(days[i]) - Date.parse(days[i - 1])) / 864e5 >= 14) return true; }
      return false; } },
    { id: 'rhythm4', icon: '◴', name: 'Weekly rhythm', desc: '4+ practice days a week, 4 weeks running', test: (c) => {
      const perWeek = {};
      c.uniqueDays.forEach((d) => { const w = weekIdx(d); perWeek[w] = (perWeek[w] || 0) + 1; });
      const good = Object.keys(perWeek).map(Number).filter((w) => perWeek[w] >= 4).sort((a, b) => a - b);
      let run = 1;
      for (let i = 1; i < good.length; i++) {
        run = (good[i] === good[i - 1] + 1) ? run + 1 : 1;
        if (run >= 4) return true;
      }
      return false; } },
    // mastery
    { id: 'first90', icon: '◆', name: 'First 90', desc: 'Score 90+ on any drill', test: (c) => c.attempts.some((a) => a.scored && a.score >= 90) },
    { id: 'anyLv5', icon: '◈', name: 'Journeyman’s mark', desc: 'Reach level 5 in any drill', test: () => anyLv(5) },
    { id: 'allLv5', icon: '⬗', name: 'Solid foundations', desc: 'Every drill at level 5+', test: () => allLv(5) },
    { id: 'anyLv9', icon: '❖', name: 'Master’s mark', desc: 'Reach level 9 in any drill', test: () => anyLv(9) },
    { id: 'allLv9', icon: '✥', name: 'The full ladder', desc: 'Every drill at level 9', test: () => allLv(9) },
    { id: 'sharpEye1', icon: '◉', name: 'Sharp eye', desc: 'Both perception drills at level 4+', test: () => { const p = percLv(); return (p.angle || 1) >= 4 && (p.prop || 1) >= 4; } },
    { id: 'sharpEye2', icon: '◎', name: 'Surgeon’s eye', desc: 'Both perception drills at level 8', test: () => { const p = percLv(); return (p.angle || 1) >= 8 && (p.prop || 1) >= 8; } },
    { id: 'quick', icon: '⚡', name: 'Quick study', desc: 'Score 85+ on a line with a ≤2s glance', test: (c) => c.attempts.some((a) => a.type === 'line' && a.score >= 85 && a.studySec <= 2) },
    // application
    { id: 'plate1', icon: '▤', name: 'First plate', desc: 'Pass a Bargue plate (85+ best)', test: () => platesPassed() >= 1 },
    { id: 'plateCourse', icon: '▥', name: 'The Bargue course', desc: 'Pass all four plates (85+)', test: () => platesPassed() >= 4 },
    { id: 'blockin', icon: '▦', name: 'Block-in', desc: 'Complete 5 Bargue block-ins', test: (c) => c.attempts.filter((a) => a.type === 'bargue').length >= 5 },
    { id: 'fromMem', icon: '☼', name: 'From memory', desc: 'Complete a Master Copy', test: (c) => c.attempts.some((a) => a.type === 'master') },
    { id: 'louvre10', icon: '🏛', name: 'Louvre habit', desc: 'Complete 10 master copies', test: (c) => c.attempts.filter((a) => a.type === 'master').length >= 10 },
    // retention & self-awareness
    { id: 'overnight10', icon: '☾', name: 'Overnight eye', desc: 'Complete 10 retention checks', test: (c) => c.recalls.length >= 10 },
    { id: 'overnight50', icon: '☽', name: 'Iron memory', desc: 'Complete 50 retention checks', test: (c) => c.recalls.length >= 50 },
    { id: 'coldRecall', icon: '❄', name: 'Cold recall', desc: 'Score 80+ on a retention check', test: (c) => c.recalls.some((a) => a.score >= 80) },
    { id: 'calib', icon: '👁', name: 'Calibrated eye', desc: 'Self-estimate within 5% over 10 drills', test: (c) => { const f = c.attempts.filter((a) => a.estErr != null).slice(-10); return f.length >= 10 && mean(f.map((a) => a.estErr)) <= 5; } },
    { id: 'calib2', icon: '🪞', name: 'The honest mirror', desc: 'Self-estimate within 5% over 25 drills', test: (c) => { const f = c.attempts.filter((a) => a.estErr != null).slice(-25); return f.length >= 25 && mean(f.map((a) => a.estErr)) <= 5; } },
    { id: 'level', icon: '∠', name: 'Dead level', desc: 'Angle bias under 1° over 20 lines', test: (c) => { const f = c.attempts.filter((a) => a.type === 'line' && a.metrics && a.metrics.angleErrDeg != null).slice(-20); return f.length >= 20 && Math.abs(mean(f.map((a) => a.metrics.angleErrDeg))) < 1; } },
    { id: 'prop', icon: '▱', name: 'True proportion', desc: 'Proportion bias under 3% over 20 shapes', test: (c) => { const f = c.attempts.filter((a) => (a.type === 'polygon' || a.type === 'envelope') && a.metrics && a.metrics.aspectErrPct != null).slice(-20); return f.length >= 20 && Math.abs(mean(f.map((a) => a.metrics.aspectErrPct))) < 3; } },
    { id: 'honestHand', icon: '✋', name: 'Honest hand', desc: '50 first-look figures at level 6+ with zero glances', test: (c) => c.attempts.filter((a) => a.scored && !a.recall && a.level >= 6 && !a.glances).length >= 50 },
    // the honorary terminal — depth, not points
    { id: 'masterAtelier', icon: '♛', name: 'Master of the Atelier', desc: 'All drills level 7+, the plate course passed, and a 30-day streak', test: (c) => LADDER().every((k) => lvl(k) >= 7) && platesPassed() >= 4 && c.bestStreak >= 30 }
  ];

  // returns {now:[newly earned defs], earned:{id:ts}, all:ACH}
  function check(attempts) {
    // repeats (redraws of a seen answer) don't count toward achievements
    const atts = (attempts || []).filter((a) => !a.repeat);
    const ctx = {
      attempts: atts,
      recalls: atts.filter((a) => a.recall),
      uniqueDays: Array.from(new Set(atts.map((a) => a.day).filter(Boolean))).sort(),
      streak: A.habit.streak(),
      bestStreak: A.store.get('bestStreak', 0)
    };
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

  // ---- weakest scored drill by recent accuracy (genuine memory trials only) ----
  function weakestDrill(attempts, minN) {
    minN = minN || 3;
    let worst = null, worstMean = Infinity;
    for (const k of LADDER()) {
      const xs = (attempts || []).filter((a) => a.type === k && a.scored && !a.repeat && !a.recall)
                                 .slice(-5).map((a) => a.score);
      if (xs.length < minN) continue;
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      if (m < worstMean) { worstMean = m; worst = k; }
    }
    return worst ? { exKey: worst, mean: Math.round(worstMean) } : null;
  }

  // the 4 AM-rollover practice day — single source of truth in A.util (storage.js)
  function todayStr() { return A.util.dayKey(); }

  /* ---- today's plan --------------------------------------------------------
     The daily ritual the recommendation engine already encodes, surfaced as
     check-off-able segments: warm-up → focus work → retention check. The plan
     DESCRIBES the day (any qualifying practice ticks a segment) rather than
     prescribing it — autonomy-supportive, per OPTIMAL theory. Completing the
     plan (not raw minutes) is what feeds the streak in 'plan' goal mode.     */
  // all perception-drill attempt types (adjustment + forced-choice) count as warm-up
  const PERC_TYPES = ['perc-angle', 'perc-prop', 'perc-curve', 'perc-value', 'afc-angle', 'afc-length', 'afc-curve', 'afc-value'];
  function planPick(attempts) {
    const today = todayStr();
    const stored = A.store.get('planPick', null);
    if (stored && stored.day === today && A.curr.def(stored.exKey)) return stored.exKey;
    // priority: due for spaced review > weakest > ladder walk
    const due = A.curr.dueDrills(today).filter((d) => LADDER().indexOf(d.key) >= 0);
    let pick = due.length ? due[0].key : null;
    if (!pick) { const w = weakestDrill(attempts); pick = w && w.exKey; }
    if (!pick) pick = LADDER().find((k) => A.curr.level(k) < 3) || LADDER()[0];
    A.store.set('planPick', { day: today, exKey: pick });
    return pick;
  }
  function dailyPlan(attempts) {
    const today = todayStr();
    const atts = (attempts || []).filter((a) => a.day === today);
    const warmN = atts.filter((a) => PERC_TYPES.indexOf(a.type) >= 0).length;
    const focusN = atts.filter((a) => a.scored && !a.repeat && !a.recall && PERC_TYPES.indexOf(a.type) < 0).length;
    const recallDone = atts.some((a) => a.recall);
    const hasRecallMaterial = (attempts || []).some((a) =>
      a.scored && !a.repeat && !a.recall && a.day && a.day < today && a.target && PERC_TYPES.indexOf(a.type) < 0);
    const pick = planPick(attempts);
    const pickDef = A.curr.def(pick);
    const segments = [
      { key: 'warm', label: 'Warm up the eye', sub: 'judge angles & proportions, no drawing',
        done: warmN >= 6, n: Math.min(warmN, 6), target: 6, step: 'warmup' },
      { key: 'focus', label: 'Focus work', sub: (pickDef ? pickDef.name : pick) + ' — or any 5 figures',
        done: focusN >= 5, n: Math.min(focusN, 5), target: 5, step: 'build', exKey: pick }
    ];
    if (hasRecallMaterial) {
      segments.push({ key: 'recall', label: 'Retention check', sub: 'redraw a previous figure, cold',
        done: recallDone, n: recallDone ? 1 : 0, target: 1, step: 'recall' });
    }
    const doneCount = segments.filter((s) => s.done).length;
    return { day: today, segments, doneCount, complete: doneCount === segments.length };
  }

  /* ---- Bargue plate course tracking ----------------------------------------
     PLATES is the course order (by plate number); a plate is PASSED at >=85
     best. Passed plates add mastery points, so the application layer finally
     moves the rank needle.                                                   */
  const PLATES = ['bargue-feet', 'bargue-foot', 'bargue-hand', 'bargue-head'];
  const PLATE_PASS = 85;
  function notePlate(refId, score) {
    if (PLATES.indexOf(refId) < 0 || score == null) return;
    const pb = A.store.get('platesBest', {});
    if ((pb[refId] || 0) < score) { pb[refId] = score; A.store.set('platesBest', pb); }
  }
  function platesPassed() {
    const pb = A.store.get('platesBest', {});
    return PLATES.filter((id) => (pb[id] || 0) >= PLATE_PASS).length;
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
    const today = todayStr();
    const percTs = (attempts || []).filter((a) => PERC_TYPES.indexOf(a.type) >= 0).map((a) => a.ts);
    const lastPerc = percTs.length ? Math.max.apply(null, percTs) : 0;
    if (!(lastPerc && now - lastPerc < WARM_MS)) {
      return { step: 'warmup', title: 'Warm up your eye', sub: 'a short perception warm-up (~8 rounds, no drawing) to prime accurate seeing' };
    }
    // Retention check (Lecoq's real test): once per day, redraw a figure you
    // studied on a PREVIOUS day — cold, no study. Retrieval after a night's
    // sleep is the strongest memory exercise in the app.
    const doneRecallToday = (attempts || []).some((a) => a.recall && a.day === today);
    const oldScored = (attempts || []).filter((a) => a.scored && !a.repeat && !a.recall && a.day && a.day < today && a.target);
    if (!doneRecallToday && oldScored.length) {
      return { step: 'recall', title: 'Retention check', sub: 'redraw a figure from a previous day — cold, from memory alone' };
    }
    const order = LADDER();
    const minLvl = Math.min.apply(null, order.map((k) => A.curr.level(k)));
    if (minLvl < GRAD) {                                  // Foundations: walk the ladder
      const pick = order.find((k) => A.curr.level(k) < GRAD) || order[0];
      return { step: 'build', exKey: pick, title: 'Practice ' + A.curr.def(pick).name, sub: 'build accuracy here (Lv ' + A.curr.level(pick) + ')' };
    }
    // Spaced review: serve the most-overdue drill before anything new — skills
    // decay on their own schedule, and distributed retrieval is what holds them.
    const due = A.curr.dueDrills(today).filter((d) => LADDER().indexOf(d.key) >= 0);
    if (due.length) {
      const pick = due[0].key;
      const late = -due[0].due;
      return { step: 'build', exKey: pick, title: 'Review ' + A.curr.def(pick).name,
               sub: late > 0 ? ('due for review — last practised ' + late + ' day' + (late === 1 ? '' : 's') + ' past its interval') : 'due for review today (spaced practice)' };
    }
    // Basics solid → Application: bring in the real-subject (Module 4) drills you
    // haven't tried yet, in classical order, then keep the TRIED ones on the
    // spaced schedule (plates decay like everything else).
    const m4 = ['contour', 'negative', 'bargue', 'value', 'master'];
    const tried = new Set((attempts || []).map((a) => a.type));
    const nextM4 = m4.find((k) => !tried.has(k));
    if (nextM4) return { step: 'reference', exKey: nextM4, title: 'Try ' + A.curr.def(nextM4).name, sub: 'apply your eye to a real subject' };
    const dueR = A.curr.dueRefs(today);
    if (dueR.length) {
      const pick = dueR[0].key;
      return { step: 'reference', exKey: pick, title: 'Review ' + A.curr.def(pick).name, sub: 'due for review — real subjects decay too (spaced practice)' };
    }
    // Maintenance: point the mixed work at the weakest drill, not a rotation
    const w = weakestDrill(attempts);
    if (w) return { step: 'build', exKey: w.exKey, title: 'Sharpen ' + A.curr.def(w.exKey).name, sub: 'your weakest drill right now (recent mean ' + w.mean + ')' };
    return { step: 'mixed', title: 'Mixed session', sub: 'keep it sharp — interleave drills, revisit the plates' };
  }

  A.game = { masteryPoints, rank, check, ACH, personalBest, noteStreak, rankUp,
             dailyPlan, planPick, notePlate, platesPassed, PLATES, PLATE_PASS,
             weeklyRecap, starTier, recommend,
             weakestDrill, rankNames: RANKS.map((r) => r.name) };
})(window.A = window.A || {});
