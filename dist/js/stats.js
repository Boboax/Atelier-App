/* ============================================================================
   stats.js  —  aggregation + lightweight inline-SVG charts
   ----------------------------------------------------------------------------
   The headline feature is *calibration*: because scored drills record SIGNED
   errors, we can surface systematic bias — e.g. "you rotate angles +4° CW" or
   "you draw envelopes 9% too wide" — which is exactly the blind spot memory
   training is meant to remove.
   Exposed as window.A.stats and window.A.charts
   ========================================================================== */
(function (A) {
  'use strict';
  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const stats = {
    summary(attempts) {
      const scored = attempts.filter((a) => a.scored);
      const byType = {};
      for (const a of attempts) {
        const t = byType[a.type] || (byType[a.type] = { type: a.type, n: 0, scores: [] });
        t.n++; t.scores.push(a.score);
      }
      Object.values(byType).forEach((t) => { t.mean = Math.round(mean(t.scores)); t.best = Math.max.apply(null, t.scores); });
      return {
        total: attempts.length,
        scoredCount: scored.length,
        meanScore: Math.round(mean(scored.map((a) => a.score))),
        byType,
        days: new Set(attempts.map((a) => a.day)).size
      };
    },

    // daily mean score (optionally for one type) → [{day, score, n}]
    // Objective, first-look trials only: self-ratings, repeats and recalls
    // would distort the trend (and levelling up makes scores DIP by design —
    // that's progress, not decline).
    dailyTrend(attempts, type) {
      let f = attempts.filter((a) => a.scored && !a.repeat && !a.recall);
      if (type) f = f.filter((a) => a.type === type);
      const byDay = {};
      for (const a of f) { (byDay[a.day] || (byDay[a.day] = [])).push(a.score); }
      return Object.keys(byDay).sort().map((d) => ({ day: d, score: Math.round(mean(byDay[d])), n: byDay[d].length }));
    },

    // systematic bias for a scored type — over a RECENT window, not all history.
    // A bias you fixed three weeks ago must not keep prescribing a counter-
    // correction; the coach should describe the eye you have NOW.
    BIAS_WINDOW: 25,
    bias(attempts, type) {
      const f = attempts.filter((a) => a.type === type && a.metrics && !a.repeat)
                        .slice(-stats.BIAS_WINDOW);
      if (type === 'line') {
        const ae = f.map((a) => a.metrics.angleErrDeg).filter((v) => v != null);
        const le = f.map((a) => a.metrics.lengthErrPct).filter((v) => v != null);
        return { kind: 'line', n: f.length,
                 angle: { mean: +mean(ae).toFixed(1), samples: ae },
                 length: { mean: +mean(le).toFixed(1), samples: le } };
      }
      if (type === 'angles') {
        const ae = f.map((a) => a.metrics.meanAngleErrDeg).filter((v) => v != null);
        const le = f.map((a) => a.metrics.meanLengthErrPct).filter((v) => v != null);
        return { kind: 'angles', n: f.length,
                 angle: { mean: +mean(ae).toFixed(1), samples: ae },
                 length: { mean: +mean(le).toFixed(1), samples: le } };
      }
      const asp = f.map((a) => a.metrics.aspectErrPct).filter((v) => v != null);
      return { kind: 'shape', n: f.length, aspect: { mean: +mean(asp).toFixed(1), samples: asp } };
    },

    studyVsAccuracy(attempts, type) {
      const f = (type ? attempts.filter((a) => a.type === type) : attempts).filter((a) => a.scored);
      return f.map((a) => ({ x: a.studySec, y: a.score }));
    },

    // how well self-estimates match actual scores (lower gap = better self-read).
    // meanGap/bias use the recent window (current calibration); the daily trend
    // spans all history (that's its point).
    selfAwareness(attempts) {
      const f = attempts.filter((a) => a.selfEstimate != null && a.estErr != null);
      if (!f.length) return null;
      const byDay = {};
      for (const a of f) (byDay[a.day] || (byDay[a.day] = [])).push(a.estErr);
      const trend = Object.keys(byDay).sort().map((d) => ({ day: d, score: Math.round(100 - mean(byDay[d])), n: byDay[d].length }));
      const recent = f.slice(-stats.BIAS_WINDOW);
      // signed bias: + = overconfident (estimates above reality), − = underconfident
      const signed = recent.map((a) => (a.estBias != null ? a.estBias
                                        : (a.selfEstimate != null && a.score != null ? a.selfEstimate - a.score : null)))
                           .filter((v) => v != null);
      return { n: f.length, meanGap: +mean(recent.map((a) => a.estErr)).toFixed(1),
               bias: signed.length ? +mean(signed).toFixed(1) : null, trend };
    }
  };

  /* ---- inline SVG charts (no dependencies) ------------------------------ */
  const charts = {
    // line chart of {day,score}
    line(series, o) {
      o = Object.assign({ w: 520, h: 160, pad: 26, color: 'var(--accent)' }, o || {});
      if (!series.length) return '<div class="muted small">No data yet.</div>';
      const xs = series.map((_, i) => i);
      const W = o.w, H = o.h, P = o.pad;
      const xmax = Math.max(1, series.length - 1);
      const X = (i) => P + (i / xmax) * (W - 2 * P);
      const Y = (v) => H - P - (v / 100) * (H - 2 * P);
      let path = '';
      series.forEach((s, i) => { path += (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(s.score).toFixed(1) + ' '; });
      const grid = [0, 25, 50, 75, 100].map((v) =>
        `<line x1="${P}" y1="${Y(v)}" x2="${W - P}" y2="${Y(v)}" stroke="var(--hair)"/>` +
        `<text x="4" y="${Y(v) + 4}" class="ctick">${v}</text>`).join('');
      const dots = series.map((s, i) => `<circle cx="${X(i)}" cy="${Y(s.score)}" r="2.6" fill="${o.color}"/>`).join('');
      let xlab = '';
      if (series[0].day) {
        xlab = `<text x="${P}" y="${H - 3}" class="ctick">${esc(series[0].day.slice(5))}</text>` +
               (series.length > 1 ? `<text x="${W - P}" y="${H - 3}" class="ctick" text-anchor="end">${esc(series[series.length - 1].day.slice(5))}</text>` : '');
      }
      return `<svg viewBox="0 0 ${W} ${H}" class="chart">${grid}` +
             `<path d="${path}" fill="none" stroke="${o.color}" stroke-width="2"/>${dots}${xlab}</svg>`;
    },

    // scatter of {x,y}; x axis labelled, y is 0-100 score
    scatter(points, o) {
      o = Object.assign({ w: 520, h: 170, pad: 30, color: 'var(--accent)', xlabel: 'study s', xmax: null }, o || {});
      if (!points.length) return '<div class="muted small">No data yet.</div>';
      const W = o.w, H = o.h, P = o.pad;
      const xmax = o.xmax || Math.max.apply(null, points.map((p) => p.x)) || 1;
      const X = (v) => P + (v / xmax) * (W - 2 * P);
      const Y = (v) => H - P - (v / 100) * (H - 2 * P);
      const grid = [0, 50, 100].map((v) => `<line x1="${P}" y1="${Y(v)}" x2="${W - P}" y2="${Y(v)}" stroke="var(--hair)"/><text x="4" y="${Y(v) + 4}" class="ctick">${v}</text>`).join('');
      const dots = points.map((p) => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3" fill="${o.color}" fill-opacity="0.6"/>`).join('');
      return `<svg viewBox="0 0 ${W} ${H}" class="chart">${grid}${dots}` +
             `<text x="${W - P}" y="${H - 6}" class="ctick" text-anchor="end">${esc(o.xlabel)} →</text></svg>`;
    },

    // horizontal bars of {label,value(0-100),sub}
    bars(items, o) {
      o = Object.assign({ w: 520, rowH: 30 }, o || {});
      if (!items.length) return '<div class="muted small">No data yet.</div>';
      const W = o.w, H = items.length * o.rowH + 8, P = 130;
      let rows = '';
      items.forEach((it, i) => {
        const y = i * o.rowH + 8;
        const bw = (it.value / 100) * (W - P - 40);
        rows += `<text x="0" y="${y + 14}" class="blabel">${esc(it.label)}</text>` +
                `<rect x="${P}" y="${y + 3}" width="${W - P - 40}" height="16" rx="4" fill="var(--hair)"/>` +
                `<rect x="${P}" y="${y + 3}" width="${Math.max(2, bw).toFixed(1)}" height="16" rx="4" fill="var(--accent)"/>` +
                `<text x="${W - 34}" y="${y + 15}" class="bval">${it.value}${it.suffix || ''}</text>`;
      });
      return `<svg viewBox="0 0 ${W} ${H}" class="chart">${rows}</svg>`;
    },

    // vertical bars of minutes per day: {day, mins, met}. Time (not a 0-100
    // score), so the y-axis self-scales to the busiest day or the goal, whichever
    // is taller. A dashed goal line; the last bar (today) is always highlighted,
    // met days accent, quiet days grey — so a glance reads "how much, how often".
    dayTime(series, o) {
      o = Object.assign({ w: 520, h: 168, pad: 24, goal: 0 }, o || {});
      if (!series.length) return '<div class="muted small">No data yet.</div>';
      const W = o.w, H = o.h, P = o.pad, base = H - P;
      const maxV = Math.max.apply(null, series.map((s) => s.mins).concat([o.goal, 1]));
      const ymax = maxV * 1.15;
      const Y = (v) => base - (v / ymax) * (base - P);
      const n = series.length, slot = (W - 2 * P) / n, bw = Math.min(slot * 0.62, 26);
      const bars = series.map((s, i) => {
        const cx = P + slot * (i + 0.5), y = Y(s.mins), today = i === n - 1;
        const fill = today || s.met ? 'var(--accent)' : 'var(--hair)';
        const op = today ? '1' : (s.met ? '0.5' : '1');
        return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, base - y).toFixed(1)}" rx="3" fill="${fill}" fill-opacity="${op}"/>`;
      }).join('');
      let goalLine = '';
      if (o.goal > 0) {
        const gy = Y(o.goal);
        goalLine = `<line x1="${P}" y1="${gy.toFixed(1)}" x2="${W - P}" y2="${gy.toFixed(1)}" stroke="var(--accent)" stroke-dasharray="4 4" stroke-opacity="0.55"/>` +
                   `<text x="${W - P}" y="${(gy - 4).toFixed(1)}" class="ctick" text-anchor="end">goal ${o.goal}m</text>`;
      }
      const axis = `<line x1="${P}" y1="${base}" x2="${W - P}" y2="${base}" stroke="var(--hair)"/>` +
        `<text x="${P}" y="${H - 4}" class="ctick">${esc(series[0].day.slice(5))}</text>` +
        (n > 1 ? `<text x="${W - P}" y="${H - 4}" class="ctick" text-anchor="end">${esc(series[n - 1].day.slice(5))}</text>` : '');
      return `<svg viewBox="0 0 ${W} ${H}" class="chart">${axis}${goalLine}${bars}</svg>`;
    },

    // signed-bias bar: zero in the centre, value drawn left(neg)/right(pos)
    biasBar(value, range, labels) {
      const W = 520, H = 56, P = 16, mid = W / 2;
      const r = range || 30;
      const v = Math.max(-r, Math.min(r, value));
      const x = mid + (v / r) * (mid - P);
      const barLeft = Math.min(mid, x), barW = Math.abs(x - mid);
      return `<svg viewBox="0 0 ${W} ${H}" class="chart">` +
        `<line x1="${P}" y1="${H / 2}" x2="${W - P}" y2="${H / 2}" stroke="var(--hair)"/>` +
        `<line x1="${mid}" y1="8" x2="${mid}" y2="${H - 8}" stroke="var(--hair)" stroke-dasharray="3 3"/>` +
        `<rect x="${barLeft}" y="${H / 2 - 8}" width="${Math.max(2, barW).toFixed(1)}" height="16" rx="4" fill="${Math.abs(value) < 1 ? 'var(--good)' : 'var(--accent)'}"/>` +
        `<circle cx="${x.toFixed(1)}" cy="${H / 2}" r="4" fill="var(--ink)"/>` +
        `<text x="${P}" y="${H - 2}" class="ctick">${esc(labels[0])}</text>` +
        `<text x="${W - P}" y="${H - 2}" class="ctick" text-anchor="end">${esc(labels[1])}</text>` +
        `</svg>`;
    }
  };

  A.stats = stats;
  A.charts = charts;
})(window.A = window.A || {});
