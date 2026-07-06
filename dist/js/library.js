/* ============================================================================
   library.js  —  reference image library (bundled + user imports)
   ----------------------------------------------------------------------------
   Bundled plates/worksheets live in window.ATELIER_REFS (base64, offline).
   Imported images are downscaled on the device and stored in IndexedDB.
   Exposed as window.A.library
   ========================================================================== */
(function (A) {
  'use strict';
  const CATS = {
    lines: 'Straight lines', polygons: 'Polygons', envelopes: 'Organic shapes',
    bargue: 'Bargue plates', cast: 'Single figures', user: 'My references'
  };
  let _items = [];
  const _imgCache = {};

  function makeItem(r, bundled) {
    return { id: r.id, title: r.title, category: r.category || 'user',
             group: r.group || (bundled ? 'Bundled' : 'Imported'),
             src: r.src, w: r.w, h: r.h, bundled: !!bundled, attrib: r.attrib || '' };
  }

  const library = {
    CATS,
    async init() {
      _items = [];
      const bundled = (window.ATELIER_REFS || []).map((r) => makeItem(r, true));
      let user = [];
      try { user = (await A.store.allUserRefs()).map((r) => makeItem(r, false)); } catch (e) {}
      _items = bundled.concat(user);
      return _items;
    },
    all() { return _items; },
    byCategory(cat) {
      if (!cat || cat === 'any' || cat === 'all') return _items;
      return _items.filter((i) => i.category === cat);
    },
    get(id) { return _items.find((i) => i.id === id); },

    // returns a (cached) loaded HTMLImageElement
    image(item) {
      if (!item) return Promise.resolve(null);
      if (_imgCache[item.id]) return Promise.resolve(_imgCache[item.id]);
      return new Promise((res) => {
        const im = new Image();
        im.onload = () => { _imgCache[item.id] = im; res(im); };
        im.onerror = () => res(null);
        im.src = item.src;
      });
    },

    // import a File → downscale → store in IndexedDB → return new item
    async importFile(file, title) {
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(file);
      });
      const img = await new Promise((res, rej) => {
        const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('bad image')); im.src = dataUrl;
      });
      const maxdim = 1500;
      const scale = Math.min(1, maxdim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      const out = cv.toDataURL('image/jpeg', 0.82);
      const rec = { id: 'user-' + Date.now() + '-' + Math.floor(Math.random() * 1e4),
                    title: title || file.name.replace(/\.[^.]+$/, ''), category: 'user',
                    group: 'My references', src: out, w, h };
      await A.store.addUserRef(rec);
      const item = makeItem(rec, false);
      _items.push(item);
      return item;
    },
    async deleteUser(id) {
      await A.store.deleteUserRef(id);
      _items = _items.filter((i) => i.id !== id);
      delete _imgCache[id];
    }
  };

  A.library = library;
})(window.A = window.A || {});
