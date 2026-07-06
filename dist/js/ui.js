/* ============================================================================
   ui.js  —  views, routing, and the drill overlay
   ----------------------------------------------------------------------------
   Builds the shell once, then renders Home / Practice / Stats / History /
   Library / Settings into a content area, and drives the full-screen drill
   overlay against an A.Drill instance. No framework — plain DOM + templates.
   Exposed as window.A.ui
   ========================================================================== */
(function (A) {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtMin = (m) => m < 1 ? Math.round(m * 60) + 's' : m.toFixed(m < 10 ? 1 : 0) + ' min';
  const clock = (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  // guided-session shapes: count of drills + a research-based recommended length.
  // Beginners hold high-quality, focused practice for ~15–20 min before fatigue
  // erodes accuracy (deliberate practice); a warm-up is a brief ~5 min priming bout.
  // Distributed practice (several short sessions) beats one long massed sitting.
  const SESSIONS = { warmup: { n: 6, min: 5 }, mixed: { n: 12, min: 15 } };
  const PERC_LABELS = { 'perc-angle': 'Perceive: Angle', 'perc-prop': 'Perceive: Proportion',
    'perc-curve': 'Perceive: Curve', 'perc-value': 'Perceive: Value',
    'afc-angle': 'Discriminate: Angle', 'afc-length': 'Discriminate: Length' };
  const exName = (type) => { const d = A.curr.def(type); return d ? d.name : (PERC_LABELS[type] || type); };
  const LOOKCUE = {
    line: 'its slant & length', angles: 'the angles between & the relative lengths',
    curve: 'its start, end & apex — the furthest point it bows out',
    polygon: 'each corner’s position & the proportions', envelope: 'the outer envelope, then where the contour turns sharply vs flows',
    gesture: 'the line of action — the single sweep from head to foot',
    shade: 'where the light turns to shadow — the terminator\u2019s path across the form',
    contour: 'the path of the edge', negative: 'the empty shapes between the forms',
    bargue: 'the big straight block-in', value: 'where light turns to dark',
    master: 'the largest shapes & their placement'
  };

  const ui = { view: 'home' };
  let surface, drill, attemptsCache = null;
  // Bargue plate order + pass mark live in gamify (A.game.PLATES / PLATE_PASS) —
  // they feed mastery points and achievements too

  /* ---- bootstrap --------------------------------------------------------- */
  ui.init = async function () {
    document.body.innerHTML = '';
    const app = el(`<div id="app">
      <div class="topbar"><div class="brandmark" data-go="home" role="button" aria-label="Home">Atelier<span class="dot">.</span></div>
        <button class="profilechip" id="profilebtn" aria-label="Switch user"></button></div>
      <div class="view" id="view"></div>
    </div>`);
    document.body.appendChild(app);

    const nav = el(`<div class="nav">
      ${navBtn('home', ICONS.home, 'Home')}${navBtn('practice', ICONS.pencil, 'Exercises')}
      ${navBtn('stats', ICONS.chart, 'Stats')}${navBtn('history', ICONS.grid, 'History')}
      ${navBtn('more', ICONS.dots, 'More')}</div>`);
    document.body.appendChild(nav);
    nav.addEventListener('click', (e) => { const b = e.target.closest('[data-nav]'); if (b) ui.go(b.dataset.nav); });
    $('.topbar', app).addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) ui.go(b.dataset.go); });
    $('#profilebtn', app).addEventListener('click', openProfiles);
    refreshProfileChip();

    buildDrill();
    await A.library.init();
    ui.go('home');
    if (!A.store.get('onboarded', false)) showOnboarding();
  };
  function navBtn(id, ic, label) { return `<button data-nav="${id}" aria-label="${label}"><span class="ic">${ic}</span>${label}</button>`; }
  // drawn stroke icons (currentColor) — font glyphs render as emoji/tofu on some stacks
  const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    home: I('<path d="M4 11.2 12 4l8 7.2"/><path d="M6.2 9.6V20h11.6V9.6"/>'),
    pencil: I('<path d="M4 20l1.2-4.2L16.6 4.4a1.7 1.7 0 0 1 2.4 0l.6.6a1.7 1.7 0 0 1 0 2.4L8.2 18.8 4 20z"/><path d="M14.8 6.2l3 3"/>'),
    chart: I('<path d="M4 20h16"/><path d="M7 16v-5"/><path d="M12 16V7"/><path d="M17 16v-8"/>'),
    grid: I('<rect x="4.5" y="4.5" width="6" height="6" rx="1"/><rect x="13.5" y="4.5" width="6" height="6" rx="1"/><rect x="4.5" y="13.5" width="6" height="6" rx="1"/><rect x="13.5" y="13.5" width="6" height="6" rx="1"/>'),
    dots: I('<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>')
  };

  ui.go = function (view) {
    ui.view = view;
    const moreViews = ['library', 'settings', 'map'];
    $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.nav === view || (moreViews.indexOf(view) >= 0 && b.dataset.nav === 'more')));
    const v = $('#view');
    v.scrollTop = 0;
    // re-trigger the entrance fade — innerHTML swaps don't restart CSS animations
    v.style.animation = 'none'; void v.offsetWidth; v.style.animation = '';
    if (view === 'home') renderHome(v);
    else if (view === 'practice') renderPractice(v);
    else if (view === 'stats') renderStats(v);
    else if (view === 'history') renderHistory(v);
    else if (view === 'library') renderLibrary(v);
    else if (view === 'settings') renderSettings(v);
    else if (view === 'map') renderMap(v);
    else if (view === 'more') renderMore(v);
  };

  // resolve the single best next action. Priority: WARM UP THE EYE FIRST (if not done
  // in the last ~40 min — warm-up decrement) > resume an open session > science-based
  // pick. Warming up must win even over a half-finished session, or you'd draw cold.
  function recAction(all) {
    const r = A.game.recommend(all);
    const sv = savedSession();
    if (r.step === 'warmup') {
      return { step: 'warmup', exKey: '', title: r.title,
        sub: sv ? 'Prime your eye first (~8 rounds), then resume your ' + (sv.kind === 'warmup' ? 'quick session' : 'mixed session') : r.sub,
        btn: 'Warm up' };
    }
    if (sv) return { step: 'resume', exKey: '', title: 'Resume ' + (sv.kind === 'warmup' ? 'quick session' : 'mixed session'), sub: sv.completed + '/' + sv.queue.length + ' done today', btn: 'Resume' };
    const btns = { warmup: 'Warm up', mixed: 'Start', resume: 'Resume', reference: 'Try', build: 'Practice', recall: 'Test me' };
    return { step: r.step, exKey: r.exKey || '', title: r.title, sub: r.sub, btn: btns[r.step] || 'Practice' };
  }
  // slim one-line recommendation — used at the top of the Exercises menu
  // (Home surfaces the same engine as the Today's-plan checklist)
  function recLine(all) {
    const a = recAction(all);
    return `<div class="card rec slim"><div class="row between center">
      <div class="small"><span class="rec-tag">RECOMMENDED</span> <b>${esc(a.title)}</b><div class="tiny muted">${esc(a.sub)}</div></div>
      <button class="btn soft sm" data-rec="${a.step}" data-recex="${esc(a.exKey)}">${a.btn} ›</button></div></div>`;
  }
  function doRec(step, exKey) {
    if (step === 'warmup') startWarmup();
    else if (step === 'build' || step === 'reference') startExercise(exKey);
    else if (step === 'recall') startRecall();
    else if (step === 'resume') resumeSession();
    else if (step === 'mixed') { const sv = savedSession(); if (sv && sv.kind === 'mixed') resumeSession(); else startSession('mixed'); }
  }
  // rotate the warm-up across all judgement kinds, always preferring the one
  // at the lowest level (the weakest perceptual skill gets the reps)
  function startWarmup() {
    const kinds = A.Perceive.kinds;
    const pl = A.store.get('percLevel', {});
    const minLv = Math.min.apply(null, kinds.map((k) => pl[k] || 1));
    const lowest = kinds.filter((k) => (pl[k] || 1) === minLv);
    let kind;
    if (lowest.length === 1) kind = lowest[0];
    else {
      const last = A.store.get('lastWarmKind', '');
      kind = lowest[(lowest.indexOf(last) + 1) % lowest.length];   // round-robin the ties
    }
    A.store.set('lastWarmKind', kind);
    A.Perceive.start(kind);
  }

  // RETENTION CHECK: pull a scored target studied on a previous day (newest days
  // first, random within the day) and serve it cold — no study phase.
  async function startRecall() {
    const all = await attempts();
    const today = A.habit.today();
    const pool = all.filter((a) => a.scored && !a.repeat && !a.recall && a.day && a.day < today && a.target);
    if (!pool.length) { toast('No previous figures to recall yet — practise today, test tomorrow.'); return; }
    const days = Array.from(new Set(pool.map((a) => a.day))).sort().reverse().slice(0, 7);
    const day = days[Math.floor(Math.random() * Math.min(3, days.length))];   // mostly yesterday-ish
    const cand = pool.filter((a) => a.day === day);
    const att = cand[Math.floor(Math.random() * cand.length)];
    run = null; session = null;
    const d = $('#drill'); d.classList.add('on');
    surface.opts.pencilOnly = A.store.get('pencilOnly', false);
    surface.opts.baseWidth = A.store.get('inkWidth', 3.2);
    surface.opts.smooth = A.store.get('smooth', 0.5);
    setTimeout(() => { surface.resize(); drill.startRecall(att.type, att.target); }, 0);
  }

  async function attempts(force) {
    if (!attemptsCache || force) attemptsCache = await A.store.allAttempts();
    return attemptsCache;
  }
  function invalidate() { attemptsCache = null; }
  ui.invalidate = invalidate;   // other modules (perceive) record attempts too
  ui.doRec = (step, exKey) => doRec(step, exKey);   // lets perceive chain into the next step

  /* ---- profiles (multi-user on one iPad) --------------------------------- */
  function refreshProfileChip() {
    const b = $('#profilebtn'); if (!b) return;
    let n = A.store.profileName() || 'Player 1';
    if (n.length > 12) n = n.slice(0, 11) + '…';
    b.textContent = '👤 ' + n;
  }
  function switchProfile(pid) {
    A.store.setProfile(pid);
    invalidate();
    refreshProfileChip();
    ui.go(ui.view);          // re-render the current view with the new profile's data
  }
  function openProfiles() {
    const cur = A.store.profileId();
    const rows = A.store.profiles().map((p) =>
      `<button class="btn ${p.id === cur ? '' : 'ghost'} block" data-switch="${esc(p.id)}" style="margin-top:6px">${p.id === cur ? '● ' : ''}${esc(p.name)}</button>`).join('');
    const sheet = openModal(`<h2>Who’s practising?</h2>
      <p class="small muted">Each person keeps their own levels, streak, stats and history on this iPad.</p>
      ${rows}
      <button class="btn soft block" data-adduser="1" style="margin-top:10px">+ Add user</button>
      <button class="btn ghost block" data-go="settings" style="margin-top:6px">Manage users in Settings ›</button>`);
    // bind pointerup AND click (de-duped) — iOS can suppress the synthetic click on
    // freshly-shown overlays, which made these taps do nothing
    let done = false;
    const act = (e) => {
      const sw = e.target.closest('[data-switch]'), add = e.target.closest('[data-adduser]'), go = e.target.closest('[data-go]');
      if (!(sw || add || go) || done) return;
      done = true; e.preventDefault();
      if (sw) { closeModal(); if (sw.dataset.switch !== cur) switchProfile(sw.dataset.switch); }
      else if (add) { closeModal(); promptModal('Name for the new user?', '', (name) => switchProfile(A.store.addProfile(name))); }
      else if (go) { closeModal(); ui.go('settings'); }
    };
    sheet.addEventListener('pointerup', act);
    sheet.addEventListener('click', act);
  }

  function toast(msg) {
    let t = $('.toast'); if (!t) { t = el('<div class="toast"></div>'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1900);
  }

  /* ======================================================================
     HOME / TODAY
     ====================================================================== */
  // Monday-aligned week index of a 'YYYY-MM-DD' key (for the weekly report ritual)
  function weekIdxOf(day) { const p = day.split('-'); return Math.floor((Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5 - 4) / 7); }

  async function renderHome(v) {
    const allAtts = await attempts();
    A.game.noteStreak();
    const rk = A.game.rank();
    const ach = A.game.check(allAtts);
    const streak = A.habit.streak();
    const bestStreak = A.store.get('bestStreak', 0);
    const mins = A.habit.todayMinutes();
    const sv = savedSession();

    // ---- today's plan: the one decision Home must support ----
    const plan = A.game.dailyPlan(allAtts);
    const planJustDone = plan.complete && A.habit.markPlanDone(plan.day);
    const segRows = plan.segments.map((s, i) => `
      <div class="planrow ${s.done ? 'done' : ''}">
        <div class="pcheck">${s.done ? '✓' : (i + 1)}</div>
        <div class="meta"><div class="nm">${esc(s.label)}</div>
          <div class="tiny muted">${esc(s.sub)}${s.target > 1 ? ` · ${s.n}/${s.target}` : ''}</div></div>
        ${s.done ? '' : `<button class="btn ${plan.segments.findIndex((x) => !x.done) === i ? '' : 'soft'} sm" data-rec="${s.step}" data-recex="${esc(s.exKey || '')}">Start ›</button>`}
      </div>`).join('');
    const pct = plan.segments.length ? plan.doneCount / plan.segments.length : 0;
    const C = 2 * Math.PI * 34;
    const cal = A.habit.calendar(14);
    const dots = cal.map((d) => `<span class="pdot ${d.met ? 'met' : ''} ${d.day === A.habit.today() ? 'today' : ''}" title="${d.day}: ${fmtMin(d.secs / 60)}"></span>`).join('');
    const resumeRow = sv ? `<button class="btn ghost block sm" data-rec="resume" style="margin-top:8px">Resume ${sv.kind === 'warmup' ? 'quick' : 'mixed'} session · ${sv.completed}/${sv.queue.length} ›</button>` : '';
    const planCard = `<div class="card rec">
      <div class="streak-hero">
        <div class="ring"><svg width="84" height="84">
          <circle cx="42" cy="42" r="34" fill="none" stroke="var(--hair)" stroke-width="8"/>
          <circle cx="42" cy="42" r="34" fill="none" stroke="${plan.complete ? 'var(--good)' : 'var(--accent)'}" stroke-width="8"
            stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
        </svg><div class="num"><b>${plan.doneCount}/${plan.segments.length}</b><span class="tiny muted">plan</span></div></div>
        <div style="flex:1">
          <div class="row between center"><h2>Today’s plan</h2>
            <div><span class="flame">${streak > 0 ? '🔥' : '·'}</span> <b>${streak}</b> <span class="muted small">day streak${bestStreak > streak ? ` · best ${bestStreak}` : ''}</span></div></div>
          <div class="tiny muted">${plan.complete ? 'Done for today — anything more is a bonus.' : 'Study → hide → draw from memory. The plan describes the day; any real practice counts.'}</div>
        </div>
      </div>
      ${segRows}
      ${resumeRow}
      <div class="row between center" style="margin-top:10px">
        <div class="pdots">${dots}</div>
        <span class="tiny muted">${fmtMin(mins)} · ${A.habit.todayCount()} drills</span>
      </div></div>`;

    // ---- progression snapshot: the drill nearest promotion + compact levels ----
    const scored = A.curr.EXERCISES.filter((e) => e.scored);
    const snap = scored.map((e) => {
      const win = A.curr.window(e.key);
      const scores = win.map((w) => (typeof w === 'object' && w ? w.s : w));
      const recent = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
      return { e, lvl: A.curr.level(e.key), recent };
    });
    const focus = snap.filter((s) => s.recent != null && s.lvl < (s.e.maxLevel || 9))
                      .sort((a, b) => b.recent - a.recent)[0] || snap[0];
    const meeting = focus.recent != null && focus.recent >= 85;
    const pills = snap.map((s) => `<span class="lvlpill" data-focus="${s.e.key}" style="cursor:pointer${s.lvl >= 9 ? ';background:var(--warn);color:#fff' : ''}">${esc(s.e.name.split(' ')[0])} ${s.lvl}</span>`).join(' ');
    const progCard = `<div class="card"><div class="row between center"><h2>Progression</h2><button class="btn ghost sm" data-go="map">Journey ›</button></div>
      <div class="exrow" data-focus="${focus.e.key}"><div class="meta">
        <div class="nm">${esc(focus.e.name)} <span class="lvlpill">Lv ${focus.lvl}</span> <span class="tiny muted">nearest level-up</span></div>
        <div class="tiny muted" style="margin:4px 0 2px">${focus.recent == null ? 'no drills yet at this level' : `recent accuracy ${focus.recent}%${meeting ? ' — on track to level up ✓' : ' (aim ~85%)'}`}</div>
        <div class="accbar"><div class="accfill" style="width:${focus.recent == null ? 0 : Math.min(100, focus.recent)}%;background:${meeting ? 'var(--good)' : 'var(--accent)'}"></div><div class="accmark"></div></div>
      </div><span class="muted">›</span></div>
      <div style="margin-top:10px;line-height:2">${pills}</div></div>`;

    // ---- how-to: novices only; afterwards the plan card carries the method ----
    const howto = rk.index === 0 ? `<div class="card">
        <h2>How to progress</h2>
        <ol class="small muted" style="margin:8px 0 0;padding-left:20px;line-height:1.7">
          <li><b>Warm up the eye</b> (2–3 min): judge angles &amp; proportions — no drawing.</li>
          <li><b>Build accuracy</b>: Lines &amp; Angles → Curves → Polygons → Envelopes. Hold ~85% across a couple of days and the level rises on its own.</li>
          <li><b>Lock it in</b>: the daily retention check + a Mixed Session a few times a week.</li>
          <li><b>Apply it</b>: Module 4 — Contour, Negative Space, Bargue plates, Value, Master copy.</li>
        </ol></div>` : '';

    v.innerHTML = `
      ${planCard}
      ${progCard}
      ${howto}
      <div class="tiny muted" style="text-align:center;margin:6px 0 18px">Atelier v${esc(A.VERSION || '?')} · ${esc(A.BUILD || 'dev')}</div>`;
    v.onclick = (e) => {
      const rc = e.target.closest('[data-rec]'); if (rc) { doRec(rc.dataset.rec, rc.dataset.recex); return; }
      const pd = e.target.closest('.pdot'); if (pd) { toast(pd.getAttribute('title') || ''); return; }
      const f = e.target.closest('[data-focus]'); if (f) { startExercise(f.dataset.focus); return; }
      const g = e.target.closest('[data-go]'); if (g) ui.go(g.dataset.go);
    };

    // ---- moments: rank ceremony > weekly report > achievement toast ----
    const up = A.game.rankUp();
    if (up) showRankUp(rk, allAtts);
    else if (maybeWeeklyReport(allAtts)) { /* modal shown */ }
    else if (ach.now.length) toast('Unlocked: ' + ach.now.map((a) => a.name).join(', '));
    else if (planJustDone) toast('Today’s plan complete ✓');
  }

  // rank-up: a once-a-month event deserves more than a toast — the journey
  // curve with the marker on its new node, plus proof of progress if we have it
  function showRankUp(rk, allAtts) {
    const desc = ['finding your eye', 'lines & angles', 'shapes & proportion', 'real subjects & plates', 'drawing from memory'][rk.index] || '';
    const cmp = ['line', 'polygon', 'envelope', 'angles', 'curve'].map((t) => A.history.compare(allAtts, t)).find(Boolean);
    const proof = cmp ? `<div class="insight" style="text-align:left">Proof it’s working: your ${esc(exName(cmp.type))} mean went ${cmp.early.mean} → ${cmp.late.mean} over ${cmp.spanDays} days.</div>` : '';
    const sheet = openModal(`<h2 style="text-align:center">Rank up</h2>
      <div class="scorebadge" style="text-align:center;display:block;font-size:34px;margin:6px 0">${esc(rk.name)}</div>
      ${journeySVG(rk)}
      <div class="small muted" style="text-align:center">${esc(desc)}${rk.next ? ` · ${rk.nextAt - rk.points} pts to ${esc(rk.next)}` : ''}</div>
      ${proof}
      <button class="btn block" data-done="1" style="margin-top:12px">Onward</button>`);
    sheet.addEventListener('click', (e) => { if (e.target.closest('[data-done]')) closeModal(); });
  }

  // weekly report card: once, on the first Home visit of a new week
  function maybeWeeklyReport(allAtts) {
    const wk = weekIdxOf(A.habit.today());
    const seen = A.store.get('weekSeen', null);
    if (seen === wk) return false;
    A.store.set('weekSeen', wk);
    if (seen == null) return false;                      // first ever visit — nothing to report
    const wr = A.game.weeklyRecap(allAtts);
    if (!wr || wr.drills < 5) return false;              // too little practice to be worth a ritual
    const sa = A.stats.selfAwareness(allAtts);
    const calLine = sa && sa.bias != null ? A.coach.calibration(sa.bias) : '';
    const lb = A.stats.bias(allAtts, 'line');
    const biasLine = lb && lb.n >= 5 ? `Line angle bias is ${lb.angle.mean > 0 ? '+' : ''}${lb.angle.mean}° right now.` : '';
    const recalls = allAtts.filter((a) => a.recall && Date.now() - a.ts < 7 * 864e5);
    const recallLine = recalls.length ? `Best retention check: ${Math.max.apply(null, recalls.map((a) => a.score))}.` : '';
    const sheet = openModal(`<h2>Your week</h2>
      <div class="kpi" style="margin:12px 0">
        <div class="k"><div class="v">${wr.days}</div><div class="l">days</div></div>
        <div class="k"><div class="v">${wr.drills}</div><div class="l">drills</div></div>
        <div class="k"><div class="v">${wr.mean}</div><div class="l">avg acc</div></div>
        ${wr.delta != null ? `<div class="k"><div class="v">${wr.delta > 0 ? '▲' : wr.delta < 0 ? '▼' : '–'}${Math.abs(wr.delta)}</div><div class="l">vs last wk</div></div>` : ''}
      </div>
      ${biasLine || recallLine ? `<div class="small muted">${esc([biasLine, recallLine].filter(Boolean).join(' '))}</div>` : ''}
      ${calLine ? `<div class="insight" style="text-align:left">${esc(calLine)}</div>` : ''}
      <button class="btn block" data-done="1" style="margin-top:12px">Start the week</button>`);
    sheet.addEventListener('click', (e) => { if (e.target.closest('[data-done]')) closeModal(); });
    return true;
  }

  /* ======================================================================
     PRACTICE PICKER
     ====================================================================== */
  async function renderPractice(v) {
    const all = await attempts();
    const groups = A.curr.modules.map((m) => {
      const exs = A.curr.EXERCISES.filter((e) => e.module === m.n);
      const rows = exs.map((e) => {
        // sight-size is a reference drill but objectively scored, and has no study
        // timer — the plate stays in view the whole time
        const lvl = e.scored ? `Lv ${A.curr.level(e.key)} · ${A.curr.studySeconds(e.key)}s study`
          : e.key === 'sightsize' ? 'unhurried · exact score' : `${e.study()}s study`;
        const tag = (e.scored || e.key === 'sightsize') ? '<span class="tag">scored</span>' : '<span class="tag self">self-check</span>';
        return `<div class="exrow" data-ex="${e.key}">
          <div class="meta"><div class="nm">${esc(e.name)} ${tag}</div>
            <div class="small muted">${esc(e.blurb)}</div>
            <div class="tiny muted" style="margin-top:3px">${lvl}</div></div>
          <button class="btn soft sm" data-ex="${e.key}">Start ›</button></div>`;
      }).join('');
      return `<div class="card"><h2>Module ${m.n} · ${esc(m.name)}</h2>${rows}</div>`;
    }).join('');
    const sv = savedSession();
    const lbl = (kind, base) => (sv && sv.kind === kind) ? `Resume · ${sv.completed}/${sv.queue.length}` : base;
    const sessions = `<div class="card"><h2>Guided sessions</h2>
      <p class="small muted" style="margin:4px 0 10px"><b>When:</b> once you know the basic drills and want a full sitting without picking each exercise yourself. It auto-builds a <i>mix</i> of drills for you — mixing (interleaving) feels harder than repeating one drill, but builds more durable, transferable skill. A few times a week is ideal. Progress saves through the day; <b>New figure</b> swaps in a fresh figure (doesn’t count).</p>
      <div class="row wrap">
        <button class="btn" data-session="mixed">${lbl('mixed', `Mixed session · ${SESSIONS.mixed.n} · ~${SESSIONS.mixed.min} min`)}</button>
        <button class="btn ghost" data-session="warmup">${lbl('warmup', `Quick session · ${SESSIONS.warmup.n} · ~${SESSIONS.warmup.min} min`)}</button></div>
      <div class="tiny muted" style="margin-top:8px">Mixed = a full workout · Quick = a short version when time’s tight.</div></div>
      <div class="card"><h2>Perception warm-up <span class="tag self">2–3 min</span></h2>
      <p class="small muted" style="margin:4px 0 10px"><b>When:</b> at the <b>start of every session</b> (and again if you come back hours later). No drawing — you just judge to prime your eye, because misperceiving the subject (not the hand) is the main cause of inaccurate drawing. Each judgement levels up on its own.</p>
      <div class="row wrap">${['angle', 'prop', 'curve', 'value'].map((k) => {
        const pl = A.store.get('percLevel', {});
        const names = { angle: 'Judge angle', prop: 'Judge proportion', curve: 'Judge curve', value: 'Judge value' };
        return `<button class="btn soft" data-perc="${k}">${names[k]} · Lv ${pl[k] || 1}</button>`;
      }).join('')}</div>
      <p class="small muted" style="margin:12px 0 8px"><b>Discriminate</b> — forced choice: which is steeper / longer? An adaptive staircase finds the smallest difference your eye can catch, then pushes it finer. Watch the threshold fall over weeks.</p>
      <div class="row wrap">${['angle', 'length'].map((k) => {
        const best = A.store.get('afcBest', {})[k];
        const names = { angle: 'Which is steeper?', length: 'Which is longer?' };
        const unit = k === 'angle' ? '°' : '%';
        return `<button class="btn soft" data-afc="${k}">${names[k]}${best != null ? ` · best ${best}${unit}` : ''}</button>`;
      }).join('')}</div></div>`;
    v.innerHTML = `${recLine(all)}<div class="banner">Not sure where to start? Use the <b>recommended</b> step above. Otherwise, pick any single drill or a guided session below.</div>${sessions}${groups}`;
    v.onclick = (e) => {
      const rc = e.target.closest('[data-rec]'); if (rc) { doRec(rc.dataset.rec, rc.dataset.recex); return; }
      const s = e.target.closest('[data-session]');
      if (s) { const sv2 = savedSession(); if (sv2 && sv2.kind === s.dataset.session) resumeSession(); else startSession(s.dataset.session); return; }
      const p = e.target.closest('[data-perc]'); if (p) { A.Perceive.start(p.dataset.perc); return; }
      const f = e.target.closest('[data-afc]'); if (f) { A.Perceive.startAFC(f.dataset.afc); return; }
      const b = e.target.closest('[data-ex]'); if (b) startExercise(b.dataset.ex);
    };
  }

  async function startExercise(exKey) {
    const def = A.curr.def(exKey);
    if (def.scored) {
      // a standalone scored exercise runs as a SET of figures so it has a clear finish
      run = { exKey, size: RUN_SIZE, done: 0, results: [], start: performance.now() };
      openDrill(exKey, null); return;
    }
    run = null;
    // reference exercise → choose an image (exclude the abstract line/shape worksheets;
    // value/contour/master want real subjects — Bargue plates or your own photos)
    let items = A.library.byCategory(def.refCat);
    if (def.refCat === 'any') items = items.filter((i) => i.category === 'cast' || i.category === 'bargue' || i.category === 'user');
    // sight-size wants ONE subject beside the paper (the atelier masks the
    // sheet); single figures first, whole multi-figure plates after
    if (exKey === 'sightsize') {
      const rank = (i) => i.category === 'cast' ? 0 : i.category === 'user' ? 1 : 2;
      items = items.slice().sort((a, b) => rank(a) - rank(b));
    }
    chooseReference(exKey, def, items);
  }

  async function chooseReference(exKey, def, items) {
    const isBargue = exKey === 'bargue';
    // every reference drill shows per-image progress (best % + stars) — the
    // plate-course pattern, generalised, so Module 4 has a visible ladder
    const atts = await attempts();
    const bestBy = {};
    atts.forEach((a) => { if (a.type === exKey && a.refId && a.score != null && !a.repeat) bestBy[a.refId] = Math.max(bestBy[a.refId] || 0, a.score); });
    let order = items, nextId = null;
    if (isBargue) {
      const rank = (id) => { const i = A.game.PLATES.indexOf(id); return i < 0 ? 99 : i; };
      order = items.slice().sort((a, b) => rank(a.id) - rank(b.id));
      nextId = (order.find((it) => (bestBy[it.id] || 0) < A.game.PLATE_PASS) || order[0] || {}).id;
    }
    const stars = (s) => { const n = s >= 85 ? 3 : s >= 70 ? 2 : s >= 50 ? 1 : 0; return '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n); };
    const cells = order.map((it) => {
      const best = bestBy[it.id] || 0;
      const meta = `<div class="tiny muted">${best ? 'best ' + best + '% ' : 'not started '}<span style="letter-spacing:1px;color:var(--accent)">${stars(best)}</span></div>`;
      const badge = (isBargue && it.id === nextId) ? `<span class="lvlpill" style="position:absolute;top:6px;left:6px;background:var(--accent);color:#fff;z-index:1">next</span>` : '';
      return `<div class="cell" data-ref="${esc(it.id)}" style="position:relative">${badge}
        <img src="${it.src}" alt=""><div class="cap">${esc(it.title)}</div>${meta}</div>`;
    }).join('') || '<div class="muted small">No images in this category. Add some in Library.</div>';
    const intro = isBargue
      ? '<p class="small muted">The Bargue course — work the plates in order, aiming for ~85% before moving on. ★ marks your best so far; <b>next</b> is where you’re up to.</p>'
      : `<p class="small muted">${esc(def.blurb)}</p>`;
    const allowSkip = def.key === 'value';
    const sheet = openModal(`<h2>${isBargue ? 'Bargue course' : 'Choose a reference'}</h2>
      ${intro}
      <div class="libgrid" style="margin-top:12px">${cells}</div>
      ${allowSkip ? '<button class="btn ghost block" data-skip="1" style="margin-top:12px">Use a physical object (no overlay)</button>' : ''}
      <button class="btn ghost block" data-go="library" style="margin-top:8px">Open Library to import ›</button>`);
    sheet.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-ref]');
      const skip = e.target.closest('[data-skip]');
      const lib = e.target.closest('[data-go]');
      if (lib) { closeModal(); ui.go('library'); return; }
      if (skip) { closeModal(); openDrill(exKey, { id: null, title: 'Physical object', img: null, studySec: def.study() }); return; }
      if (c) {
        const item = A.library.get(c.dataset.ref);
        closeModal();
        const img = await A.library.image(item);
        openDrill(exKey, Object.assign({}, item, { img, studySec: def.study() }));
      }
    });
  }

  /* ======================================================================
     DRILL OVERLAY
     ====================================================================== */
  function buildDrill() {
    const d = el(`<div id="drill">
      <div class="instructor"><div class="txt" id="d-instr">Study</div>
        <div class="hgroup"><div class="tiny muted" id="d-sess"></div>
          <div class="ringwrap"><div class="tring" id="d-ring"><svg viewBox="0 0 48 48"><circle class="track" cx="24" cy="24" r="20"></circle><circle class="fill" id="d-ringfill" cx="24" cy="24" r="20"></circle></svg><div class="tringtxt" id="d-timer"></div></div><div class="ringlabel" id="d-ringlabel"></div></div></div></div>
      <div class="hint" id="d-hint"></div>
      <button class="closeX" id="d-close" aria-label="Close drill">✕</button>
      <button class="closeX" id="d-help" style="right:58px;font-weight:600" aria-label="How this drill works">?</button>
      <canvas id="d-canvas"></canvas>
      <button class="btn soft sm" id="d-zoomreset" style="display:none" aria-label="Reset zoom">⤢ 100%</button>
      <div id="d-result"></div>
      <div class="controls" id="d-controls"></div>
    </div>`);
    document.body.appendChild(d);
    surface = new A.Surface($('#d-canvas', d), { pencilOnly: A.store.get('pencilOnly', false), baseWidth: A.store.get('inkWidth', 3.2), smooth: A.store.get('smooth', 0.5) });
    // pinch zoom (two fingers) — show a reset chip while zoomed in
    const zr = $('#d-zoomreset', d);
    surface.onViewChange = (z) => { zr.style.display = z > 1.02 ? 'block' : 'none'; };
    zr.addEventListener('pointerup', (e) => { e.preventDefault(); surface.resetView(); });
    // sight-size: any step-back transition (button or tap-to-return) restarts the
    // mark-count behind the rhythm nudge and re-renders the controls
    surface.onStepBack = () => { if (drill && drill.exKey === 'sightsize') drill.marksSinceStepBack = 0; updateDrill(); };
    drill = new A.Drill(surface);
    drill.onState = updateDrill;
    drill.onTick = updateTimer;
    drill.onResult = onDrillResult;
    $('#d-close', d).addEventListener('pointerup', closeDrill);
    $('#d-help', d).addEventListener('pointerup', () => { if (drill.exKey) showHowTo(drill.exKey); });
  }

  const HOWTO = {
    line: 'Study the single line — its slant and its length. Hide it, then redraw it from memory anywhere on the canvas. Only angle and length are scored, not where you place it.',
    angles: 'Note how the lines relate — the angle between them and their relative lengths — not their position. Reproduce those relationships from memory.',
    polygon: 'Fix each corner’s position relative to the others. Block the whole shape in, then check its proportion before committing.',
    envelope: 'Find the outer “envelope” first — the largest straight lines that contain the form — then facet into smaller straights and round to the true contour, noticing where the edge turns sharply versus flows. General to specific.',
    gesture: 'A figure is shown as its line of action — one flowing line through the whole pose, with the head and main masses. Memorise that line, then draw it from memory in a single sweep. It’s the rhythm you’re after, not the outline; push the curve a little.',
    sightsize: 'The classical atelier setup: the plate sits beside your paper at the same size, and you copy it using pure eye comparison — mark, flick your eyes to the plate, correct. Step back often to judge the whole. The String works like a taut string in your outstretched hands: stretch it along an edge on the plate to read its angle and length, then grab its middle and carry it — angle and length held — over your copy to compare. Grab an end to re-aim it. Scoring is exact: placement, size and contour all count, and you can keep refining the same copy.',
    contour: 'Trace one continuous edge slowly with your eyes, then draw it from memory in a single, unhurried line. It’s about seeing the edge, not speed.',
    negative: 'Ignore the object itself — memorise only the empty shapes around and between the forms, then draw those negative shapes.',
    bargue: 'Study only the straight-line block-in stage. Draw the outer envelope from memory, then fade the plate back over your drawing to see where you drifted.',
    value: 'Memorise the shadow line — the terminator, where light turns to dark — then draw that single boundary from memory.',
    master: 'Study the whole image as a few big shapes and their relationships. Draw it from memory, general to specific — don’t start with details.'
  };
  function showHowTo(exKey) {
    const def = A.curr.def(exKey);
    // sight-size is the one drill where looking IS the method — its rhythm line
    // is comparison, not the study-hide-recall loop
    const rhythm = exKey === 'sightsize'
      ? 'The rhythm here: <b>mark → flick eyes to the plate → correct</b>, and step back before every big decision. Unlike the memory drills, constant comparison is the whole point.'
      : 'The rhythm is always: <b>study → hide → draw from memory → reveal → correct & redraw</b>. Never peek while drawing — the struggle is where the learning happens.';
    openModal(`<h2>${esc(def ? def.name : exKey)}</h2>
      <p class="small" style="margin:8px 0">${esc(HOWTO[exKey] || '')}</p>
      <div class="insight" style="text-align:left">${rhythm}</div>
      <p class="small muted" style="margin:8px 0 0"><b>The ring</b> tracks your time: while studying it fills to the suggested look length, while drawing it fills to a recall budget. It turns <span style="color:var(--warn);font-weight:600">amber</span> and pulses when you reach it — a gentle cue to move on (hide &amp; draw, or commit your marks). It’s never a hard stop; take the time you need.</p>
      <button class="btn block" data-done="1" style="margin-top:12px">Got it</button>`)
      .addEventListener('click', (e) => { if (e.target.closest('[data-done]')) closeModal(); });
  }

  function showOnboarding() {
    // three short ideas, then learn the loop BY DOING it — the estimate-before-
    // reveal moment can't land as prose, and it takes 60 seconds to experience
    const steps = [
      { h: 'Welcome to Atelier', b: 'A pocket atelier for training the skill behind accurate drawing — your <b>visual memory</b>.<div class="insight" style="text-align:left;margin-top:10px"><b>The one rule:</b> study a shape, hide it, then draw it from memory. Never peek while drawing — the struggle is the learning.</div>' },
      { h: 'See, don’t name', b: 'Look for raw data — <b>angles, lengths, proportions</b> — not “a hand” or “a foot”. Naming makes you draw the symbol in your head instead of what’s actually there. That misperception is the real reason drawings come out wrong.' },
      { h: 'General to specific', b: 'Block the big <b>envelope</b> in straight lines first; facet and round only once the proportions are right. Keep early lines light and correctable.<div class="muted small" style="margin-top:8px">Tip: tap <b>?</b> in any drill for how it works.</div>' }
    ];
    let i = 0;
    const sheet = openModal('');
    function render() {
      const s = steps[i], last = i === steps.length - 1;
      sheet.innerHTML = `<h2>${s.h}</h2><div class="small" style="margin:10px 0 4px">${s.b}</div>
        <div class="row between center" style="margin-top:14px">
          <span class="tiny muted">${i + 1} / ${steps.length}</span>
          ${last
            ? `<div class="row" style="gap:8px"><button class="btn ghost sm" data-skiptut="1">Just explore</button>
               <button class="btn" data-try="1">Try it — 60 seconds ›</button></div>`
            : `<button class="btn" data-next="1">Next ›</button>`}</div>`;
    }
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-next]')) { i++; render(); return; }
      if (e.target.closest('[data-try]')) {
        A.store.set('onboarded', true); A.store.set('tutorial', true);
        closeModal(); startExercise('line'); return;
      }
      if (e.target.closest('[data-skiptut]')) {
        A.store.set('onboarded', true); closeModal(); ui.go('practice');
      }
    });
    render();
  }

  /* ---- sessions: interleaved practice (contextual interference) ---------- */
  let session = null;
  let sessionStart = 0;   // performance.now() at the start of the current sitting
  let run = null;         // a standalone single-exercise SET: {exKey,size,done,results,start}
  const RUN_SIZE = 5;     // figures per practice set — matches the leveling window (closure + a clear finish)
  function shuffledQueue(types, n) {
    const q = []; let last = null;
    for (let i = 0; i < n; i++) {
      let pick, guard = 0;
      do { pick = types[Math.floor(Math.random() * types.length)]; guard++; } while (pick === last && types.length > 1 && guard < 12);
      q.push(pick); last = pick;
    }
    return q;
  }
  function saveSession() { A.store.set('session', session); }
  // a saved session is resumable only if it's from today and not finished
  function savedSession() {
    const s = A.store.get('session', null);
    if (s && s.day === A.habit.today() && s.completed < s.queue.length) return s;
    if (s) A.store.set('session', null);   // stale (old day) or finished → discard
    return null;
  }
  function startSession(kind) {
    const cfg = SESSIONS[kind] || SESSIONS.mixed;
    // DERIVED from the curriculum so a new scored drill can never be left out
    // of sessions again (it happened with curve, then gesture)
    const allScored = A.curr.EXERCISES.filter((e) => e.scored).map((e) => e.key);
    const queue = kind === 'warmup'
      ? shuffledQueue(allScored.slice(0, 4), cfg.n)          // quick session: the foundations
      : shuffledQueue(allScored, cfg.n);
    session = { kind, queue, completed: 0, results: [], day: A.habit.today() };
    // mixed sessions end on a FINISHER: the capstone drill one level up
    // (peak-end rule — the session's last memory is a real challenge). It never
    // feeds the level window, so difficulty stays honest.
    if (kind === 'mixed') { queue[queue.length - 1] = 'envelope'; session.finisherIdx = queue.length - 1; }
    run = null;
    sessionStart = performance.now();
    saveSession();
    openDrill(queue[0], null, sessOpts(0));
  }
  function sessOpts(i) {
    return (session && session.finisherIdx === i) ? { finisher: true } : undefined;
  }
  function resumeSession() {
    session = savedSession(); if (!session) return;
    run = null;
    sessionStart = performance.now();   // clock the current sitting
    openDrill(session.queue[session.completed], null, sessOpts(session.completed));
  }
  // a drill counts only when actually COMPLETED (a result was produced)
  function onDrillResult(d) {
    if (!(d.def && d.result)) return;
    if (session) {
      if (d.def.scored) { session.results.push({ type: d.exKey, score: d.result.score, finisher: !!d.result.finisher }); session.completed++; saveSession(); }
    } else if (run && d.def.scored) {
      run.results.push({ type: d.exKey, score: d.result.score }); run.done++;
    }
    fatigueCheck();
  }
  // quality-decline watch: when the last 3 scored results in this sitting each
  // fall clearly below the sitting's own mean, practice quality is dropping —
  // short, high-quality sessions beat pushing through (once per sitting).
  function fatigueCheck() {
    const box = session || run;
    if (!box || box._fatigueTold) return;
    const res = box.results || [];
    if (res.length < 5) return;
    const scores = res.map((r) => r.score);
    const m = scores.reduce((a, b) => a + b, 0) / scores.length;
    const last3 = scores.slice(-3);
    if (last3.every((s) => s < m - 10)) {
      box._fatigueTold = true;
      toast('Accuracy is dropping — a rest now beats grinding on. Short sessions stick better.');
    }
  }
  // true when the current drill is the last of its session / set
  function atSetEnd() {
    return (session && session.completed >= session.queue.length) || (run && run.done >= run.size);
  }
  // after a completed drill, "Next" moves on (or finishes the session / set)
  function sessionAdvance() {
    if (session) {
      if (session.completed >= session.queue.length) { finishSession(); return; }
      const i = session.completed;
      drill.startExercise(session.queue[i], null, sessOpts(i)); return;
    }
    if (run) {
      if (run.done >= run.size) { finishRun(); return; }
      drill.next(); return;
    }
    drill.next();
  }
  // "Skip" = a fresh figure of the SAME exercise/difficulty; does NOT count as progress
  function sessionSkip() {
    if (!session) { drill.next(); return; }
    const i = session.completed;
    drill.startExercise(session.queue[i], null, sessOpts(i));
  }
  function finishSession() {
    const res = session ? session.results : [];
    const mean = res.length ? Math.round(res.reduce((a, b) => a + b.score, 0) / res.length) : 0;
    const best = res.length ? Math.max.apply(null, res.map((r) => r.score)) : 0;
    const secs = sessionStart ? (performance.now() - sessionStart) / 1000 : 0;
    const kind = session ? session.kind : 'mixed';
    const fin = res.find((r) => r.finisher);
    session = null; sessionStart = 0; A.store.set('session', null);
    drill.stop(); $('#drill').classList.remove('on'); invalidate();
    const sheet = openModal(`<h2>${kind === 'warmup' ? 'Quick session' : 'Mixed session'} complete</h2>
      <div class="kpi" style="margin:12px 0"><div class="k"><div class="v">${res.length}</div><div class="l">drills</div></div>
        <div class="k"><div class="v">${mean}</div><div class="l">mean</div></div>
        <div class="k"><div class="v">${best}</div><div class="l">best</div></div>
        <div class="k"><div class="v">${clock(secs)}</div><div class="l">time</div></div></div>
      ${fin ? `<div class="insight" style="text-align:left">Your finisher (${esc(exName(fin.type))}, one level up): <b>${fin.score}</b>.</div>` : ''}
      <p class="small muted">Interleaving different drills feels harder in the moment but builds more durable, transferable skill than repeating one drill.</p>
      <button class="btn block" data-done="1" style="margin-top:8px">Done</button>`);
    sheet.addEventListener('click', (e) => { if (e.target.closest('[data-done]')) { closeModal(); ui.go('home'); } });
  }

  // a standalone practice SET finished → affirm, summarise, and point to the next step
  function finishRun() {
    const r = run || { results: [], size: RUN_SIZE, exKey: null };
    const res = r.results;
    const mean = res.length ? Math.round(res.reduce((a, b) => a + b.score, 0) / res.length) : 0;
    const best = res.length ? Math.max.apply(null, res.map((x) => x.score)) : 0;
    const secs = r.start ? (performance.now() - r.start) / 1000 : 0;
    const exKey = r.exKey;
    const def = exKey ? A.curr.def(exKey) : null;
    const lvl = exKey ? A.curr.level(exKey) : 1;
    run = null;
    drill.stop(); $('#drill').classList.remove('on'); invalidate();
    const head = mean >= 85 ? 'Excellent — set complete' : mean >= 65 ? 'Well done — set complete' : 'Set complete — keep going';
    attempts(true).then((atts) => {
      const rec = A.game.recommend(atts);
      // is the recommendation the very same exercise we just did?
      const sameEx = rec.exKey && rec.exKey === exKey;
      const recBtn = `<button class="btn block" data-recnext="1" style="margin-top:8px">${esc(rec.title)} ›</button>`;
      const againBtn = exKey && !sameEx
        ? `<button class="btn ghost block" data-again="1" style="margin-top:8px">Another ${esc(def ? def.name : 'set')} (Lv ${lvl})</button>` : '';
      const sheet = openModal(`<h2>${head}</h2>
        <div class="kpi" style="margin:12px 0"><div class="k"><div class="v">${res.length}</div><div class="l">figures</div></div>
          <div class="k"><div class="v">${mean}</div><div class="l">mean</div></div>
          <div class="k"><div class="v">${best}</div><div class="l">best</div></div>
          <div class="k"><div class="v">${clock(secs)}</div><div class="l">time</div></div></div>
        <div class="insight" style="text-align:left">Recommended next: <b>${esc(rec.title)}</b> — ${esc(rec.sub)}</div>
        ${recBtn}${againBtn}
        <button class="btn ghost block" data-done="1" style="margin-top:8px">Back to home</button>`);
      sheet.addEventListener('click', (e) => {
        if (e.target.closest('[data-recnext]')) { closeModal(); doRec(rec.step, rec.exKey); }
        else if (e.target.closest('[data-again]')) { closeModal(); startExercise(exKey); }
        else if (e.target.closest('[data-done]')) { closeModal(); ui.go('home'); }
      });
    });
  }

  function openDrill(exKey, refItem, opts) {
    const d = $('#drill'); d.classList.add('on');
    surface.opts.pencilOnly = A.store.get('pencilOnly', false);
    surface.opts.baseWidth = A.store.get('inkWidth', 3.2);
    surface.opts.smooth = A.store.get('smooth', 0.5);
    // setTimeout (not rAF) so startup still runs if the first frame is throttled
    setTimeout(() => { surface.resize(); drill.startExercise(exKey, refItem, opts); }, 0);
  }
  function closeDrill() { session = null; run = null; sessionStart = 0; drill.stop(); $('#drill').classList.remove('on'); invalidate(); ui.go(ui.view); }

  // live progress chip (empty when practising a single standalone figure with no set)
  function updateSessClock() {
    const s = $('#d-sess'); if (!s) return;
    if (session) {
      const secs = sessionStart ? (performance.now() - sessionStart) / 1000 : 0;
      s.textContent = `${session.completed}/${session.queue.length} · ${clock(secs)}`;
    } else if (run) {
      const secs = run.start ? (performance.now() - run.start) / 1000 : 0;
      s.textContent = `${run.done}/${run.size} · ${clock(secs)}`;
    } else { s.textContent = ''; }
  }

  const RING_C = 2 * Math.PI * 20;
  function setRing(frac, warn) {
    const ring = $('#d-ring'), fill = $('#d-ringfill'); if (!ring || !fill) return;
    fill.style.strokeDasharray = RING_C;
    fill.style.strokeDashoffset = RING_C * (1 - Math.max(0, Math.min(1, frac)));
    ring.classList.toggle('warn', !!warn);
  }

  // drives the ring + centre number + label + hint. Enforced study counts DOWN (ring
  // empties = time left); self-paced study and the recall phase count UP toward their
  // soft target (ring fills = how far along). When it FILLS (or the countdown runs low)
  // it turns amber, pulses, and a hint pops up telling you what to do — never a hard stop.
  function updateTimer() {
    updateSessClock();
    const t = $('#d-timer'), hint = $('#d-hint'), label = $('#d-ringlabel');
    let lab = '';
    if (drill.phase === 'study') {
      const cap = drill.studyCap || 0;
      if (drill.enforced) {                       // countdown that auto-hides
        const rem = Math.max(0, drill.studyRemaining);
        const low = rem <= 3;
        t.textContent = Math.ceil(rem) + 's'; setRing(cap ? rem / cap : 0, low);
        lab = 'hides in';
        if (hint) hint.textContent = low ? 'Hiding now — picture it, then draw from memory.' : '';
      } else {                                     // self-paced: fills to the suggested look
        const e = drill.studyElapsed || 0;
        const full = cap && e >= cap;
        t.textContent = Math.floor(e) + 's'; setRing(cap ? Math.min(1, e / cap) : 0, full);
        lab = 'study';
        // over-stare nudge: staring past ~2× your own average look doesn't encode
        // more — glances beat stares (Rousar). Only once there's a stable average.
        const stare = drill.avgLook >= 3 && e > drill.avgLook * 2;
        if (hint) hint.textContent = stare ? 'Ease off — long stares don’t stick. Commit and draw.'
                                   : (full ? 'That’s the suggested look — hide it and draw from memory.' : '');
      }
    } else if (drill.phase === 'hold') {           // retention hold: counts down to draw
      const rem = Math.max(0, drill.holdRemaining || 0);
      t.textContent = Math.ceil(rem) + 's';
      setRing(drill.holdCap ? rem / drill.holdCap : 0, rem <= 1);
      lab = 'hold it';
      if (hint) hint.textContent = '';
    } else if (drill.phase === 'draw') {           // recall: fills to the soft budget
      const e = drill.drawElapsed || 0, bud = drill.drawBudget;
      const over = !!(bud && e > bud);
      t.textContent = Math.floor(e) + 's'; setRing(bud ? Math.min(1, e / bud) : 0, over);
      lab = 'drawing';
      if (hint) hint.textContent = over ? 'Memory fades — commit your marks now, or tap Glance.' : '';
    } else {                                        // estimate / reveal / idle — clear it
      t.textContent = ''; setRing(0, false);
      if (hint) hint.textContent = '';
    }
    if (label) label.textContent = lab;
  }

  function scoreClass(s) { return s >= 85 ? 's-good' : s >= 65 ? 's-mid' : 's-low'; }

  function updateDrill() {
    const def = drill.def;
    const instr = $('#d-instr'), timer = $('#d-timer'), controls = $('#d-controls'), result = $('#d-result');
    result.innerHTML = ''; timer.textContent = ''; timer.style.color = '';
    // "New figure" = swap in a fresh procedurally-generated figure of the same exercise
    // & level without it counting. Only for scored drills (reference/Bargue use a chosen
    // image, so a "new figure" makes no sense there).
    const newFig = def.scored ? '<button class="btn ghost sm" data-act="skipdrill">New figure ⟳</button>' : '';
    // comparative-measurement caliper (Bargue/reference): toggle + clear; a short hint
    const measureBtns = surface.measureMode
      ? `<button class="btn ghost sm sel" data-act="measure">Measuring</button><button class="btn ghost sm" data-act="clearmeasure">Clear m.</button>`
      : `<button class="btn ghost sm" data-act="measure">Measure${surface.measures.length ? ' ' + surface.measures.length : ''}</button>`;
    const measuring = surface.measureMode ? '  ·  drag a line to measure (1st = unit, rest read ×units)' : '';

    if (drill.phase === 'study') {
      const cue = LOOKCUE[drill.exKey] || 'angle, length, proportion';
      const after = drill.selfPaced
        ? 'When you can picture it, tap “I’ve got it” — it hides and you draw it from memory.'
        : 'It hides when the ring runs out — then draw it from memory.';
      instr.textContent = (drill.isFinisher ? 'Finisher — one level up! ' : '') + `Memorise ${cue}. ${after}` + (!def.scored ? measuring : '');
      timer.textContent = drill.selfPaced ? Math.floor(drill.studyElapsed || 0) + 's' : Math.ceil(drill.studyRemaining) + 's';
      const flipBtn = !def.scored && drill.ref && drill.ref.img ? `<button class="btn ghost sm" data-act="flip">Flip ⟲</button>` : '';
      const commit = drill.selfPaced
        ? `<button class="btn" data-act="skip">I’ve got it ›</button>`
        : `<button class="btn ghost" data-act="skip">Hide & draw now</button>`;
      controls.innerHTML = `${newFig}${flipBtn}${!def.scored ? measureBtns : ''}${commit}`;
    }
    else if (drill.phase === 'hold') {
      // retention hold: keep the image in the MIND'S EYE for a moment before
      // drawing — this forces recall from encoded memory, not the afterimage
      instr.textContent = 'Hold it in your mind’s eye — picture every angle and length…';
      controls.innerHTML = '';
    }
    else if (drill.phase === 'draw') {
      const flipBtn = !def.scored && drill.ref && drill.ref.img ? `<button class="btn ghost sm ${surface.ghostFlip ? 'sel' : ''}" data-act="flip">Flip ⟲</button>` : '';
      // glances cost level credit on scored drills — show that on the button so
      // it's a considered choice, not a free peek
      const glanceCost = def.scored ? ' −5' : '';
      const glanceBtn = `<button class="btn ghost sm" data-act="glance" ${drill.glancesLeft() <= 0 ? 'disabled' : ''}>Glance${glanceCost}${drill.glanceCap ? ' · ' + drill.glancesLeft() : ''}</button>`;
      const undoBtn = `<button class="btn ghost sm" data-act="undo" ${surface.canUndo() ? '' : 'disabled'}>Undo</button>`;
      const eraseBtn = `<button class="btn ghost sm ${surface.erasing ? 'sel' : ''}" data-act="erase">Erase</button>`;
      const guidesBtn = `<button class="btn ghost sm ${surface.guides ? 'sel' : ''}" data-act="guides">Guides</button>`;
      if (drill.exKey === 'sightsize') {     // side-by-side copy: compare, don't memorise
        const scoreBtn = `<button class="btn" data-act="evaluate" ${drill.canEvaluate() ? '' : 'disabled'}>Score ›</button>`;
        if (surface.stepBack) {
          instr.textContent = 'Judging distance — placement and size errors show themselves. Tap the canvas to walk back in.';
          controls.innerHTML = `<button class="btn ghost sm sel" data-act="stepback">Step back</button>${scoreBtn}`;
        } else {
          // step-back rhythm nudge: after a run of marks without judging the whole,
          // steer the eye back — that IS the sight-size discipline
          const needStep = (drill.marksSinceStepBack || 0) >= 12;
          instr.textContent = needStep
            ? 'Step back — judge the whole before the next mark.'
            : (surface.stringMode
              ? 'Stretch the string along an edge on the plate, then grab its middle to carry it — angle & length held — over your copy. Grab an end to re-aim it; tap empty space to clear.'
              : 'Copy the plate at the same size. Rhythm: mark → flick eyes to the plate → correct.');
          const stringBtn = `<button class="btn ghost sm ${surface.stringMode ? 'sel' : ''}" data-act="string">String</button>`;
          controls.innerHTML = `<button class="btn ghost sm" data-act="stepback">Step back</button>
            <button class="btn ghost sm" data-act="flick">Flick</button>${stringBtn}${measureBtns}${undoBtn}${eraseBtn}
            <button class="btn ghost sm" data-act="clear">Clear</button>${scoreBtn}`;
        }
      }
      else if (!def.scored && drill.stages) {     // guided multi-stage block-in
        const last = drill.stage >= drill.stages.length - 1;
        instr.textContent = `Stage ${drill.stage + 1}/${drill.stages.length} — ${drill.stages[drill.stage]}` + measuring;
        controls.innerHTML = `${glanceBtn}${measureBtns}${guidesBtn}${flipBtn}${undoBtn}${eraseBtn}<button class="btn ghost sm" data-act="clear">Clear</button>
          ${last ? '<button class="btn" data-act="evaluate">Reveal</button>'
                 : '<button class="btn" data-act="nextstage">Next stage ›</button>'}`;
      } else {
        instr.textContent = (drill.isRecall
          ? 'Retention check — draw the figure you studied last time, cold.'
          : 'Hidden — now draw it from memory.') + (!def.scored ? measuring : '');
        controls.innerHTML = `${glanceBtn}${def.scored || !drill.ref ? (def.scored ? guidesBtn : '') : measureBtns}${flipBtn}${undoBtn}${eraseBtn}<button class="btn ghost sm" data-act="clear">Clear</button>
          ${newFig}<button class="btn" data-act="evaluate" ${drill.canEvaluate() ? '' : 'disabled'}>${def.scored ? 'Evaluate' : 'Reveal'}</button>`;
      }
    }
    else if (drill.phase === 'estimate') {
      instr.textContent = 'Before the answer — how close were you?';
      result.innerHTML = `<div class="card resultcard">
        <div class="small" style="margin-bottom:4px">Guess your accuracy %, then see the actual.</div>
        <div class="scorebadge" id="d-estv" style="font-size:34px">70%</div>
        <div class="estq" style="margin:6px 0">
          ${[30, 50, 65, 75, 85, 95].map((p) => `<button data-estbox="${p}">${p}%</button>`).join('')}</div>
        <div class="row center" style="gap:8px"><span class="tiny muted">or fine-tune</span>
          <input type="range" id="d-est" min="0" max="100" value="70" style="flex:1"></div>
        <button class="btn block" data-estconfirm="1" style="margin-top:8px">Reveal ›</button>
        <div class="tiny muted" style="margin-top:6px">Tap a box, or drag then Reveal. Guessing first trains your eye.</div></div>`;
      controls.innerHTML = '';
    }
    else if (drill.phase === 'reveal') {
      // sight-size is objectively scored (placement + size + contour) even though
      // it's a reference drill — it gets the full scored reveal, not self-rating
      if ((def.scored || drill.exKey === 'sightsize') && drill.result) revealScored(instr, controls, result);
      else revealReference(instr, controls, result);
    }
    bindControls(controls, result);
    updateTimer();   // immediately reflect session clock + study/draw time (no first-tick lag)
  }

  function revealScored(instr, controls, result) {
    const r = drill.result;
    instr.textContent = drill.exKey === 'sightsize'
      ? 'Scored in place — placement, size and contour all count. Refine the same copy to close the gaps.'
      : 'Compare: your marks vs the target (red).';
    const m = r.metrics || {};
    // repeats saw the answer; recalls are a different game — neither sets a PB
    if (!r._pb && !r.repeat && !r.recall) r._pb = A.game.personalBest(drill.exKey, r.score);
    const pbMsg = r._pb && r._pb.isNew ? '<div class="insight" style="background:var(--accent);color:#fff">★ New personal best!</div>' : '';
    const modeMsg = r.recall
      ? '<div class="insight" style="text-align:left">Retention check — recalled across a day. Scores run lower here; that struggle is the training. (Doesn’t affect your level.)</div>'
      : r.finisher
      ? '<div class="tiny muted" style="margin-bottom:6px">Finisher — one level up. Fully scored, but it doesn’t feed your level.</div>'
      : (r.repeat ? '<div class="tiny muted" style="margin-bottom:6px">Correction redraw — recorded, but it doesn’t count toward your level or bests.</div>' : '');
    // interactive onboarding: name the signature moment the first time it happens
    let tutMsg = '';
    if (A.store.get('tutorial', false) && r.selfEstimate != null) {
      A.store.set('tutorial', false);
      tutMsg = `<div class="insight" style="text-align:left"><b>That’s the whole method.</b> You guessed ${r.selfEstimate}%, it was ${r.score}%. Shrinking that gap — seeing your own errors before being told — is what every drill here trains.</div>`;
    }
    const glanceMsg = (!r.repeat && !r.recall && drill.glanceCount > 0)
      ? `<div class="tiny muted" style="margin-bottom:6px">${drill.glanceCount} glance${drill.glanceCount > 1 ? 's' : ''} used — level credit reduced by ${drill.glanceCount * 5}.</div>` : '';
    // where this score sits vs the ~85% level-up threshold (faded: scored, genuine trials only)
    const atCapNow = drill.def && drill.level >= (drill.def.maxLevel || 9);
    const targetHint = (!r.repeat && !r.recall && !r.finisher && drill.def && drill.def.scored)
      ? (atCapNow ? ' · holding at top level'
         : r.score >= 85 ? ' · at the level-up mark ✓'
         : ' · ~85% levels you up')
      : '';
    // make the value of a redraw come across when the drawing was genuinely off
    const redrawNudge = (!r.repeat && !r.recall && drill.def && drill.def.scored && r.score < 70)
      ? `<div class="tiny muted" style="margin:2px 0 6px">Off this time — a <b>Redraw</b> from memory now is where the correction sticks (Lecoq’s method).</div>` : '';
    let metricRows = '';
    if (drill.exKey === 'line' || drill.exKey === 'angles') {
      const ae = m.angleErrDeg != null ? m.angleErrDeg : m.meanAngleErrDeg;
      const le = m.lengthErrPct != null ? m.lengthErrPct : m.meanLengthErrPct;
      metricRows = `<div class="metricline"><span>Angle error</span><b>${ae > 0 ? '+' : ''}${ae}° ${ae > 0 ? '(CW)' : ae < 0 ? '(CCW)' : ''}</b></div>
        <div class="metricline"><span>Length error</span><b>${le > 0 ? '+' : ''}${le}% ${le > 0 ? '(long)' : le < 0 ? '(short)' : ''}</b></div>`;
    } else if (drill.exKey === 'curve' || drill.exKey === 'gesture') {
      metricRows = `<div class="metricline"><span>${drill.exKey === 'gesture' ? 'Line-of-action match' : 'Curve match'}</span><b>${Math.round((m.iou || 0) * 100)}%</b></div>`;
    } else if (drill.exKey === 'sightsize') {
      // signed placement/size readouts — the exact corrections sight-size trains
      const off = (v, pos, neg) => v > 0 ? `${v}% ${pos}` : v < 0 ? `${-v}% ${neg}` : 'spot on';
      metricRows = `<div class="metricline"><span>Contour match</span><b>${Math.round((m.iou || 0) * 100)}%</b></div>
        <div class="metricline"><span>Placement ↔</span><b>${off(m.dx || 0, 'right', 'left')}</b></div>
        <div class="metricline"><span>Placement ↕</span><b>${off(m.dy || 0, 'low', 'high')}</b></div>
        <div class="metricline"><span>Size</span><b>${off(m.sizeErrPct || 0, 'large', 'small')}</b></div>`;
    } else {
      metricRows = `<div class="metricline"><span>Shape match</span><b>${Math.round((m.iou || 0) * 100)}%</b></div>
        <div class="metricline"><span>Proportion error</span><b>${m.aspectErrPct > 0 ? '+' : ''}${m.aspectErrPct}% ${m.aspectErrPct > 0 ? '(wide)' : m.aspectErrPct < 0 ? '(tall)' : ''}</b></div>`;
    }
    const lc = r.levelChange;
    const atCap = lc && lc.changed && lc.dir > 0 && drill.def && lc.level >= (drill.def.maxLevel || 9);
    const lvlMsg = lc && lc.changed
      ? (atCap
        ? `<div class="insight" style="background:var(--warn);color:#fff">❖ Master’s mark — ${esc(drill.def.name)} held at the top level. From here, spaced reviews keep it sharp.</div>`
        : `<div class="insight">${lc.dir > 0 ? '▲ Levelled up to ' + lc.level + ' — the study glance just got shorter.' : '▼ Eased to level ' + lc.level + ' to rebuild accuracy.'}</div>`)
      : '';
    // self-estimate vs actual (builds the internal error-detector)
    let estRow = '';
    if (r.selfEstimate != null) {
      const aw = A.coach.selfAwareness(r.estErr);
      estRow = `<div class="metricline"><span>You guessed / actual</span><b>${r.selfEstimate}% / ${r.score}%</b></div>
        <div class="tiny muted" style="margin:2px 0 8px">${esc(aw)} · off by ${r.estErr}%</div>`;
    }
    const coachRow = r.coaching ? `<div class="insight" style="text-align:left">${esc(r.coaching)}</div>` : '';
    // teaching layer: show the principle's TITLE inline (no click needed) with the
    // icon; the fuller "why + how" expands on tap so the card stays light.
    const pr = A.coach.principle(drill.exKey, r);
    const learnRow = pr ? `<div id="d-learn" class="learnrow"><button class="learnbtn" data-learn="1">
        <span class="lc-ic">${pr.icon}</span><span class="lt">${esc(pr.title)}</span><span class="lchev">›</span></button></div>` : '';
    // faded feedback with self-controlled access: the breakdown thins out with
    // skill, but the learner can always ASK for it (autonomy-supportive feedback)
    const detail = r.showDetail ? metricRows
      : `<div id="d-detail"><button class="btn ghost sm block" data-showdetail="1" style="margin-bottom:6px">Show breakdown</button></div>`;
    result.innerHTML = `<div class="card resultcard">
      <div class="scorebadge ${scoreClass(r.score)}">${r.score}</div>
      <div class="muted small" style="margin-bottom:8px">${r.recall ? 'retention accuracy' : 'accuracy'}${targetHint}</div>${pbMsg}${tutMsg}${modeMsg}${glanceMsg}${redrawNudge}
      ${estRow}${detail}${coachRow}${learnRow}${lvlMsg}</div>`;
    if (!r.showDetail) {
      const slot = $('#d-detail', result);
      if (slot) slot.querySelector('[data-showdetail]').onpointerup = (e) => { e.preventDefault(); slot.innerHTML = metricRows; };
    }
    if (pr) {
      const slot = $('#d-learn', result);
      if (slot) slot.querySelector('[data-learn]').onpointerup = (e) => {
        e.preventDefault();
        slot.innerHTML = `<div class="learncard"><div class="lc-head"><span class="lc-ic">${pr.icon}</span>${esc(pr.title)}</div>
          <div class="lc-why">${esc(pr.why)}</div>
          <div class="lc-how"><b>How:</b> ${esc(pr.how)}</div></div>`;
      };
    }
    controls.innerHTML = drill.exKey === 'sightsize'
      ? `<button class="btn ghost sm" data-act="close">Done ›</button>
         <button class="btn" data-act="refine">Refine the copy ›</button>`
      : drill.isRecall
      ? `<button class="btn ghost sm" data-act="again">Study it again</button>
         <button class="btn" data-act="close" id="d-recnext">Done ›</button>`
      : `<button class="btn ghost sm" data-act="redraw">Redraw</button>
         <button class="btn ghost sm" data-act="again">Re-study</button>
         <button class="btn" data-act="next">${atSetEnd() ? 'See results ›' : 'Next ›'}</button>`;
    // chain the moment: the retention check is a session OPENER — hand off to
    // the day's next step instead of stranding the user back on the dashboard
    if (drill.isRecall) {
      attempts(true).then((atts) => {
        const rec = A.game.recommend(atts);
        const b = $('#d-recnext');
        if (b && rec && rec.step !== 'recall') { pendingNextRec = rec; b.textContent = 'Next: ' + rec.title + ' ›'; b.dataset.act = 'recnext'; }
      }).catch(() => {});
    }
  }
  let pendingNextRec = null;

  function revealReference(instr, controls, result) {
    if (drill.result) {  // already rated/scored → show next actions
      instr.textContent = 'Saved. Compare with the reference.';
      result.innerHTML = `<div class="card resultcard"><div class="scorebadge ${scoreClass(drill.result.score)}">${drill.result.score}</div>
        <div class="muted small">${drill.result.objective ? 'auto-score (overlap)' : 'your self-rating'}</div></div>`;
      controls.innerHTML = `<button class="btn ghost sm" data-act="redraw">Redraw</button>
        <button class="btn ghost sm" data-act="again">Re-study</button>
        <button class="btn" data-act="next">${atSetEnd() ? 'See results ›' : 'Next ›'}</button>`;
      return;
    }
    instr.textContent = 'Fade the reference in. How close were you?';
    const hasImg = drill.ref && drill.ref.img;
    // Objective scoring is now the primary path for image references — it's the
    // app's superpower (measured feedback) extended from abstract shapes to real
    // subjects. Self-rating stays as the honest fallback (physical objects, or a
    // busy multi-figure plate the mask can't isolate).
    result.innerHTML = `<div class="card resultcard">
      ${hasImg ? `<div class="opacityctl"><span class="tiny muted">draw</span>
        <input type="range" id="d-op" min="0" max="100" value="${Math.round(drill.ghostOpacity * 100)}">
        <span class="tiny muted">ref</span></div>` : '<div class="small muted">Compare with your physical subject, then rate honestly.</div>'}
      ${proportionDrift()}
      ${hasImg ? '<button class="btn block" data-autoscore="1" style="margin-top:10px">Score against the reference ›</button>' : ''}
      <div style="margin:12px 0 6px" class="small">${hasImg ? 'or rate it yourself' : 'Rate your accuracy'}</div>
      <div class="ratebtns" id="d-rate">
        ${[1, 2, 3, 4, 5].map((n) => `<button data-rate="${n}">${n}</button>`).join('')}</div>
      <div class="tiny muted" style="margin-top:6px">1 = far off · 5 = very close</div></div>`;
    const flipBtn = hasImg ? `<button class="btn ghost sm" data-act="flip">Flip ⟲</button>` : '';
    const measureBtn = hasImg
      ? (surface.measureMode
        ? `<button class="btn ghost sm sel" data-act="measure">Measuring</button><button class="btn ghost sm" data-act="clearmeasure">Clear m.</button>`
        : `<button class="btn ghost sm" data-act="measure">Measure</button>`)
      : '';
    controls.innerHTML = `${flipBtn}${measureBtn}<button class="btn ghost sm" data-act="clear">Clear</button>`;
  }

  // height:width drift vs the plate — a Bargue proportion check at reveal
  function strokesAspect(strokes) {
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, n = 0;
    for (const s of strokes) for (const p of s) { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; n++; }
    if (n < 2) return null; const w = maxx - minx, h = maxy - miny;
    if (w < 0.01 || h < 0.01) return null; return h / w;
  }
  // Plates are multi-figure sheets, so an auto whole-image ratio is meaningless. Show
  // the learner's own height:width and steer them to the reliable, method-faithful check:
  // fade the plate in, then use the Measure caliper to compare proportions by hand.
  function proportionDrift() {
    const ua = strokesAspect(surface.strokesDesign());
    if (!ua) return '';
    return `<div class="metricline" style="margin-top:8px"><span>Your drawing — H:W</span><b>${ua.toFixed(2)}</b></div>
      <div class="tiny muted" style="margin:2px 0 4px">Fade the plate in and tap <b>Measure</b> to check it against the plate: set a unit on the height, then step it across the width. The plumb &amp; horizon lines show alignment drift.</div>`;
  }

  function showAutoScore() {
    const result = $('#d-result'), instr = $('#d-instr');
    instr.textContent = 'Scored against the reference — nudge the highlight if it misses the subject.';
    // auto-tune the threshold/invert (Otsu) so it works with no fiddling on a
    // clean subject; the sliders remain for the awkward cases
    const auto = A.imgScore.autoThreshold(drill.ref.img, null);
    let threshold = auto.threshold, invert = auto.invert, region = null;
    function recompute() {
      const r = A.imgScore.score(drill.ref.img, surface.strokesDesign(), threshold, invert, region);
      surface.setGhost(A.imgScore.maskPreview(drill.ref.img, threshold, invert, region), 0.6);
      const sb = $('#as-score'); if (sb) { sb.textContent = r.score; sb.className = 'scorebadge ' + scoreClass(r.score); }
      const cov = $('#as-cov'); if (cov) {
        if (r.method === 'edge') {
          // line-art plate: scored by how well your lines follow the plate's
          cov.textContent = 'line match ' + Math.round(r.iou * 100) + '% · block-in';
        } else {
          const c = region ? r.coverage * 4 : r.coverage;   // a panel is ~¼ of the plate
          const warn = c > 0.6 ? ' · mask too large — adjust' : r.coverage < 0.005 ? ' · mask too small — adjust' : '';
          cov.textContent = 'overlap ' + Math.round(r.iou * 100) + '%' + warn;
        }
      }
      return r;
    }
    function endCrop() { surface.cropMode = false; surface.onCropEnd = null; surface.cropRect = null; }
    function beginCrop() {
      instr.textContent = 'Drag a box around one panel.';
      surface.setGhost(drill.ref.img, 0.75);     // show the photo to select on
      surface.cropRect = null; surface.cropMode = true; surface.redraw();
      surface.onCropEnd = (cr) => {
        const gr = surface.ghostRectDesign();
        const x0 = Math.min(cr[0][0], cr[1][0]), y0 = Math.min(cr[0][1], cr[1][1]);
        const x1 = Math.max(cr[0][0], cr[1][0]), y1 = Math.max(cr[0][1], cr[1][1]);
        const fx = (v) => Math.max(0, Math.min(1, (v - gr.x) / gr.w)), fy = (v) => Math.max(0, Math.min(1, (v - gr.y) / gr.h));
        region = { x: fx(x0), y: fy(y0), w: fx(x1) - fx(x0), h: fy(y1) - fy(y0) };
        if (region.w < 0.03 || region.h < 0.03) region = null;
        surface.cropRect = null; surface.onCropEnd = null;
        instr.textContent = 'Scored against the reference — nudge the highlight if it misses the subject.';
        // re-tune to the selected panel
        const a2 = A.imgScore.autoThreshold(drill.ref.img, region); threshold = a2.threshold; invert = a2.invert;
        const th = $('#as-th'); if (th) th.value = threshold;
        const inv = $('#as-inv'); if (inv) inv.classList.toggle('sel', invert);
        const pl = $('#as-panel'); if (pl) pl.textContent = region ? '✓ panel selected' : 'whole image';
        recompute();
      };
    }
    result.innerHTML = `<div class="card resultcard">
      <div class="small" style="margin-bottom:6px">Overlap with the real subject. For a multi-panel plate, select one panel.</div>
      <div class="scorebadge" id="as-score">–</div>
      <div class="tiny muted" id="as-cov" style="margin-bottom:6px"></div>
      <div class="row" style="margin:4px 0;justify-content:center"><button class="btn ghost sm" id="as-crop">Select panel</button>
        <button class="btn ghost sm" id="as-full">Whole image</button>
        <span class="tiny muted" id="as-panel" style="align-self:center">whole image</span></div>
      <div class="opacityctl"><span class="tiny muted">dark</span>
        <input type="range" id="as-th" min="20" max="235" value="${threshold}">
        <span class="tiny muted">light</span></div>
      <button class="btn ghost sm ${invert ? 'sel' : ''}" id="as-inv" style="margin-top:6px">Invert subject</button>
      <div class="row" style="margin-top:10px"><button class="btn ghost block" id="as-back">Self-rate instead</button>
        <button class="btn block" id="as-use">Use score</button></div></div>`;
    $('#d-controls').innerHTML = '';
    recompute();
    $('#as-th').oninput = (e) => { threshold = +e.target.value; recompute(); };
    $('#as-inv').onclick = function () { invert = !invert; this.classList.toggle('sel', invert); recompute(); };
    $('#as-crop').onclick = beginCrop;
    $('#as-full').onclick = () => { region = null; surface.cropRect = null; $('#as-panel').textContent = 'whole image'; recompute(); };
    $('#as-back').onclick = () => { endCrop(); surface.setGhost(drill.ref.img, drill.ghostOpacity); updateDrill(); };
    $('#as-use').onclick = () => { const r = recompute(); endCrop(); drill.submitObjectiveScore(r.score, { iou: r.iou }); };
  }

  function bindControls(controls, result) {
    const act = (a) => {
      if (a === 'skip') drill.skipStudy();
      else if (a === 'glance') drill.glance(600, true);
      else if (a === 'clear') { surface.clearMarks(); updateDrill(); }
      else if (a === 'undo') { surface.undo(); updateDrill(); }
      else if (a === 'erase') { surface.toggleEraser(); updateDrill(); }
      else if (a === 'flip') { drill.toggleFlip(); updateDrill(); }
      else if (a === 'guides') { drill.toggleGuides(); updateDrill(); }
      else if (a === 'measure') { surface.toggleMeasure(); updateDrill(); }
      else if (a === 'clearmeasure') { surface.clearMeasures(); updateDrill(); }
      else if (a === 'stepback') surface.toggleStepBack();   // onStepBack refreshes the UI
      else if (a === 'flick') surface.flick();
      else if (a === 'string') { surface.toggleString(); updateDrill(); }
      else if (a === 'refine') drill.refineSightSize();
      else if (a === 'nextstage') drill.nextStage();
      else if (a === 'evaluate') drill.evaluate();
      else if (a === 'redraw') drill.correctAndRedraw();
      else if (a === 'again') drill.studyAgain();
      else if (a === 'skipdrill') sessionSkip();
      else if (a === 'next') sessionAdvance();
      else if (a === 'close') closeDrill();
      else if (a === 'recnext') { const rec = pendingNextRec; pendingNextRec = null; closeDrill(); if (rec) doRec(rec.step, rec.exKey); }
    };
    // Use pointerup (not click): iOS suppresses the first synthetic click right after
    // a Pencil drawing gesture on a touch-action:none canvas, which caused the
    // "have to tap twice" bug. pointerup fires immediately on tap.
    controls.onclick = null;
    controls.onpointerup = (e) => { const b = e.target.closest('[data-act]'); if (b) { e.preventDefault(); act(b.dataset.act); } };
    if (result) {
      result.onclick = null;
      result.onpointerup = (e) => {
        if (e.target.closest('[data-rate],[data-estbox],[data-estconfirm],[data-autoscore]')) e.preventDefault();
        const rb = e.target.closest('[data-rate]');
        if (rb) {
          const map = { 1: 40, 2: 58, 3: 72, 4: 85, 5: 95 };
          $$('#d-rate button').forEach((x) => x.classList.remove('sel')); rb.classList.add('sel');
          setTimeout(() => drill.submitSelfRating(map[rb.dataset.rate]), 180);
          return;
        }
        const box = e.target.closest('[data-estbox]');
        if (box) {
          $$('#d-result [data-estbox]').forEach((x) => x.classList.remove('sel')); box.classList.add('sel');
          const o = $('#d-estv'); if (o) o.textContent = box.dataset.estbox + '%';
          const sl = $('#d-est'); if (sl) sl.value = box.dataset.estbox;
          setTimeout(() => drill.submitEstimate(+box.dataset.estbox), 160); return;
        }
        if (e.target.closest('[data-estconfirm]')) { const v = +($('#d-est') ? $('#d-est').value : 70); drill.submitEstimate(v); return; }
        if (e.target.closest('[data-autoscore]')) showAutoScore();
      };
      result.oninput = (e) => {
        if (e.target.id === 'd-op') drill.setGhostOpacity(e.target.value / 100);
        if (e.target.id === 'd-est') { const o = $('#d-estv'); if (o) o.textContent = e.target.value + '%'; $$('#d-result [data-estbox]').forEach((x) => x.classList.remove('sel')); }
      };
    }
  }

  /* ======================================================================
     STATS
     ====================================================================== */
  let statsCat = 'all';
  async function renderStats(v) {
    const all = await attempts();
    if (!all.length) { v.innerHTML = `<div class="card"><h2>Statistics</h2><p class="muted small">No drills yet — practise a little and your accuracy trends, calibration bias and study-time curve will appear here.</p></div>`; return; }
    const sum = A.stats.summary(all);
    const trend = A.stats.dailyTrend(all, statsCat === 'all' ? null : statsCat);
    const trendTypes = Array.from(new Set(all.filter((a) => a.scored && !PERC_LABELS[a.type]).map((a) => a.type)));
    const trendChips = [`<button class="chip ${statsCat === 'all' ? 'active' : ''}" data-tcat="all">All</button>`]
      .concat(trendTypes.map((t) => `<button class="chip ${statsCat === t ? 'active' : ''}" data-tcat="${t}">${esc(exName(t).split(' ')[0])}</button>`)).join('');
    const byType = Object.values(sum.byType).map((t) => ({ label: exName(t.type), value: t.mean, suffix: '' }));

    // discrimination thresholds (2AFC): lower = a finer eye — plot so up = better
    let afcCard = '';
    const afcKinds = [['afc-angle', '°', 'angle'], ['afc-length', '%', 'length']];
    const afcRows = afcKinds.map(([type, unit, label]) => {
      const runs = all.filter((a) => a.type === type && a.metrics && a.metrics.threshold != null);
      if (!runs.length) return '';
      const byDay = {};
      runs.forEach((a) => { (byDay[a.day] || (byDay[a.day] = [])).push(a.metrics.threshold); });
      const t = Object.keys(byDay).sort().map((d) => ({ day: d, score: Math.max(0, Math.min(100, Math.round(100 - (byDay[d].reduce((x, y) => x + y, 0) / byDay[d].length) * (type === 'afc-angle' ? 6 : 4)))) }));
      const best = A.store.get('afcBest', {})[label];
      return `<div class="small muted" style="margin-top:6px">${esc(exName(type))} — best threshold <b>${best != null ? best + unit : '—'}</b> (lower = finer)</div>${A.charts.line(t)}`;
    }).filter(Boolean).join('');
    if (afcRows) afcCard = `<div class="card"><h2>Discrimination</h2>
      <div class="small muted">the smallest difference your eye can catch — sharpening this is sharpening the eye itself</div>${afcRows}</div>`;

    // calibration insights for scored types that have data — each with a
    // "practice this" hand-off so Stats is a springboard, not a cul-de-sac
    let calib = '';
    ['line', 'angles', 'polygon', 'envelope'].forEach((tp) => {
      const b = A.stats.bias(all, tp);
      if (!b.n) return;
      const def = A.curr.def(tp);
      const go = `<button class="btn soft sm" data-focus="${tp}" style="margin-top:8px">Practice this ›</button>`;
      if (b.kind === 'line' || b.kind === 'angles') {
        calib += `<div class="card"><h2>${esc(def.name)} — calibration <span class="muted small">(${b.n})</span></h2>
          <div class="small muted" style="margin-top:4px">Average angle bias: <b>${b.angle.mean > 0 ? '+' : ''}${b.angle.mean}°</b></div>
          ${A.charts.biasBar(b.angle.mean, 20, ['rotate CCW', 'rotate CW'])}
          <div class="small muted">Average length bias: <b>${b.length.mean > 0 ? '+' : ''}${b.length.mean}%</b></div>
          ${A.charts.biasBar(b.length.mean, 30, ['too short', 'too long'])}
          ${insight(b.angle.mean, b.length.mean)}${go}</div>`;
      } else {
        calib += `<div class="card"><h2>${esc(def.name)} — calibration <span class="muted small">(${b.n})</span></h2>
          <div class="small muted" style="margin-top:4px">Average proportion bias: <b>${b.aspect.mean > 0 ? '+' : ''}${b.aspect.mean}%</b></div>
          ${A.charts.biasBar(b.aspect.mean, 30, ['too tall', 'too wide'])}${go}</div>`;
      }
    });

    // then vs now — visible improvement in your own strokes
    const cmpTypes = ['line', 'angles', 'curve', 'polygon', 'envelope'].filter((t) => A.history.compare(all, t));
    const progressCard = cmpTypes.length ? `<div class="card"><h2>Then vs now</h2>
      <div class="small muted">your earliest attempts beside your latest — proof the practice works</div>
      <div class="row wrap" style="margin-top:10px">${cmpTypes.map((t) => `<button class="btn soft sm" data-cmp="${t}">${esc(exName(t))} ›</button>`).join('')}</div></div>` : '';

    // overnight memory — the retention checks deserve their own scoreboard
    const recalls = all.filter((a) => a.recall);
    let retCard = '';
    if (recalls.length) {
      const byDay = {};
      recalls.forEach((a) => { (byDay[a.day] || (byDay[a.day] = [])).push(a.score); });
      const trend = Object.keys(byDay).sort().map((d) => ({ day: d, score: Math.round(byDay[d].reduce((x, y) => x + y, 0) / byDay[d].length), n: byDay[d].length }));
      const rMean = Math.round(recalls.reduce((s, a) => s + a.score, 0) / recalls.length);
      const firstLook = all.filter((a) => a.scored && !a.repeat && !a.recall && !PERC_LABELS[a.type]);
      const fMean = firstLook.length ? Math.round(firstLook.reduce((s, a) => s + a.score, 0) / firstLook.length) : null;
      retCard = `<div class="card"><h2>Overnight memory <span class="muted small">(${recalls.length})</span></h2>
        <div class="small muted">retention checks — figures recalled across a day. Mean <b>${rMean}</b>${fMean != null ? ` vs ${fMean} same-day` : ''}; that gap closing is long-term memory forming.</div>
        ${A.charts.line(trend)}</div>`;
    }

    const sva = A.stats.studyVsAccuracy(all);
    const pa = all.filter((a) => a.type === 'perc-angle' && a.metrics && a.metrics.angleErrDeg != null).slice(-A.stats.BIAS_WINDOW);
    let percCard = '';
    if (pa.length) {
      const m = +(pa.reduce((s, a) => s + a.metrics.angleErrDeg, 0) / pa.length).toFixed(1);
      percCard = `<div class="card"><h2>Perceive: Angle — bias <span class="muted small">(${pa.length})</span></h2>
        <div class="small muted">pure perception, no drawing. Average signed error ${m > 0 ? '+' : ''}${m}°</div>
        ${A.charts.biasBar(m, 20, ['under-rotate', 'over-rotate'])}
        <button class="btn soft sm" data-perc="angle" style="margin-top:8px">Warm up ›</button></div>`;
    }
    const sa = A.stats.selfAwareness(all);
    const calLine = sa && sa.bias != null ? A.coach.calibration(sa.bias) : '';
    const saCard = sa ? `<div class="card"><h2>Self-awareness <span class="muted small">(${sa.n})</span></h2>
      <div class="small muted">how well your pre-reveal guess matched the real score — higher = you see your own errors. Avg gap ${sa.meanGap} pts (recent).</div>
      ${A.charts.line(sa.trend)}
      ${sa.bias != null ? `<div class="small muted" style="margin-top:6px">Direction: <b>${sa.bias > 0 ? '+' : ''}${sa.bias} pts</b></div>${A.charts.biasBar(sa.bias, 20, ['underconfident', 'overconfident'])}` : ''}
      ${calLine ? `<div class="insight">${esc(calLine)}</div>` : ''}</div>` : '';

    v.innerHTML = `
      <div class="card"><h2>Overview</h2>
        <div class="kpi" style="margin-top:10px">
          <div class="k"><div class="v">${sum.meanScore}</div><div class="l">mean accuracy</div></div>
          <div class="k"><div class="v">${sum.total}</div><div class="l">drills</div></div>
          <div class="k"><div class="v">${sum.days}</div><div class="l">days active</div></div>
          <div class="k"><div class="v">🔥 ${A.habit.streak()}</div><div class="l">streak</div></div>
        </div></div>
      <div class="card"><h2>Accuracy over time</h2><div class="small muted">daily mean — tap a drill to isolate it</div>
        <div class="chips" style="margin:8px 0 4px">${trendChips}</div>${A.charts.line(trend)}</div>
      ${afcCard}
      ${progressCard}
      ${retCard}
      <div class="card"><h2>By exercise</h2>${A.charts.bars(byType)}</div>
      ${saCard}
      ${percCard}
      ${calib}
      <div class="card"><h2>Study time vs accuracy</h2>
        <div class="small muted">each dot is one scored drill — does a longer glance actually help you?</div>
        ${A.charts.scatter(sva)}</div>`;
    v.onclick = (e) => {
      const tc = e.target.closest('[data-tcat]'); if (tc) { statsCat = tc.dataset.tcat; renderStats(v); return; }
      const c = e.target.closest('[data-cmp]'); if (c) { showCompare(all, c.dataset.cmp); return; }
      const f = e.target.closest('[data-focus]'); if (f) { startExercise(f.dataset.focus); return; }
      const p = e.target.closest('[data-perc]'); if (p) A.Perceive.start(p.dataset.perc);
    };
  }

  // "then vs now" modal: two replays side by side + the deltas that matter
  function showCompare(all, type) {
    const c = A.history.compare(all, type); if (!c) return;
    const fmtBias = (b) => b ? `${b.val > 0 ? '+' : ''}${b.val}${b.unit}` : '—';
    const sheet = openModal(`<h2>${esc(exName(type))} — then vs now</h2>
      <div class="small muted">${c.spanDays} days apart · your first five vs your latest five</div>
      <div class="cmpgrid">
        <div><div class="tiny muted" style="text-align:center;margin-bottom:4px">then</div><canvas class="replaycv" id="cmp-a"></canvas></div>
        <div><div class="tiny muted" style="text-align:center;margin-bottom:4px">now</div><canvas class="replaycv" id="cmp-b"></canvas></div>
      </div>
      <div class="metricline"><span>Mean accuracy</span><b>${c.early.mean} → ${c.late.mean}</b></div>
      ${c.early.bias && c.late.bias ? `<div class="metricline"><span>${esc(c.late.bias.label)}</span><b>${fmtBias(c.early.bias)} → ${fmtBias(c.late.bias)}</b></div>` : ''}
      <div class="metricline"><span>Study glance</span><b>${c.early.study}s → ${c.late.study}s</b></div>
      ${c.early.estErr != null && c.late.estErr != null ? `<div class="metricline"><span>Self-estimate gap</span><b>±${c.early.estErr} → ±${c.late.estErr}</b></div>` : ''}
      <button class="btn block" data-done="1" style="margin-top:12px">Close</button>`);
    const draw = (sel, att) => {
      const cv = $(sel, sheet); if (!cv) return;
      const dpr = window.devicePixelRatio || 1;
      const s = Math.round((cv.clientWidth || 170) * dpr);
      cv.width = s; cv.height = s;
      A.history.drawReplay(cv.getContext('2d'), att, s, 1);
    };
    draw('#cmp-a', c.early.att); draw('#cmp-b', c.late.att);
    sheet.addEventListener('click', (e) => { if (e.target.closest('[data-done]')) closeModal(); });
  }
  function insight(angle, len) {
    const parts = [];
    if (Math.abs(angle) >= 2) parts.push(`you consistently rotate lines ${angle > 0 ? 'clockwise' : 'anticlockwise'} (${Math.abs(angle)}°) — bias your aim the other way`);
    if (Math.abs(len) >= 4) parts.push(`you tend to draw ${len > 0 ? 'too long' : 'too short'} by ${Math.abs(len)}% — ${len > 0 ? 'shorten' : 'extend'} deliberately`);
    if (!parts.length) return '<div class="insight">Well calibrated — no strong systematic bias. 👌</div>';
    return `<div class="insight">${esc(parts.join('; '))}.</div>`;
  }

  /* ======================================================================
     HISTORY
     ====================================================================== */
  let histCat = 'all';
  async function renderHistory(v) {
    const all = (await attempts()).slice().sort((a, b) => b.ts - a.ts);
    if (!all.length) { v.innerHTML = `<div class="card"><h2>History</h2><p class="muted small">Your saved drills will appear here as a gallery you can replay.</p></div>`; return; }
    // filter chips: only the types that actually have attempts
    const types = Array.from(new Set(all.map((a) => a.type))).filter((t) => !PERC_LABELS[t]);
    const chips = [`<button class="chip ${histCat === 'all' ? 'active' : ''}" data-cat="all">All</button>`]
      .concat(types.map((t) => `<button class="chip ${histCat === t ? 'active' : ''}" data-cat="${t}">${esc(exName(t).split(' ')[0])}</button>`)).join('');
    const shown = histCat === 'all' ? all : all.filter((a) => a.type === histCat);
    const cells = shown.slice(0, 200).map((a) => {
      return `<div class="cell" data-att="${a.id}">${A.history.thumbSVG(a, 130)}
        <div class="cap"><span>${esc(exName(a.type).split(' ')[0])}${a.recall ? ' ⟲' : ''}</span>
        <span class="sc ${scoreClass(a.score)}">${a.score}${a.selfRated ? '*' : ''}</span></div></div>`;
    }).join('');
    // per-drill mini progress line when filtered
    let trendCard = '';
    if (histCat !== 'all') {
      const t = A.stats.dailyTrend(shown.slice().reverse(), histCat);
      if (t.length >= 2) trendCard = `<div class="card"><h2>${esc(exName(histCat))} — progress</h2>${A.charts.line(t)}</div>`;
    }
    v.innerHTML = `<div class="card"><div class="row between center"><h2>History</h2><span class="muted small">${shown.length} drills · * = self-rated</span></div></div>
      <div class="chips">${chips}</div>${trendCard}
      <div class="gal">${cells || '<div class="muted small">Nothing in this category yet.</div>'}</div>`;
    v.onclick = (e) => {
      const ch = e.target.closest('[data-cat]'); if (ch) { histCat = ch.dataset.cat; renderHistory(v); return; }
      const c = e.target.closest('[data-att]'); if (c) showAttempt(all.find((x) => x.id == c.dataset.att));
    };
  }

  function showAttempt(a) {
    if (!a) return;
    const dt = new Date(a.ts);
    const def = A.curr.def(a.type);
    const m = a.metrics || {};
    let detail = '';
    if (a.type === 'line' || a.type === 'angles') {
      const ae = m.angleErrDeg != null ? m.angleErrDeg : m.meanAngleErrDeg;
      const le = m.lengthErrPct != null ? m.lengthErrPct : m.meanLengthErrPct;
      if (ae != null) detail += `<div class="metricline"><span>Angle error</span><b>${ae > 0 ? '+' : ''}${ae}°</b></div>`;
      if (le != null) detail += `<div class="metricline"><span>Length error</span><b>${le > 0 ? '+' : ''}${le}%</b></div>`;
    } else if (m.iou != null) {
      const label = a.type === 'gesture' ? 'Line-of-action match' : a.type === 'curve' ? 'Curve match' : 'Shape match';
      detail += `<div class="metricline"><span>${label}</span><b>${Math.round(m.iou * 100)}%</b></div>`;
      if (m.aspectErrPct != null) detail += `<div class="metricline"><span>Proportion error</span><b>${m.aspectErrPct > 0 ? '+' : ''}${m.aspectErrPct}%</b></div>`;
    }
    const sheet = openModal(`<div class="row between center"><h2>${esc(exName(a.type))}</h2>
      <span class="scorebadge ${scoreClass(a.score)}" style="font-size:30px">${a.score}${a.selfRated ? '*' : ''}</span></div>
      <div class="small muted">${dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · Lv ${a.level}${a.recall ? ' · retention check' : ''}${a.repeat ? ' · redraw' : ''} · ${a.studySec}s study · ${a.drawSec}s draw</div>
      <canvas class="replaycv" id="rep"></canvas>
      <div class="row" style="margin:8px 0"><button class="btn soft sm" id="rep-play">▶ Replay</button>
        ${a.refTitle ? `<span class="small muted center" style="display:flex;align-items:center">ref: ${esc(a.refTitle)}</span>` : ''}</div>
      ${detail}
      <button class="btn ghost block" id="att-del" style="margin-top:12px">Delete this drill</button>`);
    const cv = $('#rep', sheet); const ctx = cv.getContext('2d');
    // render at the DISPLAYED size × devicePixelRatio, or the replay is blurry
    // on every retina iPad (the buffer used to be a fixed 360)
    const cssW = cv.clientWidth || 360, dpr = window.devicePixelRatio || 1;
    const size = Math.round(cssW * dpr);
    cv.width = size; cv.height = size;
    A.history.drawReplay(ctx, a, size, 1);
    let raf = null;
    $('#rep-play', sheet).onclick = () => {
      cancelAnimationFrame(raf); const t0 = performance.now(); const dur = 1400;
      const step = (t) => { const p = Math.min(1, (t - t0) / dur); A.history.drawReplay(ctx, a, size, p); if (p < 1) raf = requestAnimationFrame(step); };
      raf = requestAnimationFrame(step);
    };
    $('#att-del', sheet).onclick = () => {
      confirmModal('Delete this drill?', 'The recorded attempt and its replay are removed.', 'Delete',
        async () => { await A.store.deleteAttempt(a.id); invalidate(); closeModal(); ui.go('history'); toast('Drill deleted'); }, true);
    };
  }

  /* ======================================================================
     LIBRARY
     ====================================================================== */
  let libCat = 'all';
  function renderLibrary(v) {
    const cats = [['all', 'All'], ['bargue', 'Bargue plates'], ['lines', 'Lines'], ['polygons', 'Polygons'], ['envelopes', 'Organic'], ['user', 'My references']];
    const chips = cats.map(([k, l]) => `<button class="chip ${libCat === k ? 'active' : ''}" data-cat="${k}">${l}</button>`).join('');
    const items = A.library.byCategory(libCat);
    const cells = items.map((it) => `<div class="libcell" data-ref="${esc(it.id)}">
      <img src="${it.src}" alt="" loading="lazy">
      ${it.bundled ? '' : `<button class="del" data-del="${esc(it.id)}">✕</button>`}
      <div class="cap">${esc(it.title)}${it.attrib ? '<div class="tiny muted" style="margin-top:2px">PD · Wikimedia Commons</div>' : ''}</div></div>`).join('') || '<div class="muted small">Nothing here yet.</div>';
    v.innerHTML = `<div class="card"><div class="row between center"><h2>Reference library</h2>
        <label class="btn soft sm">Import<input type="file" id="lib-file" accept="image/*" multiple hidden></label></div>
      <p class="small muted" style="margin:6px 0 0">Bundled worksheets and Bargue plates for offline use. Import your own photos (hands, eggs, paintings) for negative-space, value and master-copy drills.</p>
      <p class="tiny muted" style="margin:6px 0 0">Bargue plates are public domain (Charles Bargue, <i>Cours de dessin</i>, 1860s–70s) via Wikimedia Commons.</p></div>
      <div class="chips">${chips}</div>
      <div class="libgrid">${cells}</div>`;
    $$('.chip', v).forEach((c) => c.onclick = () => { libCat = c.dataset.cat; renderLibrary(v); });
    $('#lib-file', v).onchange = async (e) => {
      const files = Array.prototype.slice.call(e.target.files);
      for (const f of files) { try { await A.library.importFile(f); } catch (err) { toast('Could not import ' + f.name); } }
      toast(files.length + ' image(s) imported'); renderLibrary(v);
    };
    v.querySelectorAll('[data-del]').forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      confirmModal('Delete this reference?', 'The imported image is removed from your library.', 'Delete',
        async () => { await A.library.deleteUser(b.dataset.del); renderLibrary(v); }, true);
    });
  }

  /* ======================================================================
     MORE  (settings + library entry + about + backup)
     ====================================================================== */
  // a rising learning-curve with the 5 ranks as milestones and a "you are here" marker
  function journeySVG(rk) {
    const names = A.game.rankNames, n = names.length;
    const W = 520, H = 132, padX = 34, top = 22, bot = 34;
    const X = (i) => padX + i / (n - 1) * (W - 2 * padX);
    const Y = (i) => (H - bot) - i / (n - 1) * (H - top - bot);   // rises left→right
    let base = ''; for (let i = 0; i < n; i++) base += (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(i).toFixed(1) + ' ';
    const cur = rk.index;
    const mX = cur < n - 1 ? X(cur) + (X(cur + 1) - X(cur)) * rk.progress : X(cur);
    const mY = cur < n - 1 ? Y(cur) + (Y(cur + 1) - Y(cur)) * rk.progress : Y(cur);
    let fill = 'M' + X(0).toFixed(1) + ',' + Y(0).toFixed(1) + ' ';
    for (let i = 1; i <= cur; i++) fill += 'L' + X(i).toFixed(1) + ',' + Y(i).toFixed(1) + ' ';
    fill += 'L' + mX.toFixed(1) + ',' + mY.toFixed(1) + ' ';
    const nodes = names.map((nm, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(i).toFixed(1)}" r="${i === cur ? 6 : 4.5}" fill="${i <= cur ? 'var(--accent)' : 'var(--hair)'}" stroke="var(--card)" stroke-width="2"/><text x="${X(i).toFixed(1)}" y="${H - 6}" class="jlabel ${i === cur ? 'cur' : ''}" text-anchor="middle">${esc(nm)}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="chart">
      <path d="${base}" fill="none" stroke="var(--hair)" stroke-width="3" stroke-linecap="round"/>
      <path d="${fill}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/>
      ${nodes}<circle cx="${mX.toFixed(1)}" cy="${mY.toFixed(1)}" r="4" fill="var(--ink)"/></svg>`;
  }

  async function renderMap(v) {
    const allAtts = await attempts();
    // gold state: a drill held at cap — mastery is UPHELD, not just reached
    const star = (n, gold) => Array.from({ length: 5 }, (_, i) => `<span style="color:${i < n ? (gold ? 'var(--warn)' : 'var(--accent)') : 'var(--line)'}">★</span>`).join('');
    const sections = A.curr.modules.map((m) => {
      const exs = A.curr.EXERCISES.filter((e) => e.module === m.n);
      const nodes = exs.map((e) => {
        if (e.scored) {
          const lvl = A.curr.level(e.key);
          const gold = lvl >= (e.maxLevel || 9);
          return `<div class="mapnode" data-focus="${e.key}"><div class="mn-name">${esc(e.name)}${gold ? ' <span class="lvlpill" style="background:var(--warn);color:#fff">held at cap</span>' : ''}</div>
            <div class="mn-stars">${star(A.game.starTier(lvl), gold)} <span class="tiny muted">Lv ${lvl}</span></div></div>`;
        }
        if (e.key === 'bargue') {
          const pb = A.store.get('platesBest', {});
          const stars = A.game.PLATES.map((id) => (pb[id] || 0) >= A.game.PLATE_PASS ? '★' : '☆').join('');
          return `<div class="mapnode" data-ex="${e.key}"><div class="mn-name">${esc(e.name)} <span class="tag self">plate course</span></div>
            <div class="mn-stars"><span style="color:var(--accent);letter-spacing:2px">${stars}</span> <span class="tiny muted">${A.game.platesPassed()}/4 plates passed</span></div></div>`;
        }
        return `<div class="mapnode" data-ex="${e.key}"><div class="mn-name">${esc(e.name)} <span class="tag self">self-check</span></div>
          <div class="tiny muted">reference drill</div></div>`;
      }).join('');
      return `<div class="card"><h2>Module ${m.n} · ${esc(m.name)}</h2><div class="small muted">${esc(m.note)}</div>
        <div class="mapwrap">${nodes}</div></div>`;
    }).join('');
    const rk = A.game.rank();
    const desc = ['finding your eye', 'lines & angles', 'shapes & proportion', 'real subjects & plates', 'drawing from memory'][rk.index] || '';
    const journeyCard = `<div class="card"><h2>Your journey</h2>${journeySVG(rk)}
      <div class="small muted" style="text-align:center;margin-top:2px">You are a <b>${esc(rk.name)}</b> — ${esc(desc)}. ${rk.next ? `${rk.nextAt - rk.points} pts to ${esc(rk.next)} (${rk.points} pts).` : ''}</div></div>`;
    // post-Master: reframe from climbing to UPHOLDING — skills decay on the
    // spaced schedule; the master's practice is keeping them from decaying
    let masterCard = '';
    if (!rk.next) {
      const due = A.curr.dueDrills(A.habit.today()).concat(A.curr.dueRefs(A.habit.today()));
      const capped = A.curr.EXERCISES.filter((e) => e.scored && A.curr.level(e.key) >= (e.maxLevel || 9)).length;
      const sa = A.stats.selfAwareness(allAtts);
      masterCard = `<div class="card"><h2>Master’s practice</h2>
        <div class="small muted" style="margin-top:4px">The rank is earned; the skill is upheld. Reviews keep it from decaying.</div>
        <div class="kpi" style="margin-top:10px">
          <div class="k"><div class="v">${capped}/5</div><div class="l">held at cap</div></div>
          <div class="k"><div class="v">${due.length}</div><div class="l">due for review</div></div>
          <div class="k"><div class="v">${A.game.platesPassed()}/4</div><div class="l">plates passed</div></div>
          ${sa ? `<div class="k"><div class="v">±${sa.meanGap}</div><div class="l">self-read gap</div></div>` : ''}
        </div></div>`;
    }
    // achievements live on the journey, not the daily dashboard
    const ach = A.game.check(allAtts);
    const earnedCount = Object.keys(ach.earned).length;
    const badges = A.game.ACH.map((a) => {
      const got = !!ach.earned[a.id];
      return `<div class="badge ${got ? '' : 'locked'}" title="${esc(a.desc)}"><div class="bic">${a.icon}</div><div class="bnm">${esc(a.name)}</div></div>`;
    }).join('');
    const achCard = `<div class="card"><div class="row between center"><h2>Achievements</h2>
        <span class="muted small">${earnedCount}/${A.game.ACH.length}</span></div>
      <div class="badges">${badges}</div></div>`;
    v.innerHTML = `${journeyCard}${masterCard}<div class="banner">Each scored drill earns stars as its level rises; the real-subject drills unlock as your basics get solid.</div>${sections}${achCard}`;
    v.onclick = (e) => {
      const bd = e.target.closest('.badge'); if (bd) { toast(bd.getAttribute('title') || ''); return; }
      const f = e.target.closest('[data-focus]'); if (f) { startExercise(f.dataset.focus); return; }
      const x = e.target.closest('[data-ex]'); if (x) startExercise(x.dataset.ex);
    };
  }

  function renderMore(v) {
    v.innerHTML = `
      <div class="card"><h2>More</h2>
        <div class="exrow" data-go="map"><div class="meta"><div class="nm">Progress map</div><div class="small muted">Your skill path across the modules</div></div><span class="muted">›</span></div>
        <div class="exrow" data-go="library"><div class="meta"><div class="nm">Reference library</div><div class="small muted">Bundled plates + import your own</div></div><span class="muted">›</span></div>
        <div class="exrow" data-go="settings"><div class="meta"><div class="nm">Settings</div><div class="small muted">Goal, Pencil, ink, backup</div></div><span class="muted">›</span></div>
      </div>
      <div class="card"><h2>About</h2><p class="small muted">Atelier trains visual memory in the classical tradition (Lecoq de Boisbaudran → Bargue → Florence Academy): study, hide, draw from memory, correct. Works fully offline. Your data lives only on this device — back it up regularly.</p>
        <p class="tiny muted" style="margin-top:8px">Bargue plates: public domain (Charles Bargue &amp; J.-L. Gérôme, <i>Cours de dessin</i>, c. 1866–73), via Wikimedia Commons.</p></div>`;
    v.onclick = (e) => { const b = e.target.closest('[data-go]'); if (b) ui.go(b.dataset.go); };
  }

  function renderSettings(v) {
    const pencilOnly = A.store.get('pencilOnly', false);
    const goal = A.habit.goalMin();
    const inkW = A.store.get('inkWidth', 3.2);
    const curPid = A.store.profileId();
    const profRows = A.store.profiles().map((p) => {
      const isCur = p.id === curPid;
      return `<div class="setrow"><div><div>${esc(p.name)} ${isCur ? '<span class="lvlpill">current</span>' : ''}</div>
          <div class="small muted">${p.id === 'default' ? 'original profile' : 'own levels, streak & history'}</div></div>
        <div class="row" style="gap:6px">
          ${isCur ? '' : `<button class="btn ghost sm" data-psw="${esc(p.id)}">Switch</button>`}
          <button class="btn ghost sm" data-pren="${esc(p.id)}">Rename</button>
          ${(p.id === 'default' || isCur) ? '' : `<button class="btn ghost sm" data-pdel="${esc(p.id)}" style="color:var(--bad)">Delete</button>`}
        </div></div>`;
    }).join('');
    v.innerHTML = `
      <div class="card"><h2>Users on this iPad</h2>
        <p class="small muted">Several people can share the app — each keeps their own progress. Tap to switch.</p>
        ${profRows}
        <button class="btn soft block" id="addprofile" style="margin-top:10px">+ Add user</button></div>
      <div class="card"><h2>Practice</h2>
        <div class="setrow"><div><div>Daily goal</div><div class="small muted">what keeps the streak alive</div></div>
          <button class="btn ghost sm" id="goalmode">${A.habit.goalMode() === 'plan' ? 'Complete the plan' : 'Minutes practised'}</button></div>
        <div class="setrow"><div><div>Minutes target</div><div class="small muted">${A.habit.goalMode() === 'plan' ? 'also counts — either one keeps the streak' : 'minutes per day for your streak'}</div></div>
          <div class="stepper"><button data-goal="-1">−</button><b id="goalv">${goal}</b><button data-goal="1">+</button></div></div>
        <div class="setrow"><div><div>Apple Pencil only</div><div class="small muted">ignore finger/palm while drawing</div></div>
          <div class="switch ${pencilOnly ? 'on' : ''}" id="sw-pencil" role="switch" aria-checked="${pencilOnly}" tabindex="0" aria-label="Apple Pencil only"><div class="knob"></div></div></div>
        <div class="setrow"><div><div>Ink weight</div><div class="small muted">stroke thickness</div></div>
          <div class="stepper"><button data-ink="-0.4">−</button><b id="inkv">${inkW.toFixed(1)}</b><button data-ink="0.4">+</button></div></div>
        <div class="setrow"><div><div>Line smoothing</div><div class="small muted">steadies shaky strokes — raise it if lines come out wobbly</div></div>
          <button class="btn ghost sm" id="smoothmode">${esc({ 0: 'Off', 0.3: 'Light', 0.5: 'Medium', 0.72: 'Strong' }[A.store.get('smooth', 0.5)] || 'Medium')}</button></div>
        <div class="setrow"><div><div>Pace</div><div class="small muted">Relaxed stretches suggested study &amp; draw times by 50%</div></div>
          <button class="btn ghost sm" id="pacemode">${A.store.get('pace', 'standard') === 'relaxed' ? 'Relaxed' : 'Standard'}</button></div>
        <div class="setrow"><div><div>Sighting guides</div><div class="small muted">plumb line, horizon, thirds, angle ticks</div></div>
          <button class="btn ghost sm" id="guidesmode">${esc({ auto: 'Auto (fades)', on: 'Always on', off: 'Off' }[A.store.get('guidesMode', 'auto')])}</button></div>
        <div class="setrow"><div><div>Introduction</div><div class="small muted">replay the welcome guide</div></div>
          <button class="btn ghost sm" id="replayintro">Replay</button></div>
      </div>
      <div class="card"><h2>Backup</h2>
        <p class="small muted">iPad may clear an unused web app’s data after a few weeks. Export a backup to Files/Dropbox to be safe.</p>
        <div class="small muted" id="bkinfo" style="margin-top:6px">Checking storage…</div>
        <button class="btn block" id="export" style="margin-top:10px">Export backup (.json)</button>
        <label class="btn ghost block" style="margin-top:8px">Restore from backup<input type="file" id="import" accept="application/json,.json" hidden></label>
      </div>
      <div class="card"><h2>Data</h2>
        <button class="btn ghost block" id="reset-prog">Reset levels & streak</button>
        <button class="btn ghost block" id="wipe" style="margin-top:8px;color:var(--bad)">Delete all drills</button>
      </div>
      <div class="card"><h2>Install on iPad</h2><p class="small muted">Open this file in Safari, tap the Share button, then “Add to Home Screen”. It then runs full-screen and offline like a native app.</p></div>
      <div class="card"><h2>About</h2>
        <div class="setrow"><div><div>Version</div><div class="small muted">check this matches the latest deploy</div></div>
          <b style="font-variant-numeric:tabular-nums">v${esc(A.VERSION || '?')} · ${esc(A.BUILD || 'dev')}</b></div></div>`;

    $$('[data-psw]', v).forEach((b) => b.onclick = () => switchProfile(b.dataset.psw));
    $$('[data-pren]', v).forEach((b) => b.onclick = () => {
      const p = A.store.profiles().find((x) => x.id === b.dataset.pren);
      promptModal('Rename user', p ? p.name : '', (n) => { A.store.renameProfile(b.dataset.pren, n); refreshProfileChip(); renderSettings(v); });
    });
    $$('[data-pdel]', v).forEach((b) => b.onclick = () => {
      confirmModal('Delete this user?', 'All their progress on this iPad will be removed. This cannot be undone.', 'Delete',
        async () => { await A.store.deleteProfile(b.dataset.pdel); renderSettings(v); }, true);
    });
    $('#addprofile', v).onclick = () => promptModal('Name for the new user?', '', (n) => switchProfile(A.store.addProfile(n)));
    $('#goalmode', v).onclick = () => { A.habit.setGoalMode(A.habit.goalMode() === 'plan' ? 'minutes' : 'plan'); renderSettings(v); };
    $$('[data-goal]', v).forEach((b) => b.onclick = () => { A.habit.setGoal(Math.max(5, Math.min(120, goal + (+b.dataset.goal) * 5))); renderSettings(v); });
    $$('[data-ink]', v).forEach((b) => b.onclick = () => { A.store.set('inkWidth', Math.max(1.2, Math.min(6, inkW + (+b.dataset.ink)))); surface.opts.baseWidth = A.store.get('inkWidth', 3.2); renderSettings(v); });
    $('#sw-pencil', v).onclick = () => { A.store.set('pencilOnly', !pencilOnly); surface.opts.pencilOnly = !pencilOnly; renderSettings(v); };
    $('#guidesmode', v).onclick = () => { const cur = A.store.get('guidesMode', 'auto'); const nxt = { auto: 'on', on: 'off', off: 'auto' }[cur]; A.store.set('guidesMode', nxt); renderSettings(v); };
    $('#smoothmode', v).onclick = () => { const cur = A.store.get('smooth', 0.5); const nxt = { 0: 0.3, 0.3: 0.5, 0.5: 0.72, 0.72: 0 }[cur]; A.store.set('smooth', nxt == null ? 0.5 : nxt); surface.opts.smooth = A.store.get('smooth', 0.5); renderSettings(v); };
    $('#pacemode', v).onclick = () => { A.store.set('pace', A.store.get('pace', 'standard') === 'relaxed' ? 'standard' : 'relaxed'); renderSettings(v); };
    $('#replayintro', v).onclick = () => showOnboarding();
    $('#export', v).onclick = exportBackup;
    $('#import', v).onchange = importBackup;
    attempts().then((list) => {
      const last = A.store.get('lastBackup', null);
      const el = $('#bkinfo', v); if (!el) return;
      const since = last ? new Date(last).toLocaleDateString() : 'never';
      el.textContent = `${list.length} drills stored · last backup: ${since}`;
      if (list.length >= 30 && !last) el.style.color = 'var(--warn)';
    });
    $('#reset-prog', v).onclick = () => {
      confirmModal('Reset progress?', 'All levels, rank, achievements, personal bests and streak reset. Your saved drills stay.', 'Reset', () => {
        // store.remove is profile-aware — a hand-built 'atelier:' prefix would
        // wipe the DEFAULT profile's keys no matter who is active
        ['curriculum', 'percLevel', 'percWin', 'ach', 'pb', 'bestStreak', 'lastRank', 'daily', 'dailyDone', 'dailyCount',
         'session', 'planDays', 'planPick', 'platesBest', 'weekSeen', 'lastWarmKind']
          .forEach((k) => A.store.remove(k));
        A.store.set('habit', { days: {}, goalMin: goal });
        toast('Progress reset'); renderSettings(v);
      }, true);
    };
    $('#wipe', v).onclick = () => {
      confirmModal('Delete ALL saved drills?', 'Every recorded drill for this user is removed. This cannot be undone.', 'Delete all',
        async () => { await A.store.clearAttempts(); invalidate(); toast('All drills deleted'); }, true);
    };
  }

  async function exportBackup() {
    const data = await A.store.exportAll();
    const name = 'atelier-backup-' + A.habit.today() + '.json';
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    // Web Share with a file is one tap → "Save to Files"/Dropbox on an installed
    // iPad PWA — much nicer than the <a download> flow, which is awkward in
    // standalone mode. Feature-detect and fall back.
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Atelier backup' });
        A.store.set('lastBackup', Date.now());
        toast('Backup shared');
        return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; /* user cancelled — no backup */ }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    A.store.set('lastBackup', Date.now());
    toast('Backup downloaded');
  }
  async function importBackup(e) {
    const f = e.target.files[0]; if (!f) return;
    try {
      const txt = await f.text(); const data = JSON.parse(txt);
      const res = await A.store.importAll(data, { merge: false });
      await A.library.init(); invalidate();
      toast('Backup restored — ' + (res && res.records != null ? res.records + ' records' : 'done')); ui.go('home');
    } catch (err) { toast('Restore failed: ' + err.message); }
  }

  /* ---- modal ------------------------------------------------------------- */
  function openModal(html, opts) {
    closeModal();
    const m = el(`<div class="modal${opts && opts.top ? ' top' : ''}"><div class="sheet">${html}</div></div>`);
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
    return $('.sheet', m);
  }
  function closeModal() { const m = $('.modal'); if (m) m.remove(); }

  // in-app replacements for prompt()/confirm(): native dialogs render as origin-
  // titled system alerts inside an installed PWA (and iOS has suppressed prompt()
  // in standalone mode before) — the most "this is a webpage" moment in the app.
  // Top-aligned so the iPad keyboard can't cover the input.
  function promptModal(title, initial, onOk, sub) {
    const sheet = openModal(`<h2>${esc(title)}</h2>
      ${sub ? `<p class="small muted">${esc(sub)}</p>` : ''}
      <input type="text" class="txtinput" id="pm-input" value="${esc(initial || '')}" autocomplete="off">
      <div class="row" style="margin-top:12px">
        <button class="btn ghost block" data-cancel="1">Cancel</button>
        <button class="btn block" data-ok="1">OK</button></div>`, { top: true });
    const input = $('#pm-input', sheet);
    setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 60);
    const ok = () => { const v = input.value; closeModal(); if (v && v.trim()) onOk(v.trim()); };
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-ok]')) ok();
      else if (e.target.closest('[data-cancel]')) closeModal();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  }
  function confirmModal(title, body, okLabel, onOk, danger) {
    const sheet = openModal(`<h2>${esc(title)}</h2>
      <p class="small muted" style="margin:8px 0 0">${esc(body)}</p>
      <div class="row" style="margin-top:14px">
        <button class="btn ghost block" data-cancel="1">Cancel</button>
        <button class="btn block" data-ok="1" ${danger ? 'style="background:var(--bad)"' : ''}>${esc(okLabel || 'OK')}</button></div>`);
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-ok]')) { closeModal(); onOk(); }
      else if (e.target.closest('[data-cancel]')) closeModal();
    });
  }

  A.ui = ui;
})(window.A = window.A || {});
