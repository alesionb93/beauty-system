/**
 * pwa.js — Beauty System
 * --------------------------------------------------
 * Responsável por:
 *  1. Registrar o Service Worker.
 *  2. Capturar o evento `beforeinstallprompt` (Chrome / Edge / Android).
 *  3. Mostrar um botão "Instalar aplicativo" quando disponível.
 *  4. Detectar iOS e exibir banner com instruções de "Adicionar à Tela de Início".
 *  5. Esconder tudo quando o app já está instalado / rodando standalone.
 *
 * Uso: incluir UMA ÚNICA vez por página, depois de <body>:
 *   <script src="pwa.js" defer></script>
 *
 * Não depende de framework. Não quebra nada se o navegador não suportar.
 */

(function () {
  'use strict';

  // ---------- Helpers ----------
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS = () => {
    const ua = window.navigator.userAgent || '';
    const iOSDevice = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    // iPad moderno se identifica como Mac; detectamos via touch.
    const iPadOS =
      ua.includes('Macintosh') && 'ontouchend' in document;
    return iOSDevice || iPadOS;
  };

  const isSafari = () => {
    const ua = window.navigator.userAgent || '';
    return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  };

  const LS_IOS_BANNER_DISMISSED = 'pwa:iosBannerDismissed';

  // ---------- 1. Service Worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./service-worker.js')
        .then((reg) => {
          // Quando uma nova versão for instalada, ativa imediatamente.
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (
                newWorker.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                newWorker.postMessage('SKIP_WAITING');
              }
            });
          });
        })
        .catch((err) => console.warn('[PWA] Falha ao registrar SW:', err));

      // Recarrega a página uma vez quando o novo SW assume o controle.
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    });
  }

  // ---------- 2 & 3. Install prompt (Android / Desktop) ----------
  let deferredPrompt = null;

  function createInstallButton() {
    if (document.getElementById('pwa-install-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'pwa-install-btn';
    btn.type = 'button';
    btn.className = 'pwa-install-btn';
    btn.setAttribute('aria-label', 'Instalar aplicativo');
    btn.innerHTML =
      '<span class="pwa-install-btn__icon" aria-hidden="true">⬇</span>' +
      '<span class="pwa-install-btn__label">Instalar app</span>';

    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      btn.disabled = true;
      try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') hideInstallButton();
      } catch (err) {
        console.warn('[PWA] Erro ao abrir prompt:', err);
      } finally {
        deferredPrompt = null;
        btn.disabled = false;
      }
    });

    document.body.appendChild(btn);
  }

  function hideInstallButton() {
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.remove();
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!isStandalone()) createInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallButton();
    hideIOSBanner();
  });

  // ---------- 4. Banner iOS ----------
  function createIOSBanner() {
    if (document.getElementById('pwa-ios-banner')) return;
    if (localStorage.getItem(LS_IOS_BANNER_DISMISSED) === '1') return;

    const banner = document.createElement('div');
    banner.id = 'pwa-ios-banner';
    banner.className = 'pwa-ios-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Instalar este app no iPhone/iPad');
    banner.innerHTML = `
      <div class="pwa-ios-banner__content">
        <strong>Instalar Beauty System</strong>
        <p>
          Toque em
          <span class="pwa-ios-banner__icon" aria-hidden="true">⬆️</span>
          (Compartilhar) e depois em
          <em>"Adicionar à Tela de Início"</em>.
        </p>
      </div>
      <button type="button" class="pwa-ios-banner__close" aria-label="Fechar">×</button>
    `;
    banner
      .querySelector('.pwa-ios-banner__close')
      .addEventListener('click', () => {
        localStorage.setItem(LS_IOS_BANNER_DISMISSED, '1');
        hideIOSBanner();
      });
    document.body.appendChild(banner);
  }

  function hideIOSBanner() {
    const b = document.getElementById('pwa-ios-banner');
    if (b) b.remove();
  }

  // ---------- 5. Inicialização ----------
  function init() {
    if (isStandalone()) {
      // Já está rodando como app — não precisa promover instalação.
      hideInstallButton();
      hideIOSBanner();
      return;
    }
    if (isIOS() && isSafari()) {
      // No iOS só dá pra instalar pelo Safari → mostra dica.
      createIOSBanner();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
