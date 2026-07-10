/* =========================================================
   Service Worker — versão estável
   - Sem cache agressivo de navegação (evita "presa em build antiga"
     sem precisar do toast funcionando perfeito)
   - Suporta SKIP_WAITING via postMessage
   - updateViaCache controlado pelo registro no pwa.js
   ========================================================= */

const SW_VERSION = 'v1.0.0'; // <- troque a cada deploy (ou injete no build)
const RUNTIME_CACHE = `runtime-${SW_VERSION}`;

self.addEventListener('install', (event) => {
  // NÃO chamar skipWaiting aqui automaticamente.
  // O skipWaiting será disparado SOMENTE quando o usuário clicar "Atualizar".
  // Isso evita que o SW novo assuma sozinho e cause loops/reloads inesperados.
  event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Limpa caches antigos
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== RUNTIME_CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Mensagem vinda do pwa.js quando o usuário clica em "Atualizar"
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING' || (data && data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

/* Fetch:
   - Navegações (HTML): SEMPRE network-first, sem cache.
     Evita servir HTML antigo e elimina a maior fonte de "preso em versão velha".
   - Outros assets: deixa o browser/HTTP cache cuidar (sem interceptar),
     a não ser que você queira offline. */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req).then((r) => r || caches.match('/index.html'))
      )
    );
    return;
  }
  // demais requests: passthrough
});
