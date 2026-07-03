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

  // Two timings per drill, both research-based:
  //  • study(level) — the ENCODING glance. Brief and shrinking with skill (Rousar;
  //    constrained-retrieval desirable difficulty). Longer for more complex stimuli.
  //  • draw         — the RECALL budget. Visual working memory decays over ~10–30 s
  //    without rehearsal, so you should commit the marks before the trace fades
  //    (then refresh with a capped Glance, not a stare). It is a SOFT target — the
  //    UI nudges past it but never cuts you off, because classical execution is
  //    unhurried. Scaled to how much there is to lay down. Reference (Module 4)
  //    copies are deliberately slow careful studies → no draw budget (null).
  const EXERCISES = [
    { key: 'line', name: 'Lines & Angles', module: 1, scored: true,
      blurb: 'Reproduce one line’s exact angle and length from memory.',
      study: (l) => clamp(Math.round(8 - l * 0.8), 2, 8), draw: 12, maxLevel: 9 },
    { key: 'angles', name: 'Angle Relationships', module: 1, scored: true,
      blurb: 'Two or three lines from a shared vertex — judge the relative angles.',
      study: (l) => clamp(Math.round(13 - l), 3, 13), draw: 18, maxLevel: 9 },
    { key: 'curve', name: 'Curves', module: 1, scored: true,
      blurb: 'Reproduce a curve from memory — fix its start, end and apex (its furthest bow).',
      study: (l) => clamp(Math.round(12 - l), 3, 12), draw: 18, maxLevel: 9 },
    { key: 'polygon', name: 'Polygons', module: 2, scored: true,
      blurb: 'Closed straight-sided shapes, triangles to asymmetric n-gons.',
      study: (l) => clamp(Math.round(18 - l * 1.2), 4, 18), draw: 30, maxLevel: 9 },
    { key: 'envelope', name: 'Complex Envelopes', module: 3, scored: true,
      blurb: 'Real organic forms: block the outer envelope in straight lines, then refine to the true contour.',
      study: (l) => clamp(Math.round(26 - l * 1.6), 6, 26), draw: 45, maxLevel: 9 },
    { key: 'contour', name: 'Contour (Edges)', module: 4, scored: false, refCat: 'any',
      blurb: 'Trace one edge slowly from memory — eyes on the form, building edge-perception.',
      study: () => 40, draw: null, maxLevel: 1 },
    { key: 'negative', name: 'Negative Space', module: 4, scored: false, refCat: 'bargue',
      blurb: 'Memorise and draw only the empty shapes between forms.',
      study: () => 45, draw: null, maxLevel: 1 },
    { key: 'bargue', name: 'Bargue Block-In', module: 4, scored: false, refCat: 'bargue',
      blurb: 'Study a plate’s block-in, draw the envelope from memory, then ghost it back.',
      study: () => 45, draw: null, maxLevel: 1 },
    { key: 'value', name: 'Value / Terminator', module: 4, scored: false, refCat: 'any',
      blurb: 'The lit-egg drill: memorise the shadow line, then draw it from memory.',
      study: () => 60, draw: null, maxLevel: 1 },
    { key: 'master', name: 'Master Copy', module: 4, scored: false, refCat: 'any',
      blurb: 'Lecoq’s Louvre exercise — study a whole image, draw it from memory.',
      study: () => 90, draw: null, maxLevel: 1 }
  ];
  const BY_KEY = {};
  EXERCISES.forEach((e) => (BY_KEY[e.key] = e));

  const ADVANCE = 85, REGRESS = 45, WINDOW = 5;

  const curr = {
    EXERCISES,
    def: (k) => BY_KEY[k],
    modules: [
      { n: 1, name: 'Lines, Angles & Curves', note: 'Length, angle and the bow of a curve — the foundation of all measurement.' },
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
    // Evidence-based gate: advance only when the window averages ≥85% (the "85% Rule"
    // optimal-learning sweet spot; Bloom mastery ≈80%) with no weak drill, AND it is
    // SUSTAINED across ≥2 separate days — for retention (overlearning) and to avoid
    // promoting on a single warm-up-inflated session.
    recordScore(key, score, day) {
      const d = BY_KEY[key];
      if (!d || !d.scored) return { changed: false, level: this.level(key) };
      const s = this._state();
      const st = s[key] || (s[key] = { level: 1, window: [] });
      st.window.push({ s: score, d: day || '' });
      if (st.window.length > WINDOW) st.window.shift();
      const scoreOf = (w) => (typeof w === 'object' && w ? w.s : w);   // tolerate old numeric entries
      let changed = false, dir = 0;
      if (st.window.length >= WINDOW) {
        const xs = st.window.map(scoreOf);
        const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
        const weakest = Math.min.apply(null, xs);
        const days = new Set(st.window.map((w) => (typeof w === 'object' && w ? w.d : '')).filter(Boolean)).size;
        if (mean >= ADVANCE && weakest >= 70 && days >= 2 && st.level < d.maxLevel) { st.level++; st.window = []; changed = true; dir = 1; }
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
