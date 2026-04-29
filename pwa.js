/**
 * pwa.js — Beauty System (v4 - estável, sem reload automático)
 * ------------------------------------------------------------
 * Objetivos desta versão:
 * - Não recarregar a página automaticamente em controllerchange.
 * - Não registrar Service Worker em ambiente local de desenvolvimento
 *   (localhost / 127.0.0.1), evitando cache e reload inesperados em testes.
 * - Em produção, avisar quando houver nova versão e atualizar somente por
 *   ação explícita do usuário.
 * - Se o Service Worker falhar, o app continua funcionando normalmente.
 */

(function () {
  'use strict';

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS = () => {
    const ua = window.navigator.userAgent || '';
    const iOSDevice = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const iPadOS = ua.includes('Macintosh') && 'ontouchend' in document;
    return iOSDevice || iPadOS;
  };

  const isSafari = () => {
    const ua = window.navigator.userAgent || '';
    return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  };

  const isLocalDev = () => {
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
  };

  const LS_IOS_BANNER_DISMISSED = 'pwa:iosBannerDismissed';

  // ---------- 1. Service Worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      if (isLocalDev()) {
        // Em testes locais, Service Worker costuma causar cache fantasma.
        // Limpamos silenciosamente o ambiente local, sem reload automático.
        navigator.serviceWorker.getRegistrations()
          .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
          .catch((err) => console.warn('[PWA] Falha ao remover SW local:', err));

        if (window.caches && typeof window.caches.keys === 'function') {
          window.caches.keys()
            .then((names) => Promise.all(names.map((name) => window.caches.delete(name))))
            .catch((err) => console.warn('[PWA] Falha ao limpar caches locais:', err));
        }
        return;
      }

      navigator.serviceWorker
        .register('./service-worker.js', { updateViaCache: 'none' })
        .then((reg) => {
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;

            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateToast(newWorker);
              }
            });
          });

          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
              try { reg.update().catch(() => {}); } catch (_) {}
            }
          });
        })
        .catch((err) => console.warn('[PWA] Falha ao registrar SW:', err));

      // v4: controllerchange NÃO recarrega a página sozinho.
      // Ele só finaliza uma atualização iniciada pelo clique do usuário.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (window.__PWA_USER_REQUESTED_UPDATE__ !== true) {
          console.log('[PWA] controllerchange detectado sem reload automático.');
          return;
        }

        if (window.__PWA_RELOAD_HANDLED__ === true) return;
        window.__PWA_RELOAD_HANDLED__ = true;
        setTimeout(() => { try { window.location.reload(); } catch (_) {} }, 150);
      });
    });
  }

  function showUpdateToast(newWorker) {
    if (document.getElementById('pwa-update-toast')) return;

    const t = document.createElement('div');
    t.id = 'pwa-update-toast';
    t.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
      'background:#1B1340;color:#fff;padding:12px 18px;border-radius:12px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,0.25);z-index:99999;' +
      'font-family:Inter,sans-serif;font-size:14px;display:flex;align-items:center;gap:12px;';
    t.innerHTML =
      '<span>Nova versão disponível</span>' +
      '<button id="pwa-update-btn" style="background:#6C3AED;color:#fff;border:0;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:600;">Atualizar</button>' +
      '<button id="pwa-update-close" style="background:transparent;color:#fff;border:0;cursor:pointer;font-size:18px;line-height:1;padding:4px;">×</button>';
    document.body.appendChild(t);

    document.getElementById('pwa-update-btn').addEventListener('click', () => {
      window.__PWA_USER_REQUESTED_UPDATE__ = true;
      try { newWorker.postMessage('SKIP_WAITING'); } catch (err) { console.warn('[PWA] Falha ao ativar novo SW:', err); }

      // Fallback controlado e iniciado pelo usuário. Não roda sem clique.
      setTimeout(() => {
        if (window.__PWA_RELOAD_HANDLED__ === true) return;
        window.__PWA_RELOAD_HANDLED__ = true;
        try { window.location.reload(); } catch (_) {}
      }, 1200);
    });

    document.getElementById('pwa-update-close').addEventListener('click', () => t.remove());
  }

  // ---------- 2. Install prompt (Android / Desktop) ----------
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
      } catch (err) { console.warn('[PWA] Erro ao abrir prompt:', err); }
      finally { deferredPrompt = null; btn.disabled = false; }
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

  // ---------- 3. Banner iOS ----------
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
        <p>Toque em <span class="pwa-ios-banner__icon" aria-hidden="true">⬆️</span> (Compartilhar) e depois em <em>"Adicionar à Tela de Início"</em>.</p>
      </div>
      <button type="button" class="pwa-ios-banner__close" aria-label="Fechar">×</button>
    `;
    banner.querySelector('.pwa-ios-banner__close').addEventListener('click', () => {
      localStorage.setItem(LS_IOS_BANNER_DISMISSED, '1');
      hideIOSBanner();
    });
    document.body.appendChild(banner);
  }

  function hideIOSBanner() {
    const b = document.getElementById('pwa-ios-banner');
    if (b) b.remove();
  }

  function init() {
    if (isStandalone()) { hideInstallButton(); hideIOSBanner(); return; }
    if (isIOS() && isSafari()) createIOSBanner();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
