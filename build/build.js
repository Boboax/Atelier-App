/* Build Atelier from src/ — the ONE build step. Produces:
     1. dist/          — the deployable PWA (src copied verbatim, with the
                         service-worker CACHE and A.BUILD stamped from the
                         build clock, so every build invalidates the old cache)
     2. Atelier.html   — a single self-contained file (CSS, JS, bundled images,
                         manifest, icons all inlined) that runs fully offline
                         from a plain file with no server and no service worker.
   Usage:  node build/build.js   (run from the Atelier folder) */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const readB64 = (p) => fs.readFileSync(path.join(SRC, p)).toString('base64');

// build stamp: YYMMDD.HHMM — becomes the SW cache name and A.BUILD.
// Overridable via env (BUILD=ci) so CI can build deterministically.
const now = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const BUILD = process.env.BUILD ||
  (String(now.getFullYear()).slice(2) + p2(now.getMonth() + 1) + p2(now.getDate()) +
   '.' + p2(now.getHours()) + p2(now.getMinutes()));
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8')).version;

// THE single source of module load order. index.html and sw.js each carry a
// copy; the checks below fail the build the moment either drifts.
const JS_ORDER = [
  'data/refs.js',
  'js/geometry.js', 'js/storage.js', 'js/generators.js', 'js/canvas.js',
  'js/curriculum.js', 'js/coach.js', 'js/gamify.js', 'js/exercises.js', 'js/perceive.js', 'js/library.js', 'js/stats.js',
  'js/history.js', 'js/imgscore.js', 'js/ui.js', 'js/app.js'
];

// drift guards — three copies of the module list have already diverged once
const htmlOrder = [...read('index.html').matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
if (htmlOrder.join() !== JS_ORDER.join()) {
  console.error('BUILD FAILED: index.html <script> order differs from JS_ORDER in build.js');
  console.error('  index.html:', htmlOrder.join(', '));
  console.error('  JS_ORDER:  ', JS_ORDER.join(', '));
  process.exit(1);
}
const swSrc = read('sw.js');
for (const f of JS_ORDER) {
  if (!swSrc.includes("'" + f + "'")) {
    console.error('BUILD FAILED: sw.js ASSETS is missing ' + f);
    process.exit(1);
  }
}

const stampApp = (js) => js
  .replace(/A\.BUILD = '[^']*'/, "A.BUILD = '" + BUILD + "'")
  .replace(/A\.VERSION = '[^']*'/, "A.VERSION = '" + VERSION + "'");

module.exports = { JS_ORDER, SRC };   // reused by the Node test harness
if (require.main !== module) return;  // require()d for JS_ORDER only — don't build

/* ---- 1. dist/ ----------------------------------------------------------- */
fs.rmSync(DIST, { recursive: true, force: true });
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const f = path.join(from, ent.name), t = path.join(to, ent.name);
    if (ent.isDirectory()) copyDir(f, t);
    else fs.copyFileSync(f, t);
  }
};
copyDir(SRC, DIST);
fs.rmSync(path.join(DIST, 'tests.html'), { force: true });          // dev-only
fs.writeFileSync(path.join(DIST, 'sw.js'), read('sw.js').replace('__BUILD__', BUILD));
fs.writeFileSync(path.join(DIST, 'js/app.js'), stampApp(read('js/app.js')));
if (!fs.existsSync(path.join(DIST, 'robots.txt'))) {
  fs.writeFileSync(path.join(DIST, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
}

/* ---- 2. Atelier.html ----------------------------------------------------- */
const css = read('styles.css');
const js = JS_ORDER.map((f) => '\n/* ===== ' + f + ' ===== */\n' +
  (f === 'js/app.js' ? stampApp(read(f)) : read(f))).join('\n');

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
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Atelier">
<meta name="theme-color" content="#f6f3ec" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#211d18" media="(prefers-color-scheme: dark)">
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
console.log('Build ' + BUILD);
console.log('  dist/         refreshed (SW cache atelier-' + BUILD + ')');
console.log('  Atelier.html  ' + kb + ' KB');
