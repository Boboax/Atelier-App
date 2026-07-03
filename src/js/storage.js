/* ============================================================================
   storage.js  —  persistence
   ----------------------------------------------------------------------------
   - IndexedDB for the bulky stuff: every attempt (target geometry + the user's
     stroke + score) and user-imported reference images.
   - localStorage for small synchronous state: settings, curriculum level/window
     state, streak/habit data.
   - Whole-state export/import (JSON) so the user can back up to Files/Dropbox,
     because iOS may evict a PWA's storage if it goes unused for weeks.
   Exposed as window.A.store
   ========================================================================== */
(function (A) {
  'use strict';
  const DB_NAME = 'atelier';
  const DB_VERSION = 1;
  let _db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('attempts')) {
          const s = db.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true });
          s.createIndex('ts', 'ts');
          s.createIndex('type', 'type');
          s.createIndex('day', 'day');
        }
        if (!db.objectStoreNames.contains('userRefs')) {
          db.createObjectStore('userRefs', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode) {
    return openDB().then((db) => db.transaction(store, mode).objectStore(store));
  }
  function reqP(r) {
    return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }

  const store = {
    /* ---- attempts ------------------------------------------------------- */
    async addAttempt(att) {
      const os = await tx('attempts', 'readwrite');
      const id = await reqP(os.add(att));
      return id;
    },
    async allAttempts() {
      const os = await tx('attempts', 'readonly');
      return reqP(os.getAll());
    },
    async attemptsByType(type) {
      const os = await tx('attempts', 'readonly');
      return reqP(os.index('type').getAll(type));
    },
    async deleteAttempt(id) {
      const os = await tx('attempts', 'readwrite');
      return reqP(os.delete(id));
    },
    async clearAttempts() {
      const os = await tx('attempts', 'readwrite');
      return reqP(os.clear());
    },

    /* ---- user-imported references --------------------------------------- */
    async addUserRef(ref) {
      const os = await tx('userRefs', 'readwrite');
      return reqP(os.put(ref));
    },
    async allUserRefs() {
      const os = await tx('userRefs', 'readonly');
      return reqP(os.getAll());
    },
    async deleteUserRef(id) {
      const os = await tx('userRefs', 'readwrite');
      return reqP(os.delete(id));
    },

    /* ---- small synchronous state (localStorage) ------------------------- */
    get(key, fallback) {
      try {
        const v = localStorage.getItem('atelier:' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem('atelier:' + key, JSON.stringify(val)); } catch (e) {}
    },

    /* ---- backup / restore ---------------------------------------------- */
    async exportAll() {
      const attempts = await store.allAttempts();
      const userRefs = await store.allUserRefs();
      const ls = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('atelier:')) ls[k] = localStorage.getItem(k);
      }
      return { app: 'atelier', version: 1, exportedAt: new Date().toISOString(),
               localStorage: ls, attempts, userRefs };
    },
    async importAll(data, { merge } = { merge: false }) {
      if (!data || data.app !== 'atelier') throw new Error('Not an Atelier backup file.');
      if (!merge) { await store.clearAttempts(); }
      if (data.localStorage) {
        for (const k in data.localStorage) localStorage.setItem(k, data.localStorage[k]);
      }
      if (Array.isArray(data.attempts)) {
        const os = await tx('attempts', 'readwrite');
        for (const a of data.attempts) { const c = Object.assign({}, a); if (!merge) delete c.id; os.add(c); }
      }
      if (Array.isArray(data.userRefs)) {
        const os = await tx('userRefs', 'readwrite');
        for (const r of data.userRefs) os.put(r);
      }
      return true;
    }
  };

  A.store = store;
})(window.A = window.A || {});
