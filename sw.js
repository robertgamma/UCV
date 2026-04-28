const CACHE_NAME = 'ucv-app-v2';
const urlsToCache = [
  'index.html',
  'app.js',
  'db.js',
  'index.css',
  'parsers.js',
  'pensums.js',
  'pdf.min.js',
  'pdf.worker.min.js',
  'manifest.json'
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
      return; // El navegador manejará esto normalmente si no llamamos a respondWith
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request);
      })
  );
});
