/* =====================================================================
 * desconto-auth.js — Add-on isolado (v1 — 2026-06-03)
 * ---------------------------------------------------------------------
 * Carregue em agenda.html SEMPRE ANTES de agendamento-desconto.js:
 *
 *   <script src="/desconto-auth.js?v=1" defer></script>
 *   <script src="/agendamento-desconto.js?v=1" defer></script>
 *
 * O que faz:
 *   • Lê a feature flag `tenant_settings.exigir_senha_desconto`.
 *   • Expõe `window.onToggleExigirSenhaDesconto(el)` para o toggle
 *     "Exigir senha para desconto" em Configurações > Geral.
 *   • Intercepta — em capture-phase, ANTES do listener de
 *     agendamento-desconto.js — o clique no botão
 *     [data-desc-action="open-apply"] dentro do modal "Registrar pagamento".
 *     - Flag DESATIVADA: deixa o fluxo seguir normalmente.
 *     - Flag ATIVADA  : abre o modal de autorização administrativa
 *       (reutiliza o look & feel `cxa-*` de cancelamento-auth.css)
 *       e chama a Edge Function `authorize-admin`. Em caso de sucesso
 *       re-emite o clique com um marcador `__SLOTIFY_DESC_AUTH_OK__`
 *       para liberar a abertura do modal de desconto.
 *
 * NÃO altera:
 *   • Edge Function `authorize-admin` (reutilizada como está).
 *   • Lógica do desconto (`agendamento-desconto.js`).
 *   • Cálculos financeiros / dashboards / comissões / histórico.
 *   • Fluxo de cancelamento (a flag é independente).
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_DESC_AUTH_LOADED__) return;
  window.__SLOTIFY_DESC_AUTH_LOADED__ = true;

  var VERSION = 'desconto-auth-v1-2026-06-03';
  try { window.__DESCONTO_AUTH_VERSION__ = VERSION; } catch (_) {}
  console.log('%c🔐 desconto-auth.js v1 carregado',
    'background:#6c3aed;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700');

  // ---------------- Config global em runtime ----------------
  window.DESCONTO_CFG = window.DESCONTO_CFG || { exigir_senha: false, _loaded: false };
  var DESCONTO_CFG = window.DESCONTO_CFG;

  // ---------------- Helpers ----------------
  function getSupabase() {
    return window.supabaseClient || window.supabase || window._supabase || null;
  }
  function getCurrentTenantId() {
    try { if (typeof window.getCurrentTenantId === 'function') return window.getCurrentTenantId(); } catch (_) {}
    return window.__CURRENT_TENANT_ID__ || null;
  }
  async function getJWT() {
    try {
      var sb = getSupabase();
      var s = await sb.auth.getSession();
      return s && s.data && s.data.session ? s.data.session.access_token : null;
    } catch (_) { return null; }
  }
  function getFunctionsBase() {
    var url = window.SUPABASE_URL || (getSupabase() && getSupabase().supabaseUrl) || '';
    return String(url).replace(/\/+$/, '') + '/functions/v1/authorize-admin';
  }
  function readBoolFlag(v) {
    return v === true || v === 'true' || v === 1 || v === '1';
  }

  // ---------------- Carrega a flag do tenant ----------------
  async function carregarFlag() {
    var sb = getSupabase();
    var tenantId = getCurrentTenantId();
    if (!sb || !tenantId) return;
    try {
      var resp = await sb.from('tenant_settings')
        .select('exigir_senha_desconto')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (resp && resp.data && resp.data.exigir_senha_desconto != null) {
        DESCONTO_CFG.exigir_senha = readBoolFlag(resp.data.exigir_senha_desconto);
      } else {
        DESCONTO_CFG.exigir_senha = false;
      }
    } catch (e) {
      console.warn('[desconto-auth] não foi possível carregar flag:', e);
      DESCONTO_CFG.exigir_senha = false;
    } finally {
      DESCONTO_CFG._loaded = true;
      var chk = document.getElementById('cfg-exigir-senha-desconto');
      if (chk) chk.checked = !!DESCONTO_CFG.exigir_senha;
    }
  }

  // Tenta carregar assim que o supabase estiver pronto. Re-tenta algumas vezes.
  (function bootstrapFlag() {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (getSupabase() && getCurrentTenantId()) {
        clearInterval(iv);
        carregarFlag();
      } else if (tries > 40) {
        clearInterval(iv); // desiste em silêncio; será carregado on-demand
      }
    }, 500);
  })();

  // ---------------- Toggle handler (Configurações > Geral) ----------------
  window.onToggleExigirSenhaDesconto = async function (el) {
    var sb = getSupabase();
    var tenantId = getCurrentTenantId();
    var fb = document.getElementById('cfg-desconto-feedback');
    if (!sb || !tenantId) {
      if (fb) {
        fb.style.display = '';
        fb.className = 'ac-feedback err';
        fb.textContent = 'Sessão não encontrada. Recarregue a página.';
      }
      return;
    }
    var on = !!el.checked;
    el.disabled = true;
    try {
      var resp = await sb.from('tenant_settings').upsert(
        { tenant_id: tenantId, exigir_senha_desconto: on },
        { onConflict: 'tenant_id' }
      );
      if (resp.error) throw resp.error;
      DESCONTO_CFG.exigir_senha = on;
      if (fb) {
        fb.style.display = '';
        fb.className = 'ac-feedback ok';
        fb.textContent = on
          ? '✓ Senha de administrador será exigida para aplicar descontos.'
          : '✓ Descontos poderão ser aplicados sem autenticação.';
        setTimeout(function () { fb.style.display = 'none'; }, 3000);
      }
    } catch (err) {
      console.error('[desconto-auth] erro ao salvar flag:', err);
      el.checked = !on;
      if (fb) {
        fb.style.display = '';
        fb.className = 'ac-feedback err';
        fb.textContent = 'Não foi possível salvar. Tente novamente.';
      }
    } finally {
      el.disabled = false;
    }
  };

  // ---------------- Modal de autorização (reusa cxa-*) ----------------
  function buildAuthModal(onSuccess, onClose) {
    var overlay = document.createElement('div');
    overlay.className = 'cxa-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = '' +
      '<div class="cxa-modal">' +
        '<header class="cxa-header">' +
          '<h3>Autorização necessária</h3>' +
          '<button class="cxa-close" type="button" aria-label="Fechar">&times;</button>' +
        '</header>' +
        '<p class="cxa-sub">Para aplicar desconto é necessária a autorização de um administrador. Informe login ou e-mail e a senha.</p>' +
        '<form class="cxa-form" autocomplete="off" novalidate>' +
          '<label class="cxa-label">' +
            '<span>Login ou e-mail do administrador</span>' +
            '<input type="text" class="cxa-input" name="identifier" data-field="identifier" autocomplete="off" autocapitalize="off" spellcheck="false" />' +
          '</label>' +
          '<label class="cxa-label">' +
            '<span>Senha do administrador</span>' +
            '<input type="password" class="cxa-input" name="password" data-field="password" autocomplete="new-password" />' +
          '</label>' +
          '<p class="cxa-error" data-role="error" hidden></p>' +
          '<footer class="cxa-footer">' +
            '<button type="button" class="cxa-btn cxa-btn-ghost" data-action="cancel">Cancelar</button>' +
            '<button type="submit" class="cxa-btn cxa-btn-danger" data-action="confirm">' +
              '<span class="cxa-btn-label">Autorizar</span>' +
              '<span class="cxa-spinner" hidden></span>' +
            '</button>' +
          '</footer>' +
        '</form>' +
      '</div>';

    function close() {
      try { overlay.remove(); } catch (_) {}
      document.removeEventListener('keydown', onKey);
      onClose && onClose();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    overlay.querySelector('.cxa-close').addEventListener('click', close);
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    var form = overlay.querySelector('form');
    var inpId = form.querySelector('[data-field="identifier"]');
    var inpPwd = form.querySelector('[data-field="password"]');
    var errorEl = form.querySelector('[data-role="error"]');
    var btn = form.querySelector('[data-action="confirm"]');
    var btnLabel = btn.querySelector('.cxa-btn-label');
    var spinner = btn.querySelector('.cxa-spinner');

    function showError(msg) {
      errorEl.textContent = msg || '';
      errorEl.hidden = !msg;
    }
    function setLoading(on) {
      btn.disabled = on;
      spinner.hidden = !on;
      btnLabel.textContent = on ? 'Validando…' : 'Autorizar';
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      e.stopPropagation();
      showError('');
      var identifier = (inpId.value || '').trim();
      var password = inpPwd.value || '';
      if (!identifier) return showError('Informe o login ou e-mail do administrador.');
      if (!password) return showError('Informe a senha do administrador.');
      if (password.length < 4) return showError('Senha muito curta.');

      setLoading(true);
      try {
        var anonKey = window.SUPABASE_ANON_KEY || window.SUPABASE_PUBLISHABLE_KEY || '';
        var sessJwt = await getJWT();
        var bearer = sessJwt || anonKey;
        var resp = await fetch(getFunctionsBase(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': anonKey,
            'Authorization': 'Bearer ' + bearer
          },
          body: JSON.stringify({ identifier: identifier, password: password })
        });
        var json = null;
        try { json = await resp.json(); } catch (_) {}
        if (!resp.ok || !json || json.success !== true) {
          var msg = (json && json.message) || 'Não foi possível validar a autorização.';
          if (resp.status === 401) msg = json && json.message ? json.message : 'Credenciais inválidas.';
          if (resp.status === 403) msg = json && json.message ? json.message : 'Usuário sem permissão administrativa.';
          throw new Error(msg);
        }
        close();
        onSuccess && onSuccess(json);
      } catch (err) {
        setLoading(false);
        showError(err && err.message ? err.message : 'Falha na autorização.');
      }
    });

    document.body.appendChild(overlay);
    setTimeout(function () { try { inpId.focus(); } catch (_) {} }, 30);
  }

  // ---------------- Interceptação do clique (capture-phase) ----------------
  // Carregado ANTES de agendamento-desconto.js → este listener é registrado
  // primeiro em capture e executa antes do listener do desconto.
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var btn = t.closest('[data-desc-action="open-apply"]');
    if (!btn) return;

    // Bypass: clique re-emitido por nós após autorização OK.
    if (window.__SLOTIFY_DESC_AUTH_OK__) return;

    // Se a flag ainda não carregou, tenta carregar agora (síncrono via flag).
    // Se mesmo assim não houver certeza, fail-safe = não bloquear.
    if (!DESCONTO_CFG._loaded) {
      // Tenta carregar em background; neste clique deixa passar para não travar UX.
      carregarFlag();
      return;
    }

    if (!DESCONTO_CFG.exigir_senha) return; // flag OFF → fluxo normal

    // Flag ON → bloqueia e exibe modal de autorização
    ev.preventDefault();
    ev.stopImmediatePropagation();

    buildAuthModal(function onOk() {
      // Re-emite o clique com bypass marcado.
      try {
        window.__SLOTIFY_DESC_AUTH_OK__ = true;
        // Pequena espera para garantir que estamos fora do stack atual.
        setTimeout(function () {
          try { btn.click(); } catch (_) {}
          setTimeout(function () { window.__SLOTIFY_DESC_AUTH_OK__ = false; }, 0);
        }, 0);
      } catch (e) {
        window.__SLOTIFY_DESC_AUTH_OK__ = false;
      }
    });
  }, true); // capture: registra antes — ordem garantida pelo defer
})();
