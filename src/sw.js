// Service worker de Ronda Cero.
// - La app (HTML, JS, CSS, iconos) se guarda en caché al instalar: funciona sin conexión.
// - games.json se pide primero a la red (para ver juegos nuevos en cuanto los hay) y,
//   sin conexión, se usa la última copia guardada.
// - Cada publicación cambia VERSION (lo pone scripts/build.mjs), así el móvil detecta
//   que hay versión nueva y la app ofrece "Actualizar".

const VERSION = '__VERSION__';
const CACHE = `ronda-cero-${VERSION}`;
const SHELL = __SHELL__;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => (k.startsWith('ronda-cero-') || k.startsWith('mesa-lista-')) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Lista de juegos: red primero, caché si no hay conexión.
  if (url.origin === location.origin && url.pathname.endsWith('/games.json')) {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // Fuentes de Google: caché en cuanto se descargan una vez.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // Resto de la app: caché primero.
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).catch(() =>
        req.mode === 'navigate' ? caches.match('./index.html') : undefined))
    );
  }
});
