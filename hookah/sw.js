const CACHE_NAME = 'dym-mix-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Сеть в приоритете для самой страницы (обновления видны сразу),
// кэш — офлайн-запас; статика (иконки/манифест) — из кэша.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isHTML = req.mode === 'navigate' || req.destination === 'document' ||
    url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');

  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put('./index.html', clone));
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(req)) ||
          (await caches.match('./index.html')) ||
          (await caches.match('./'))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return response;
      });
    })
  );
});
