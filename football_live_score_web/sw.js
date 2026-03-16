const CACHE_NAME = 'korra-live-v10';
const urlsToCache = [
  '/',
  '/index.html',
  '/main-v2.css',
  '/app_v5.js',
  '/logo.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
