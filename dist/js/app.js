/* ============================================================================
   app.js  —  bootstrap
   ========================================================================== */
(function (A) {
  'use strict';
  // Stamped by build/build.js: A.VERSION from build/version.json, A.BUILD from
  // the build clock (YYMMDD.HHMM). These literals are only the un-built dev fallback.
  A.VERSION = '1.12.0';
  A.BUILD = '260706.2158';
  function boot() {
    try { A.ui.init(); }
    catch (e) {
      document.body.innerHTML = '<div style="padding:24px;font-family:sans-serif">' +
        '<h2>Atelier failed to start</h2><pre style="white-space:pre-wrap;color:#b4453a">' +
        (e && e.stack ? e.stack : e) + '</pre></div>';
      throw e;
    }
  }
  // On-screen error surface — an installed iPad PWA has no devtools, so any
  // runtime error would otherwise be invisible. Show it as a dismissible banner.
  function showError(msg) {
    let b = document.getElementById('errbar');
    if (!b) { b = document.createElement('div'); b.id = 'errbar'; b.onclick = () => b.remove(); document.body.appendChild(b); }
    b.textContent = '⚠ ' + msg + '  · tap to dismiss';
  }
  window.addEventListener('error', (e) => {
    // Ignore opaque cross-origin "Script error." with no detail — it's browser/Safari
    // noise (content blockers, the Share sheet, etc.), not an Atelier crash.
    const real = (e.error && e.error.message) || (e.message && e.message !== 'Script error.') || e.filename;
    if (!real) return;
    let msg = (e.error && e.error.message) || e.message || 'error';
    if (e.filename) msg += ' @ ' + String(e.filename).split('/').pop() + ':' + (e.lineno || '?');
    showError(msg);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    const msg = (r && r.message) || (typeof r === 'string' ? r : '');
    if (!msg) return;   // ignore detail-less rejections (noise)
    showError('Promise: ' + msg);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // Ask iOS not to evict our storage (installed PWAs are usually granted) —
  // one line of insurance against the ~4-week idle wipe.
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (_) {}

  // Register the service worker only when served over http(s) (not file://).
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})(window.A = window.A || {});
