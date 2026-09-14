const VERSION = 'mr-ahmed-saber-teacher-v2-install';
const CACHE = `teacher-${VERSION}`;

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('teacher-') && k !== CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;

  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) {
    return;
  }

  const url = new URL(req.url);

  // Always get the main page fresh so updates reach the installed app.
  const isHtml =
    url.pathname === '/' ||
    url.pathname.endsWith('/index.html');

  if (isHtml) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => {
          if (!res.ok) return res;

          const headers = new Headers(res.headers);
          headers.set('cache-control', 'no-store');

          return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers
          });
        })
        .catch(() => caches.match(req))
    );

    return;
  }

  // Keep important app files available.
  const isAppFile =
    /\.(html|css|js|webmanifest|png|jpg|jpeg|svg|ico)$/.test(url.pathname);

  if (!isAppFile) return;

  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
