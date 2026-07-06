/* ============================================================================
   imgscore.js  —  objective scoring for reference drills (beta)
   ----------------------------------------------------------------------------
   Threshold a reference image to a binary subject mask (luminance), rasterise
   the user's filled drawing to a mask, and compare by bounding-box-normalised
   IoU (size/position invariant, like shape scoring). Works best on clean,
   single-subject, high-contrast images; tunable threshold + invert handle the
   rest. Self-rating remains the fallback when the mask is poor.
   Exposed as window.A.imgScore
   ========================================================================== */
(function (A) {
  'use strict';
  const G = 200;          // mask resolution
  const N = 140;          // IoU sampling grid
  let _c, _x;
  function ctx() { if (!_c) { _c = document.createElement('canvas'); _c.width = _c.height = G; _x = _c.getContext('2d', { willReadFrequently: true }); } return _x; }

  // fit a w×h image into G×G (contain), return draw rect
  function fitRect(w, h) { const s = Math.min(G / w, G / h); const dw = w * s, dh = h * s; return { x: (G - dw) / 2, y: (G - dh) / 2, w: dw, h: dh }; }

  // region (optional): {x,y,w,h} as a fraction of the image — restrict masking to
  // one panel of a multi-panel plate (Bargue). Pixels outside are background.
  function maskFromImage(img, threshold, invert, region) {
    const x = ctx(); x.clearRect(0, 0, G, G);
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const r = fitRect(iw, ih);
    x.drawImage(img, r.x, r.y, r.w, r.h);
    const d = x.getImageData(0, 0, G, G).data;
    const m = new Uint8Array(G * G);
    let rx0 = 0, ry0 = 0, rx1 = G, ry1 = G;
    if (region) {
      rx0 = r.x + region.x * r.w; ry0 = r.y + region.y * r.h;
      rx1 = rx0 + region.w * r.w; ry1 = ry0 + region.h * r.h;
    }
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const px = j % G, py = (j / G) | 0;
      if (region && (px < rx0 || px > rx1 || py < ry0 || py > ry1)) { m[j] = 0; continue; }
      if (d[i + 3] < 30) { m[j] = 0; continue; }   // transparent → background
      const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      m[j] = invert ? (L > threshold ? 1 : 0) : (L < threshold ? 1 : 0);
    }
    return m;
  }

  // Otsu's method: find the luminance threshold that best separates the image
  // into two classes (subject vs background) by maximising between-class
  // variance. Also decides invert by which side yields a plausible subject size,
  // so auto-score works with no manual tuning on a clean, single-subject image.
  function autoThreshold(img, region) {
    const x = ctx(); x.clearRect(0, 0, G, G);
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const r = fitRect(iw, ih);
    x.drawImage(img, r.x, r.y, r.w, r.h);
    const d = x.getImageData(0, 0, G, G).data;
    let rx0 = 0, ry0 = 0, rx1 = G, ry1 = G;
    if (region) { rx0 = r.x + region.x * r.w; ry0 = r.y + region.y * r.h; rx1 = rx0 + region.w * r.w; ry1 = ry0 + region.h * r.h; }
    const hist = new Array(256).fill(0);
    let total = 0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const px = j % G, py = (j / G) | 0;
      if (px < rx0 || px > rx1 || py < ry0 || py > ry1) continue;
      if (d[i + 3] < 30) continue;
      const L = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
      hist[L]++; total++;
    }
    if (!total) return { threshold: 128, invert: false };
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    // subject is usually the darker, smaller region; if "dark" covers most of the
    // frame, the subject is the light side instead
    let dark = 0; for (let t = 0; t <= thr; t++) dark += hist[t];
    const invert = (dark / total) > 0.5;
    return { threshold: thr, invert };
  }

  function maskFromStrokes(strokes) {
    const x = ctx(); x.clearRect(0, 0, G, G); x.fillStyle = '#fff';
    for (const s of strokes) {
      if (s.length < 2) continue;
      x.beginPath(); x.moveTo(s[0][0] * G, s[0][1] * G);
      for (let i = 1; i < s.length; i++) x.lineTo(s[i][0] * G, s[i][1] * G);
      x.closePath(); x.fill();
    }
    const d = x.getImageData(0, 0, G, G).data;
    const m = new Uint8Array(G * G);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) m[j] = d[i + 3] > 40 ? 1 : 0;
    return m;
  }

  function bbox(m) {
    let minX = G, minY = G, maxX = -1, maxY = -1;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) if (m[y * G + x]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxX < 0) return null;
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  function sample(m, bb, u, v) {           // u,v in [-0.5,0.5] → pixel via bbox+diagonal
    const diag = Math.hypot(bb.w, bb.h) || 1;
    const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
    const px = Math.round(cx + u * diag), py = Math.round(cy + v * diag);
    if (px < 0 || py < 0 || px >= G || py >= G) return 0;
    return m[py * G + px];
  }

  function iou(mA, mB) {
    const ba = bbox(mA), bb = bbox(mB);
    if (!ba || !bb) return 0;
    let inter = 0, uni = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const u = i / (N - 1) - 0.5, v = j / (N - 1) - 0.5;
      const a = sample(mA, ba, u, v), b = sample(mB, bb, u, v);
      uni += a | b; inter += a & b;
    }
    return uni ? inter / uni : 0;
  }

  // ---- edge / contour matching (for line-art references: Bargue block-ins) ----
  // A block-in is thin lines on white, not a filled silhouette, so silhouette IoU
  // is meaningless for it. Instead compare the SHAPE of your line network to the
  // plate's: both point sets bbox-normalised (so it's position/size invariant,
  // like the memory drills), symmetric chamfer weighted toward precision (are your
  // marks on the plate's lines) over coverage (did you cover the whole plate).
  function maskPoints(mask, cap) {
    const pts = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) pts.push([(i % G) / G, ((i / G) | 0) / G]);
    if (cap && pts.length > cap) { const step = Math.ceil(pts.length / cap); return pts.filter((_, i) => i % step === 0); }
    return pts;
  }
  function normCloud(pts) {
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    for (const p of pts) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; }
    const cx = (a + c) / 2, cy = (b + d) / 2, diag = Math.hypot(c - a, d - b) || 1;
    return pts.map((p) => [(p[0] - cx) / diag, (p[1] - cy) / diag]);
  }
  function meanNearest(A, B) {
    if (!A.length || !B.length) return 1;
    let s = 0;
    for (const p of A) { let m = 1e9; for (const q of B) { const dx = p[0] - q[0], dy = p[1] - q[1], dd = dx * dx + dy * dy; if (dd < m) m = dd; } s += Math.sqrt(m); }
    return s / A.length;
  }
  function edgeScore(refMask, strokesDesign) {
    const ref = normCloud(maskPoints(refMask, 500));
    let usr = [];
    for (const s of strokesDesign) for (const p of s) usr.push([p[0], p[1]]);
    if (usr.length > 400) { const step = Math.ceil(usr.length / 400); usr = usr.filter((_, i) => i % step === 0); }
    if (ref.length < 8 || usr.length < 4) return { score: 0, iou: 0, method: 'edge' };
    const nu = normCloud(usr);
    const prec = meanNearest(nu, ref);   // your marks → nearest plate line
    const cov = meanNearest(ref, nu);    // plate lines → nearest of your marks
    const ch = 0.65 * prec + 0.35 * cov;
    const score = Math.round(Math.max(0, Math.min(100, 100 - ch * 260)));
    return { score, iou: +(score / 100).toFixed(3), method: 'edge' };
  }

  // boundary pixels of a mask (works for filled photos AND line-art alike:
  // a line's pixels are all boundary; a silhouette reduces to its outline)
  function edgePoints(mask, cap) {
    const pts = [];
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const i = y * G + x;
      if (!mask[i]) continue;
      if (x === 0 || y === 0 || x === G - 1 || y === G - 1 ||
          !mask[i - 1] || !mask[i + 1] || !mask[i - G] || !mask[i + G]) pts.push([x / G, y / G]);
    }
    if (cap && pts.length > cap) { const step = Math.ceil(pts.length / cap); return pts.filter((_, i) => i % step === 0); }
    return pts;
  }

  const imgScore = {
    autoThreshold,

    /* ---- sight-size scoring ------------------------------------------------
       The reference panel and the drawing panel share one coordinate system at
       1:1, so unlike the memory drills NOTHING is normalised away: the drawing
       is compared to the reference IN PLACE. Placement, size and proportion
       errors all count — exactly what the sight-size method disciplines.
       Also reports the actionable errors a teacher would name: where the copy
       sits (dx/dy) and how its size compares (sizeErrPct).                   */
    sightScore(img, strokesDesign) {
      if (!img || !strokesDesign || !strokesDesign.length) return { score: 0, iou: 0, metrics: {} };
      const auto = autoThreshold(img, null);
      const mask = maskFromImage(img, auto.threshold, auto.invert, null);
      const E = edgePoints(mask, 600);
      let U = [];
      for (const s of strokesDesign) for (const p of s) U.push([p[0], p[1]]);
      if (U.length > 500) { const step = Math.ceil(U.length / 500); U = U.filter((_, i) => i % step === 0); }
      if (E.length < 8 || U.length < 4) return { score: 0, iou: 0, metrics: {} };
      const mn = (A2, B2) => { let s = 0; for (const p of A2) { let m = 1e9; for (const q of B2) { const dx = p[0] - q[0], dy = p[1] - q[1], dd = dx * dx + dy * dy; if (dd < m) m = dd; } s += Math.sqrt(m); } return s / A2.length; };
      const ch = 0.6 * mn(U, E) + 0.4 * mn(E, U);
      const score = Math.round(Math.max(0, Math.min(100, 100 - ch * 480)));
      // placement + size read directly off the two bounding boxes
      const bbOf = (pts) => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const p of pts) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; } return { cx: (a + c) / 2, cy: (b + d) / 2, diag: Math.hypot(c - a, d - b) }; };
      const be = bbOf(E), bu = bbOf(U);
      const dx = +((bu.cx - be.cx) * 100).toFixed(1);        // % of panel; + = right
      const dy = +((bu.cy - be.cy) * 100).toFixed(1);        // + = low
      const sizeErrPct = be.diag ? +(((bu.diag / be.diag) - 1) * 100).toFixed(1) : 0;
      return { score, iou: +(score / 100).toFixed(3),
               metrics: { iou: +(score / 100).toFixed(3), dx, dy, sizeErrPct } };
    },
    // returns {iou, score, coverage, method}. Auto-selects: a filled subject is
    // scored by silhouette overlap; a line-art plate by edge/contour matching.
    score(img, strokesDesign, threshold, invert, region) {
      if (!img || !strokesDesign || !strokesDesign.length) return { iou: 0, score: 0, coverage: 0, method: 'none' };
      const ref = maskFromImage(img, threshold == null ? 128 : threshold, invert, region);
      let cov = 0; for (let i = 0; i < ref.length; i++) cov += ref[i];
      const coverage = cov / (G * G);
      // thin mask ⇒ line drawing (block-in) ⇒ edge matching, not silhouette IoU
      if (coverage < 0.12) {
        const e = edgeScore(ref, strokesDesign);
        return { iou: e.iou, score: e.score, coverage, method: 'edge' };
      }
      const usr = maskFromStrokes(strokesDesign);
      const v = iou(ref, usr);
      return { iou: +v.toFixed(3), score: Math.round(Math.max(0, Math.min(100, Math.pow(v, 0.62) * 100))), coverage, method: 'silhouette' };
    },
    // height:width of the thresholded subject's bounding box (for a proportion check).
    // Returns null if the mask is empty. Region/threshold same meaning as score().
    aspect(img, threshold, invert, region) {
      if (!img) return null;
      const m = maskFromImage(img, threshold == null ? 128 : threshold, invert, region);
      const bb = bbox(m);
      if (!bb || bb.w < 2 || bb.h < 2) return null;
      return bb.h / bb.w;
    },
    // a tinted preview of the extracted subject mask, as a canvas (for overlay)
    maskPreview(img, threshold, invert, region) {
      const ref = maskFromImage(img, threshold == null ? 128 : threshold, invert, region);
      const c = document.createElement('canvas'); c.width = c.height = G;
      const x = c.getContext('2d'); const id = x.createImageData(G, G); const d = id.data;
      for (let i = 0, j = 0; j < ref.length; i += 4, j++) {
        if (ref[j]) { d[i] = 180; d[i + 1] = 83; d[i + 2] = 42; d[i + 3] = 130; }
      }
      x.putImageData(id, 0, 0);
      return c;
    }
  };
  A.imgScore = imgScore;
})(window.A = window.A || {});
