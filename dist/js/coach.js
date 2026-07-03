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
    }
  };
  A.coach = coach;
})(window.A = window.A || {});
