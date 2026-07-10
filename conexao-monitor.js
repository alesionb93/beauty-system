/* =====================================================================
 * conexao-monitor.js — Tratamento global de falhas de conexão
 * Slotify — 2026-05-15
 * ---------------------------------------------------------------------
 * O QUE FAZ:
 *  - Detecta navigator.onLine (online/offline)
 *  - Envolve window.fetch global com timeout (default 15s)
 *  - Captura erros de rede (TypeError "Failed to fetch", AbortError,
 *    timeouts, status 5xx do Supabase) e exibe modal amigável
 *  - Não altera lógica de negócio; é puramente UX
 *  - Expõe API global: window.ConexaoMonitor
 *
 * USO BÁSICO (automático após include):
 *   <link rel="stylesheet" href="/conexao-monitor.css">
 *   <script src="/conexao-monitor.js" defer></script>
 *
 * USO MANUAL (opcional, em ações críticas):
 *   try {
 *     await window.ConexaoMonitor.run(async () => {
 *       const { error } = await supabase.from('clientes').insert(...);
 *       if (error) throw error;
 *     }, { onRetry: () => salvarCliente() });
 *   } catch(e){ ... }
 *
 *   window.ConexaoMonitor.show({ onRetry: () => doLogin() });
 *   window.ConexaoMonitor.hide();
 *
 * CONFIG:
 *   window.ConexaoMonitor.config({
 *     timeoutMs: 15000,
 *     autoWrapFetch: true,
 *     debug: false
 *   });
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_CONEXAO_MONITOR__) return;
  window.__SLOTIFY_CONEXAO_MONITOR__ = true;

  // ----------------------- estado / config -----------------------
  var STATE = {
    timeoutMs: 15000,
    autoWrapFetch: true,
    debug: false,
    visible: false,
    lastRetry: null,
    suppressUntil: 0, // evita modal dentro de 1s após Tentar novamente
    // ----------------------------------------------------------------
    // MODO OFFLINE DEGRADADO (2026-05-15)
    // Quando true (default), o modal NÃO abre automaticamente em eventos
    // passivos (offline event, fetch falhando em background, 5xx, unhandled
    // rejection). O app entra silenciosamente em "modo offline": o usuário
    // continua navegando e vendo dados em cache.
    // O modal só aparece quando uma AÇÃO ONLINE é tentada — via:
    //   - ConexaoMonitor.run(fn, { onRetry })
    //   - ConexaoMonitor.show({ onRetry })
    // Para reativar o comportamento antigo (debug/legacy):
    //   ConexaoMonitor.config({ silentOffline: false })
    // ----------------------------------------------------------------
    silentOffline: true,
    online: (typeof navigator === 'undefined') ? true : navigator.onLine !== false
  };

  function log() {
    if (!STATE.debug) return;
    try { console.log.apply(console, ['[conexao-monitor]'].concat([].slice.call(arguments))); } catch (_) {}
  }

  // ----------------------- DOM do modal --------------------------
  function ensureModal() {
    var ov = document.getElementById('cm-overlay');
    if (ov) return ov;

    ov = document.createElement('div');
    ov.id = 'cm-overlay';
    ov.className = 'cm-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'cm-title');
    ov.setAttribute('aria-hidden', 'true');
    ov.innerHTML = ''
      + '<div class="cm-modal" role="document">'
      +   '<button type="button" class="cm-close" aria-label="Fechar">'
      +     '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">'
      +       '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/>'
      +     '</svg>'
      +   '</button>'
      +   '<div class="cm-icon" aria-hidden="true">'
      +     '<svg viewBox="0 0 64 64" width="56" height="56">'
      +       '<g fill="none" stroke="#ef4444" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">'
      +         '<path d="M8 24c14-12 34-12 48 0"/>'
      +         '<path d="M16 33c9-8 23-8 32 0"/>'
      +         '<path d="M24 42c5-4 11-4 16 0"/>'
      +         '<circle cx="32" cy="50" r="3" fill="#ef4444" stroke="none"/>'
      +         '<path d="M10 10l44 44" stroke-width="4"/>'
      +       '</g>'
      +     '</svg>'
      +   '</div>'
      +   '<h2 id="cm-title" class="cm-title">Sem conexão com a internet</h2>'
      +   '<p class="cm-desc">'
      +     'Não foi possível se comunicar com o servidor.<br>'
      +     'Verifique sua conexão com a internet e tente novamente.'
      +   '</p>'
      +   '<div class="cm-actions">'
      +     '<button type="button" class="cm-btn cm-btn-secondary" data-cm-action="close">Fechar</button>'
      +     '<button type="button" class="cm-btn cm-btn-primary" data-cm-action="retry">'
      +       '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" class="cm-retry-icon">'
      +         '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/>'
      +       '</svg>'
      +       '<span>Tentar novamente</span>'
      +     '</button>'
      +   '</div>'
      + '</div>';

    document.body.appendChild(ov);

    ov.addEventListener('click', function (e) {
      var t = e.target;
      if (t === ov) return hide();
      var btn = t.closest && t.closest('[data-cm-action], .cm-close');
      if (!btn) return;
      var act = btn.getAttribute('data-cm-action') || (btn.classList.contains('cm-close') ? 'close' : null);
      if (act === 'close') hide();
      else if (act === 'retry') retry();
    });

    document.addEventListener('keydown', function (e) {
      if (!STATE.visible) return;
      if (e.key === 'Escape') hide();
    });

    return ov;
  }

  function show(opts) {
    opts = opts || {};
    if (typeof opts.onRetry === 'function') STATE.lastRetry = opts.onRetry;
    var ov = ensureModal();
    ov.classList.add('is-open');
    ov.setAttribute('aria-hidden', 'false');
    STATE.visible = true;
    try {
      var btn = ov.querySelector('.cm-btn-primary');
      if (btn) btn.focus({ preventScroll: true });
    } catch (_) {}
    log('show');
  }

  function hide() {
    var ov = document.getElementById('cm-overlay');
    if (!ov) return;
    ov.classList.remove('is-open');
    ov.setAttribute('aria-hidden', 'true');
    STATE.visible = false;
    log('hide');
  }

  function retry() {
    // Proteção: se ainda está offline, NÃO executa retry/reload.
    // Mantém o modal aberto, dá feedback visual e aguarda a conexão voltar.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      log('retry bloqueado: ainda offline');
      flashStillOffline();
      // Quando 'online' disparar, dispara o retry automaticamente (uma vez).
      armAutoRetryOnOnline();
      return;
    }

    var fn = STATE.lastRetry;
    STATE.suppressUntil = Date.now() + 1500;
    hide();
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { log('retry error', e); }
    } else {
      // fallback: reload a página
      try { location.reload(); } catch (_) {}
    }
  }

  // Feedback visual quando o usuário clica em "Tentar novamente" ainda offline.
  function flashStillOffline() {
    var ov = document.getElementById('cm-overlay');
    if (!ov) return;
    var desc = ov.querySelector('.cm-desc');
    var btn  = ov.querySelector('.cm-btn-primary');
    if (desc) {
      if (!desc.dataset._original) desc.dataset._original = desc.innerHTML;
      desc.innerHTML = 'Ainda sem conexão com a internet.<br>Aguardando o sinal voltar para tentar novamente...';
    }
    if (btn) {
      btn.classList.add('cm-shake');
      setTimeout(function () { btn.classList.remove('cm-shake'); }, 450);
    }
  }

  // Quando voltar online, executa o retry automaticamente (uma única vez).
  function armAutoRetryOnOnline() {
    if (STATE._autoRetryArmed) return;
    STATE._autoRetryArmed = true;
    var handler = function () {
      window.removeEventListener('online', handler);
      STATE._autoRetryArmed = false;
      // Pequeno delay para a stack de rede estabilizar
      setTimeout(function () {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        retry();
      }, 250);
    };
    window.addEventListener('online', handler);
  }

  // ----------------------- detecção de erro -----------------------
  function isNetworkError(err) {
    if (!err) return false;
    if (err.name === 'AbortError') return true;
    if (err.name === 'TypeError') {
      var msg = String(err.message || '').toLowerCase();
      if (msg.indexOf('failed to fetch') !== -1) return true;
      if (msg.indexOf('networkerror') !== -1) return true;
      if (msg.indexOf('load failed') !== -1) return true; // safari
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') return true;
    return false;
  }

  function shouldShowForResponse(res) {
    // 5xx ou 408 do Supabase / API
    if (!res || typeof res.status !== 'number') return false;
    return res.status === 408 || res.status === 502 || res.status === 503 || res.status === 504;
  }

  function maybeShow(opts) {
    if (Date.now() < STATE.suppressUntil) return;
    if (STATE.visible) return;
    show(opts || {});
  }

  // Disparo passivo (offline event, fetch em background, 5xx, unhandled
  // rejection). No novo modo offline degradado, NÃO abre o modal — apenas
  // registra o estado interno. O modal só aparece em ações explícitas
  // (run / show), tipicamente disparadas por interação do usuário.
  function passiveSignal(reason) {
    log('passiveSignal', reason);
    if (STATE.silentOffline) return; // modo offline degradado: silencioso
    maybeShow();
  }

  // ----------------------- wrap fetch -----------------------------
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  function wrappedFetch(input, init) {
    if (!nativeFetch) return Promise.reject(new Error('fetch indisponível'));

    init = init || {};
    var url = '';
    try {
      url = (typeof input === 'string') ? input : (input && input.url) || '';
    } catch (_) {}

    // offline imediato — rejeita o fetch (para a chamada falhar e o
    // chamador tratar), mas NÃO abre o modal automaticamente.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      passiveSignal('fetch-offline');
      return Promise.reject(new TypeError('Failed to fetch (offline)'));
    }

    // timeout via AbortController (só se ainda não tem signal)
    var controller, timer;
    if (!init.signal && typeof AbortController !== 'undefined') {
      controller = new AbortController();
      init = Object.assign({}, init, { signal: controller.signal });
      timer = setTimeout(function () {
        try { controller.abort(); } catch (_) {}
      }, STATE.timeoutMs);
    }

    return nativeFetch(input, init).then(function (res) {
      if (timer) clearTimeout(timer);
      if (shouldShowForResponse(res)) {
        log('5xx response', url, res.status);
        passiveSignal('http-' + res.status);
      }
      return res;
    }, function (err) {
      if (timer) clearTimeout(timer);
      if (isNetworkError(err)) {
        log('network error', url, err);
        passiveSignal('fetch-network-error');
      }
      throw err;
    });
  }

  function installFetchWrap() {
    if (!STATE.autoWrapFetch || !nativeFetch) return;
    if (window.fetch && window.fetch.__cmWrapped) return;
    wrappedFetch.__cmWrapped = true;
    window.fetch = wrappedFetch;
    log('fetch wrapped');
  }

  // ----------------------- online/offline -------------------------
  // Modo offline degradado: o evento 'offline' apenas atualiza o estado
  // interno. NÃO abre o modal — o app continua utilizável em leitura.
  window.addEventListener('offline', function () {
    STATE.online = false;
    log('offline event (silent)');
    passiveSignal('offline-event');
  });
  window.addEventListener('online', function () {
    STATE.online = true;
    log('online event');
    if (STATE.visible) hide();
  });

  // captura erros não tratados (promise reject) que sejam de rede
  // — também passivos no novo modo (não abre modal sozinho).
  window.addEventListener('unhandledrejection', function (e) {
    if (isNetworkError(e && e.reason)) passiveSignal('unhandled-rejection');
  });

  // ----------------------- API pública ----------------------------
  /**
   * Executa uma ação assíncrona com timeout e tratamento amigável.
   * Em caso de erro de rede, mostra o modal com botão "Tentar novamente"
   * que reexecuta a mesma ação.
   */
  function run(fn, opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs || STATE.timeoutMs;
    var attempt = function () {
      var to;
      var p = new Promise(function (resolve, reject) {
        to = setTimeout(function () { reject(new Error('timeout')); }, timeoutMs);
        Promise.resolve().then(fn).then(function (v) { clearTimeout(to); resolve(v); },
                                         function (e) { clearTimeout(to); reject(e); });
      });
      return p.catch(function (err) {
        var msg = String(err && err.message || '').toLowerCase();
        var isNet = isNetworkError(err) || msg === 'timeout' || (typeof navigator !== 'undefined' && navigator.onLine === false);
        if (isNet) {
          maybeShow({ onRetry: opts.onRetry || attempt });
        }
        throw err;
      });
    };
    return attempt();
  }

  // Helper para ações que EXIGEM internet. Retorna true se online; caso
  // contrário abre o modal explicitamente e retorna false. Use antes de
  // login, salvar, deletar, upload, trocar tenant, logout, etc.
  //   if (!ConexaoMonitor.requireOnline({ onRetry: () => salvar() })) return;
  function requireOnline(opts) {
    var online = (typeof navigator === 'undefined') ? true : navigator.onLine !== false;
    if (online) return true;
    show(opts || {});
    return false;
  }

  window.ConexaoMonitor = {
    show: show,
    hide: hide,
    retry: retry,
    run: run,
    requireOnline: requireOnline,
    isOnline: function () { return typeof navigator === 'undefined' ? true : navigator.onLine !== false; },
    config: function (cfg) {
      if (!cfg) return Object.assign({}, STATE);
      Object.keys(cfg).forEach(function (k) {
        if (k in STATE) STATE[k] = cfg[k];
      });
      if ('autoWrapFetch' in cfg && cfg.autoWrapFetch) installFetchWrap();
      return Object.assign({}, STATE);
    },
    _isNetworkError: isNetworkError
  };

  // ----------------------- bootstrap ------------------------------
  function boot() {
    ensureModal();
    installFetchWrap();
    log('ready');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
