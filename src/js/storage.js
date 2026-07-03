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

  /* ---- profiles (several users sharing one iPad) -------------------------
     The first profile is 'default' and keeps the ORIGINAL un-namespaced keys
     and the existing (un-tagged) attempts — so nothing migrates. New profiles
     get an 'atelier:<pid>:' localStorage prefix and a profileId tag on their
     attempts. The registry itself lives in dedicated (shared) keys. */
  const PKEY = 'atelier__profiles', CKEY = 'atelier__current';
  let _pid = null;
  function profilesRaw() { try { return JSON.parse(localStorage.getItem(PKEY)) || []; } catch (e) { return []; } }
  function saveProfilesRaw(list) { try { localStorage.setItem(PKEY, JSON.stringify(list)); } catch (e) {} }
  function currentPid() {
    if (_pid) return _pid;
    let list = profilesRaw();
    if (!list.length) { list = [{ id: 'default', name: 'Player 1' }]; saveProfilesRaw(list); }
    let c = localStorage.getItem(CKEY);
    if (!c || !list.some((p) => p.id === c)) { c = list[0].id; localStorage.setItem(CKEY, c); }
    _pid = c; return c;
  }
  function keyPrefix() { const pid = currentPid(); return 'atelier:' + (pid === 'default' ? '' : pid + ':'); }
  // an attempt belongs to the active profile (default also owns legacy, un-tagged ones)
  function ownAttempt(a, pid) { pid = pid || currentPid(); return pid === 'default' ? (a.profileId == null || a.profileId === 'default') : a.profileId === pid; }

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

  // Current record/backup schema. Old records are upgraded at READ time by
  // normalizeAttempt — no migration pass, no rewrite-in-place.
  const ATTEMPT_SCHEMA = 2;
  const BACKUP_VERSION = 1;
  function normalizeAttempt(a) {
    if (!a || a.schema >= ATTEMPT_SCHEMA) return a;
    // schema 1 → 2: flags/fields added over time get safe defaults
    if (a.repeat == null) a.repeat = false;
    if (a.recall == null) a.recall = false;
    if (a.glances == null) a.glances = 0;
    if (a.estBias == null && a.selfEstimate != null && a.score != null) a.estBias = a.selfEstimate - a.score;
    a.schema = ATTEMPT_SCHEMA;
    return a;
  }

  const store = {
    ATTEMPT_SCHEMA, BACKUP_VERSION, normalizeAttempt,
    /* ---- attempts ------------------------------------------------------- */
    async addAttempt(att) {
      const os = await tx('attempts', 'readwrite');
      const id = await reqP(os.add(Object.assign({}, att, { profileId: currentPid(), schema: ATTEMPT_SCHEMA })));
      return id;
    },
    async allAttempts() {
      const os = await tx('attempts', 'readonly');
      const all = await reqP(os.getAll());
      return all.filter((a) => ownAttempt(a)).map(normalizeAttempt);
    },
    async attemptsByType(type) {
      const os = await tx('attempts', 'readonly');
      const all = await reqP(os.index('type').getAll(type));
      return all.filter((a) => ownAttempt(a)).map(normalizeAttempt);
    },
    async deleteAttempt(id) {
      const os = await tx('attempts', 'readwrite');
      return reqP(os.delete(id));
    },
    async clearAttempts() {            // only the ACTIVE profile's attempts
      const os = await tx('attempts', 'readwrite');
      const all = await reqP(os.getAll());
      for (const a of all) { if (ownAttempt(a)) os.delete(a.id); }
      return true;
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

    /* ---- profiles ------------------------------------------------------- */
    profiles() { return profilesRaw(); },
    profileId() { return currentPid(); },
    profileName() { const p = profilesRaw().find((x) => x.id === currentPid()); return p ? p.name : 'Player 1'; },
    setProfile(pid) { if (profilesRaw().some((p) => p.id === pid)) { localStorage.setItem(CKEY, pid); _pid = pid; } },
    addProfile(name) {
      const list = profilesRaw();
      const id = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      list.push({ id, name: (name && name.trim()) || ('Player ' + (list.length + 1)) });
      saveProfilesRaw(list); return id;
    },
    renameProfile(pid, name) { const list = profilesRaw(); const p = list.find((x) => x.id === pid); if (p && name && name.trim()) { p.name = name.trim(); saveProfilesRaw(list); } },
    async deleteProfile(pid) {
      if (pid === 'default') return false;                 // the original profile is kept
      const list = profilesRaw().filter((p) => p.id !== pid);
      if (!list.length) return false;
      saveProfilesRaw(list);
      const pre = 'atelier:' + pid + ':', del = [];        // wipe its namespaced settings
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(pre) === 0) del.push(k); }
      del.forEach((k) => localStorage.removeItem(k));
      const os = await tx('attempts', 'readwrite');         // wipe its attempts
      const all = await reqP(os.getAll());
      for (const a of all) { if (a.profileId === pid) os.delete(a.id); }
      if (currentPid() === pid) { localStorage.setItem(CKEY, list[0].id); _pid = list[0].id; }
      return true;
    },

    /* ---- small synchronous state (localStorage) ------------------------- */
    get(key, fallback) {
      try {
        const v = localStorage.getItem(keyPrefix() + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem(keyPrefix() + key, JSON.stringify(val)); } catch (e) {}
    },
    remove(key) {                      // profile-aware — callers must never hand-build prefixes
      try { localStorage.removeItem(keyPrefix() + key); } catch (e) {}
    },

    /* ---- backup / restore ---------------------------------------------- */
    async exportAll() {                  // backs up the ACTIVE profile only
      const attempts = await store.allAttempts();
      const userRefs = await store.allUserRefs();
      const ls = {}, isDefault = currentPid() === 'default', pre = keyPrefix();
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(pre) !== 0) continue;
        if (isDefault && /^atelier:[^:]+:/.test(k)) continue;   // skip other profiles' namespaced keys
        ls[k] = localStorage.getItem(k);
      }
      return { app: 'atelier', version: BACKUP_VERSION, profile: store.profileName(), exportedAt: new Date().toISOString(),
               localStorage: ls, attempts, userRefs };
    },
    async importAll(data, { merge } = { merge: false }) {   // restores INTO the active profile
      if (!data || data.app !== 'atelier') throw new Error('Not an Atelier backup file.');
      if (data.version && data.version > BACKUP_VERSION) {
        throw new Error('This backup is from a newer version of Atelier — update the app first.');
      }
      if (!merge) {
        await store.clearAttempts();
        // a clean restore replaces the profile's settings too — keys earned
        // AFTER the backup (levels, achievements, PBs) must not survive and
        // mix with the restored state
        const pre = keyPrefix(), isDefault = currentPid() === 'default', del = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || k.indexOf(pre) !== 0) continue;
          if (isDefault && /^atelier:[^:]+:/.test(k)) continue;   // never touch other profiles
          del.push(k);
        }
        del.forEach((k) => localStorage.removeItem(k));
      }
      if (data.localStorage) {
        for (const k in data.localStorage) {
          const bare = k.replace(/^atelier:(?:[^:]+:)?/, '');   // strip any old prefix → re-namespace to current
          if (bare) localStorage.setItem(keyPrefix() + bare, data.localStorage[k]);
        }
      }
      // IDB writes are transactional — wait for commit and surface failures,
      // so "Backup restored" is never toasted over a silently-aborted restore
      const txDone = (os) => new Promise((res, rej) => {
        const t = os.transaction;
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error || new Error('restore transaction failed'));
        t.onabort = () => rej(t.error || new Error('restore transaction aborted'));
      });
      let wrote = 0;
      if (Array.isArray(data.attempts) && data.attempts.length) {
        const os = await tx('attempts', 'readwrite');
        const done = txDone(os);
        for (const a of data.attempts) { const c = Object.assign({}, a); delete c.id; c.profileId = currentPid(); os.add(c); wrote++; }
        await done;
      }
      if (Array.isArray(data.userRefs) && data.userRefs.length) {
        const os = await tx('userRefs', 'readwrite');
        const done = txDone(os);
        for (const r of data.userRefs) { os.put(r); wrote++; }
        await done;
      }
      return { ok: true, records: wrote };
    }
  };

  A.store = store;
})(window.A = window.A || {});
