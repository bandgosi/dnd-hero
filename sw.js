const CACHE_NAME = 'dnd-hero-v36';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './fonts/cinzel-latin.woff2',
  './fonts/crimson-text-latin.woff2',
  './fonts/crimson-text-600-latin.woff2',
  './fonts/crimson-text-italic-latin.woff2',
  './images/welcome-art.jpg',
  './images/bg-texture.jpg',
  './images/frame.png',
  './images/crests/voin.png',
  './images/crests/mag.png',
  './images/crests/plut.png',
  './images/crests/klerik.png',
  './images/crests/paladin.png',
  './images/crests/sledopyt.png',
  './images/crests/varvar.png',
  './images/crests/bard.png',
  './images/crests/monah.png',
  './images/crests/charodey.png',
  './images/crests/koldun.png',
  './images/crests/druid.png',
  './images/empty/spells.png',
  './images/empty/inventory.png',
  './images/empty/features.png',
  './images/empty/rolls.png',
  './images/items/sword.png',
  './images/items/dagger.png',
  './images/items/bow.png',
  './images/items/staff.png',
  './images/items/shield.png',
  './images/items/armor.png',
  './images/items/potion.png',
  './images/items/scroll.png',
  './images/items/book.png',
  './images/items/orb.png',
  './images/items/key.png',
  './images/items/chest.png',
  './images/items/rope.png',
  './images/items/torch.png',
  './images/items/tent.png',
  './images/items/food.png',
  './images/items/coin.png',
  './images/items/ring.png',
  './images/items/amulet.png',
  './images/items/boots.png',
  './images/items/cloak.png',
  './images/items/gloves.png',
  './images/items/helmet.png',
  './images/items/horn.png',
  './images/items/lute.png',
  './images/items/dice.png',
  './images/items/lockpicks.png',
  './images/items/bomb.png',
  './images/items/map.png',
  './images/items/bag.png'
];

// Install: pre-cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Live spell/item API (Open5e) — network only, never cache
  if (url.hostname.includes('open5e.com')) {
    event.respondWith(
      fetch(req).catch(() => new Response('{"results":[]}', { headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }

  // Приложение — это единственный index.html. Для навигаций и самого документа
  // работаем ПО СЕТИ В ПЕРВУЮ ОЧЕРЕДЬ: онлайн всегда видно свежую версию, iOS
  // не застревает на старом кэше. Кэш — только офлайн-запас.
  const isHTML = req.mode === 'navigate' || req.destination === 'document' ||
    url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');

  if (isHTML && url.origin === location.origin) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone));
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

  // Остальное (шрифты, иконки, manifest) — из кэша, иначе из сети и кэшируем
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((response) => {
          if (response.ok && url.origin === location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
