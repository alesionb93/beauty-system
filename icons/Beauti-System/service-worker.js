/**
 * Service Worker - Beauty System PWA
 * --------------------------------------------------
 * Estratégia:
 *  - Pre-cache do "app shell" (HTML, CSS, JS, ícones) na instalação.
 *  - Para navegação (HTML): network-first com fallback para cache (offline).
 *  - Para estáticos (CSS/JS/imagens): stale-while-revalidate.
 *  - Limpeza automática de caches antigos quando o CACHE_VERSION muda.
 *
 * IMPORTANTE: Sempre que publicar uma nova versão dos arquivos,
 * incremente CACHE_VERSION para forçar atualização nos clientes.
 */

const CACHE_VERSION = 'beauty-system-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Arquivos essenciais para o app funcionar offline (App Shell).
// Use caminhos RELATIVOS para funcionar em qualquer subpasta.
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
  './icons/apple-touch-icon.png',
];

// ---------- Install ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        // addAll falha se UM arquivo falhar; usamos add individual tolerante.
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('[SW] Falha ao pré-cachear', url, err);
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

// ---------- Activate ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ---------- Fetch ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Só interceptamos GET.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Ignora requisições para outras origens (ex.: APIs externas, Supabase).
  // Assim não interferimos em chamadas de backend.
  if (url.origin !== self.location.origin) return;

  // Estratégia para navegação (páginas HTML): network-first.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then(
            (cached) =>
              cached ||
              caches.match('./index.html') ||
              new Response('Offline', { status: 503, statusText: 'Offline' }),
          ),
        ),
    );
    return;
  }

  // Estratégia para estáticos: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    }),
  );
});

// Permite que a página force atualização imediata após novo deploy.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
