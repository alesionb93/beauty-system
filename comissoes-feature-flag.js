/* =========================================================================
 * comissoes-feature-flag.js  (v2 — usa contexto global do script.js)
 *
 * Objetivo:
 *   Persistir o toggle "Exibir Comissões" em tenant_settings.modulo_comissoes_ativo
 *   usando EXATAMENTE o mesmo contexto (supabaseClient, currentUser,
 *   getCurrentTenantId) do restante do sistema. Não cria nova instância
 *   do Supabase. Não tenta descobrir o tenant por conta própria.
 *
 * Instalação (em agenda.html), DEPOIS do script.js:
 *   <script src="/comissoes-feature-flag.js?v=2" defer></script>
 *
 * Pré-requisito SQL (executar 1x):
 *   ver arquivo comissoes-feature-flag.sql
 * ========================================================================= */
(function () {
  'use strict';

  var COL = 'modulo_comissoes_ativo';
  var LS_KEY = 'ff_comissoes_ativo';
  var TOGGLE_ID = 'ff-comissoes';
  var LOG = function () {
    try { console.log.apply(console, ['[comissoes-ff]'].concat([].slice.call(arguments))); } catch (_) {}
  };

  // -------------------------------------------------------------------------
  // 1) Acesso ao contexto global (sem recriar nada)
  // -------------------------------------------------------------------------
  function getCtx() {
    var supabase =
      (typeof window !== 'undefined' && window.supabaseClient) ||
      (typeof supabaseClient !== 'undefined' ? supabaseClient : null);

    var currentUser =
      (typeof window !== 'undefined' && window.currentUser) ||
      (typeof window !== 'undefined' && window.currentUser === undefined && typeof currentUser !== 'undefined'
        ? currentUser
        : (window && window.currentUser) || null);

    var tenantId = null;
    try {
      if (typeof window.getCurrentTenantId === 'function') {
        tenantId = window.getCurrentTenantId();
      } else if (typeof getCurrentTenantId === 'function') {
        tenantId = getCurrentTenantId();
      }
    } catch (_) {}
    if (!tenantId) {
      try { tenantId = localStorage.getItem('currentTenantId'); } catch (_) {}
    }
    if (!tenantId && currentUser && currentUser.tenantId) tenantId = currentUser.tenantId;

    return {
      supabase: supabase,
      tenantId: tenantId || null,
      currentUser: currentUser || null,
      currentTenant: tenantId || null
    };
  }

  function ctxReady(ctx) {
    return !!(ctx && ctx.supabase && ctx.tenantId);
  }

  // Aguarda até o contexto da aplicação estar pronto.
  function waitForCtx(timeoutMs) {
    timeoutMs = timeoutMs || 20000;
    return new Promise(function (resolve) {
      var t0 = Date.now();
      var ctx = getCtx();
      if (ctxReady(ctx)) return resolve(ctx);

      var iv = setInterval(function () {
        var c = getCtx();
        if (ctxReady(c)) {
          clearInterval(iv);
          resolve(c);
        } else if (Date.now() - t0 > timeoutMs) {
          clearInterval(iv);
          resolve(c); // resolve mesmo "incompleto" para o caller logar
        }
      }, 250);
    });
  }

  // -------------------------------------------------------------------------
  // 2) Leitura: DB -> cache localStorage -> false
  // -------------------------------------------------------------------------
  window.__FF_COMISSOES_DB__ = (typeof window.__FF_COMISSOES_DB__ === 'boolean')
    ? window.__FF_COMISSOES_DB__
    : null;

  async function fetchFlagFromDB() {
    var ctx = await waitForCtx();
    console.log('[comissoes-ff] ctx fetch:', {
      supabase: !!ctx.supabase,
      tenantId: ctx.tenantId,
      currentUser: ctx.currentUser,
      currentTenant: ctx.currentTenant
    });
    if (!ctxReady(ctx)) {
      LOG('supabase/tenant indisponível — usando cache local');
      return null;
    }
    try {
      var resp = await ctx.supabase
        .from('tenant_settings')
        .select(COL)
        .eq('tenant_id', ctx.tenantId)
        .maybeSingle();
      if (resp.error) { LOG('erro select', resp.error); return null; }
      var val = !!(resp.data && resp.data[COL]);
      window.__FF_COMISSOES_DB__ = val;
      try { localStorage.setItem(LS_KEY, val ? '1' : '0'); } catch (_) {}
      return val;
    } catch (e) {
      LOG('exception select', e);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // 3) Override das funções globais usadas pela UI
  // -------------------------------------------------------------------------
  window.isFeatureComissoesAtiva = function () {
    if (typeof window.__FF_COMISSOES_DB__ === 'boolean') return window.__FF_COMISSOES_DB__;
    try { return localStorage.getItem(LS_KEY) === '1'; } catch (_) { return false; }
  };

  window.onToggleFeatureComissoes = async function (el) {
    var novo = !!(el && el.checked);
    var anterior = window.isFeatureComissoesAtiva();

    // Otimista na UI
    window.__FF_COMISSOES_DB__ = novo;
    try { localStorage.setItem(LS_KEY, novo ? '1' : '0'); } catch (_) {}
    try { if (typeof window.renderAgendaIfReady === 'function') window.renderAgendaIfReady(); } catch (_) {}
    try { if (typeof window.aplicarVisibilidadeComissoes === 'function') window.aplicarVisibilidadeComissoes(); } catch (_) {}

    var ctx = await waitForCtx();
    console.log({
      supabase: ctx.supabase,
      tenantId: ctx.tenantId,
      currentUser: ctx.currentUser,
      currentTenant: ctx.currentTenant
    });

    if (!ctxReady(ctx)) {
      LOG('supabase/tenant indisponível — NÃO foi possível salvar no banco');
      return;
    }

    try {
      var patch = { tenant_id: ctx.tenantId };
      patch[COL] = novo;
      // UPDATE parcial (só a coluna do flag) — evita sobrescrever
      // qualquer outro campo da tenant_settings.
      var resp = await ctx.supabase
        .from('tenant_settings')
        .update(patch)
        .eq('tenant_id', ctx.tenantId)
        .select(COL)
        .maybeSingle();

      if (resp.error) throw resp.error;

      // Se nenhuma linha existir ainda, faz upsert
      if (!resp.data) {
        var up = await ctx.supabase
          .from('tenant_settings')
          .upsert(patch, { onConflict: 'tenant_id' })
          .select(COL)
          .maybeSingle();
        if (up.error) throw up.error;
      }

      LOG('flag salvo no banco =', novo);
    } catch (err) {
      LOG('falha ao salvar — rollback', err);
      window.__FF_COMISSOES_DB__ = anterior;
      try { localStorage.setItem(LS_KEY, anterior ? '1' : '0'); } catch (_) {}
      if (el) el.checked = anterior;
      try { if (typeof window.renderAgendaIfReady === 'function') window.renderAgendaIfReady(); } catch (_) {}
      try { alert('Não foi possível salvar o toggle de Comissões. Tente novamente.'); } catch (_) {}
    }
  };

  // -------------------------------------------------------------------------
  // 4) Boot: aguarda contexto e sincroniza UI
  // -------------------------------------------------------------------------
  async function bootSync() {
    var val = await fetchFlagFromDB();
    if (val === null) return;
    var chk = document.getElementById(TOGGLE_ID);
    if (chk) chk.checked = val;
    try { if (typeof window.aplicarVisibilidadeComissoes === 'function') window.aplicarVisibilidadeComissoes(); } catch (_) {}
  }

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  onReady(function () {
    bootSync();

    // Re-sync quando troca de tenant ou login completa
    var prevSwitch = window.onTenantSwitch;
    window.onTenantSwitch = function () {
      try { if (typeof prevSwitch === 'function') prevSwitch.apply(this, arguments); } catch (_) {}
      window.__FF_COMISSOES_DB__ = null;
      bootSync();
    };
    var prevLogin = window.onLogin;
    window.onLogin = function () {
      try { if (typeof prevLogin === 'function') prevLogin.apply(this, arguments); } catch (_) {}
      window.__FF_COMISSOES_DB__ = null;
      bootSync();
    };

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') bootSync();
    });
  });

  // -------------------------------------------------------------------------
  // 5) Auditoria: loga qualquer UPDATE/UPSERT em tenant_settings
  // -------------------------------------------------------------------------
  (function installAudit() {
    function wrap(sb) {
      if (!sb || sb.__ff_audited__) return;
      var origFrom = sb.from.bind(sb);
      sb.from = function (table) {
        var qb = origFrom(table);
        if (table !== 'tenant_settings') return qb;
        ['update', 'upsert', 'insert'].forEach(function (m) {
          if (typeof qb[m] !== 'function') return;
          var orig = qb[m].bind(qb);
          qb[m] = function (payload, opts) {
            try {
              console.log('[ts-audit] tenant_settings.' + m, payload, '\n' + new Error().stack);
            } catch (_) {}
            return orig(payload, opts);
          };
        });
        return qb;
      };
      sb.__ff_audited__ = true;
    }
    var iv = setInterval(function () {
      var sb = window.supabaseClient;
      if (sb) { wrap(sb); clearInterval(iv); }
    }, 200);
    setTimeout(function () { clearInterval(iv); }, 30000);
  })();

})();
