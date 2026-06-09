/* =====================================================================
   DASHBOARD-LOADING.JS  (v5 — 2026-06-09)
   ---------------------------------------------------------------------
   Add-on isolado. Carregue DEPOIS de script.js, pagamentos.js,
   dashboard-pagamentos.js, comissoes-desconto.js, etc.:

       <link rel="stylesheet" href="/dashboard-loading.css?v=2">
       <script src="/dashboard-loading.js?v=5" defer></script>

   O QUE FAZ
   ---------
   1) Elimina o "pisca-pisca" do Dashboard ao clicar em "Aplicar" filtro.
      O conteúdo abaixo dos filtros fica oculto enquanto os add-ons
      assíncronos terminam de recalcular e injetar colunas/valores.

   2) NOVO NA v3 — GATE DE ATUALIZAÇÃO EXPLÍCITA
      O Dashboard agora só recalcula quando a ação for explícita:
        a) Usuário entra na tela do Dashboard (página torna-se ativa).
        b) Usuário clica no botão "Aplicar" (.btn-dash-apply / #btn-aplicar-filtros-dash).
      Qualquer outra chamada a window.loadDashboard() — vinda de
      setInterval, polling, listeners de visibilidade, websockets,
      focus/blur, resize, requestAnimationFrame, ou qualquer add-on —
      é BLOQUEADA silenciosamente (com console.warn de diagnóstico).
      Isso elimina recálculos automáticos em background, o loader
      reaparecendo sozinho, dados sumindo/voltando e instabilidade
      na automação Playwright.

   CORREÇÃO DA v2
   --------------
   A v1 podia ficar em loop infinito porque o overlay era aberto duas
   vezes (aplicarFiltrosDashboard + loadDashboard), mas podia ser
   fechado apenas uma. A v2 usa sessão única de carregamento com
   timeout real de saída e fallback caso aplicarFiltrosDashboard não
   chame loadDashboard.

   NÃO ALTERA:
     - script.js, pagamentos.js, comissoes.js, regras de cálculo, CSS
       existente, layout, classes, HTML do dashboard (apenas adiciona
       1 wrapper e 1 overlay).
   ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_DASH_LOADING_LOADED__) return;
  window.__SLOTIFY_DASH_LOADING_LOADED__ = true;

   console.log('%c⏳ dashboard-loading.js v5 carregado (gate externo aguardando hooks financeiros)',
    'background:#6c3aed;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700');

  // ---------- Configuração ----------
  var STABLE_MS = 900;          // tempo sem mutações para considerar pronto
  var MAX_SETTLE_MS = 5200;     // espera máxima pelos add-ons pós-loadDashboard
  var HARD_TIMEOUT_MS = 9000;   // saída absoluta de segurança do overlay
  var APPLY_FALLBACK_MS = 3500; // se Aplicar não disparar loadDashboard, libera a tela
  var MIN_SHOW_MS = 250;        // mostra o overlay por pelo menos isso (anti-flash)

  // v5: este add-on precisa ficar POR FORA da cadeia de wrappers financeiros.
  // pagamentos.js, dashboard-pagamentos.js e desconto-financeiro.js instalam
  // hooks assíncronos em momentos diferentes. Se o loading envolver cedo demais,
  // ele esconde a tela no valor bruto (ex.: 80) e a automação lê antes de a
  // caixinha/desconto finalizar (valor correto: 90). Por isso aguardamos uma
  // janela curta antes de envolver loadDashboard.
  var FINANCIAL_HOOK_SETTLE_MS = 2600;

  // Janela na qual uma ação explícita (entrar na tela / clicar Aplicar)
  // autoriza chamadas a loadDashboard. Depois disso o gate fecha de novo.
  var EXPLICIT_GRANT_MS = 8000;

  var PAGE_ID = 'page-dashboard';
  var WRAP_ID = 'dash-content-wrap';
  var OVERLAY_ID = 'dash-loading-overlay';
  var STEP_ID = 'dash-loading-step';

  // Alvos que costumam receber atualizações sucessivas depois do filtro
  var WATCH_IDS = [
    'dash-faturamento',
    'dash-total-ag',
    'dash-ticket',
    'dash-total-servicos',
    'dash-prof-tbody',
    'dash-prof-cards-mobile',
    'dash-top-servicos',
    'dash-top-clientes',
    'dash-chart-horarios',
    'dash-card-pacotes-vendidos'
  ];

  // Seletores de gatilhos explícitos de "Aplicar"
  var APPLY_SELECTORS = [
    '.btn-dash-apply',
    '#btn-aplicar-filtros-dash',
    '#btn-aplicar-dash',
    '[data-action="aplicar-dash"]',
    '[data-dash-apply]'
  ];

  // ---------- Estado interno ----------
  var pageEl = null;
  var wrapEl = null;
  var overlayEl = null;
  var stepEl = null;

  var observer = null;
  var stableTimer = null;
  var maxSettleTimer = null;
  var hardTimer = null;
  var applyFallbackTimer = null;
  var hideTimer = null;

  var openedAt = 0;
  var cycle = 0;
  var isOpen = false;
  var runningLoads = 0;

  // ---------- Gate explícito ----------
  // Permissão explícita única. IMPORTANTE: não acumula permissões.
  // O clique em Aplicar dispara dois caminhos no app atual:
  //   1) listener em capture phase deste arquivo;
  //   2) onclick="aplicarFiltrosDashboard()" no HTML.
  // Na v3 isso gerava 2 grants: o primeiro loadDashboard consumia 1 e um
  // refresh automático posterior podia consumir o grant sobrando, reabrindo
  // o loader. Na v4, cada ação explícita mantém no máximo 1 grant pendente.
  var explicitGrants = 0;
  var grantExpiresAt = 0;
  var initialGrantUsed = false;

  function grantExplicit(reason) {
    explicitGrants = 1;
    grantExpiresAt = Date.now() + EXPLICIT_GRANT_MS;
    // console.log('[dash-loading] permissão concedida/substituída:', reason);
  }

  function consumeGrant() {
    if (explicitGrants > 0 && Date.now() <= grantExpiresAt) {
      explicitGrants = 0;
      grantExpiresAt = 0;
      return true;
    }
    explicitGrants = 0;
    grantExpiresAt = 0;
    return false;
  }

  // ---------- Helpers DOM ----------
  function $(id) { return document.getElementById(id); }

  function isDashboardActive() {
    var el = $(PAGE_ID);
    if (!el) return false;
    // Considera ativa se visível na viewport / não tiver display:none
    if (el.classList && el.classList.contains('active')) return true;
    var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && style.display !== 'none' && style.visibility !== 'hidden') {
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
    return false;
  }

  function ensureStructure() {
    pageEl = $(PAGE_ID);
    if (!pageEl) return false;

    wrapEl = $(WRAP_ID);
    if (!wrapEl) {
      wrapEl = document.createElement('div');
      wrapEl.id = WRAP_ID;

      var children = Array.prototype.slice.call(pageEl.children);
      children.forEach(function (node) {
        if (!node) return;
        if (node.id === OVERLAY_ID || node.id === WRAP_ID) return;
        if (node.classList && (
          node.classList.contains('page-header') ||
          node.classList.contains('dash-filters')
        )) return;
        wrapEl.appendChild(node);
      });

      pageEl.appendChild(wrapEl);
    }

    overlayEl = $(OVERLAY_ID);
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = OVERLAY_ID;
      overlayEl.setAttribute('role', 'status');
      overlayEl.setAttribute('aria-live', 'polite');
      overlayEl.innerHTML =
        '<div class="dash-loading-card">' +
          '<div class="dash-loading-spinner" aria-hidden="true"></div>' +
          '<div class="dash-loading-title">Atualizando indicadores</div>' +
          '<div class="dash-loading-step dash-loading-dots" id="' + STEP_ID + '">Calculando</div>' +
        '</div>';
      wrapEl.appendChild(overlayEl);
    }

    stepEl = $(STEP_ID);
    return true;
  }

  function setStep(text) {
    if (stepEl) stepEl.textContent = text || '';
  }

  function clearTimer(name) {
    if (name === 'stable' && stableTimer) { clearTimeout(stableTimer); stableTimer = null; }
    if (name === 'maxSettle' && maxSettleTimer) { clearTimeout(maxSettleTimer); maxSettleTimer = null; }
    if (name === 'hard' && hardTimer) { clearTimeout(hardTimer); hardTimer = null; }
    if (name === 'applyFallback' && applyFallbackTimer) { clearTimeout(applyFallbackTimer); applyFallbackTimer = null; }
    if (name === 'hide' && hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function cleanupWatchers() {
    if (observer) {
      try { observer.disconnect(); } catch (_) {}
      observer = null;
    }
    clearTimer('stable');
    clearTimer('maxSettle');
  }

  // ---------- Mostrar / esconder ----------
  function show(reason) {
    if (!ensureStructure()) return cycle;

    clearTimer('hide');
    if (!isOpen) {
      cycle += 1;
      openedAt = Date.now();
      isOpen = true;
      window.__slotifyDashboardReady = false;
      pageEl.setAttribute('data-dashboard-ready', 'false');
      pageEl.classList.add('is-recalculating');

      clearTimer('hard');
      hardTimer = setTimeout(function () {
        console.warn('[dash-loading] timeout de segurança: liberando Dashboard');
        hide(cycle, true);
      }, HARD_TIMEOUT_MS);
    }

    setStep(reason || 'Calculando');
    return cycle;
  }

  function hide(token, force) {
    if (!pageEl || !isOpen) return;
    if (!force && token && token !== cycle) return;
    if (!force && runningLoads > 0) return;

    cleanupWatchers();
    clearTimer('hard');
    clearTimer('applyFallback');

    var elapsed = Date.now() - openedAt;
    var wait = force ? 0 : Math.max(0, MIN_SHOW_MS - elapsed);

    clearTimer('hide');
    hideTimer = setTimeout(function () {
      if (!pageEl) return;
      isOpen = false;
      runningLoads = 0;
      window.__slotifyDashboardReady = true;
      pageEl.setAttribute('data-dashboard-ready', 'true');
      pageEl.classList.remove('is-recalculating');
      setStep('');
      clearTimer('hide');
    }, wait);
  }

  function scheduleApplyFallback(token) {
    clearTimer('applyFallback');
    applyFallbackTimer = setTimeout(function () {
      if (runningLoads === 0) {
        console.warn('[dash-loading] fallback do Aplicar acionado: nenhum loadDashboard detectado');
        hide(token, true);
      }
    }, APPLY_FALLBACK_MS);
  }

  // ---------- Detector de conclusão visual ----------
  function waitForDashboardReady() {
    return new Promise(function (resolve) {
      var done = false;

      function finish() {
        if (done) return;
        done = true;
        cleanupWatchers();
        resolve();
      }

      function armStable() {
        clearTimer('stable');
        stableTimer = setTimeout(finish, STABLE_MS);
      }

      function shouldCountMutation(mutation) {
        var target = mutation && mutation.target;
        if (!target) return false;
        if (overlayEl && target.nodeType === 1 && overlayEl.contains(target)) return false;
        if (overlayEl && target.parentNode && overlayEl.contains(target.parentNode)) return false;

        while (target && target.nodeType === 1) {
          if (target.id && WATCH_IDS.indexOf(target.id) !== -1) return true;
          if (target === wrapEl || target === pageEl) break;
          target = target.parentNode;
        }
        return false;
      }

      try {
        observer = new MutationObserver(function (mutations) {
          for (var i = 0; i < mutations.length; i += 1) {
            if (shouldCountMutation(mutations[i])) {
              setStep('Aplicando ajustes finais');
              armStable();
              return;
            }
          }
        });

        WATCH_IDS.forEach(function (id) {
          var el = $(id);
          if (el) observer.observe(el, {
            childList: true,
            characterData: true,
            attributes: true,
            subtree: true
          });
        });
      } catch (_) {}

      armStable();
      clearTimer('maxSettle');
      maxSettleTimer = setTimeout(finish, MAX_SETTLE_MS);
    });
  }

  // ---------- Monkey-patch das funções do dashboard ----------
  function wrapLoadDashboard() {
    var tries = 0;
    var iv = setInterval(function () {
      var fn = window.loadDashboard;

      if (typeof fn === 'function' && !fn.__dashLoadingWrapped) {
        if (!window.__dashLoadingCanWrapAt) window.__dashLoadingCanWrapAt = Date.now() + FINANCIAL_HOOK_SETTLE_MS;
        if (Date.now() < window.__dashLoadingCanWrapAt) return;

        clearInterval(iv);

        var original = fn;
        var wrapped = function () {
          var self = this;
          var args = arguments;

          // ===== GATE EXPLÍCITO =====
          // Bloqueia qualquer chamada que não venha de:
          //   1) entrada na tela do Dashboard (1ª vez ou re-entrada)
          //   2) clique em "Aplicar"
          if (!consumeGrant()) {
            console.warn(
              '[dash-loading] chamada AUTOMÁTICA a loadDashboard bloqueada ' +
              '(sem ação explícita do usuário). Origem provável: ' +
              'setInterval/polling/listener em background.'
            );
            return Promise.resolve();
          }

          var token = show('Calculando indicadores');
          clearTimer('applyFallback');
          runningLoads += 1;

          var execP;
          try {
            var ret = original.apply(self, args);
            execP = (ret && typeof ret.then === 'function') ? ret : Promise.resolve(ret);
          } catch (err) {
            runningLoads = Math.max(0, runningLoads - 1);
            hide(token, true);
            throw err;
          }

          return execP
            .then(function (ret) {
              setStep('Aplicando ajustes finais');
              return waitForDashboardReady().then(function () {
                runningLoads = Math.max(0, runningLoads - 1);
                if (runningLoads === 0) hide(token, false);
                return ret;
              });
            })
            .catch(function (err) {
              runningLoads = Math.max(0, runningLoads - 1);
              hide(token, true);
              throw err;
            });
        };

        wrapped.__dashLoadingWrapped = true;
        try {
          Object.keys(original).forEach(function (key) {
            try { wrapped[key] = original[key]; } catch (_) {}
          });
        } catch (_) {}

        window.loadDashboard = wrapped;
        console.log('[dash-loading] loadDashboard envolvido por fora dos hooks financeiros');
      } else if (++tries > 100) {
        clearInterval(iv);
      }
    }, 150);
  }

  function wrapAplicarFiltros() {
    var tries = 0;
    var iv = setInterval(function () {
      var fn = window.aplicarFiltrosDashboard;

      if (typeof fn === 'function' && !fn.__dashLoadingWrapped) {
        clearInterval(iv);

        var original = fn;
        var wrapped = function () {
          // Aplicar SEMPRE é ação explícita do usuário.
          grantExplicit('aplicarFiltrosDashboard');

          var token = show('Processando filtros');

          try {
            var ret = original.apply(this, arguments);
            scheduleApplyFallback(token);

            if (ret && typeof ret.then === 'function') {
              return ret.catch(function (err) {
                hide(token, true);
                throw err;
              });
            }
            return ret;
          } catch (err) {
            hide(token, true);
            throw err;
          }
        };

        wrapped.__dashLoadingWrapped = true;
        try {
          Object.keys(original).forEach(function (key) {
            try { wrapped[key] = original[key]; } catch (_) {}
          });
        } catch (_) {}

        window.aplicarFiltrosDashboard = wrapped;
        console.log('[dash-loading] aplicarFiltrosDashboard envolvido');
      } else if (++tries > 80) {
        clearInterval(iv);
      }
    }, 150);
  }

  // ---------- Detectores de "ação explícita" ----------
  function bindApplyClickGrants() {
    // Captura clique em qualquer botão Aplicar do Dashboard, no capture
    // phase, ANTES dos handlers da aplicação chamarem loadDashboard.
    document.addEventListener('click', function (ev) {
      var target = ev.target;
      if (!target || target.nodeType !== 1) return;
      for (var i = 0; i < APPLY_SELECTORS.length; i += 1) {
        if (target.closest && target.closest(APPLY_SELECTORS[i])) {
          grantExplicit('click:' + APPLY_SELECTORS[i]);
          return;
        }
      }
    }, true);
  }

  function bindDashboardEntryGrants() {
    // 1) Carga inicial: se a tela do Dashboard já estiver ativa, libera 1 grant.
    function tryInitialGrant() {
      if (initialGrantUsed) return;
      if (isDashboardActive()) {
        initialGrantUsed = true;
        grantExplicit('initial-load');
      }
    }
    tryInitialGrant();
    setTimeout(tryInitialGrant, 300);
    setTimeout(tryInitialGrant, 1200);

    // 2) Entradas subsequentes: observa quando #page-dashboard
    //    passa de oculto para visível (troca de classe "active" ou
    //    style.display). Cada transição "entrou no Dashboard" gera 1 grant.
    var lastActive = isDashboardActive();
    try {
      var pageObserver = new MutationObserver(function () {
        var nowActive = isDashboardActive();
        if (nowActive && !lastActive) {
          grantExplicit('dashboard-entry');
        }
        lastActive = nowActive;
      });

      function attachPageObserver() {
        var el = $(PAGE_ID);
        if (!el) return false;
        pageObserver.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
        return true;
      }

      if (!attachPageObserver()) {
        var t = 0;
        var iv = setInterval(function () {
          if (attachPageObserver() || ++t > 100) clearInterval(iv);
        }, 100);
      }
    } catch (_) {}

    // 3) Cliques em itens de menu que apontam para o Dashboard também
    //    contam como entrada explícita.
    document.addEventListener('click', function (ev) {
      var target = ev.target;
      if (!target || target.nodeType !== 1) return;
      var trigger = target.closest && target.closest(
        '[data-page="dashboard"],[data-target="page-dashboard"],' +
        'a[href="#dashboard"],a[href="#page-dashboard"],' +
        '.menu-dashboard,.nav-dashboard,#menu-dashboard'
      );
      if (trigger) grantExplicit('menu:dashboard');
    }, true);
  }

  function boot() {
    var tries = 0;
    var iv = setInterval(function () {
      if (ensureStructure() || ++tries > 100) clearInterval(iv);
    }, 100);

    bindApplyClickGrants();
    bindDashboardEntryGrants();
    wrapLoadDashboard();
    wrapAplicarFiltros();

    // API pública mínima para casos em que outro script precise
    // legitimamente forçar um refresh (raro). Use com parcimônia.
    window.__dashLoading = {
      grant: function (reason) { grantExplicit(reason || 'manual-api'); },
      version: 5
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
