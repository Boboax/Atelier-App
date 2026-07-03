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
  const PERC_LABELS = { 'perc-angle': 'Perceive: Angle', 'perc-prop': 'Perceive: Proportion' };
  const exName = (type) => { const d = A.curr.def(type); return d ? d.name : (PERC_LABELS[type] || type); };
  const LOOKCUE = {
    line: 'its slant & length', angles: 'the angles between & the relative lengths',
    polygon: 'each corner’s position & the proportions', envelope: 'the outer envelope first',
    contour: 'the path of the edge', negative: 'the empty shapes between the forms',
    bargue: 'the big straight block-in', value: 'where light turns to dark',
    master: 'the largest shapes & their placement'
  };

  const ui = { view: 'home' };
  let surface, drill, attemptsCache = null;

  /* ---- bootstrap --------------------------------------------------------- */
  ui.init = async function () {
    document.body.innerHTML = '';
    const app = el(`<div id="app">
      <div class="topbar"><div class="brandmark">Atelier<span class="dot">.</span></div>
        <button class="btn soft sm" data-go="practice">Practice ›</button></div>
      <div class="view" id="view"></div>
    </div>`);
    document.body.appendChild(app);

    const nav = el(`<div class="nav">
      ${navBtn('home', '◴', 'Today')}${navBtn('practice', '✎', 'Practice')}
      ${navBtn('stats', '◷', 'Stats')}${navBtn('history', '▦', 'History')}
      ${navBtn('more', '⋯', 'More')}</div>`);
    document.body.appendChild(nav);
    nav.addEventListener('click', (e) => { const b = e.target.closest('[data-nav]'); if (b) ui.go(b.dataset.nav); });
    $('.topbar', app).addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) ui.go(b.dataset.go); });

    buildDrill();
    await A.library.init();
    ui.go('home');
    if (!A.store.get('onboarded', false)) showOnboarding();
  };
  function navBtn(id, ic, label) { return `<button data-nav="${id}"><span class="ic">${ic}</span>${label}</button>`; }

  ui.go = function (view) {
    ui.view = view;
    $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.nav === view || (view === 'library' && b.dataset.nav === 'more') || (view === 'settings' && b.dataset.nav === 'more')));
    const v = $('#view');
    v.scrollTop = 0;
    if (view === 'home') renderHome(v);
    else if (view === 'practice') renderPractice(v);
    else if (view === 'stats') renderStats(v);
    else if (view === 'history') renderHistory(v);
    else if (view === 'library') renderLibrary(v);
    else if (view === 'settings') renderSettings(v);
    else if (view === 'more') renderMore(v);
  };

  async function attempts(force) {
    if (!attemptsCache || force) attemptsCache = await A.store.allAttempts();
    return attemptsCache;
  }
  function invalidate() { attemptsCache = null; }

  function toast(msg) {
    let t = $('.toast'); if (!t) { t = el('<div class="toast"></div>'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1900);
  }

  /* ======================================================================
     HOME / TODAY
     ====================================================================== */
  // spaced review: the scored exercise with the weakest recent accuracy
  async function weakestFocus() {
    const all = await attempts();
    const scored = all.filter((a) => a.scored);
    if (scored.length < 4) return null;
    const recent = {};
    ['line', 'angles', 'polygon', 'envelope'].forEach((t) => {
      const xs = scored.filter((a) => a.type === t).slice(-5).map((a) => a.score);
      if (xs.length) recent[t] = xs.reduce((a, b) => a + b, 0) / xs.length;
    });
    const keys = Object.keys(recent);
    if (!keys.length) return null;
    keys.sort((a, b) => recent[a] - recent[b]);
    return { key: keys[0], mean: Math.round(recent[keys[0]]) };
  }

  async function renderHome(v) {
    const goal = A.habit.goalMin();
    const mins = A.habit.todayMinutes();
    const pct = Math.min(1, goal ? mins / goal : 0);
    const streak = A.habit.streak();
    const cal = A.habit.calendar(14);
    const C = 2 * Math.PI * 34;
    const calHtml = cal.map((d) => {
      const lab = d.day.slice(8);
      const cls = (d.met ? 'met ' : '') + (d.day === A.habit.today() ? 'today' : '');
      return `<div class="d ${cls}" title="${d.day}: ${fmtMin(d.secs / 60)}">${lab}</div>`;
    }).join('');

    const focus = await weakestFocus();
    const focusCard = focus ? `<div class="card"><div class="row between center">
        <div><h2>Today’s focus</h2><div class="small muted">your weakest drill lately: <b>${esc(A.curr.def(focus.key).name)}</b> (${focus.mean})</div></div>
        <button class="btn soft sm" data-focus="${focus.key}">Drill it ›</button></div></div>` : '';

    const mods = A.curr.EXERCISES.filter((e) => e.scored).map((e) => {
      const lvl = A.curr.level(e.key), win = A.curr.window(e.key);
      const dots = Array.from({ length: 5 }, (_, i) => `<span style="opacity:${i < win.length ? 1 : 0.22};color:var(--accent)">●</span>`).join(' ');
      const enforced = lvl >= 4 ? ' · timed' : '';
      return `<div class="exrow" data-focus="${e.key}"><div class="meta"><div class="nm">${esc(e.name)}</div>
        <div class="tiny muted" style="margin-top:3px">${dots} &nbsp;${win.length}/5 to next${enforced}</div></div>
        <span class="lvlpill">Lv ${lvl}</span></div>`;
    }).join('');

    v.innerHTML = `
      <div class="card">
        <div class="streak-hero">
          <div class="ring"><svg width="84" height="84">
            <circle cx="42" cy="42" r="34" fill="none" stroke="var(--hair)" stroke-width="8"/>
            <circle cx="42" cy="42" r="34" fill="none" stroke="var(--accent)" stroke-width="8"
              stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
          </svg><div class="num"><b>${Math.round(pct * 100)}%</b><span class="tiny muted">of goal</span></div></div>
          <div style="flex:1">
            <div class="row between center"><h2>Today</h2><div><span class="flame">${streak > 0 ? '🔥' : '·'}</span> <b>${streak}</b> <span class="muted small">day streak</span></div></div>
            <div class="small muted">${fmtMin(mins)} practised · ${A.habit.todayCount()} drills · goal ${goal} min</div>
            <button class="btn block" style="margin-top:12px" data-go="practice">${mins > 0 ? 'Keep practising' : 'Start today’s practice'}</button>
          </div>
        </div>
      </div>

      ${focusCard}

      <div class="card"><h2>Last 14 days</h2><div class="cal" style="margin-top:10px">${calHtml}</div></div>

      <div class="card"><div class="row between center"><h2>Your progression</h2><button class="btn ghost sm" data-go="stats">See stats ›</button></div>
        ${mods}</div>

      <div class="card">
        <h2>The method</h2>
        <p class="small muted" style="margin:6px 0 0">Study intently, hide the reference, then draw from memory — never peek while drawing.
        Work <i>general to specific</i>: block the envelope in straight lines before any detail. Correct, then redraw.
        As your accuracy holds above 85%, the study glance shortens automatically.</p>
      </div>`;
    v.onclick = (e) => {
      const f = e.target.closest('[data-focus]'); if (f) { startExercise(f.dataset.focus); return; }
      const g = e.target.closest('[data-go]'); if (g) ui.go(g.dataset.go);
    };
  }

  /* ======================================================================
     PRACTICE PICKER
     ====================================================================== */
  function renderPractice(v) {
    const groups = A.curr.modules.map((m) => {
      const exs = A.curr.EXERCISES.filter((e) => e.module === m.n);
      const rows = exs.map((e) => {
        const lvl = e.scored ? `Lv ${A.curr.level(e.key)} · ${A.curr.studySeconds(e.key)}s study` : `${e.study()}s study`;
        const tag = e.scored ? '<span class="tag">scored</span>' : '<span class="tag self">self-check</span>';
        return `<div class="exrow" data-ex="${e.key}">
          <div class="meta"><div class="nm">${esc(e.name)} ${tag}</div>
            <div class="small muted">${esc(e.blurb)}</div>
            <div class="tiny muted" style="margin-top:3px">${lvl}</div></div>
          <button class="btn soft sm" data-ex="${e.key}">Start ›</button></div>`;
      }).join('');
      return `<div class="card"><h2>Module ${m.n} · ${esc(m.name)}</h2>${rows}</div>`;
    }).join('');
    const sessions = `<div class="card"><h2>Guided sessions</h2>
      <p class="small muted" style="margin:4px 0 10px">Interleaved practice — mixing drills rather than repeating one — feels harder but builds more durable, transferable skill.</p>
      <div class="row wrap">
        <button class="btn" data-session="mixed">Mixed session · 12</button>
        <button class="btn ghost" data-session="warmup">Quick warm-up · 6</button></div></div>
      <div class="card"><h2>Perception (no drawing)</h2>
      <p class="small muted" style="margin:4px 0 10px">Misperceiving the subject — not the hand — is the main cause of inaccurate drawing. Train the eye alone: study, then reproduce the judgement.</p>
      <div class="row wrap"><button class="btn soft" data-perc="angle">Judge angle</button>
        <button class="btn soft" data-perc="prop">Judge proportion</button></div></div>`;
    v.innerHTML = `${sessions}<div class="banner">Or pick a single drill. Scored drills generate a fresh target each time; self-check drills use a reference image you choose.</div>${groups}`;
    v.onclick = (e) => {
      const s = e.target.closest('[data-session]'); if (s) { startSession(s.dataset.session); return; }
      const p = e.target.closest('[data-perc]'); if (p) { A.Perceive.start(p.dataset.perc); return; }
      const b = e.target.closest('[data-ex]'); if (b) startExercise(b.dataset.ex);
    };
  }

  async function startExercise(exKey) {
    const def = A.curr.def(exKey);
    if (def.scored) { openDrill(exKey, null); return; }
    // reference exercise → choose an image
    const items = A.library.byCategory(def.refCat);
    chooseReference(exKey, def, items);
  }

  function chooseReference(exKey, def, items) {
    const cells = items.map((it) => `<div class="cell" data-ref="${esc(it.id)}">
      <img src="${it.src}" alt=""><div class="cap">${esc(it.title)}</div></div>`).join('') ||
      '<div class="muted small">No images in this category. Add some in Library.</div>';
    const allowSkip = def.key === 'value';
    const sheet = openModal(`<h2>Choose a reference</h2>
      <p class="small muted">${esc(def.blurb)}</p>
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
      <div class="instructor"><div class="txt" id="d-instr">Study</div><div class="timer" id="d-timer"></div></div>
      <button class="closeX" id="d-close">✕</button>
      <button class="closeX" id="d-help" style="right:54px;font-weight:600">?</button>
      <canvas id="d-canvas"></canvas>
      <div id="d-result"></div>
      <div class="controls" id="d-controls"></div>
    </div>`);
    document.body.appendChild(d);
    surface = new A.Surface($('#d-canvas', d), { pencilOnly: A.store.get('pencilOnly', false), baseWidth: A.store.get('inkWidth', 3.2) });
    drill = new A.Drill(surface);
    drill.onState = updateDrill;
    drill.onTick = updateTimer;
    drill.onResult = onDrillResult;
    $('#d-close', d).addEventListener('click', closeDrill);
    $('#d-help', d).addEventListener('click', () => { if (drill.exKey) showHowTo(drill.exKey); });
  }

  const HOWTO = {
    line: 'Study the single line — its slant and its length. Hide it, then redraw it from memory anywhere on the canvas. Only angle and length are scored, not where you place it.',
    angles: 'Note how the lines relate — the angle between them and their relative lengths — not their position. Reproduce those relationships from memory.',
    polygon: 'Fix each corner’s position relative to the others. Block the whole shape in, then check its proportion before committing.',
    envelope: 'Find the outer “envelope” first — the largest straight lines that contain the blob — then facet it into smaller straights. Work general to specific.',
    contour: 'Trace one continuous edge slowly with your eyes, then draw it from memory in a single, unhurried line. It’s about seeing the edge, not speed.',
    negative: 'Ignore the object itself — memorise only the empty shapes around and between the forms, then draw those negative shapes.',
    bargue: 'Study only the straight-line block-in stage. Draw the outer envelope from memory, then fade the plate back over your drawing to see where you drifted.',
    value: 'Memorise the shadow line — the terminator, where light turns to dark — then draw that single boundary from memory.',
    master: 'Study the whole image as a few big shapes and their relationships. Draw it from memory, general to specific — don’t start with details.'
  };
  function showHowTo(exKey) {
    const def = A.curr.def(exKey);
    openModal(`<h2>${esc(def ? def.name : exKey)}</h2>
      <p class="small" style="margin:8px 0">${esc(HOWTO[exKey] || '')}</p>
      <div class="insight" style="text-align:left">The rhythm is always: <b>study → hide → draw from memory → reveal → correct & redraw</b>. Never peek while drawing — the struggle is where the learning happens.</div>
      <button class="btn block" data-done="1" style="margin-top:12px">Got it</button>`)
      .addEventListener('click', (e) => { if (e.target.closest('[data-done]')) closeModal(); });
  }

  function showOnboarding() {
    const steps = [
      { h: 'Welcome to Atelier', b: 'A pocket atelier for training the skill behind accurate drawing — your <b>visual memory</b>.<div class="insight" style="text-align:left;margin-top:10px"><b>The one rule:</b> study a shape, hide it, then draw it from memory. Never peek while drawing — the struggle is the learning.</div>' },
      { h: 'See, don’t name', b: 'Look for raw data — <b>angles, lengths, proportions</b> — not “a hand” or “a foot”. Naming makes you draw the symbol in your head instead of what’s actually there. That misperception is the real reason drawings come out wrong.' },
      { h: 'General to specific', b: 'Block the big <b>envelope</b> in straight lines first; facet and round only once the proportions are right. Keep early lines light and correctable, and use your shoulder for longer strokes.' },
      { h: 'Judge yourself', b: 'Before each reveal you’ll rate your own accuracy — that’s how your eye learns to catch its own errors. Mixed sessions and shorter glances feel harder on purpose; that difficulty is what builds lasting skill.<div class="muted small" style="margin-top:8px">Tip: tap <b>?</b> in any drill for how it works.</div>' }
    ];
    let i = 0;
    const sheet = openModal('');
    function render() {
      const s = steps[i], last = i === steps.length - 1;
      sheet.innerHTML = `<h2>${s.h}</h2><div class="small" style="margin:10px 0 4px">${s.b}</div>
        <div class="row between center" style="margin-top:14px">
          <span class="tiny muted">${i + 1} / ${steps.length}</span>
          <button class="btn" data-next="1">${last ? 'Start practising' : 'Next ›'}</button></div>`;
    }
    sheet.addEventListener('click', (e) => {
      if (!e.target.closest('[data-next]')) return;
      if (i < steps.length - 1) { i++; render(); }
      else { A.store.set('onboarded', true); closeModal(); ui.go('practice'); }
    });
    render();
  }

  /* ---- sessions: interleaved practice (contextual interference) ---------- */
  let session = null;
  function shuffledQueue(types, n) {
    const q = []; let last = null;
    for (let i = 0; i < n; i++) {
      let pick, guard = 0;
      do { pick = types[Math.floor(Math.random() * types.length)]; guard++; } while (pick === last && types.length > 1 && guard < 12);
      q.push(pick); last = pick;
    }
    return q;
  }
  function startSession(kind) {
    const queue = kind === 'warmup'
      ? shuffledQueue(['line', 'angles', 'polygon'], 6)
      : shuffledQueue(['line', 'angles', 'polygon', 'envelope'], 12);
    session = { kind, queue, i: 0, results: [] };
    openDrill(queue[0], null);
  }
  function onDrillResult(d) {
    if (session && d.def && d.def.scored && d.result) session.results.push({ type: d.exKey, score: d.result.score });
  }
  function sessionNext() {
    if (!session) { drill.next(); return; }
    session.i++;
    if (session.i >= session.queue.length) { finishSession(); return; }
    drill.startExercise(session.queue[session.i], null);
  }
  function finishSession() {
    const res = session.results;
    const mean = res.length ? Math.round(res.reduce((a, b) => a + b.score, 0) / res.length) : 0;
    const best = res.length ? Math.max.apply(null, res.map((r) => r.score)) : 0;
    const kind = session.kind; session = null;
    drill.stop(); $('#drill').classList.remove('on'); invalidate();
    const sheet = openModal(`<h2>${kind === 'warmup' ? 'Warm-up' : 'Mixed session'} complete</h2>
      <div class="kpi" style="margin:12px 0"><div class="k"><div class="v">${res.length}</div><div class="l">drills</div></div>
        <div class="k"><div class="v">${mean}</div><div class="l">mean</div></div>
        <div class="k"><div class="v">${best}</div><div class="l">best</div></div></div>
      <p class="small muted">Interleaving different drills feels harder in the moment but builds more durable, transferable skill than repeating one drill.</p>
      <button class="btn block" data-done="1" style="margin-top:8px">Done</button>`);
    sheet.addEventListener('click', (e) => { if (e.target.closest('[data-done]')) { closeModal(); ui.go('home'); } });
  }

  function openDrill(exKey, refItem) {
    const d = $('#drill'); d.classList.add('on');
    surface.opts.pencilOnly = A.store.get('pencilOnly', false);
    surface.opts.baseWidth = A.store.get('inkWidth', 3.2);
    // setTimeout (not rAF) so startup still runs if the first frame is throttled
    setTimeout(() => { surface.resize(); drill.startExercise(exKey, refItem); }, 0);
  }
  function closeDrill() { session = null; drill.stop(); $('#drill').classList.remove('on'); invalidate(); ui.go(ui.view); }

  function updateTimer() {
    const t = $('#d-timer');
    if (drill.phase !== 'study') return;
    if (drill.selfPaced) {
      const e = drill.studyElapsed || 0;
      const over = drill.avgLook > 2 && e > 2 * drill.avgLook;   // over-stare nudge
      t.textContent = Math.floor(e) + 's' + (over ? ' · ease off?' : '');
      t.style.color = over ? 'var(--warn)' : '';
    } else {
      t.textContent = Math.ceil(drill.studyRemaining) + 's'; t.style.color = '';
    }
  }

  function scoreClass(s) { return s >= 85 ? 's-good' : s >= 65 ? 's-mid' : 's-low'; }

  function updateDrill() {
    const def = drill.def;
    const instr = $('#d-instr'), timer = $('#d-timer'), controls = $('#d-controls'), result = $('#d-result');
    result.innerHTML = ''; timer.textContent = ''; timer.style.color = '';
    const sessSkip = session ? '<button class="btn ghost sm" data-act="skipdrill">Skip</button>' : '';

    if (drill.phase === 'study') {
      const cue = LOOKCUE[drill.exKey] || 'angle, length, proportion';
      instr.textContent = `Study — look for ${cue}. Don’t draw yet.`;
      timer.textContent = drill.selfPaced ? Math.floor(drill.studyElapsed || 0) + 's' : Math.ceil(drill.studyRemaining) + 's';
      const flipBtn = !def.scored && drill.ref && drill.ref.img ? `<button class="btn ghost sm" data-act="flip">Flip ⟲</button>` : '';
      const commit = drill.selfPaced
        ? `<button class="btn" data-act="skip">I’ve got it ›</button>`
        : `<button class="btn ghost" data-act="skip">Hide & draw now</button>`;
      controls.innerHTML = `${sessSkip}${flipBtn}${commit}`;
    }
    else if (drill.phase === 'draw') {
      const flipBtn = !def.scored && drill.ref && drill.ref.img ? `<button class="btn ghost sm ${surface.ghostFlip ? 'sel' : ''}" data-act="flip">Flip ⟲</button>` : '';
      const glanceBtn = `<button class="btn ghost sm" data-act="glance" ${drill.glancesLeft() <= 0 ? 'disabled' : ''}>Glance${drill.glanceCap ? ' ' + drill.glancesLeft() : ''}</button>`;
      const undoBtn = `<button class="btn ghost sm" data-act="undo" ${surface.strokes.length ? '' : 'disabled'}>Undo</button>`;
      if (!def.scored && drill.stages) {     // guided multi-stage block-in
        const last = drill.stage >= drill.stages.length - 1;
        instr.textContent = `Stage ${drill.stage + 1}/${drill.stages.length} — ${drill.stages[drill.stage]}`;
        controls.innerHTML = `${glanceBtn}${flipBtn}${undoBtn}<button class="btn ghost sm" data-act="clear">Clear</button>
          ${last ? '<button class="btn" data-act="evaluate">Reveal</button>'
                 : '<button class="btn" data-act="nextstage">Next stage ›</button>'}`;
      } else {
        instr.textContent = 'Draw from memory.';
        const guidesBtn = def.scored ? `<button class="btn ghost sm ${surface.guides ? 'sel' : ''}" data-act="guides">Guides</button>` : '';
        controls.innerHTML = `${glanceBtn}${guidesBtn}${flipBtn}${undoBtn}<button class="btn ghost sm" data-act="clear">Clear</button>
          ${sessSkip}<button class="btn" data-act="evaluate" ${drill.canEvaluate() ? '' : 'disabled'}>${def.scored ? 'Evaluate' : 'Reveal'}</button>`;
      }
    }
    else if (drill.phase === 'estimate') {
      instr.textContent = 'Before the answer — how close were you?';
      result.innerHTML = `<div class="card resultcard">
        <div class="small" style="margin-bottom:8px">Judge your own accuracy first, <i>then</i> see the truth.</div>
        <div class="estq">
          <button data-estq="30">Way off</button><button data-estq="50">Off</button>
          <button data-estq="70">Okay</button><button data-estq="85">Close</button>
          <button data-estq="95">Bang on</button></div>
        <div class="tiny muted" style="margin-top:8px">Estimating before the reveal trains your eye to catch its own errors.</div></div>`;
      controls.innerHTML = '';
    }
    else if (drill.phase === 'reveal') {
      if (def.scored && drill.result) revealScored(instr, controls, result);
      else revealReference(instr, controls, result);
    }
    if (session) instr.textContent = `${session.i + 1}/${session.queue.length} · ` + instr.textContent;
    bindControls(controls, result);
  }

  function revealScored(instr, controls, result) {
    const r = drill.result;
    instr.textContent = 'Compare: your marks vs the target (red).';
    const m = r.metrics || {};
    let metricRows = '';
    if (drill.exKey === 'line' || drill.exKey === 'angles') {
      const ae = m.angleErrDeg != null ? m.angleErrDeg : m.meanAngleErrDeg;
      const le = m.lengthErrPct != null ? m.lengthErrPct : m.meanLengthErrPct;
      metricRows = `<div class="metricline"><span>Angle error</span><b>${ae > 0 ? '+' : ''}${ae}° ${ae > 0 ? '(CW)' : ae < 0 ? '(CCW)' : ''}</b></div>
        <div class="metricline"><span>Length error</span><b>${le > 0 ? '+' : ''}${le}% ${le > 0 ? '(long)' : le < 0 ? '(short)' : ''}</b></div>`;
    } else {
      metricRows = `<div class="metricline"><span>Shape overlap (IoU)</span><b>${Math.round((m.iou || 0) * 100)}%</b></div>
        <div class="metricline"><span>Proportion error</span><b>${m.aspectErrPct > 0 ? '+' : ''}${m.aspectErrPct}% ${m.aspectErrPct > 0 ? '(wide)' : m.aspectErrPct < 0 ? '(tall)' : ''}</b></div>`;
    }
    const lc = r.levelChange;
    const lvlMsg = lc && lc.changed ? `<div class="insight">${lc.dir > 0 ? '▲ Levelled up to ' + lc.level + ' — the study glance just got shorter.' : '▼ Eased to level ' + lc.level + ' to rebuild accuracy.'}</div>` : '';
    // self-estimate vs actual (builds the internal error-detector)
    let estRow = '';
    if (r.selfEstimate != null) {
      const aw = A.coach.selfAwareness(r.estErr);
      estRow = `<div class="metricline"><span>You guessed / actual</span><b>${r.selfEstimate} / ${r.score}</b></div>
        <div class="tiny muted" style="margin:2px 0 8px">${esc(aw)} (off by ${r.estErr})</div>`;
    }
    const coachRow = r.coaching ? `<div class="insight" style="text-align:left">${esc(r.coaching)}</div>` : '';
    // faded feedback: detailed metric breakdown only when showDetail
    const detail = r.showDetail ? metricRows : '<div class="tiny muted" style="margin-bottom:6px">Detailed metrics hidden — trust your eye. (Full read every few drills.)</div>';
    result.innerHTML = `<div class="card resultcard">
      <div class="scorebadge ${scoreClass(r.score)}">${r.score}</div>
      <div class="muted small" style="margin-bottom:8px">accuracy</div>
      ${estRow}${detail}${coachRow}${lvlMsg}</div>`;
    controls.innerHTML = `<button class="btn ghost sm" data-act="redraw">Redraw</button>
      <button class="btn ghost sm" data-act="again">Re-study</button>
      <button class="btn" data-act="next">Next ›</button>`;
  }

  function revealReference(instr, controls, result) {
    if (drill.result) {  // already rated/scored → show next actions
      instr.textContent = 'Saved. Compare with the reference.';
      result.innerHTML = `<div class="card resultcard"><div class="scorebadge ${scoreClass(drill.result.score)}">${drill.result.score}</div>
        <div class="muted small">${drill.result.objective ? 'auto-score (overlap)' : 'your self-rating'}</div></div>`;
      controls.innerHTML = `<button class="btn ghost sm" data-act="redraw">Redraw</button>
        <button class="btn ghost sm" data-act="again">Re-study</button>
        <button class="btn" data-act="next">Next ›</button>`;
      return;
    }
    instr.textContent = 'Fade the reference in. How close were you?';
    const hasImg = drill.ref && drill.ref.img;
    result.innerHTML = `<div class="card resultcard">
      ${hasImg ? `<div class="opacityctl"><span class="tiny muted">draw</span>
        <input type="range" id="d-op" min="0" max="100" value="${Math.round(drill.ghostOpacity * 100)}">
        <span class="tiny muted">ref</span></div>` : '<div class="small muted">Compare with your physical subject, then rate honestly.</div>'}
      <div style="margin:12px 0 6px" class="small">Rate your accuracy</div>
      <div class="ratebtns" id="d-rate">
        ${[1, 2, 3, 4, 5].map((n) => `<button data-rate="${n}">${n}</button>`).join('')}</div>
      <div class="tiny muted" style="margin-top:6px">1 = far off · 5 = very close</div>
      ${hasImg ? '<button class="btn ghost sm" data-autoscore="1" style="margin-top:8px">Auto-score (beta)</button>' : ''}</div>`;
    const flipBtn = hasImg ? `<button class="btn ghost sm" data-act="flip">Flip ⟲</button>` : '';
    controls.innerHTML = `${flipBtn}<button class="btn ghost sm" data-act="clear">Clear</button>`;
  }

  function showAutoScore() {
    const result = $('#d-result'), instr = $('#d-instr');
    instr.textContent = 'Auto-score — tune the highlight to cover the subject.';
    let threshold = 128, invert = false, region = null;
    function recompute() {
      const r = A.imgScore.score(drill.ref.img, surface.strokesDesign(), threshold, invert, region);
      surface.setGhost(A.imgScore.maskPreview(drill.ref.img, threshold, invert, region), 0.6);
      const sb = $('#as-score'); if (sb) { sb.textContent = r.score; sb.className = 'scorebadge ' + scoreClass(r.score); }
      const cov = $('#as-cov'); if (cov) {
        const c = region ? r.coverage * 4 : r.coverage;   // a panel is ~¼ of the plate
        let warn = c > 0.6 ? ' · mask too large — adjust' : r.coverage < 0.005 ? ' · mask too small — adjust' : '';
        cov.textContent = 'overlap ' + Math.round(r.iou * 100) + '%' + warn;
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
        instr.textContent = 'Auto-score — tune the highlight to cover the subject.';
        const pl = $('#as-panel'); if (pl) pl.textContent = region ? '✓ panel selected' : 'whole image';
        recompute();
      };
    }
    result.innerHTML = `<div class="card resultcard">
      <div class="small" style="margin-bottom:6px">Auto-score (beta) — for multi-panel plates, select one panel.</div>
      <div class="scorebadge" id="as-score">–</div>
      <div class="tiny muted" id="as-cov" style="margin-bottom:6px"></div>
      <div class="row" style="margin:4px 0;justify-content:center"><button class="btn ghost sm" id="as-crop">Select panel</button>
        <button class="btn ghost sm" id="as-full">Whole image</button>
        <span class="tiny muted" id="as-panel" style="align-self:center">whole image</span></div>
      <div class="opacityctl"><span class="tiny muted">dark</span>
        <input type="range" id="as-th" min="20" max="235" value="128">
        <span class="tiny muted">light</span></div>
      <button class="btn ghost sm" id="as-inv" style="margin-top:6px">Invert subject</button>
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
      else if (a === 'flip') { drill.toggleFlip(); updateDrill(); }
      else if (a === 'guides') { drill.toggleGuides(); updateDrill(); }
      else if (a === 'nextstage') drill.nextStage();
      else if (a === 'evaluate') drill.evaluate();
      else if (a === 'redraw') drill.correctAndRedraw();
      else if (a === 'again') drill.studyAgain();
      else if (a === 'skipdrill') sessionNext();
      else if (a === 'next') sessionNext();
    };
    controls.onclick = (e) => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); };
    if (result) {
      result.onclick = (e) => {
        const rb = e.target.closest('[data-rate]');
        if (rb) {
          const map = { 1: 40, 2: 58, 3: 72, 4: 85, 5: 95 };
          $$('#d-rate button').forEach((x) => x.classList.remove('sel')); rb.classList.add('sel');
          setTimeout(() => drill.submitSelfRating(map[rb.dataset.rate]), 180);
          return;
        }
        const eq = e.target.closest('[data-estq]');
        if (eq) { $$('#d-result [data-estq]').forEach((x) => x.classList.remove('sel')); eq.classList.add('sel'); setTimeout(() => drill.submitEstimate(+eq.dataset.estq), 160); return; }
        if (e.target.closest('[data-autoscore]')) showAutoScore();
      };
      result.oninput = (e) => {
        if (e.target.id === 'd-op') drill.setGhostOpacity(e.target.value / 100);
      };
    }
  }

  /* ======================================================================
     STATS
     ====================================================================== */
  async function renderStats(v) {
    const all = await attempts();
    if (!all.length) { v.innerHTML = `<div class="card"><h2>Statistics</h2><p class="muted small">No drills yet — practise a little and your accuracy trends, calibration bias and study-time curve will appear here.</p></div>`; return; }
    const sum = A.stats.summary(all);
    const trend = A.stats.dailyTrend(all);
    const byType = Object.values(sum.byType).map((t) => ({ label: exName(t.type), value: t.mean, suffix: '' }));

    // calibration insights for scored types that have data
    let calib = '';
    ['line', 'angles', 'polygon', 'envelope'].forEach((tp) => {
      const b = A.stats.bias(all, tp);
      if (!b.n) return;
      const def = A.curr.def(tp);
      if (b.kind === 'line' || b.kind === 'angles') {
        calib += `<div class="card"><h2>${esc(def.name)} — calibration <span class="muted small">(${b.n})</span></h2>
          <div class="small muted" style="margin-top:4px">Average angle bias: <b>${b.angle.mean > 0 ? '+' : ''}${b.angle.mean}°</b></div>
          ${A.charts.biasBar(b.angle.mean, 20, ['rotate CCW', 'rotate CW'])}
          <div class="small muted">Average length bias: <b>${b.length.mean > 0 ? '+' : ''}${b.length.mean}%</b></div>
          ${A.charts.biasBar(b.length.mean, 30, ['too short', 'too long'])}
          ${insight(b.angle.mean, b.length.mean)}</div>`;
      } else {
        calib += `<div class="card"><h2>${esc(def.name)} — calibration <span class="muted small">(${b.n})</span></h2>
          <div class="small muted" style="margin-top:4px">Average proportion bias: <b>${b.aspect.mean > 0 ? '+' : ''}${b.aspect.mean}%</b></div>
          ${A.charts.biasBar(b.aspect.mean, 30, ['too tall', 'too wide'])}</div>`;
      }
    });

    const sva = A.stats.studyVsAccuracy(all);
    const pa = all.filter((a) => a.type === 'perc-angle' && a.metrics && a.metrics.angleErrDeg != null);
    let percCard = '';
    if (pa.length) {
      const m = +(pa.reduce((s, a) => s + a.metrics.angleErrDeg, 0) / pa.length).toFixed(1);
      percCard = `<div class="card"><h2>Perceive: Angle — bias <span class="muted small">(${pa.length})</span></h2>
        <div class="small muted">pure perception, no drawing. Average signed error ${m > 0 ? '+' : ''}${m}°</div>
        ${A.charts.biasBar(m, 20, ['under-rotate', 'over-rotate'])}</div>`;
    }
    const sa = A.stats.selfAwareness(all);
    const saCard = sa ? `<div class="card"><h2>Self-awareness <span class="muted small">(${sa.n})</span></h2>
      <div class="small muted">how well your pre-reveal guess matched the real score — higher = you see your own errors. Avg gap ${sa.meanGap} pts.</div>
      ${A.charts.line(sa.trend)}</div>` : '';

    v.innerHTML = `
      <div class="card"><h2>Overview</h2>
        <div class="kpi" style="margin-top:10px">
          <div class="k"><div class="v">${sum.meanScore}</div><div class="l">mean accuracy</div></div>
          <div class="k"><div class="v">${sum.total}</div><div class="l">drills</div></div>
          <div class="k"><div class="v">${sum.days}</div><div class="l">days active</div></div>
          <div class="k"><div class="v">🔥 ${A.habit.streak()}</div><div class="l">streak</div></div>
        </div></div>
      <div class="card"><h2>Accuracy over time</h2><div class="small muted">daily mean across all drills</div>${A.charts.line(trend)}</div>
      <div class="card"><h2>By exercise</h2>${A.charts.bars(byType)}</div>
      ${saCard}
      ${percCard}
      ${calib}
      <div class="card"><h2>Study time vs accuracy</h2>
        <div class="small muted">each dot is one scored drill — does a longer glance actually help you?</div>
        ${A.charts.scatter(sva)}</div>`;
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
  async function renderHistory(v) {
    const all = (await attempts()).slice().sort((a, b) => b.ts - a.ts);
    if (!all.length) { v.innerHTML = `<div class="card"><h2>History</h2><p class="muted small">Your saved drills will appear here as a gallery you can replay.</p></div>`; return; }
    const cells = all.slice(0, 200).map((a) => {
      const dt = new Date(a.ts);
      return `<div class="cell" data-att="${a.id}">${A.history.thumbSVG(a, 130)}
        <div class="cap"><span>${esc(exName(a.type).split(' ')[0])}</span>
        <span class="sc ${scoreClass(a.score)}" style="color:${a.score >= 85 ? 'var(--good)' : a.score >= 65 ? 'var(--warn)' : 'var(--bad)'}">${a.score}${a.selfRated ? '*' : ''}</span></div></div>`;
    }).join('');
    v.innerHTML = `<div class="card"><div class="row between center"><h2>History</h2><span class="muted small">${all.length} drills · * = self-rated</span></div></div>
      <div class="gal">${cells}</div>`;
    v.onclick = (e) => { const c = e.target.closest('[data-att]'); if (c) showAttempt(all.find((x) => x.id == c.dataset.att)); };
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
      detail += `<div class="metricline"><span>Overlap</span><b>${Math.round(m.iou * 100)}%</b></div>
        <div class="metricline"><span>Proportion error</span><b>${m.aspectErrPct > 0 ? '+' : ''}${m.aspectErrPct}%</b></div>`;
    }
    const sheet = openModal(`<div class="row between center"><h2>${esc(exName(a.type))}</h2>
      <span class="scorebadge ${scoreClass(a.score)}" style="font-size:30px">${a.score}${a.selfRated ? '*' : ''}</span></div>
      <div class="small muted">${dt.toLocaleString()} · Lv ${a.level} · ${a.studySec}s study · ${a.drawSec}s draw</div>
      <canvas class="replaycv" id="rep"></canvas>
      <div class="row" style="margin:8px 0"><button class="btn soft sm" id="rep-play">▶ Replay</button>
        ${a.refTitle ? `<span class="small muted center" style="display:flex;align-items:center">ref: ${esc(a.refTitle)}</span>` : ''}</div>
      ${detail}
      <button class="btn ghost block" id="att-del" style="margin-top:12px">Delete this drill</button>`);
    const cv = $('#rep', sheet); const ctx = cv.getContext('2d');
    const size = 360; cv.width = size; cv.height = size;
    A.history.drawReplay(ctx, a, size, 1);
    let raf = null;
    $('#rep-play', sheet).onclick = () => {
      cancelAnimationFrame(raf); const t0 = performance.now(); const dur = 1400;
      const step = (t) => { const p = Math.min(1, (t - t0) / dur); A.history.drawReplay(ctx, a, size, p); if (p < 1) raf = requestAnimationFrame(step); };
      raf = requestAnimationFrame(step);
    };
    $('#att-del', sheet).onclick = async () => { await A.store.deleteAttempt(a.id); invalidate(); closeModal(); ui.go('history'); toast('Drill deleted'); };
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
      <div class="cap">${esc(it.title)}</div></div>`).join('') || '<div class="muted small">Nothing here yet.</div>';
    v.innerHTML = `<div class="card"><div class="row between center"><h2>Reference library</h2>
        <label class="btn soft sm">Import<input type="file" id="lib-file" accept="image/*" multiple hidden></label></div>
      <p class="small muted" style="margin:6px 0 0">Your Bargue plates and worksheets are bundled for offline use. Import photos (hands, eggs, paintings) for negative-space, value and master-copy drills.</p></div>
      <div class="chips">${chips}</div>
      <div class="libgrid">${cells}</div>`;
    $$('.chip', v).forEach((c) => c.onclick = () => { libCat = c.dataset.cat; renderLibrary(v); });
    $('#lib-file', v).onchange = async (e) => {
      const files = Array.prototype.slice.call(e.target.files);
      for (const f of files) { try { await A.library.importFile(f); } catch (err) { toast('Could not import ' + f.name); } }
      toast(files.length + ' image(s) imported'); renderLibrary(v);
    };
    v.querySelectorAll('[data-del]').forEach((b) => b.onclick = async (e) => {
      e.stopPropagation();
      if (confirm('Delete this reference?')) { await A.library.deleteUser(b.dataset.del); renderLibrary(v); }
    });
  }

  /* ======================================================================
     MORE  (settings + library entry + about + backup)
     ====================================================================== */
  function renderMore(v) {
    v.innerHTML = `
      <div class="card"><h2>More</h2>
        <div class="exrow" data-go="library"><div class="meta"><div class="nm">Reference library</div><div class="small muted">Bundled plates + import your own</div></div><span class="muted">›</span></div>
        <div class="exrow" data-go="settings"><div class="meta"><div class="nm">Settings</div><div class="small muted">Goal, Pencil, ink, backup</div></div><span class="muted">›</span></div>
      </div>
      <div class="card"><h2>About</h2><p class="small muted">Atelier trains visual memory in the classical tradition (Lecoq de Boisbaudran → Bargue → Florence Academy): study, hide, draw from memory, correct. Works fully offline. Your data lives only on this device — back it up regularly.</p></div>`;
    v.onclick = (e) => { const b = e.target.closest('[data-go]'); if (b) ui.go(b.dataset.go); };
  }

  function renderSettings(v) {
    const pencilOnly = A.store.get('pencilOnly', false);
    const goal = A.habit.goalMin();
    const inkW = A.store.get('inkWidth', 3.2);
    v.innerHTML = `
      <div class="card"><h2>Practice</h2>
        <div class="setrow"><div><div>Daily goal</div><div class="small muted">minutes per day for your streak</div></div>
          <div class="stepper"><button data-goal="-1">−</button><b id="goalv">${goal}</b><button data-goal="1">+</button></div></div>
        <div class="setrow"><div><div>Apple Pencil only</div><div class="small muted">ignore finger/palm while drawing</div></div>
          <div class="switch ${pencilOnly ? 'on' : ''}" id="sw-pencil"><div class="knob"></div></div></div>
        <div class="setrow"><div><div>Ink weight</div><div class="small muted">stroke thickness</div></div>
          <div class="stepper"><button data-ink="-0.4">−</button><b id="inkv">${inkW.toFixed(1)}</b><button data-ink="0.4">+</button></div></div>
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
      <div class="card"><h2>Install on iPad</h2><p class="small muted">Open this file in Safari, tap the Share button, then “Add to Home Screen”. It then runs full-screen and offline like a native app.</p></div>`;

    $$('[data-goal]', v).forEach((b) => b.onclick = () => { A.habit.setGoal(Math.max(5, Math.min(120, goal + (+b.dataset.goal) * 5))); renderSettings(v); });
    $$('[data-ink]', v).forEach((b) => b.onclick = () => { A.store.set('inkWidth', Math.max(1.2, Math.min(6, inkW + (+b.dataset.ink)))); surface.opts.baseWidth = A.store.get('inkWidth', 3.2); renderSettings(v); });
    $('#sw-pencil', v).onclick = () => { A.store.set('pencilOnly', !pencilOnly); surface.opts.pencilOnly = !pencilOnly; renderSettings(v); };
    $('#guidesmode', v).onclick = () => { const cur = A.store.get('guidesMode', 'auto'); const nxt = { auto: 'on', on: 'off', off: 'auto' }[cur]; A.store.set('guidesMode', nxt); renderSettings(v); };
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
    $('#reset-prog', v).onclick = () => { if (confirm('Reset all exercise levels and your streak?')) { A.store.set('curriculum', {}); A.store.set('habit', { days: {}, goalMin: goal }); toast('Progress reset'); renderSettings(v); } };
    $('#wipe', v).onclick = async () => { if (confirm('Delete ALL saved drills? This cannot be undone.')) { await A.store.clearAttempts(); invalidate(); toast('All drills deleted'); } };
  }

  async function exportBackup() {
    const data = await A.store.exportAll();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'atelier-backup-' + A.habit.today() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    A.store.set('lastBackup', Date.now());
    toast('Backup downloaded');
  }
  async function importBackup(e) {
    const f = e.target.files[0]; if (!f) return;
    try {
      const txt = await f.text(); const data = JSON.parse(txt);
      await A.store.importAll(data, { merge: false });
      await A.library.init(); invalidate();
      toast('Backup restored'); ui.go('home');
    } catch (err) { toast('Restore failed: ' + err.message); }
  }

  /* ---- modal ------------------------------------------------------------- */
  function openModal(html) {
    closeModal();
    const m = el(`<div class="modal"><div class="sheet">${html}</div></div>`);
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
    return $('.sheet', m);
  }
  function closeModal() { const m = $('.modal'); if (m) m.remove(); }

  A.ui = ui;
})(window.A = window.A || {});
