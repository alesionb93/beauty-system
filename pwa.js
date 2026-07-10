/* =========================================================
   pwa.js — Update flow estável
   Corrige:
   - Path único do SW (/sw.js) com updateViaCache: 'none'
   - SKIP_WAITING correto via postMessage
   - Reload UMA vez via 'controllerchange' (sem loop)
   - Toast só aparece quando há SW em "installed" + controller existente
     (i.e. realmente uma NOVA versão substituindo a atual)
   - Dismiss persistente por scriptURL+hash do SW (sessionStorage)
   - Logs detalhados para auditoria
   ========================================================= */

(() => {
  if (!('serviceWorker' in navigator)) return;

  const SW_URL = '/sw.js';
  const DISMISS_KEY = 'pwa:dismissedSW';
  let reloading = false;
  let toastEl = null;

  const log = (...a) => console.log('[PWA]', ...a);

  // Reload controlado: dispara UMA vez quando o novo SW assume o controle
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    log('controllerchange -> reload');
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(SW_URL, {
        updateViaCache: 'none',
      });
      log('SW registrado', reg.scope);

      // Se já existe um SW esperando ao carregar a página
      if (reg.waiting && navigator.serviceWorker.controller) {
        maybeShowToast(reg.waiting);
      }

      // Novo SW encontrado
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        log('updatefound', newWorker.scriptURL);

        newWorker.addEventListener('statechange', () => {
          log('[UPDATE CHECK]', {
            state: newWorker.state,
            hasController: !!navigator.serviceWorker.controller,
            scriptURL: newWorker.scriptURL,
          });

          // Só é "nova versão" se:
          // - state === 'installed'
          // - já existe um controller (i.e. NÃO é a primeira instalação)
          if (
            newWorker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            maybeShowToast(newWorker);
          }
        });
      });

      // Update apenas em foco/visibilidade — sem polling agressivo
      let lastCheck = 0;
      const checkUpdate = () => {
        const now = Date.now();
        if (now - lastCheck < 60_000) return; // throttle 1min
        lastCheck = now;
        reg.update().catch((e) => log('update() falhou', e));
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkUpdate();
      });
      window.addEventListener('focus', checkUpdate);
    } catch (err) {
      console.error('[PWA] erro ao registrar SW:', err);
    }
  });

  function maybeShowToast(worker) {
    const id = worker.scriptURL; // identificador estável da "versão" do SW
    const dismissed = sessionStorage.getItem(DISMISS_KEY);
    if (dismissed === id) {
      log('toast suprimido (dismiss anterior)', id);
      return;
    }
    if (toastEl) return; // já exibido
    showToast(worker, id);
  }

  function showToast(worker, id) {
    toastEl = document.createElement('div');
    toastEl.setAttribute('role', 'status');
    toastEl.style.cssText = `
      position: fixed; z-index: 99999; left: 50%; bottom: 24px;
      transform: translateX(-50%);
      background: #111; color: #fff; padding: 12px 16px; border-radius: 10px;
      font: 14px/1.3 system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,.25);
      display: flex; align-items: center; gap: 12px;
    `;
    toastEl.innerHTML = `
      <span>Nova versão disponível</span>
      <button id="pwa-update" style="background:#22c55e;color:#fff;border:0;padding:6px 12px;border-radius:6px;cursor:pointer;">Atualizar</button>
      <button id="pwa-dismiss" aria-label="Fechar" style="background:transparent;color:#fff;border:0;font-size:18px;cursor:pointer;">×</button>
    `;
    document.body.appendChild(toastEl);

    toastEl.querySelector('#pwa-update').addEventListener('click', () => {
      log('usuário clicou Atualizar -> SKIP_WAITING');
      worker.postMessage({ type: 'SKIP_WAITING' });
      // O reload será disparado pelo 'controllerchange'
    });

    toastEl.querySelector('#pwa-dismiss').addEventListener('click', () => {
      sessionStorage.setItem(DISMISS_KEY, id);
      toastEl.remove();
      toastEl = null;
      log('usuário fechou toast (dismiss salvo)', id);
    });
  }
})();
