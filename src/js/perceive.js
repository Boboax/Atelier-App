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

  let el, instr, timerEl, stim, ctrl, st = {};

  function build() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'perceive';
    el.innerHTML = `<div class="instructor"><div class="txt" id="p-instr">Study</div><div class="timer" id="p-timer"></div></div>
      <button class="closeX" id="p-close">✕</button>
      <div class="p-stage"><div id="p-stim"></div><div id="p-ctrl"></div></div>`;
    document.body.appendChild(el);
    instr = el.querySelector('#p-instr'); timerEl = el.querySelector('#p-timer');
    stim = el.querySelector('#p-stim'); ctrl = el.querySelector('#p-ctrl');
    el.querySelector('#p-close').addEventListener('click', close);
  }
  function close() { clearInterval(st.timer); el.classList.remove('on'); if (A.ui) A.ui.go(A.ui.view); }

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
  function svgBox(inner) { return `<svg viewBox="0 0 280 200" style="width:min(360px,82vw);height:auto;background:#fff;border:1px solid var(--line);border-radius:12px">${inner}</svg>`; }

  // --- flow ---------------------------------------------------------------
  function start(kind) {
    build(); el.classList.add('on'); newRound(kind);
  }
  function newRound(kind) {
    st = { kind, timer: null };
    st.studySec = kind === 'angle' ? 2.5 : 3;
    st.remaining = st.studySec;
    if (kind === 'angle') { st.truth = Math.round(rnd(12, 168)); stim.innerHTML = svgBox(angleSVG(st.truth, 'var(--ink)')); }
    else { st.truth = +rnd(0.3, 0.92).toFixed(3); stim.innerHTML = svgBox(barsSVG(st.truth)); }
    ctrl.innerHTML = '';
    instr.textContent = kind === 'angle' ? 'Memorise the angle.' : 'Memorise the proportion (right vs left).';
    timerEl.textContent = Math.ceil(st.remaining) + 's';
    clearInterval(st.timer);
    st.startT = performance.now();
    st.timer = setInterval(() => {
      st.remaining = st.studySec - (performance.now() - st.startT) / 1000;   // elapsed-time based
      timerEl.textContent = Math.max(0, Math.ceil(st.remaining)) + 's';
      if (st.remaining <= 0) { clearInterval(st.timer); recall(); }
    }, 100);
  }

  function recall() {
    timerEl.textContent = ''; st.t0 = performance.now();
    instr.textContent = st.kind === 'angle' ? 'Set the line to the angle you saw.' : 'Set the right bar to match.';
    if (st.kind === 'angle') {
      st.guess = 90;
      stim.innerHTML = svgBox(angleSVG(st.guess, 'var(--accent)'));
      ctrl.innerHTML = `<div class="opacityctl"><input type="range" id="p-range" min="0" max="179" value="90"></div>
        <button class="btn block" id="p-submit" style="margin-top:12px">Reveal ›</button>`;
    } else {
      st.guess = 0.6;
      stim.innerHTML = svgBox(barsSVG(st.guess));
      ctrl.innerHTML = `<div class="opacityctl"><input type="range" id="p-range" min="10" max="110" value="60"></div>
        <button class="btn block" id="p-submit" style="margin-top:12px">Reveal ›</button>`;
    }
    const range = el.querySelector('#p-range');
    range.oninput = () => {
      if (st.kind === 'angle') { st.guess = +range.value; stim.innerHTML = svgBox(angleSVG(st.guess, 'var(--accent)')); }
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
      metrics = { angleErrDeg: +(st.guess - st.truth).toFixed(1) };
      label = `You: ${st.guess}° · actual: ${st.truth}° · off ${Math.round(err)}°`;
      stim.innerHTML = svgBox(angleSVG(st.truth, 'var(--ink)', 4) + angleSVG(st.guess, 'var(--accent)', 2));
    } else {
      const err = Math.abs(st.guess - st.truth) / st.truth * 100;
      score = Math.max(0, Math.round(100 - err));
      metrics = { ratioErrPct: +((st.guess - st.truth) / st.truth * 100).toFixed(1) };
      label = `You: ${Math.round(st.guess * 100)}% · actual: ${Math.round(st.truth * 100)}% · off ${Math.round(err)}%`;
      stim.innerHTML = svgBox(barsSVG(st.truth) + `<rect x="165" y="${175 - 150 * st.guess}" width="34" height="2" fill="#000"/>`);
    }
    instr.textContent = 'Compare.';
    A.store.addAttempt({
      ts: Date.now(), day: dayKey(), type: st.kind === 'angle' ? 'perc-angle' : 'perc-prop',
      scored: true, level: 1, studySec: st.studySec, drawSec: +think.toFixed(1),
      score, selfRated: false, selfEstimate: null, estErr: null, metrics,
      target: st.kind === 'angle' ? { kind: 'line', lines: [[[0.2, 0.5], [0.8, 0.5]]] } : null,
      strokes: [], refId: null, refTitle: null
    });
    A.habit.touch(st.studySec + think);
    const cls = score >= 85 ? 's-good' : score >= 65 ? 's-mid' : 's-low';
    ctrl.innerHTML = `<div class="card resultcard" style="position:static;width:min(360px,82vw)">
      <div class="scorebadge ${cls}">${score}</div><div class="muted small">accuracy</div>
      <div class="small" style="margin:8px 0">${label}</div>
      <div class="row"><button class="btn ghost block" id="p-again">Again</button>
        <button class="btn block" id="p-done">Done</button></div></div>`;
    el.querySelector('#p-again').onclick = () => newRound(st.kind);
    el.querySelector('#p-done').onclick = close;
  }

  A.Perceive = { start };
})(window.A = window.A || {});
