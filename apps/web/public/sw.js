/* Kianda RH — service worker (app instalável).
 * - Ficheiros estáticos do Next (/_next/static): cache primeiro (têm hash no nome).
 * - Páginas do colaborador: rede primeiro com limite de 6 s (rede fraca); sem rede, a última versão guardada.
 * - /api: nunca guardado (dados sempre do servidor). O ponto sem rede é tratado pela própria página.
 * - Ao terminar sessão a página apaga a cache de páginas (dados pessoais).
 */
const VERSION = 'v1';
const STATIC = `kianda-static-${VERSION}`;
const PAGES = 'kianda-pages-v1';
const PRECACHE = ['/offline', '/icons/icon-192.png', '/icons/icon-512.png', '/manifest.webmanifest'];
const PAGE_PATHS = [/^\/$/, /^\/recibos(\/.*)?$/, /^\/ausencias$/, /^\/assiduidade$/, /^\/adiantamentos$/, /^\/documentos$/, /^\/portal\/.*$/];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kianda-static-') && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'clear-pages') event.waitUntil(caches.delete(PAGES));
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(caches.open(STATIC).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (req.mode === 'navigate') {
    const cacheable = PAGE_PATHS.some((r) => r.test(url.pathname));
    const network = fetch(req).then(async (res) => {
      // Só guarda páginas com sessão (sem redireccionamento para o login).
      if (cacheable && res.ok && !res.redirected) (await caches.open(PAGES)).put(url.pathname, res.clone());
      return res;
    });
    event.respondWith(
      withTimeout(network, 6000).catch(async () => {
        const cached = cacheable ? await (await caches.open(PAGES)).match(url.pathname) : undefined;
        if (cached) { network.catch(() => {}); return cached; }
        try { return await network; } catch { return (await caches.match('/offline')) || Response.error(); }
      }),
    );
  }
});
