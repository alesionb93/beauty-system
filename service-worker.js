/**
 * Service Worker - Beauty System PWA  (v2 - Realtime safe)
 * --------------------------------------------------
 * MUDANÇAS vs v1:
 *  - CACHE_VERSION bump → invalida TODOS os caches antigos no activate.
 *  - JS/CSS agora usam NETWORK-FIRST (timeout 3s) em vez de stale-while-revalidate.
 *    Isso resolve o "código velho carregando até dar Ctrl+F5".
 *  - Imagens/ícones continuam stale-while-revalidate (são imutáveis na prática).
 *  - Navegação HTML continua network-first com fallback para cache (offline).
 *  - Nunca intercepta requisições para Supabase / outras origens.
 *
 * REGRA DE DEPLOY: a cada release que mude script.js / pwa.js / estilos.css,
 * incremente CACHE_VERSION abaixo. É a única coisa obrigatória.
 */

const CACHE_VERSION = 'beauty-system-v3-bcast';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './agenda.html',
  './pacotes.html',
  './estilos.css',
  './script.js',
  './pwa.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// ---------- Install ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] precache falhou', url, err))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ---------- Activate ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ---------- Helpers ----------
function networkFirst(request, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      caches.match(request).then((cached) => resolve(cached || fetch(request)));
    }, timeoutMs);

    fetch(request).then((resp) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (resp && resp.status === 200 && resp.type === 'basic') {
        const copy = resp.clone();
        caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy));
      }
      resolve(resp);
    }).catch(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      caches.match(request).then((cached) =>
        resolve(cached || new Response('Offline', { status: 503, statusText: 'Offline' }))
      );
    });
  });
}

function staleWhileRevalidate(request) {
  return caches.match(request).then((cached) => {
    const networkFetch = fetch(request).then((resp) => {
      if (resp && resp.status === 200 && resp.type === 'basic') {
        const copy = resp.clone();
        caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy));
      }
      return resp;
    }).catch(() => cached);
    return cached || networkFetch;
  });
}

// ---------- Fetch ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Não interceptar outras origens (Supabase, fonts, cdnjs, jsdelivr...)
  if (url.origin !== self.location.origin) return;

  // 1) Navegação HTML → network-first 3s
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, 3000));
    return;
  }

  const dest = request.destination;

  // 2) Scripts e estilos → network-first 3s (CRÍTICO p/ não servir script.js velho)
  if (dest === 'script' || dest === 'style' || /\.(?:js|css)(?:\?|$)/i.test(url.pathname)) {
    event.respondWith(networkFirst(request, 3000));
    return;
  }

  // 3) Imagens / fontes / outros estáticos → stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// Permite que o cliente force ativação imediata
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
