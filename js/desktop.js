/* =====================================================================
   Desktop persistence. The Windows launcher serves the app from
   localhost, and the browser keeps localStorage per origin (host + port).
   To make sure the API key, resume and preferences survive every launch,
   the launcher also keeps a copy on disk (GET/POST /__store):
     - on start, if this origin has nothing saved yet, restore from disk;
     - afterwards, mirror every change back to disk (debounced).
   Runs before the rest of the app so the restore is in place first.
   ===================================================================== */
(function () {
  'use strict';
  if (!/[?&]desktop=1/.test(location.search)) return;
  const PREFIX = 'atsResumeBuilder.';
  const removed = new Set();   // keys deleted since load; sent as null

  function snapshot() {
    const out = {};
    removed.forEach(k => { out[k] = null; });
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(PREFIX) === 0) out[k] = localStorage.getItem(k);
    }
    return out;
  }

  // Restore before any other script reads localStorage: anything saved on
  // disk that this origin does not have yet is copied in. A synchronous
  // request to the local server takes a few milliseconds.
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/__store', false);
    xhr.send(null);
    if (xhr.status === 200) {
      const data = JSON.parse(xhr.responseText || '{}');
      Object.keys(data).forEach(k => {
        if (k.indexOf(PREFIX) === 0 && typeof data[k] === 'string' && localStorage.getItem(k) === null) localStorage.setItem(k, data[k]);
      });
    }
  } catch (e) { /* no store available; carry on with browser storage */ }

  // Mirror changes to disk. The server merges what it receives (null
  // deletes a key), so a page that holds only part of the data can never
  // wipe the rest. An empty snapshot is never sent.
  let timer = null;
  function body() {
    const snap = snapshot();
    return Object.keys(snap).length ? JSON.stringify(snap) : null;
  }
  function push() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const b = body();
      if (!b) return;
      try {
        fetch('/__store', { method: 'POST', headers: { 'content-type': 'application/json' }, body: b, keepalive: true }).catch(() => {});
      } catch (e) { /* ignore */ }
    }, 400);
  }
  const proto = Storage.prototype;
  const origSet = proto.setItem, origRemove = proto.removeItem, origClear = proto.clear;
  const mine = k => String(k).indexOf(PREFIX) === 0;
  proto.setItem = function (k, v) { origSet.call(this, k, v); if (this === localStorage && mine(k)) { removed.delete(k); push(); } };
  proto.removeItem = function (k) { origRemove.call(this, k); if (this === localStorage && mine(k)) { removed.add(k); push(); } };
  proto.clear = function () {
    if (this === localStorage) Object.keys(localStorage).filter(mine).forEach(k => removed.add(k));
    origClear.call(this);
    if (this === localStorage) push();
  };
  window.addEventListener('pagehide', () => {
    clearTimeout(timer);
    const b = body();
    if (!b) return;
    try { navigator.sendBeacon('/__store', new Blob([b], { type: 'application/json' })); } catch (e) { /* ignore */ }
  });
})();
