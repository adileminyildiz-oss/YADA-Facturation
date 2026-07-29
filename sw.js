/* AEM CONSEIL — Service worker (PWA).
   Stratégie sûre : réseau d'abord (jamais d'appli périmée quand on est en ligne),
   repli sur le cache hors-ligne. N'intercepte que le même domaine en GET :
   Supabase, Stripe, Resend et les CDN passent directement par le réseau. */
const CACHE = 'aem-espace-v1';
const CORE = [
  './', './index.html',
  './facturation/', './clients/', './sous-traitants/', './documents/', './efacture/', './portail/', './abonnement/', './legal/',
  './assets/favicon-192.png', './assets/favicon-512.png', './assets/logo-full.png', './assets/logo-round.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // laisser passer Supabase / CDN / etc.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy).catch(() => {}));
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match('./index.html')))
  );
});
