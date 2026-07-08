/* Atelier service worker — cache-first offline shell.
   Only used when the app is served over http(s).
   CACHE is stamped by build/build.js on every build — do not edit by hand. */
const CACHE = 'atelier-260708.2217';
const ASSETS = [
  '.', 'index.html', 'styles.css', 'manifest.webmanifest', 'robots.txt',
  'data/refs.js',
  'js/geometry.js', 'js/storage.js', 'js/generators.js', 'js/canvas.js',
  'js/curriculum.js', 'js/coach.js', 'js/exercises.js', 'js/perceive.js', 'js/library.js', 'js/stats.js',
  'js/history.js', 'js/imgscore.js', 'js/gamify.js', 'js/ui.js', 'js/app.js',
  'assets/favicon.svg', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  // addAll is atomic and MUST be allowed to fail: a half-cached "offline" app
  // that dies in Airplane Mode is worse than keeping the previous version.
  // cache:'reload' bypasses the HTTP cache so a stale CDN copy can't be frozen in.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => {
      // offline miss: only NAVIGATIONS fall back to the shell — an uncached
      // script/image must error, not silently receive HTML
      if (e.request.mode === 'navigate') return caches.match('index.html');
      return Response.error();
    }))
  );
});
