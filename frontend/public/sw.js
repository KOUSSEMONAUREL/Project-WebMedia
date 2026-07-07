var CACHE = 'webmedia-v1';
var DATA_CACHE = 'webmedia-data-v1';
var STATIC_FILES = ['/'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(STATIC_FILES); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== DATA_CACHE; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // Astro assets (versioned) et catalogue.sqlite -> cache-first, pas de TTL (build)
  if (url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/assets/') || url.pathname === '/data/catalogue.sqlite') {
    event.respondWith(
      caches.open(CACHE).then(function (cache) {
        return cache.match(event.request).then(function (cached) {
          var fetchPromise = fetch(event.request).then(function (res) {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          });
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // API routes -> network-first, cache en fallback
  if (event.request.method === 'GET' && url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(DATA_CACHE).then(function (cache) { cache.put(event.request, copy); }).catch(function () { });
        }
        return res;
      }).catch(function () {
        return caches.match(event.request);
      })
    );
    return;
  }

  event.respondWith(fetch(event.request).catch(function () { return new Response('', { status: 503 }); }));
});