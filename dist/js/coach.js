/* ============================================================================
   coach.js  —  turn per-attempt metrics into one actionable instruction
   ----------------------------------------------------------------------------
   Research basis: feedback aids learning when it points to the correction, and
   self-estimation + a single corrective cue builds the internal error-detector
   better than a wall of numbers. So we say ONE thing to fix next.
   Exposed as window.A.coach
   ========================================================================== */
(function (A) {
  'use strict';
  const coach = {
    advice(exKey, m) {
      m = m || {};
      if (exKey === 'line' || exKey === 'angles') {
        const a = m.angleErrDeg != null ? m.angleErrDeg : m.meanAngleErrDeg;
        const l = m.lengthErrPct != null ? m.lengthErrPct : m.meanLengthErrPct;
        if (a != null && Math.abs(a) >= 3)
          return `Your line leans too far ${a > 0 ? 'clockwise' : 'anticlockwise'} (~${Math.abs(a)}°) — aim the other way next time.`;
        if (l != null && Math.abs(l) >= 6)
          return `Length a touch too ${l > 0 ? 'long' : 'short'} (~${Math.abs(l)}%) — ${l > 0 ? 'shorten' : 'extend'} it deliberately.`;
        return 'Dialled in — angle and length both close.';
      }
      if (exKey === 'curve') {
        if (m.iou != null && m.iou < 0.6) return 'Follow the bend more closely — pin the start, end and apex (furthest bow) first.';
        return 'Nice curve — smooth and close to the path.';
      }
      if (exKey === 'gesture') {
        if (m.iou != null && m.iou < 0.7) return 'Find the main sweep — one long line head to foot. Push the curve rather than tracing the outline.';
        return 'Strong line of action — you caught the pose’s rhythm.';
      }
      // shapes
      if (m.aspectErrPct != null && Math.abs(m.aspectErrPct) >= 8)
        return `Proportion off — you drew it too ${m.aspectErrPct > 0 ? 'wide; make it taller/narrower' : 'tall; make it wider'} (~${Math.abs(m.aspectErrPct)}%).`;
      if (m.iou != null && m.iou < 0.6)
        return 'Envelope is drifting — lock the outer corners and overall box before any detail.';
      return 'Good proportion and overlap — refine the corners.';
    },

    // qualitative label for how well the self-estimate matched reality
    selfAwareness(estErr) {
      if (estErr == null) return '';
      if (estErr <= 6) return 'sharp self-read';
      if (estErr <= 15) return 'fair self-read';
      return 'you misjudged your own work';
    },

    // one line about the DIRECTION of self-estimates (signed calibration):
    // a consistent lean matters more than any single gap
    calibration(bias) {
      if (bias == null) return '';
      if (Math.abs(bias) < 4) return 'Your self-estimates are well calibrated.';
      return bias > 0
        ? `You tend to overestimate your work by ~${Math.round(bias)} pts — judge harder before the reveal.`
        : `You tend to underestimate your work by ~${Math.round(Math.abs(bias))} pts — trust your eye more.`;
    },

    /* ---- teaching layer ----------------------------------------------------
       The single coaching cue says WHAT to fix; a principle card says WHY it
       happens and HOW the atelier tradition handles it — the "here's the master's
       method" a drill machine otherwise lacks. Returned on demand (the learner
       taps "Why & how"), keyed to the dominant error so it's never generic.   */
    PRINCIPLES: {
      angle: { icon: '∠', title: 'Read angles against vertical & horizontal',
        why: 'The eye is hopeless at judging a slant in isolation but very accurate at comparing it to true vertical or horizontal — the one reference always in front of you.',
        how: 'Before you commit a line, name its tilt off vertical/horizontal (“about 2 o’clock”) and match that, not the line by itself. Hold the pencil up as a level to check. The faint angle-clock guide is there for exactly this.' },
      length: { icon: '⇥', title: 'Measure by comparison, never by eye',
        why: 'Absolute lengths are nearly impossible to judge; ratios are easy. This is the heart of sight-size and comparative measurement — the first thing every atelier teaches.',
        how: 'Pick one length as your unit, then read every other length as a multiple of it (“this span is 1.4 of that”). Tap Measure to lay a caliper: the first line is the unit, the rest read ×units.' },
      proportion: { icon: '▢', title: 'Lock the big box before any detail',
        why: 'The whole classical method is general-to-specific. If the outermost width-to-height is wrong, every internal shape inherits the error — no amount of careful detail rescues a wrong envelope.',
        how: 'Mark the extreme top, bottom, left and right points first and check the overall height:width ratio against the subject. Only then place the sides. Proportion is decided by that box, not by the edges.' },
      envelope: { icon: '⬡', title: 'Straight lines first, curves last',
        why: 'Blocking a form in a few long straights (the “envelope”) fixes its proportion and gesture before you commit to a contour. Starting with curves locks in an edge before the big shape is right.',
        how: 'Draw the fewest straight lines that just contain the form, facet them into smaller straights, and round to the true contour only at the end. Keep the early lines light and correctable.' },
      apex: { icon: '⌒', title: 'Pin the anchors, then the bow',
        why: 'A curve is fully described by its two endpoints and its apex — the furthest point it departs from the straight line between them. Fix those three and the curve almost draws itself.',
        how: 'Before the sweep, mark start, end, and where (and how far) it bows out. Draw through those points in one unhurried stroke rather than feeling your way along the edge.' },
      loa: { icon: '⟋', title: 'One line through the whole figure',
        why: 'A pose reads as a single rhythmic line — the line of action — before any anatomy. Catching that flow first is what makes a gesture feel alive instead of stiff, and it’s the first mark every figure artist makes.',
        how: 'Draw the longest continuous line from the head down the spine to the weight-bearing foot in one stroke. Push the curve a little further than you think you see — a gesture exaggerates the rhythm.' },
      calibration: { icon: '👁', title: 'Judge before you’re told',
        why: 'Estimating your own accuracy before the reveal builds the internal error-detector — the skill that lets you self-correct without a teacher. The shrinking gap between guess and truth IS the progress.',
        how: 'Commit to a real number every time; a specific wrong guess teaches far more than a vague one. Over sessions, watch the self-read gap in Stats close.' },
      faster: { icon: '⏱', title: 'Now train the eye to see faster',
        why: 'Once accuracy holds, the skill left to build is speed of perception — capturing the same information in a shorter glance. That is exactly what levelling up shortens for you.',
        how: 'Trust your first read. Study until you can picture it, commit, and draw — don’t keep staring; a long stare rarely adds accuracy, and glances beat stares for memory.' }
    },
    // choose the principle for the dominant error of this attempt (or null)
    principle(exKey, r) {
      const m = (r && r.metrics) || {};
      if (exKey === 'line' || exKey === 'angles') {
        const a = m.angleErrDeg != null ? m.angleErrDeg : m.meanAngleErrDeg;
        const l = m.lengthErrPct != null ? m.lengthErrPct : m.meanLengthErrPct;
        if (a != null && Math.abs(a) >= 3) return coach.PRINCIPLES.angle;
        if (l != null && Math.abs(l) >= 6) return coach.PRINCIPLES.length;
      } else if (exKey === 'curve') {
        if (m.iou != null && m.iou < 0.75) return coach.PRINCIPLES.apex;
      } else if (exKey === 'gesture') {
        if (m.iou != null && m.iou < 0.8) return coach.PRINCIPLES.loa;
      } else {   // polygon / envelope
        if (m.aspectErrPct != null && Math.abs(m.aspectErrPct) >= 8) return coach.PRINCIPLES.proportion;
        if (m.iou != null && m.iou < 0.75) return coach.PRINCIPLES.envelope;
      }
      // dialled in: teach calibration if the self-read was off, else seeing faster
      if (r && r.estErr != null && r.estErr > 12) return coach.PRINCIPLES.calibration;
      return coach.PRINCIPLES.faster;
    }
  };
  A.coach = coach;
})(window.A = window.A || {});
