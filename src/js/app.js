/* ============================================================================
   app.js  —  bootstrap
   ========================================================================== */
(function (A) {
  'use strict';
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
  window.addEventListener('error', (e) => showError((e.error && e.error.message) || e.message || 'script error'));
  window.addEventListener('unhandledrejection', (e) => showError('Promise: ' + ((e.reason && e.reason.message) || e.reason || 'rejection')));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // Register the service worker only when served over http(s) (not file://).
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})(window.A = window.A || {});
