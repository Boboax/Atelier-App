/* Atelier service worker — cache-first offline shell.
   Only used when the app is served over http(s). Bump CACHE to force update. */
const CACHE = 'atelier-v3';
const ASSETS = [
  '.', 'index.html', 'styles.css', 'manifest.webmanifest',
  'data/refs.js',
  'js/geometry.js', 'js/storage.js', 'js/generators.js', 'js/canvas.js',
  'js/curriculum.js', 'js/coach.js', 'js/exercises.js', 'js/perceive.js', 'js/library.js', 'js/stats.js',
  'js/history.js', 'js/imgscore.js', 'js/ui.js', 'js/app.js',
  'assets/icon-192.png', 'assets/icon-512.png', 'assets/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})).then(() => self.skipWaiting()));
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
    }).catch(() => caches.match('index.html')))
  );
});
