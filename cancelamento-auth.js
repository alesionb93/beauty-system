/* =====================================================================
 * cancelamento-auth.js — fluxo de cancelamento em 2 STEPS
 * Slotify v3 — 2026-06-03
 *
 * MUDANÇAS NESTA VERSÃO:
 *  - A autenticação administrativa NÃO é mais feita pela edge function
 *    `cancelar-agendamento`. Agora usa a nova função GENÉRICA e
 *    reutilizável `authorize-admin`.
 *  - O modal foi separado em DOIS passos quando `exigirSenha=true`:
 *       Step 1 → "Autorização necessária" (login/e-mail + senha)
 *       Step 2 → "Cancelar agendamento" (motivo)
 *    Quando `exigirSenha=false`, abre direto o Step 2.
 *  - A autorização vale APENAS para este fluxo. Não é persistida em
 *    sessão global nem reutilizada entre ações.
 *  - O POST para `cancelar-agendamento` sempre envia
 *    `exigir_senha_cancelamento:false` (a edge function aceita esse
 *    sinal de bypass — admin já foi validado no Step 1 ou a flag está
 *    desligada). Nenhuma regra financeira/auditoria foi alterada.
 *
 * API pública (inalterada):
 *   await CancelamentoAuth.solicitar({
 *     agendamentoId, tenantId, possuiPagamento, exigirSenha, onSuccess
 *   });
 * ===================================================================== */
(function () {
  'use strict';

  const VERSION = 'cancelamento-auth-2step-v6-2026-06-03';
  try { window.__CANCELAMENTO_AUTH_VERSION__ = VERSION; } catch (_) {}

  const FN_CANCEL_PATH = '/functions/v1/cancelar-agendamento';
  const FN_AUTH_PATH   = '/functions/v1/authorize-admin';
  const cacheMotivosPorTenant = new Map();

  // ---------- helpers ----------
  function getSupabase() {
    return window.supabaseClient || window.supabase || (window._supabase ?? null);
  }
  function getSupabaseUrl() {
    return (window.SUPABASE_URL || (getSupabase()?.supabaseUrl ?? '')).replace(/\/+$/, '');
  }
  function urlAuth()   { return getSupabaseUrl() + FN_AUTH_PATH; }
  function urlCancel() { return getSupabaseUrl() + FN_CANCEL_PATH; }
  async function getJWT() {
    try {
      const sb = getSupabase();
      const { data } = await sb.auth.getSession();
      return data?.session?.access_token || null;
    } catch (_) { return null; }
  }
  async function fetchMotivos(tenantId) {
    const cacheKey = String(tenantId || 'global');
    if (cacheMotivosPorTenant.has(cacheKey)) return cacheMotivosPorTenant.get(cacheKey);
    const sb = getSupabase();
    const { data, error } = await sb
      .from('cancelamento_motivos')
      .select('id, nome, slug, exige_descricao, ordem, tenant_id')
      .eq('ativo', true)
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .order('ordem', { ascending: true });
    if (error) throw error;
    const motivos = data || [];
    cacheMotivosPorTenant.set(cacheKey, motivos);
    return motivos;
  }
  function readVal(input) {
    if (!input) return '';
    try {
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
    return typeof input.value === 'string' ? input.value : '';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function makeOverlay() {
    const o = document.createElement('div');
    o.className = 'cxa-overlay';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    return o;
  }

  // ============================================================
  // STEP 1 — Modal de autorização administrativa (genérico)
  // Chama a edge function `authorize-admin`.
  // Resolve para { user_id, role, email, access_token } ou null (cancelado).
  // ============================================================
  function abrirModalAutorizacao() {
    return new Promise((resolve) => {
      const overlay = makeOverlay();
      overlay.innerHTML = `
        <div class="cxa-modal">
          <header class="cxa-header">
            <h3>Autorização necessária</h3>
            <button class="cxa-close" type="button" aria-label="Fechar">&times;</button>
          </header>
          <p class="cxa-sub">Esta ação exige autorização de um administrador. Informe e-mail e senha do administrador responsável.</p>
          <form class="cxa-form" autocomplete="off" novalidate>
            <label class="cxa-label">
              <span>Login ou e-mail do administrador</span>
              <input type="text" class="cxa-input" name="identifier" data-field="identifier"
                     autocomplete="off" autocapitalize="off" spellcheck="false" />
            </label>
            <label class="cxa-label">
              <span>Senha do administrador</span>
              <input type="password" class="cxa-input" name="senha" data-field="senha"
                     autocomplete="new-password" />
            </label>
            <p class="cxa-error" data-role="error" hidden></p>
            <footer class="cxa-footer">
              <button type="button" class="cxa-btn cxa-btn-ghost" data-action="cancel">Cancelar</button>
              <button type="submit" class="cxa-btn cxa-btn-danger" data-action="confirm">
                <span class="cxa-btn-label">Autorizar</span>
                <span class="cxa-spinner" hidden></span>
              </button>
            </footer>
          </form>
        </div>`;
      const form        = overlay.querySelector('form');
      const inpId       = form.querySelector('[data-field="identifier"]');
      const inpSenha    = form.querySelector('[data-field="senha"]');
      const errorEl     = form.querySelector('[data-role="error"]');
      const btn         = form.querySelector('[data-action="confirm"]');
      const spinner     = btn.querySelector('.cxa-spinner');
      const btnLabel    = btn.querySelector('.cxa-btn-label');

      const showError = (m) => { errorEl.textContent = m || ''; errorEl.hidden = !m; };
      const setLoading = (on) => {
        btn.disabled = on; spinner.hidden = !on;
        btnLabel.textContent = on ? 'Autorizando…' : 'Autorizar';
      };
      const close = (result) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result || null);
      };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);

      overlay.querySelector('.cxa-close').addEventListener('click', () => close(null));
      overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(null));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });

      form.addEventListener('submit', async (e) => {
        e.preventDefault(); e.stopPropagation(); showError('');
        const identifier = readVal(inpId).trim();
        const password   = readVal(inpSenha);
        if (!identifier) return showError('Informe o login ou e-mail do administrador.');
        if (!password)   return showError('Informe a senha do administrador.');
        if (password.length < 4) return showError('Senha muito curta.');

        setLoading(true);
        try {
          const anonKey = window.SUPABASE_ANON_KEY || window.SUPABASE_PUBLISHABLE_KEY || '';
          const sessJwt = await getJWT();
          const bearer  = sessJwt || anonKey;
          const res = await fetch(urlAuth(), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': anonKey,
              'Authorization': 'Bearer ' + bearer,
            },
            body: JSON.stringify({ identifier, password }),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || !j.success) {
            setLoading(false);
            return showError(j.message || 'Credenciais inválidas.');
          }
          close({
            user_id: j.user_id, role: j.role, name: j.name,
            email: j.email, access_token: j.access_token, tenant_id: j.tenant_id,
          });
        } catch (err) {
          setLoading(false);
          showError('Falha de rede ao validar credenciais.');
        }
      });

      document.body.appendChild(overlay);
      setTimeout(() => { try { inpId.focus(); } catch (_) {} }, 30);
    });
  }

  // ============================================================
  // STEP 2 — Modal de seleção de motivo e confirmação
  // ============================================================
  function abrirModalMotivo({ motivos, onConfirm }) {
    return new Promise((resolve) => {
      const overlay = makeOverlay();
      const optionsHtml = motivos.map(m =>
        `<option value="${escapeHtml(m.id)}" data-slug="${escapeHtml(m.slug)}" data-exige="${m.exige_descricao ? 'true' : 'false'}">${escapeHtml(m.nome)}</option>`
      ).join('');

      overlay.innerHTML = `
        <div class="cxa-modal">
          <header class="cxa-header">
            <h3>Cancelar agendamento</h3>
            <button class="cxa-close" type="button" aria-label="Fechar">&times;</button>
          </header>
          <p class="cxa-sub">Selecione o motivo do cancelamento. Esta ação não pode ser desfeita.</p>
          <form class="cxa-form" autocomplete="off" novalidate>
            <label class="cxa-label">
              <span>Motivo do cancelamento</span>
              <select class="cxa-input" name="motivo" data-field="motivo">
                <option value="">Selecione…</option>
                ${optionsHtml}
              </select>
            </label>
            <label class="cxa-label cxa-hidden" data-field-wrap="descricao">
              <span>Descreva o motivo</span>
              <textarea class="cxa-input" name="descricao" data-field="descricao" rows="3" maxlength="500"></textarea>
            </label>
            <p class="cxa-error" data-role="error" hidden></p>
            <footer class="cxa-footer">
              <button type="button" class="cxa-btn cxa-btn-ghost" data-action="cancel">Cancelar ação</button>
              <button type="submit" class="cxa-btn cxa-btn-danger" data-action="confirm">
                <span class="cxa-btn-label">Confirmar cancelamento</span>
                <span class="cxa-spinner" hidden></span>
              </button>
            </footer>
          </form>
        </div>`;

      const form        = overlay.querySelector('form');
      const selMotivo   = form.querySelector('[data-field="motivo"]');
      const inpDesc     = form.querySelector('[data-field="descricao"]');
      const descWrap    = form.querySelector('[data-field-wrap="descricao"]');
      const errorEl     = form.querySelector('[data-role="error"]');
      const btn         = form.querySelector('[data-action="confirm"]');
      const spinner     = btn.querySelector('.cxa-spinner');
      const btnLabel    = btn.querySelector('.cxa-btn-label');

      const showError = (m) => { errorEl.textContent = m || ''; errorEl.hidden = !m; };
      const setLoading = (on) => {
        btn.disabled = on; spinner.hidden = !on;
        btnLabel.textContent = on ? 'Processando…' : 'Confirmar cancelamento';
      };
      const close = (ok) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(!!ok);
      };
      const onKey = (e) => { if (e.key === 'Escape') close(false); };
      document.addEventListener('keydown', onKey);

      overlay.querySelector('.cxa-close').addEventListener('click', () => close(false));
      overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

      selMotivo.addEventListener('change', () => {
        const opt = selMotivo.selectedOptions[0];
        descWrap.classList.toggle('cxa-hidden', !(opt && opt.dataset.exige === 'true'));
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault(); e.stopPropagation(); showError('');
        const motivoId  = readVal(selMotivo).trim();
        const descricao = readVal(inpDesc).trim();
        if (!motivoId) return showError('Selecione um motivo.');
        const opt = selMotivo.selectedOptions[0];
        if (opt && opt.dataset.exige === 'true' && descricao.length < 3) {
          return showError('Descreva o motivo (mín. 3 caracteres).');
        }
        setLoading(true);
        try {
          await onConfirm({
            motivoId, descricao,
            motivoNome: opt ? opt.textContent : '',
          });
          close(true);
        } catch (err) {
          setLoading(false);
          showError(err?.message || 'Falha ao cancelar.');
        }
      });

      document.body.appendChild(overlay);
      setTimeout(() => { try { selMotivo.focus(); } catch (_) {} }, 30);
    });
  }

  // ============================================================
  // API pública: solicitar
  // ============================================================
  async function solicitar({ agendamentoId, tenantId, possuiPagamento = false, exigirSenha, onSuccess }) {
    if (!agendamentoId) throw new Error('agendamentoId é obrigatório');
    if (!tenantId)      throw new Error('tenantId é obrigatório');

    // Default fail-safe: se não informado, mantém comportamento antigo (true).
    const flagSenha = exigirSenha !== false && exigirSenha !== 'false'
                   && exigirSenha !== 0 && exigirSenha !== '0';

    // Pré-carrega motivos (independente do step).
    let motivos;
    try { motivos = await fetchMotivos(tenantId); }
    catch (e) { alert('Erro ao carregar motivos: ' + (e.message || e)); return false; }
    if (!motivos.length) { alert('Nenhum motivo cadastrado.'); return false; }

    // STEP 1 — só quando exigirSenha=true
    let adminAuth = null; // { access_token, role, ... } — válido APENAS para este fluxo
    if (flagSenha) {
      adminAuth = await abrirModalAutorizacao();
      if (!adminAuth) return false; // usuário cancelou
    }

    // STEP 2 — motivo + confirmação
    return await abrirModalMotivo({
      motivos,
      onConfirm: async ({ motivoId, descricao }) => {
        // JWT do usuário corrente (para auditoria na edge function).
        // Preferimos o access_token do admin recém-autorizado quando existir,
        // pois ele identifica QUEM autorizou esta ação específica.
        const jwt = (adminAuth && adminAuth.access_token) || await getJWT();
        if (!jwt) throw new Error('Sessão expirada — faça login novamente.');

        // exigir_senha_cancelamento:false → a edge function de cancelamento
        // entra no modo "sem senha" (audita pelo JWT, não pede admin_email).
        // A autorização administrativa já foi validada no Step 1 pela
        // função genérica `authorize-admin`.
        const payload = {
          agendamento_id: agendamentoId,
          motivo_id: motivoId,
          descricao_outro: descricao,
          cancelar_com_venda: false,
          exigir_senha_cancelamento: false,
        };

        console.log('[CancelamentoAuth] POST', urlCancel(), {
          version: VERSION,
          autorizado_por: adminAuth ? adminAuth.email : '(flag desligada)',
          role: adminAuth ? adminAuth.role : null,
          ...payload,
        });

        let res;
        try {
          res = await fetch(urlCancel(), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + jwt,
              'apikey': window.SUPABASE_ANON_KEY || '',
            },
            body: JSON.stringify(payload),
          });
        } catch (_) { throw new Error('Falha de rede ao contatar o servidor.'); }

        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.success) {
          console.warn('[CancelamentoAuth] falha cancelar-agendamento', { status: res.status, j });
          if (res.status === 404) throw new Error(j.error || 'Agendamento não encontrado.');
          if (res.status === 409) throw new Error(j.error || 'Agendamento já está cancelado.');
          throw new Error(j.error || 'Falha ao cancelar.');
        }
        onSuccess && onSuccess(j);
      },
    });
  }

  window.CancelamentoAuth = {
    solicitar,
    _clearCache: () => { cacheMotivosPorTenant.clear(); },
  };
})();
