/* ============================================================================
   curriculum.js  —  exercise catalogue, adaptive difficulty, habit/streak
   ----------------------------------------------------------------------------
   Eight exercises mapped onto the Lecoq → Bargue progression. Four are
   procedurally generated and objectively scored; four use reference images and
   are self-assessed (no ground truth). Difficulty adapts per Rousar: as your
   rolling accuracy rises, the study glance shortens and complexity increases.
   Exposed as window.A.curr and window.A.habit
   ========================================================================== */
(function (A) {
  'use strict';

  // study seconds as a function of level (the glance shrinks as you improve)
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const EXERCISES = [
    { key: 'line', name: 'Lines & Angles', module: 1, scored: true,
      blurb: 'Reproduce one line’s exact angle and length from memory.',
      study: (l) => clamp(Math.round(8 - l * 0.8), 2, 8), maxLevel: 9 },
    { key: 'angles', name: 'Angle Relationships', module: 1, scored: true,
      blurb: 'Two or three lines from a shared vertex — judge the relative angles.',
      study: (l) => clamp(Math.round(13 - l), 3, 13), maxLevel: 9 },
    { key: 'polygon', name: 'Polygons', module: 2, scored: true,
      blurb: 'Closed straight-sided shapes, triangles to asymmetric n-gons.',
      study: (l) => clamp(Math.round(18 - l * 1.2), 4, 18), maxLevel: 9 },
    { key: 'envelope', name: 'Complex Envelopes', module: 3, scored: true,
      blurb: 'Organic blobs blocked in with straight lines — the envelope method.',
      study: (l) => clamp(Math.round(26 - l * 1.6), 6, 26), maxLevel: 9 },
    { key: 'contour', name: 'Contour (Edges)', module: 4, scored: false, refCat: 'any',
      blurb: 'Trace one edge slowly from memory — eyes on the form, building edge-perception.',
      study: () => 40, maxLevel: 1 },
    { key: 'negative', name: 'Negative Space', module: 4, scored: false, refCat: 'bargue',
      blurb: 'Memorise and draw only the empty shapes between forms.',
      study: () => 45, maxLevel: 1 },
    { key: 'bargue', name: 'Bargue Block-In', module: 4, scored: false, refCat: 'bargue',
      blurb: 'Study a plate’s block-in, draw the envelope from memory, then ghost it back.',
      study: () => 45, maxLevel: 1 },
    { key: 'value', name: 'Value / Terminator', module: 4, scored: false, refCat: 'any',
      blurb: 'The lit-egg drill: memorise the shadow line, then draw it from memory.',
      study: () => 60, maxLevel: 1 },
    { key: 'master', name: 'Master Copy', module: 4, scored: false, refCat: 'any',
      blurb: 'Lecoq’s Louvre exercise — study a whole image, draw it from memory.',
      study: () => 90, maxLevel: 1 }
  ];
  const BY_KEY = {};
  EXERCISES.forEach((e) => (BY_KEY[e.key] = e));

  const ADVANCE = 85, REGRESS = 45, WINDOW = 5;

  const curr = {
    EXERCISES,
    def: (k) => BY_KEY[k],
    modules: [
      { n: 1, name: 'Lines & Angles', note: 'Length and angle — the foundation of all measurement.' },
      { n: 2, name: 'Polygons', note: 'Closed shapes and internal proportion.' },
      { n: 3, name: 'Envelopes', note: 'Organic form blocked in with straight lines.' },
      { n: 4, name: 'Real Subjects', note: 'Negative space, Bargue plates, value, master copies.' }
    ],

    _state() { return A.store.get('curriculum', {}); },
    _save(s) { A.store.set('curriculum', s); },

    level(key) {
      const s = this._state();
      return (s[key] && s[key].level) || 1;
    },
    window(key) {
      const s = this._state();
      return (s[key] && s[key].window) || [];
    },
    studySeconds(key) {
      const d = BY_KEY[key];
      return d ? d.study(this.level(key)) : 30;
    },

    // record a scored attempt → maybe advance/regress level. Returns {changed,dir,level}.
    recordScore(key, score) {
      const d = BY_KEY[key];
      if (!d || !d.scored) return { changed: false, level: this.level(key) };
      const s = this._state();
      const st = s[key] || (s[key] = { level: 1, window: [] });
      st.window.push(score);
      if (st.window.length > WINDOW) st.window.shift();
      let changed = false, dir = 0;
      if (st.window.length >= WINDOW) {
        const mean = st.window.reduce((a, b) => a + b, 0) / st.window.length;
        const weakest = Math.min.apply(null, st.window);
        // smooth over-promotion: need a strong mean AND no weak drill in the window,
        // so a couple of lucky (or unlimited-look) highs can't vault you to the
        // enforced countdown before you're consistent.
        if (mean >= ADVANCE && weakest >= 70 && st.level < d.maxLevel) { st.level++; st.window = []; changed = true; dir = 1; }
        else if (mean <= REGRESS && st.level > 1) { st.level--; st.window = []; changed = true; dir = -1; }
      }
      this._save(s);
      return { changed, dir, level: st.level };
    }
  };

  /* ---- habit / streak ----------------------------------------------------*/
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayOffset(off) {
    const d = new Date(); d.setDate(d.getDate() + off);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  const habit = {
    today,
    data() { return A.store.get('habit', { days: {}, goalMin: 15 }); },
    save(d) { A.store.set('habit', d); },
    goalMin() { return this.data().goalMin; },
    setGoal(min) { const d = this.data(); d.goalMin = min; this.save(d); },

    // add an attempt's time to today's tally
    touch(seconds) {
      const d = this.data();
      const k = today();
      const day = d.days[k] || (d.days[k] = { count: 0, secs: 0 });
      day.count++; day.secs += seconds || 0;
      this.save(d);
    },
    todayMinutes() {
      const d = this.data();
      const day = d.days[today()];
      return day ? day.secs / 60 : 0;
    },
    todayCount() {
      const d = this.data();
      const day = d.days[today()];
      return day ? day.count : 0;
    },
    metGoalOn(dayKey) {
      const d = this.data();
      const day = d.days[dayKey];
      return day && (day.secs / 60) >= d.goalMin;
    },
    // consecutive days up to today meeting the goal
    streak() {
      let n = 0;
      for (let i = 0; ; i++) {
        if (this.metGoalOn(dayOffset(-i))) n++;
        else if (i === 0) continue;       // today not yet met → keep counting prior days
        else break;
      }
      return n;
    },
    // last n days as [{day, secs, count, met}]
    calendar(n) {
      const out = [];
      for (let i = n - 1; i >= 0; i--) {
        const k = dayOffset(-i);
        const day = this.data().days[k] || { count: 0, secs: 0 };
        out.push({ day: k, secs: day.secs, count: day.count, met: (day.secs / 60) >= this.goalMin() });
      }
      return out;
    }
  };

  A.curr = curr;
  A.habit = habit;
})(window.A = window.A || {});
