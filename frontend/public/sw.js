const CACHE = 'webmedia-v1';
const DATA_CACHE = 'webmedia-data-v1';
const STATIC_FILES = ['/', '/data/catalogue.sqlite'];

self.addEventListener('install', (event: any) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(STATIC_FILES))
  );
  (self as any).skipWaiting();
});

self.addEventListener('activate', (event: any) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== DATA_CACHE).map((k) => caches.delete(k)))
    )
  );
  (self as any).clients.claim();
});

self.addEventListener('fetch', (event: any) => {
  const url = new URL(event.request.url);

  if (url.pathname === '/data/catalogue.sqlite') {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
        const clone = res.clone();
        caches.open(DATA_CACHE).then((c) => c.put(event.request, clone));
        return res;
      }))
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('/').then((cached) => cached || fetch(event.request))
    );
    return;
  }

  if (event.request.method === 'GET' && url.pathname.startsWith('/api/')) {
    event.respondWith(
      caches.open(DATA_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request).then((res) => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  if (url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request).then((res) => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          });
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  event.respondWith(fetch(event.request));
});
