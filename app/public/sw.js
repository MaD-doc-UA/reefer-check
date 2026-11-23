// Offline cache for the app shell. Plan data is never fetched over the network:
// it lives in the phone's local storage only.
const CACHE = 'reefer-check-v5';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html', './manifest.webmanifest', './icon-512.png', './splash.webp', './splash-glow.webp'])));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'reefer-shared').map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Android Share > Reefers (manifest share_target): park the files, open the app; the Plan tab takes them
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      try {
        const form = await req.formData();
        const cache = await caches.open('reefer-shared');
        let i = 0;
        for (const f of form.getAll('file')) {
          if (typeof f === 'string') continue;
          await cache.put(new Request(`./shared/${Date.now()}-${i++}`), new Response(f, {
            headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name || 'shared-file') },
          }));
        }
      } catch (e) { /* the app says nothing was received */ }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }

  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // network first so a new version is picked up when online; cached page offline
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // hashed assets: cache first
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
