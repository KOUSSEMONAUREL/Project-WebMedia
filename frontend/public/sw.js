const CACHE = 'webmedia-v1';
const DATA_CACHE = 'webmedia-data-v1';
const STATIC_FILES = ['/'];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE).then(function(cache) { return cache.addAll(STATIC_FILES); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE && k !== DATA_CACHE; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  if (event.request.method === 'GET' && url.pathname.startsWith('/api/')) {
    event.respondWith(
      caches.open(DATA_CACHE).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          var fetchPromise = fetch(event.request).then(function(res) {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          })['catch'](function() { return cached; });
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  if (url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          var fetchPromise = fetch(event.request).then(function(res) {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          });
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  event.respondWith(fetch(event.request));
});
