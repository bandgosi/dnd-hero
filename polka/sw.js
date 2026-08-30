// «Детская полка» — сервис-воркер: после первого захода всё работает без интернета.
// Кэш-first: файлы отдаются из кэша, сеть — только для нового. При обновлении
// приложения поднимите номер версии — старый кэш удалится сам.
const CACHE_NAME = 'polka-v3';
const ASSETS = [
  './',
  './chasiki/app.info.js',
  './chasiki/index.html',
  './chasiki/js/app.js',
  './chasiki/js/audio.js',
  './chasiki/js/clock.js',
  './chasiki/js/curriculum.js',
  './chasiki/js/fx.js',
  './chasiki/js/games.js',
  './chasiki/js/lessons.js',
  './chasiki/js/storage.js',
  './chasiki/js/ui.js',
  './chasiki/styles/base.css',
  './chasiki/styles/components.css',
  './chasiki/styles/screens.css',
  './hub/hub.css',
  './hub/hub.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
  './index.html',
  './manifest.webmanifest',
  './shared/profile.js',
  './skazki/app.info.js',
  './skazki/index.html',
  './umnyashka/app.info.js',
  './umnyashka/app.js',
  './umnyashka/core/fx.js',
  './umnyashka/core/mascot.js',
  './umnyashka/core/router.js',
  './umnyashka/core/sfx.js',
  './umnyashka/core/skills.js',
  './umnyashka/core/speech.js',
  './umnyashka/core/srs.js',
  './umnyashka/core/storage.js',
  './umnyashka/core/store.js',
  './umnyashka/core/ui.js',
  './umnyashka/data/achievements.js',
  './umnyashka/data/alphabet.js',
  './umnyashka/data/characters.js',
  './umnyashka/data/curriculum.js',
  './umnyashka/data/mathgen.js',
  './umnyashka/data/numbers.js',
  './umnyashka/data/school.js',
  './umnyashka/data/sentences.js',
  './umnyashka/data/space.js',
  './umnyashka/data/words.js',
  './umnyashka/data/world.js',
  './umnyashka/games/literacy.js',
  './umnyashka/games/memory.js',
  './umnyashka/games/numbers.js',
  './umnyashka/games/shell.js',
  './umnyashka/index.html',
  './umnyashka/screens/main.js',
  './umnyashka/screens/meta.js',
  './umnyashka/screens/worlds.js',
  './umnyashka/styles/base.css',
  './umnyashka/styles/components.css',
  './umnyashka/styles/games-literacy.css',
  './umnyashka/styles/games-numbers.css',
  './umnyashka/styles/screens.css',
  './umnyashka/styles/tasks-math.css',
  './umnyashka/styles/tasks-reading.css',
  './umnyashka/styles/tokens.css',
  './umnyashka/styles/worlds.css',
  './umnyashka/tasks/common.js',
  './umnyashka/tasks/engine.js',
  './umnyashka/tasks/math.js',
  './umnyashka/tasks/reading.js',
  './umnyashka/tasks/school.js',
  './umnyashka/tasks/space.js',
  './umnyashka/tasks/tracing.js',
  './umnyashka/tasks/world.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('polka-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
