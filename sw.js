const CACHE_NAME = 'ucv-app-v1';
const urlsToCache = [
  './',
  './index.html',
  './app.js',
  './db.js',
  './pensums.js',
  './pdf.min.js',
  './pdf.worker.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  // Ignorar peticiones a APIs externas (como Gemini)
  if (event.request.url.includes('generativelanguage.googleapis.com')) {
      return fetch(event.request);
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) return response;
        return fetch(event.request);
      })
  );
});
