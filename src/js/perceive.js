/* ============================================================================
   perceive.js  —  perception-only drills (no drawing)
   ----------------------------------------------------------------------------
   The research is blunt: misperception of the object is the dominant source of
   drawing error, not motor skill. So we isolate perception — study a stimulus,
   then reproduce the JUDGEMENT (angle or proportion) with a control, scored
   objectively. This trains the eye independent of the hand.
   Recorded as attempts (type 'perc-angle' / 'perc-prop') so they feed Stats.
   Exposed as window.A.Perceive
   ========================================================================== */
(function (A) {
  'use strict';
  function dayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  // --- progression (self-contained; mirrors the main curriculum's adaptive rule) ---
  const TH_ADV = 85, TH_REG = 60, WIN = 5, MAXLVL = 8;   // pull toward the 85% sweet spot from both sides
  function lvlState() { return A.store.get('percLevel', { angle: 1, prop: 1 }); }
  function lvlOf(kind) { return lvlState()[kind] || 1; }
  function recordLevel(kind, score) {
    const s = lvlState(), w = A.store.get('percWin', { angle: [], prop: [] });
    const arr = w[kind] || (w[kind] = []);
    arr.push(score); if (arr.length > WIN) arr.shift();
    let changed = false, dir = 0;
    if (arr.length >= WIN) {
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length, min = Math.min.apply(null, arr);
      if (mean >= TH_ADV && min >= 70 && s[kind] < MAXLVL) { s[kind]++; w[kind] = []; changed = true; dir = 1; }
      else if (mean <= TH_REG && s[kind] > 1) { s[kind]--; w[kind] = []; changed = true; dir = -1; }
    }
    A.store.set('percLevel', s); A.store.set('percWin', w);
    return { changed, dir, level: s[kind] };
  }
  // study glance shrinks with level; stimuli get less "easy" (oblique angles, non-half ratios)
  function studyFor(kind, lvl) {
    if (kind === 'angle') return Math.max(1.2, +(4.5 - (lvl - 1) * 0.4).toFixed(1));
    if (kind === 'curve') return Math.max(1.5, +(5 - (lvl - 1) * 0.4).toFixed(1));
    if (kind === 'value') return Math.max(1.2, +(3.5 - (lvl - 1) * 0.3).toFixed(1));
    return Math.max(1.5, +(5 - (lvl - 1) * 0.4).toFixed(1));
  }
  function pickAngle(lvl) { let a; do { a = Math.round(rnd(8, 172)); } while (lvl >= 4 && [0, 45, 90, 135, 180].some((c) => Math.abs(a - c) < 8)); return a; }
  function pickRatio(lvl) { let r; do { r = +rnd(0.25, 0.95).toFixed(3); } while (lvl >= 4 && Math.abs(r - 0.5) < 0.08); return r; }
  function pickBow(lvl) { let b; do { b = +rnd(0.08, 0.45).toFixed(3); } while (lvl >= 4 && Math.abs(b - 0.25) < 0.03); return b; }
  function pickValue(lvl) { return Math.round(lvl >= 4 ? rnd(25, 75) : rnd(15, 85)); }   // mid-greys are the hard ones

  let el, instr, timerEl, countEl, stim, ctrl, st = {};
  let ringEl, ringFill, ringLabel;
  let wuCount = 0, wuStart = 0;            // rounds done + start time, for the warm-up progress
  const TARGET = 8;                        // ~a 2–3 min warm-up
  const mmss = (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function updateProg() {
    if (!countEl) return;
    const el2 = wuStart ? (performance.now() - wuStart) / 1000 : 0;
    countEl.textContent = `warm-up: ${wuCount} · ${mmss(el2)}`;
  }
  // ring matches the drawing drills: it empties as the memorise countdown runs, turns
  // amber in the last moment, then the judge prompt appears.
  const RING_C = 2 * Math.PI * 20;
  function setRing(frac, warn, label) {
    if (!ringFill) return;
    ringFill.style.strokeDasharray = RING_C;
    ringFill.style.strokeDashoffset = RING_C * (1 - Math.max(0, Math.min(1, frac)));
    if (ringEl) ringEl.classList.toggle('warn', !!warn);
    if (ringLabel) ringLabel.textContent = label || '';
  }

  function build() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'perceive';
    el.innerHTML = `<div class="instructor"><div class="txt" id="p-instr">Study</div>
        <div style="display:flex;gap:12px;align-items:center"><div class="tiny muted" id="p-count"></div>
          <div class="ringwrap"><div class="tring" id="p-ring"><svg viewBox="0 0 48 48"><circle class="track" cx="24" cy="24" r="20"></circle><circle class="fill" id="p-ringfill" cx="24" cy="24" r="20"></circle></svg><div class="tringtxt" id="p-timer"></div></div><div class="ringlabel" id="p-ringlabel"></div></div></div></div>
      <button class="closeX" id="p-close">✕</button>
      <div class="p-stage"><div id="p-stim"></div><div id="p-ctrl"></div></div>`;
    document.body.appendChild(el);
    instr = el.querySelector('#p-instr'); timerEl = el.querySelector('#p-timer'); countEl = el.querySelector('#p-count');
    ringEl = el.querySelector('#p-ring'); ringFill = el.querySelector('#p-ringfill'); ringLabel = el.querySelector('#p-ringlabel');
    stim = el.querySelector('#p-stim'); ctrl = el.querySelector('#p-ctrl');
    el.querySelector('#p-close').addEventListener('click', close);
  }
  function close() {
    clearInterval(st.timer); el.classList.remove('on');
    if (A.ui && A.ui.invalidate) A.ui.invalidate();   // Home must see the fresh warm-up attempts
    if (A.ui) A.ui.go(A.ui.view);
  }

  // --- stimulus + preview rendering ---------------------------------------
  function angleSVG(deg, color, w) {
    const cx = 140, cy = 100, L = 70, a = deg * Math.PI / 180;
    const dx = Math.cos(a) * L, dy = Math.sin(a) * L;
    return `<line x1="${cx - dx}" y1="${cy - dy}" x2="${cx + dx}" y2="${cy + dy}" stroke="${color}" stroke-width="${w || 4}" stroke-linecap="round"/>`;
  }
  function barsSVG(ratio, opts) {
    opts = opts || {};
    const baseH = 150, leftX = 95, rightX = 165, w = 34, floor = 175;
    const rH = baseH * ratio;
    let s = `<rect x="${leftX}" y="${floor - baseH}" width="${w}" height="${baseH}" fill="${opts.leftColor || 'var(--ink)'}"/>`;
    if (!opts.hideRight) s += `<rect x="${rightX}" y="${floor - rH}" width="${w}" height="${rH}" fill="${opts.rightColor || 'var(--accent)'}"/>`;
    return s;
  }
  // curve with a given bow (sagitta as a fraction of the chord) — quadratic bezier
  function curveSVG(bow, color, w, ang) {
    const cx = 140, cy = 100, L = 170, a = (ang || 0) * Math.PI / 180;
    const dx = Math.cos(a) * L / 2, dy = Math.sin(a) * L / 2;
    const x1 = cx - dx, y1 = cy - dy, x2 = cx + dx, y2 = cy + dy;
    const nx = -Math.sin(a), ny = Math.cos(a);
    const off = 2 * bow * L * 0.5;                    // bezier sagitta = off/2 → bow·L/2
    const mx = cx + nx * off, my = cy + ny * off;
    return `<path d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="${w || 4}" stroke-linecap="round"/>`;
  }
  // grey patch on a mid-grey surround (controls simultaneous contrast)
  function valueSVG(v) {
    const g = Math.round(255 * v / 100);
    return `<circle cx="140" cy="100" r="72" fill="rgb(148,144,136)"/>
      <rect x="105" y="65" width="70" height="70" rx="8" fill="rgb(${g},${g},${g})"/>`;
  }
  function svgBox(inner) { return `<svg viewBox="0 0 280 200" style="width:min(360px,82vw);height:auto;background:#fff;border:1px solid var(--line);border-radius:12px">${inner}</svg>`; }

  // --- flow ---------------------------------------------------------------
  function start(kind) {
    build(); el.classList.add('on'); wuCount = 0; wuStart = 0; updateProg(); newRound(kind);
  }
  function newRound(kind) {
    if (!wuStart) wuStart = performance.now();
    updateProg();
    const lvl = lvlOf(kind);
    st = { kind, level: lvl, timer: null };
    st.studySec = studyFor(kind, lvl);
    st.remaining = st.studySec;
    if (kind === 'angle') { st.truth = pickAngle(lvl); stim.innerHTML = svgBox(angleSVG(st.truth, 'var(--ink)')); }
    else if (kind === 'curve') { st.truth = pickBow(lvl); st.ang = lvl >= 5 ? Math.round(rnd(-35, 35)) : 0; stim.innerHTML = svgBox(curveSVG(st.truth, 'var(--ink)', 4, st.ang)); }
    else if (kind === 'value') { st.truth = pickValue(lvl); stim.innerHTML = svgBox(valueSVG(st.truth)); }
    else { st.truth = pickRatio(lvl); stim.innerHTML = svgBox(barsSVG(st.truth)); }
    ctrl.innerHTML = '';
    const CUES = { angle: 'Memorise the angle.', curve: 'Memorise how much the curve bows.', value: 'Memorise the grey — how light or dark.', prop: 'Memorise the proportion (right vs left).' };
    instr.textContent = (CUES[kind] || CUES.prop) + '  ·  Lv ' + lvl;
    timerEl.textContent = Math.ceil(st.remaining) + 's';
    setRing(1, false, 'memorise');
    clearInterval(st.timer);
    st.startT = performance.now();
    st.timer = setInterval(() => {
      st.remaining = st.studySec - (performance.now() - st.startT) / 1000;   // elapsed-time based
      timerEl.textContent = Math.max(0, Math.ceil(st.remaining)) + 's';
      setRing(st.studySec ? st.remaining / st.studySec : 0, st.remaining <= 1, 'memorise');
      updateProg();                                                          // keep warm-up clock live
      if (st.remaining <= 0) { clearInterval(st.timer); recall(); }
    }, 100);
  }

  function recall() {
    timerEl.textContent = ''; setRing(0, false, ''); st.t0 = performance.now();
    const ASK = { angle: 'Set the line to the angle you saw.', curve: 'Set the bow to match.', value: 'Set the grey to match.', prop: 'Set the right bar to match.' };
    instr.textContent = ASK[st.kind] || ASK.prop;
    // randomised start anchor: a fixed start (90° / 60%) lets the eye learn
    // "distance from the anchor" instead of the quantity itself, and method-of-
    // adjustment answers drift toward the anchor. Start somewhere new each time
    // (kept a margin away from the truth so there's always a real adjustment).
    const slider = (min, max, val) => `<div class="opacityctl"><input type="range" id="p-range" min="${min}" max="${max}" value="${val}"></div>
        <button class="btn block" id="p-submit" style="margin-top:12px">Reveal ›</button>`;
    if (st.kind === 'angle') {
      do { st.guess = Math.round(rnd(5, 174)); } while (Math.abs(st.guess - st.truth) < 20);
      stim.innerHTML = svgBox(angleSVG(st.guess, 'var(--accent)'));
      ctrl.innerHTML = slider(0, 179, st.guess);
    } else if (st.kind === 'curve') {
      do { st.guess = Math.round(rnd(5, 50)) / 100; } while (Math.abs(st.guess - st.truth) < 0.1);
      stim.innerHTML = svgBox(curveSVG(st.guess, 'var(--accent)', 4, st.ang));
      ctrl.innerHTML = slider(5, 50, Math.round(st.guess * 100));
    } else if (st.kind === 'value') {
      do { st.guess = Math.round(rnd(5, 95)); } while (Math.abs(st.guess - st.truth) < 18);
      stim.innerHTML = svgBox(valueSVG(st.guess));
      ctrl.innerHTML = slider(0, 100, st.guess);
    } else {
      do { st.guess = Math.round(rnd(15, 105)) / 100; } while (Math.abs(st.guess - st.truth) < 0.12);
      stim.innerHTML = svgBox(barsSVG(st.guess));
      ctrl.innerHTML = slider(10, 110, Math.round(st.guess * 100));
    }
    const range = el.querySelector('#p-range');
    range.oninput = () => {
      if (st.kind === 'angle') { st.guess = +range.value; stim.innerHTML = svgBox(angleSVG(st.guess, 'var(--accent)')); }
      else if (st.kind === 'curve') { st.guess = +range.value / 100; stim.innerHTML = svgBox(curveSVG(st.guess, 'var(--accent)', 4, st.ang)); }
      else if (st.kind === 'value') { st.guess = +range.value; stim.innerHTML = svgBox(valueSVG(st.guess)); }
      else { st.guess = +range.value / 100; stim.innerHTML = svgBox(barsSVG(st.guess)); }
    };
    el.querySelector('#p-submit').onclick = reveal;
  }

  function reveal() {
    const think = (performance.now() - st.t0) / 1000;
    let score, metrics, label;
    if (st.kind === 'angle') {
      let err = Math.abs(st.guess - st.truth); if (err > 90) err = 180 - err;
      score = Math.max(0, Math.round(100 - err * 3));
      // fold the SIGNED error the same way (undirected line): a 170°-vs-5°
      // miss is a 15° error, not −165°, or one wrap-around swamps the bias mean
      let se = st.guess - st.truth;
      if (se > 90) se -= 180; else if (se <= -90) se += 180;
      metrics = { angleErrDeg: +se.toFixed(1) };
      label = `You: ${st.guess}° · actual: ${st.truth}° · off ${Math.round(err)}°`;
      stim.innerHTML = svgBox(angleSVG(st.truth, 'var(--ink)', 4) + angleSVG(st.guess, 'var(--accent)', 2));
    } else if (st.kind === 'curve') {
      const err = Math.abs(st.guess - st.truth);
      score = Math.max(0, Math.round(100 - err * 300));
      metrics = { bowErr: +((st.guess - st.truth)).toFixed(3) };
      label = `You: ${Math.round(st.guess * 100)} · actual: ${Math.round(st.truth * 100)} (bow) · off ${Math.round(err * 100)}`;
      stim.innerHTML = svgBox(curveSVG(st.truth, 'var(--ink)', 4, st.ang) + curveSVG(st.guess, 'var(--accent)', 2, st.ang));
    } else if (st.kind === 'value') {
      const err = Math.abs(st.guess - st.truth);
      score = Math.max(0, Math.round(100 - err * 2.5));
      metrics = { valueErr: +(st.guess - st.truth).toFixed(1) };
      label = `You: ${st.guess} · actual: ${st.truth} (0 dark – 100 light) · off ${Math.round(err)}`;
      const g1 = Math.round(255 * st.truth / 100), g2 = Math.round(255 * st.guess / 100);
      stim.innerHTML = svgBox(`<circle cx="140" cy="100" r="72" fill="rgb(148,144,136)"/>
        <rect x="70" y="65" width="66" height="70" rx="8" fill="rgb(${g1},${g1},${g1})"/>
        <rect x="144" y="65" width="66" height="70" rx="8" fill="rgb(${g2},${g2},${g2})"/>
        <text x="103" y="152" text-anchor="middle" font-size="11" fill="#333">actual</text>
        <text x="177" y="152" text-anchor="middle" font-size="11" fill="#333">you</text>`);
    } else {
      const err = Math.abs(st.guess - st.truth) / st.truth * 100;
      score = Math.max(0, Math.round(100 - err));
      metrics = { ratioErrPct: +((st.guess - st.truth) / st.truth * 100).toFixed(1) };
      label = `You: ${Math.round(st.guess * 100)}% · actual: ${Math.round(st.truth * 100)}% · off ${Math.round(err)}%`;
      stim.innerHTML = svgBox(barsSVG(st.truth) + `<rect x="165" y="${175 - 150 * st.guess}" width="34" height="2" fill="#000"/>`);
    }
    instr.textContent = 'Compare.';
    A.store.addAttempt({
      ts: Date.now(), day: dayKey(), type: 'perc-' + st.kind,
      scored: true, level: st.level, studySec: st.studySec, drawSec: +think.toFixed(1),
      score, selfRated: false, selfEstimate: null, estErr: null, metrics,
      target: st.kind === 'angle' ? { kind: 'line', lines: [[[0.2, 0.5], [0.8, 0.5]]] } : null,
      strokes: [], refId: null, refTitle: null
    });
    A.habit.touch(st.studySec + think);
    wuCount++; updateProg();
    const adv = recordLevel(st.kind, score);
    const lvlMsg = adv.changed
      ? `<div class="insight" style="margin-top:8px">${adv.dir > 0 ? '▲ Levelled up to ' + adv.level + ' — shorter glance now.' : '▼ Eased to level ' + adv.level + '.'}</div>` : '';
    const cls = score >= 85 ? 's-good' : score >= 65 ? 's-mid' : 's-low';
    const elapsed = wuStart ? (performance.now() - wuStart) / 1000 : 0;
    const warmed = wuCount >= TARGET || elapsed >= 120;
    const wuLine = warmed
      ? `<div class="insight" style="margin-top:8px">✓ Well warmed up (${wuCount} in ${mmss(elapsed)}). Tap Done to start drawing.</div>`
      : `<div class="tiny muted" style="margin-top:8px">Warm-up ${wuCount}/${TARGET} · ${mmss(elapsed)} — a few more to prime your eye.</div>`;
    // primary button = keep going until warmed, then = Done
    const again = `<button class="btn ${warmed ? 'ghost' : ''} block" id="p-again">Again</button>`;
    const done = `<button class="btn ${warmed ? '' : 'ghost'} block" id="p-done">Done</button>`;
    ctrl.innerHTML = `<div class="card" style="width:100%;text-align:center">
      <div class="scorebadge ${cls}">${score}</div><div class="muted small">accuracy</div>
      <div class="small" style="margin:8px 0">${label}</div>${lvlMsg}${wuLine}
      <div class="row" style="margin-top:8px">${again}${done}</div></div>`;
    el.querySelector('#p-again').onclick = () => newRound(st.kind);
    el.querySelector('#p-done').onclick = close;
    // the warm-up is the day's OPENER — once warmed, hand off to the next step
    // of the plan instead of stranding the user back on a dashboard
    if (warmed && A.ui && A.ui.doRec && A.game && A.store.allAttempts) {
      A.store.allAttempts().then((atts) => {
        const rec = A.game.recommend(atts);
        const btn = el.querySelector('#p-done');
        if (btn && rec && rec.step !== 'warmup') {
          btn.textContent = 'Next: ' + rec.title + ' ›';
          btn.onclick = () => { close(); A.ui.doRec(rec.step, rec.exKey); };
        }
      }).catch(() => {});
    }
  }

  /* ---- 2AFC: forced-choice discrimination with an adaptive staircase -------
     The fastest-proven format for sharpening discrimination: two stimuli, pick
     which is more (steeper / longer), immediate right-wrong feedback, and a
     2-down-1-up staircase that homes in on your just-noticeable difference.
     Ends after 16 taps; the threshold (mean of the last reversals) is the
     score that should shrink over weeks.                                     */
  const AFC = {
    angle:  { start: 14, min: 1,  max: 30, unit: '°',  ask: 'Which line is steeper?' },
    length: { start: 18, min: 2,  max: 40, unit: '%',  ask: 'Which line is longer?' }
  };
  // pure staircase step (exported for tests): 2 consecutive correct → harder
  // (smaller diff); any miss → easier. Reversals mark the oscillation points.
  function stairStep(s, correct) {
    const out = { diff: s.diff, streak: s.streak, dir: null, reversal: false };
    if (correct) {
      out.streak = s.streak + 1;
      if (out.streak >= 2) { out.diff = s.diff * 0.72; out.streak = 0; out.dir = 'down'; }
    } else {
      out.diff = s.diff * 1.45; out.streak = 0; out.dir = 'up';
    }
    if (out.dir && s.lastDir && out.dir !== s.lastDir) out.reversal = true;
    out.lastDir = out.dir || s.lastDir;
    return out;
  }

  const AFC_TAPS = 16;
  function startAFC(kind) {
    build(); el.classList.add('on');
    const cfg = AFC[kind] || AFC.angle;
    st = { afc: kind, cfg, diff: cfg.start, streak: 0, lastDir: null,
           reversals: [], taps: 0, hits: 0, t0: performance.now(), timer: null };
    setRing(0, false, 'discriminate');
    afcRound();
  }
  function afcRound() {
    const cfg = st.cfg;
    st.diff = Math.max(cfg.min, Math.min(cfg.max, st.diff));
    timerEl.textContent = (st.taps + 1) + '/' + AFC_TAPS;
    instr.textContent = cfg.ask + '  ·  Δ ' + st.diff.toFixed(1) + cfg.unit;
    st.moreIsLeft = Math.random() < 0.5;
    let leftSVG, rightSVG;
    if (st.afc === 'angle') {
      const base = rnd(15, 55);
      const hi = base + st.diff;                              // steeper = closer to vertical
      const lo = base;
      const draw = (deg) => `<line x1="60" y1="170" x2="${60 + Math.cos(deg * Math.PI / 180) * 130}" y2="${170 - Math.sin(deg * Math.PI / 180) * 130}" stroke="var(--ink)" stroke-width="4" stroke-linecap="round"/>`;
      leftSVG = draw(st.moreIsLeft ? hi : lo); rightSVG = draw(st.moreIsLeft ? lo : hi);
    } else {
      const base = rnd(90, 130);
      const hi = base * (1 + st.diff / 100), lo = base;
      const draw = (len) => { const x = rnd(20, 250 - len); const y = rnd(80, 120);
        return `<line x1="${x}" y1="${y}" x2="${x + len}" y2="${y}" stroke="var(--ink)" stroke-width="5" stroke-linecap="round"/>`; };
      leftSVG = draw(st.moreIsLeft ? hi : lo); rightSVG = draw(st.moreIsLeft ? lo : hi);
    }
    stim.innerHTML = `<div style="display:flex;gap:10px;justify-content:center">
      <div style="flex:1;max-width:200px">${svgBox(leftSVG)}</div>
      <div style="flex:1;max-width:200px">${svgBox(rightSVG)}</div></div>`;
    ctrl.innerHTML = `<div class="row" style="margin-top:10px">
      <button class="btn block" id="afc-l">Left</button>
      <button class="btn block" id="afc-r">Right</button></div>
      <div class="tiny muted" style="text-align:center;margin-top:8px">Immediate feedback — trust the first impression.</div>`;
    el.querySelector('#afc-l').onclick = () => afcAnswer(true);
    el.querySelector('#afc-r').onclick = () => afcAnswer(false);
  }
  function afcAnswer(saidLeft) {
    const correct = saidLeft === st.moreIsLeft;
    st.taps++; if (correct) st.hits++;
    const stepped = stairStep(st, correct);
    if (stepped.reversal) st.reversals.push(st.diff);
    st.diff = stepped.diff; st.streak = stepped.streak; st.lastDir = stepped.lastDir;
    setRing(st.taps / AFC_TAPS, false, 'discriminate');
    instr.textContent = correct ? '✓ Correct' : '✗ Not this time';
    if (st.taps >= AFC_TAPS) { setTimeout(afcEnd, 420); }
    else setTimeout(afcRound, 420);
  }
  function afcEnd() {
    const cfg = st.cfg;
    const revs = st.reversals.slice(-4);
    const threshold = +(revs.length >= 2 ? revs.reduce((a, b) => a + b, 0) / revs.length : st.diff).toFixed(1);
    const elapsed = (performance.now() - st.t0) / 1000;
    const type = 'afc-' + st.afc;
    const score = Math.max(0, Math.min(100, Math.round(100 - threshold * (st.afc === 'angle' ? 6 : 4))));
    A.store.addAttempt({
      ts: Date.now(), day: dayKey(), type, scored: true, level: 1,
      studySec: 0, drawSec: +elapsed.toFixed(1), score,
      selfRated: false, selfEstimate: null, estErr: null,
      metrics: { threshold, taps: st.taps, hits: st.hits },
      target: null, strokes: [], refId: null, refTitle: null
    });
    A.habit.touch(elapsed);
    const bests = A.store.get('afcBest', {});
    const isBest = bests[st.afc] == null || threshold < bests[st.afc];
    if (isBest) { bests[st.afc] = threshold; A.store.set('afcBest', bests); }
    if (A.ui && A.ui.invalidate) A.ui.invalidate();
    timerEl.textContent = ''; setRing(0, false, '');
    instr.textContent = 'Discrimination threshold.';
    stim.innerHTML = '';
    ctrl.innerHTML = `<div class="card" style="width:100%;text-align:center">
      <div class="scorebadge ${score >= 85 ? 's-good' : score >= 65 ? 's-mid' : 's-low'}">${threshold}${cfg.unit}</div>
      <div class="muted small">smallest difference your eye caught (${st.hits}/${st.taps} correct)</div>
      ${isBest ? '<div class="insight" style="margin-top:8px">★ Your finest threshold yet — the eye is sharpening.</div>'
               : `<div class="tiny muted" style="margin-top:8px">Best so far: ${bests[st.afc]}${cfg.unit}. Lower is finer.</div>`}
      <div class="row" style="margin-top:10px">
        <button class="btn ghost block" id="p-again">Again</button>
        <button class="btn block" id="p-done">Done</button></div></div>`;
    el.querySelector('#p-again').onclick = () => startAFC(st.afc);
    el.querySelector('#p-done').onclick = close;
  }

  A.Perceive = { start, startAFC, stairStep,
                 kinds: ['angle', 'prop', 'curve', 'value'], afcKinds: ['angle', 'length'] };
})(window.A = window.A || {});
