var C = { s: 'wm-s-v1', h: 'wm-h-v1', a: 'wm-a-v1' };
var O = true;

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(C.h).then(function(c) {
      return c.addAll(['/', '/offline.html']);
    }).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(ks) {
      return Promise.all(ks.filter(function(k) { return !Object.values(C).includes(k); }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('message', function(e) {
  var d = e.data || {};
  if (d.type === 'SET_OFFLINE') { O = !!d.value; }
  if (d.type === 'CLEAR_CACHE') {
    e.waitUntil(caches.keys().then(function(ks) { return Promise.all(ks.map(function(k) { return caches.delete(k); })); }));
  }
});

self.addEventListener('fetch', function(e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET') { return; }
  if (u.pathname.startsWith('/_astro/') || u.pathname.startsWith('/assets/') || u.pathname.match(/\.(woff2?|ttf|otf|eot|js|css|svg|png|jpg|jpeg|webp|avif)$/)) {
    e.respondWith(fcache(e.request, C.s)); return;
  }
  if (u.pathname.match(/\.(sqlite|wasm)$/)) {
    if (O) { e.respondWith(fcache(e.request, C.a)); } return;
  }
  if (u.pathname.startsWith('/api/')) {
    if (O) { e.respondWith(nfirst(e.request, C.a)); } return;
  }
  if (e.request.mode === 'navigate') {
    e.respondWith(nfirst(e.request, C.h)); return;
  }
});

function fcache(r, cn) {
  return caches.open(cn).then(function(c) {
    return c.match(r).then(function(m) {
      if (m) { return m; }
      return fetch(r).then(function(res) {
        if (res.ok) { c.put(r, res.clone()); }
        return res;
      });
    });
  });
}

function nfirst(r, cn) {
  return fetch(r).then(function(res) {
    if (res.ok) {
      var clone = res.clone();
      caches.open(cn).then(function(c) { c.put(r, clone); });
    }
    return res;
  }).catch(function() {
    return caches.open(cn).then(function(c) { return c.match(r); });
  });
}
