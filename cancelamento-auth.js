/* =====================================================================
 * cancelamento-auth.js — modal de autorização administrativa
 * Slotify v2 — 2026-05-12
 *
 * NOVIDADES desta versão:
 *  - Suporte à feature flag `exigirSenha` (default true para retro-compat).
 *    Quando false:
 *      • Modal NÃO exibe os campos "E-mail do administrador" e "Senha".
 *      • Validação JS pula esses campos.
 *      • Payload omite admin_email/admin_senha — a edge function identifica
 *        o admin pelo JWT do Authorization header.
 *  - Restante do fluxo (motivos, descrição, com_venda, logs, analytics)
 *    permanece idêntico.
 *
 * Histórico anterior:
 *  - Workaround para autofill do Chrome em <input type="password">.
 *  - Leitura defensiva via querySelector.
 *  - novalidate no form, mensagens de erro distintas por campo.
 *
 * Dependências globais:
 *   - window.supabase (cliente supabase-js)
 *   - window.SUPABASE_URL  (de config.js)
 *
 * Uso:
 *   await CancelamentoAuth.solicitar({
 *     agendamentoId,
 *     tenantId,
 *     possuiPagamento: boolean,
 *     exigirSenha: boolean,        // <-- NOVO (default true)
 *     onSuccess: ({ novo_status }) => { ... }
 *   });
 * ===================================================================== */
(function () {
  'use strict';

  const CANCELAMENTO_AUTH_VERSION = 'cancelamento-auth-optional-admin-v5-2026-05-12';
  try { window.__CANCELAMENTO_AUTH_VERSION__ = CANCELAMENTO_AUTH_VERSION; } catch (_) {}

  const FN_PATH = '/functions/v1/cancelar-agendamento';
  const cacheMotivosPorTenant = new Map();

  // ---------- helpers ----------
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v != null) node.setAttribute(k, v);
    });
    children.flat().forEach(c => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function getSupabase() {
    return window.supabaseClient || window.supabase || (window._supabase ?? null);
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

  async function getJWT() {
    const sb = getSupabase();
    const { data } = await sb.auth.getSession();
    return data?.session?.access_token || null;
  }

  function getFunctionsBase() {
    const url = window.SUPABASE_URL || (getSupabase()?.supabaseUrl ?? '');
    return url.replace(/\/+$/, '') + FN_PATH;
  }

  function readInputValue(input) {
    if (!input) return '';
    try {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
    const v = input.value;
    return typeof v === 'string' ? v : '';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------- modal ----------
  function buildModal({ motivos, possuiPagamento, exigirSenha, onConfirm, onClose }) {
    const overlay = el('div', { class: 'cxa-overlay', role: 'dialog', 'aria-modal': 'true' });

    const optionsHtml = motivos.map(m =>
      `<option value="${escapeHtml(m.id)}" data-slug="${escapeHtml(m.slug)}" data-exige="${m.exige_descricao ? 'true' : 'false'}">${escapeHtml(m.nome)}</option>`
    ).join('');

    // Bloco de credenciais admin — só renderiza quando a flag está ATIVA.
    const credenciaisHtml = exigirSenha ? `
          <label class="cxa-label">
            <span>E-mail do administrador</span>
            <input type="email" class="cxa-input" name="adminEmail" data-field="adminEmail" autocomplete="off" autocapitalize="off" spellcheck="false" />
          </label>

          <label class="cxa-label">
            <span>Senha do administrador</span>
            <input type="password" class="cxa-input" name="senha" data-field="senha" autocomplete="new-password" />
          </label>
    ` : '';

    const titulo = exigirSenha ? 'Autorização necessária' : 'Cancelar agendamento';
    const subtitulo = exigirSenha
      ? 'Esta ação exige autorização de um administrador. Informe e-mail e senha do administrador responsável.'
      : 'Selecione o motivo do cancelamento. Esta ação não pode ser desfeita.';

    overlay.innerHTML = `
      <div class="cxa-modal">
        <header class="cxa-header">
          <h3>${escapeHtml(titulo)}</h3>
          <button class="cxa-close" type="button" aria-label="Fechar">&times;</button>
        </header>
        <p class="cxa-sub">${escapeHtml(subtitulo)}</p>

        <form class="cxa-form" autocomplete="off" novalidate>
          ${credenciaisHtml}

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

          ${possuiPagamento ? `
          <label class="cxa-checkbox">
            <input type="checkbox" name="comVenda" data-field="comVenda" checked />
            <span>Preservar pagamentos (cancelar com venda)</span>
          </label>` : ''}

          <p class="cxa-error" data-role="error" hidden></p>

          <footer class="cxa-footer">
            <button type="button" class="cxa-btn cxa-btn-ghost" data-action="cancel">Cancelar ação</button>
            <button type="submit" class="cxa-btn cxa-btn-danger" data-action="confirm">
              <span class="cxa-btn-label">Confirmar cancelamento</span>
              <span class="cxa-spinner" hidden></span>
            </button>
          </footer>
        </form>
      </div>
    `;

    const form = overlay.querySelector('form');
    const inputEmail = form.querySelector('[data-field="adminEmail"]');
    const inputSenha = form.querySelector('[data-field="senha"]');
    const selectMotivo = form.querySelector('[data-field="motivo"]');
    const inputDescricao = form.querySelector('[data-field="descricao"]');
    const inputComVenda = form.querySelector('[data-field="comVenda"]');
    const descricaoWrap = form.querySelector('[data-field-wrap="descricao"]');
    const errorEl = form.querySelector('[data-role="error"]');
    const btnConfirm = form.querySelector('[data-action="confirm"]');
    const spinner = btnConfirm.querySelector('.cxa-spinner');
    const btnLabel = btnConfirm.querySelector('.cxa-btn-label');

    function showError(msg) {
      errorEl.textContent = msg || '';
      errorEl.hidden = !msg;
    }
    function setLoading(on) {
      btnConfirm.disabled = on;
      spinner.hidden = !on;
      btnLabel.textContent = on ? 'Processando…' : 'Confirmar cancelamento';
    }
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      onClose && onClose();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    overlay.querySelector('.cxa-close').addEventListener('click', close);
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    selectMotivo.addEventListener('change', () => {
      const opt = selectMotivo.selectedOptions[0];
      const exige = opt && opt.dataset.exige === 'true';
      descricaoWrap.classList.toggle('cxa-hidden', !exige);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      showError('');

      // Leitura defensiva (autofill).
      const adminEmail = inputEmail ? readInputValue(inputEmail).trim() : '';
      const senha = inputSenha ? readInputValue(inputSenha) : '';
      const motivoId = readInputValue(selectMotivo).trim();
      const descricao = readInputValue(inputDescricao).trim();
      const comVenda = !!(inputComVenda && inputComVenda.checked);

      console.log('[CancelamentoAuth] submit', {
        exigirSenha,
        adminEmailLen: adminEmail.length,
        senhaLen: senha.length,
        motivoId,
        descricaoLen: descricao.length,
        comVenda,
      });

      if (exigirSenha) {
        if (!adminEmail) return showError('Informe o e-mail do administrador.');
        if (!adminEmail.includes('@')) return showError('Informe um e-mail válido.');
        if (!senha) return showError('Informe a senha do administrador.');
        if (senha.length < 4) return showError('Senha muito curta.');
      }
      if (!motivoId) return showError('Selecione um motivo.');

      const opt = selectMotivo.selectedOptions[0];
      if (opt && opt.dataset.exige === 'true' && descricao.length < 3) {
        return showError('Descreva o motivo (mín. 3 caracteres).');
      }

      setLoading(true);
      try {
        await onConfirm({
          adminEmail, senha, motivoId, descricao, cancelarComVenda: comVenda,
          motivoNome: opt ? opt.textContent : '',
        });
        close();
      } catch (err) {
        setLoading(false);
        showError(err?.message || 'Falha ao cancelar.');
      }
    });

    document.body.appendChild(overlay);
    setTimeout(() => {
      try { (exigirSenha && inputEmail ? inputEmail : selectMotivo).focus(); } catch (_) {}
    }, 30);
    return { close };
  }

  // ---------- API pública ----------
  async function solicitar({ agendamentoId, tenantId, possuiPagamento = false, exigirSenha, onSuccess }) {
    if (!agendamentoId) throw new Error('agendamentoId é obrigatório');
    if (!tenantId) throw new Error('tenantId é obrigatório');

    // Default fail-safe: se não informado, mantém comportamento antigo (true).
    const flagSenha = exigirSenha !== false && exigirSenha !== 'false' && exigirSenha !== 0 && exigirSenha !== '0';

    let motivos;
    try { motivos = await fetchMotivos(tenantId); }
    catch (e) { alert('Erro ao carregar motivos: ' + (e.message || e)); return; }

    if (!motivos.length) { alert('Nenhum motivo cadastrado.'); return; }

    return new Promise((resolve) => {
      buildModal({
        motivos,
        possuiPagamento,
        exigirSenha: flagSenha,
        onClose: () => resolve(false),
        onConfirm: async ({ adminEmail, senha, motivoId, descricao, cancelarComVenda }) => {
          const jwt = await getJWT();
          if (!jwt) throw new Error('Sessão expirada — faça login novamente.');

          const payload = {
            agendamento_id: agendamentoId,
            motivo_id: motivoId,
            descricao_outro: descricao,
            cancelar_com_venda: cancelarComVenda,
            exigir_senha_cancelamento: flagSenha,
          };
          if (flagSenha) {
            payload.admin_email = adminEmail;
            payload.admin_senha = senha;
          }

          const payloadLog = { ...payload };
          if (flagSenha) payloadLog.admin_senha = `(${senha.length} chars)`;
          console.log('[CancelamentoAuth] POST', getFunctionsBase(), {
            version: CANCELAMENTO_AUTH_VERSION,
            ...payloadLog,
          });

          let res;
          try {
            res = await fetch(getFunctionsBase(), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + jwt,
                'apikey': window.SUPABASE_ANON_KEY || '',
              },
              body: JSON.stringify(payload),
            });
          } catch (netErr) {
            throw new Error('Falha de rede ao contatar o servidor.');
          }

          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json.success) {
            console.warn('[CancelamentoAuth] falha cancelar-agendamento', {
              status: res.status,
              error: json.error,
              code: json.code,
              modo: json.modo,
              flag_source: json.flag_source,
              flag_raw: json.flag_raw,
              tenant_id: json.tenant_id,
              motivo_tenant_id: json.motivo_tenant_id,
              function_version: json.function_version,
              response: json,
            });
            if (res.status === 401) {
              throw new Error(json.error || (flagSenha
                ? 'E-mail ou senha do administrador incorretos.'
                : 'Sessão expirada — faça login novamente.'));
            }
            if (res.status === 403) {
              throw new Error(json.error || 'Você não possui permissão para cancelar agendamentos.');
            }
            if (res.status === 404) throw new Error(json.error || 'Agendamento não encontrado.');
            if (res.status === 409) throw new Error(json.error || 'Agendamento já está cancelado.');
            throw new Error(json.error || 'Falha ao cancelar.');
          }
          resolve(true);
          onSuccess && onSuccess(json);
        },
      });
    });
  }

  window.CancelamentoAuth = { solicitar, _clearCache: () => { cacheMotivosPorTenant.clear(); } };
})();
