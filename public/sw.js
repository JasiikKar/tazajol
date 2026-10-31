// Service worker: caches the app shell so the app opens without a connection.
// API calls always go to the network; failed submissions are kept by the app's outbox.
const CACHE = 'tazajol-shell-v2';
const SHELL = ['/', '/style.css', '/app.js', '/i18n.js', '/manifest.webmanifest', '/icon.svg', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
