/* Test shim: loads the app's IIFE modules (window.A namespace) into Node with
   a fake localStorage. No build system, no dependencies — `node --test test/`. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function freshEnv(files) {
  let mem = {};
  const localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
    key: (i) => Object.keys(mem)[i] || null,
    get length() { return Object.keys(mem).length; },
    _reset: () => { mem = {}; },
    _dump: () => Object.assign({}, mem)
  };
  const window = { A: {} };
  const ctx = vm.createContext({
    window, localStorage, console, Math, Date, JSON, Array, Object, Number, String,
    performance: { now: () => Date.now() },
    document: undefined, navigator: {}, OffscreenCanvas: undefined
  });
  const SRC = path.join(__dirname, '..', 'src');
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  }
  return { A: window.A, localStorage };
}

// modules with no DOM dependency at load OR call time (for the logic we test)
const LOGIC = ['js/geometry.js', 'js/storage.js', 'js/generators.js',
               'js/curriculum.js', 'js/coach.js', 'js/gamify.js', 'js/stats.js'];

// mirrors A.util.dayKey (storage.js): the practice day rolls over at 04:00,
// not midnight — keep in sync or time-of-day-dependent tests flake at night
const dayKey = (offset) => {
  const d = new Date(); d.setHours(d.getHours() - 4); d.setDate(d.getDate() + (offset || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

module.exports = { freshEnv, LOGIC, dayKey };
