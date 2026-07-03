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

  const imgScore = {
    // returns {iou, score, coverage} comparing user's filled shape to the thresholded subject
    score(img, strokesDesign, threshold, invert, region) {
      if (!img || !strokesDesign || !strokesDesign.length) return { iou: 0, score: 0, coverage: 0 };
      const ref = maskFromImage(img, threshold == null ? 128 : threshold, invert, region);
      const usr = maskFromStrokes(strokesDesign);
      const v = iou(ref, usr);
      let cov = 0; for (let i = 0; i < ref.length; i++) cov += ref[i];
      return { iou: +v.toFixed(3), score: Math.round(Math.max(0, Math.min(100, Math.pow(v, 0.62) * 100))), coverage: cov / (G * G) };
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
