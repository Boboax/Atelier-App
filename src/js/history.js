/* ============================================================================
   history.js  —  render saved attempts (thumbnails + animated replay)
   ----------------------------------------------------------------------------
   Every attempt stores its target geometry and the user's strokes in design
   coords, so we can redraw both: a static SVG thumbnail for the gallery and an
   animated stroke-by-stroke replay in the detail view.
   Exposed as window.A.history
   ========================================================================== */
(function (A) {
  'use strict';

  function targetPathsDesign(att) {
    const t = att.target; if (!t) return { lines: [], polys: [] };
    if (t.kind === 'line' || t.kind === 'angles') return { lines: t.lines, polys: [] };
    if (t.polygon) return { lines: [], polys: [t.polygon] };
    return { lines: [], polys: [] };
  }

  const history = {
    // small comparison thumbnail: target (grey) + user marks (ink) + answer (accent outline)
    thumbSVG(att, size) {
      size = size || 120;
      const S = size, M = (v) => (v * (S - 8) + 4).toFixed(1);
      const tp = targetPathsDesign(att);
      let g = '';
      // target study shape (grey)
      tp.polys.forEach((poly) => {
        let d = 'M' + poly.map((p) => M(p[0]) + ',' + M(p[1])).join(' L') + ' Z';
        g += `<path d="${d}" fill="rgba(0,0,0,0.07)" stroke="rgba(0,0,0,0.4)" stroke-width="1"/>`;
      });
      tp.lines.forEach((ln) => {
        g += `<line x1="${M(ln[0][0])}" y1="${M(ln[0][1])}" x2="${M(ln[1][0])}" y2="${M(ln[1][1])}" stroke="rgba(0,0,0,0.4)" stroke-width="1.5"/>`;
      });
      // user marks (ink)
      (att.strokes || []).forEach((s) => {
        if (s.length < 2) return;
        const d = 'M' + s.map((p) => M(p[0]) + ',' + M(p[1])).join(' L');
        g += `<path d="${d}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
      });
      return `<svg viewBox="0 0 ${S} ${S}" class="thumb"><rect width="${S}" height="${S}" fill="#fff"/>${g}</svg>`;
    },

    // animated replay onto a canvas 2d context (square). progress 0..1.
    drawReplay(ctx, att, sizePx, progress) {
      const S = sizePx;
      ctx.clearRect(0, 0, S, S); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
      const M = (v) => v * (S - 12) + 6;
      const tp = targetPathsDesign(att);
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1.5;
      tp.polys.forEach((poly) => {
        ctx.beginPath(); ctx.moveTo(M(poly[0][0]), M(poly[0][1]));
        for (let i = 1; i < poly.length; i++) ctx.lineTo(M(poly[i][0]), M(poly[i][1]));
        ctx.closePath(); ctx.fill(); ctx.stroke();
      });
      tp.lines.forEach((ln) => { ctx.beginPath(); ctx.moveTo(M(ln[0][0]), M(ln[0][1])); ctx.lineTo(M(ln[1][0]), M(ln[1][1])); ctx.stroke(); });
      ctx.restore();
      // user strokes up to progress
      const strokes = att.strokes || [];
      const totalPts = strokes.reduce((n, s) => n + s.length, 0);
      let budget = Math.round(totalPts * progress);
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const s of strokes) {
        if (budget <= 0) break;
        const n = Math.min(s.length, budget); budget -= s.length;
        if (n < 2) continue;
        ctx.beginPath(); ctx.moveTo(M(s[0][0]), M(s[0][1]));
        for (let i = 1; i < n; i++) ctx.lineTo(M(s[i][0]), M(s[i][1]));
        ctx.stroke();
      }
    }
  };

  A.history = history;
})(window.A = window.A || {});
