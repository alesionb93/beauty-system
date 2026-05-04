// ================================
// 🔥 CICLO DE VIDA DO SERVICE WORKER
// ================================

// ativa imediatamente o SW novo
self.addEventListener('install', () => {
  self.skipWaiting();
});

// assume controle de todas as abas imediatamente
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});


// ================================
// 📲 PUSH NOTIFICATION RECEIVER
// ================================

self.addEventListener('push', function (event) {
  try {
    const data = event.data ? event.data.json() : {};

    const title = data.title || 'Novo agendamento';
    const body = data.body || 'Você tem uma nova notificação';
    const url = data.url || '/';

    const options = {
      body,
      icon: '/icon.png',
      badge: '/icon.png',
      data: {
        url
      }
    };

    event.waitUntil(
      self.registration.showNotification(title, options)
    );

  } catch (err) {
    console.error('[SW] erro no push:', err);

    // fallback mínimo pra não quebrar silenciosamente
    event.waitUntil(
      self.registration.showNotification('Notificação', {
        body: 'Você recebeu uma nova atualização',
        icon: '/icon.png'
      })
    );
  }
});


// ================================
// 👆 CLICK NA NOTIFICAÇÃO
// ================================

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  const url = event.notification?.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});