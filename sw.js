/* Service worker: network first, cache fallback, so the browser-installed
   app keeps working offline. The desktop build does not register it. */
const CACHE = 'ats-resume-builder-v9';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css', './css/resume.css',
  './js/config.js', './js/desktop.js', './js/data.js', './js/parse.js', './js/ai.js', './js/flow.js', './js/editor.js', './js/preview.js', './js/ats.js', './js/tailor.js', './js/export.js', './js/app.js',
  './vendor/docx.iife.js', './vendor/pdf.min.js', './vendor/pdf.worker.min.js', './vendor/mammoth.browser.min.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
