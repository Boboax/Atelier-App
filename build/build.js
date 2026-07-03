/* Build a single self-contained Atelier.html from src/ — everything inlined
   (CSS, JS, bundled images, manifest, icons) so it runs fully offline from a
   plain file with no server, no network, no service worker required.
   Usage:  node build/build.js   (run from the Atelier folder) */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const readB64 = (p) => fs.readFileSync(path.join(SRC, p)).toString('base64');

const JS_ORDER = [
  'data/refs.js',
  'js/geometry.js', 'js/storage.js', 'js/generators.js', 'js/canvas.js',
  'js/curriculum.js', 'js/coach.js', 'js/gamify.js', 'js/exercises.js', 'js/perceive.js', 'js/library.js', 'js/stats.js',
  'js/history.js', 'js/imgscore.js', 'js/ui.js', 'js/app.js'
];

const css = read('styles.css');
const js = JS_ORDER.map((f) => '\n/* ===== ' + f + ' ===== */\n' + read(f)).join('\n');

// inline manifest with data-URI icons
const manifest = JSON.parse(read('manifest.webmanifest'));
const icon192 = 'data:image/png;base64,' + readB64('assets/icon-192.png');
const icon512 = 'data:image/png;base64,' + readB64('assets/icon-512.png');
const touch = 'data:image/png;base64,' + readB64('assets/apple-touch-icon.png');
manifest.icons = [
  { src: icon192, sizes: '192x192', type: 'image/png' },
  { src: icon512, sizes: '512x512', type: 'image/png' },
  { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
];
const manifestDataUri = 'data:application/manifest+json;base64,' +
  Buffer.from(JSON.stringify(manifest)).toString('base64');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no, maximum-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Atelier">
<meta name="theme-color" content="#f6f3ec">
<link rel="manifest" href="${manifestDataUri}">
<link rel="apple-touch-icon" href="${touch}">
<title>Atelier — memory drawing trainer</title>
<style>
${css}
</style>
</head>
<body>
<div id="boot" style="padding:40px;text-align:center;font-family:Georgia,serif;color:#8a8276">Atelier…</div>
<script>
${js}
</script>
</body>
</html>
`;

const out = path.join(ROOT, 'Atelier.html');
fs.writeFileSync(out, html);
const kb = Math.round(Buffer.byteLength(html) / 1024);
console.log('Wrote ' + out + '  (' + kb + ' KB)');
