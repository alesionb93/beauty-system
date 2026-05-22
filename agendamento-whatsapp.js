/* =========================================================================
 * agendamento-whatsapp.js  (v8 — carrega notifyWhatsapp.js + config.js antes do engine)
 * -------------------------------------------------------------------------
 * Mudanças vs v6:
 *   - FIX 1 (UX): O modal de confirmação agora abre SOMENTE após:
 *       1) shell do agendamento-cliente.html injetado
 *       2) motor legado carregado
 *       3) auto-identificação concluída
 *       4) loaders removidos
 *       5) tela de serviços (Step 2) realmente renderizada
 *     Antes, o modal abria sobre a tela preta "Carregando sua agenda".
 *
 *   - FIX 2 (Telefone): Normalização BR remove o country code `55`
 *     ANTES de aplicar a máscara. Entrada `+55 48 9120-3769` agora
 *     exibe corretamente `(48) 9120-3769` (antes virava `(54) 89120-3769`).
 *
 *   - Edição de nome/telefone continua atualizando o MESMO cadastro
 *     (best-effort em `clientes`).
 *   - 100% reutiliza o motor legado /agendamento-cliente.js.
 * ========================================================================= */
(function () {
  'use strict';

  const TAG = '[wa-magic]';
  const log  = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);
  const err  = (...a) => console.error(TAG, ...a);

  // ---------- Configuração ----------
  const SUPABASE_URL  = window.__SUPABASE_URL__  || 'https://krmvgrfwoanzajlsvjvm.supabase.co';
  const SUPABASE_ANON = window.__SUPABASE_ANON__ || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtybXZncmZ3b2FuemFqbHN2anZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMzY0MDcsImV4cCI6MjA5MTcxMjQwN30.1x4_zxPzCXONYBvH7wbkLiUPr-kq_T0KCdG3EhruzVQ';
  const SHELL_PATH    = '/agendamento-cliente.html';
  const ENGINE_PATH   = '/agendamento-cliente.js';
  const NOTIFY_PATH   = '/notifyWhatsapp.js';
  const CONFIG_PATH   = '/config.js';

  // ---------- Util ----------
  const qs    = (s, r = document) => r.querySelector(s);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function showInvalid(msg) {
    const boot = qs('#aw-boot'); if (boot) boot.remove();
    const box = qs('#aw-invalid'); if (box) box.style.display = 'flex';
    if (msg) { const p = box && box.querySelector('p'); if (p) p.textContent = msg; }
  }
  const tokenFromUrl = () => new URL(location.href).searchParams.get('t');

  function waitFor(selector, { timeout = 8000, interval = 80, predicate } = {}) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        const el = qs(selector);
        if (el && (!predicate || predicate(el))) return resolve(el);
        if (Date.now() - t0 > timeout) return resolve(null);
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  // ---------- Telefone (normalização BR — remove country code 55) ----------
  /**
   * Recebe qualquer entrada (+55 48 9120-3769, 5548912037 69, (48) 9120-3769, etc.)
   * e devolve apenas dígitos BR locais (DDD + número), sem o country code.
   *  - Se vierem 12+ dígitos começando por "55", remove o "55".
   *  - Se vierem 13 dígitos começando por "550", remove o "55" também (alguns gateways).
   *  - No fim, garante no máximo 11 dígitos (DDD de 2 + 9 do celular).
   */
  function normalizePhoneBR(raw) {
    let d = String(raw || '').replace(/\D+/g, '');
    if (!d) return '';
    // Remove country code 55 quando presente
    if (d.length >= 12 && d.startsWith('55')) {
      d = d.slice(2);
    }
    // Garante no máximo 11 dígitos locais
    if (d.length > 11) d = d.slice(-11);
    return d;
  }

  /**
   * Formata dígitos BR locais (10 ou 11) na máscara visual.
   *  - 11 dígitos: (DD) 9XXXX-XXXX
   *  - 10 dígitos: (DD) XXXX-XXXX
   *  - Caso contrário: devolve só os dígitos (parcial).
   */
  function formatPhoneBR(input) {
    const d = normalizePhoneBR(input);
    if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
    return d;
  }

  // ---------- Supabase singleton ----------
  function getSupabase() {
    if (window.__SB_CLIENT__) return window.__SB_CLIENT__;
    if (!window.supabase || !window.supabase.createClient) {
      err('SDK supabase-js v2 ausente.'); return null;
    }
    window.__SB_CLIENT__ = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'wa-magic' },
    });
    return window.__SB_CLIENT__;
  }

  // ---------- Sessão ----------
  async function resolveSession(token) {
    const sb = getSupabase(); if (!sb) throw new Error('supabase-client');
    const { data, error } = await sb.rpc('wa_session_lookup', { p_token: token });
    if (error) { err('wa_session_lookup', error); throw error; }
    if (!data) throw new Error('sessao-invalida');
    const raw = Array.isArray(data) ? data[0] : data;
    if (!raw) throw new Error('sessao-invalida');

    const session = {
      tenant_id:    raw.tenant_id,
      tenant_slug:  raw.tenant_slug,
      phone_e164:   raw.telefone || raw.phone_e164,
      push_name:    raw.nome || raw.push_name,
      expires_at:   raw.expires_at,
    };
    if (!session.tenant_id || !session.phone_e164) throw new Error('sessao-incompleta');

    const url = new URL(window.location.href);
    url.searchParams.set('tenantId', session.tenant_id);
    window.history.replaceState({}, '', url);
    return session;
  }

  // ---------- Injeção do shell legado ----------
  async function injectClientShell() {
    const res = await fetch(SHELL_PATH, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('shell-fetch-' + res.status);
    const html = await res.text();
    const doc  = new DOMParser().parseFromString(html, 'text/html');

    for (const a of Array.from(doc.documentElement.attributes)) {
      if (a.name === 'data-magic-link') continue;
      if (!document.documentElement.hasAttribute(a.name))
        document.documentElement.setAttribute(a.name, a.value);
    }
    document.documentElement.setAttribute('data-magic-link', '1');

    for (const a of Array.from(doc.body.attributes)) {
      document.body.setAttribute(a.name, a.value);
    }

    doc.head.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      document.head.appendChild(node.cloneNode(true));
    });

    const styleHide = document.createElement('style');
    styleHide.textContent = `
      html[data-magic-link="1"] [data-step-content="0"],
      html[data-magic-link="1"] [data-step="0"],
      html[data-magic-link="1"] #ac-modal-cadastro { display: none !important; visibility: hidden !important; }

      /* Bloqueia interação com a tela de serviços enquanto o modal de
         confirmação está ativo (evita cliques acidentais). */
      html[data-wa-confirm="1"] body > *:not(#wa-confirm-root):not(#aw-boot):not(#aw-invalid) {
        pointer-events: none !important;
        user-select: none !important;
      }
    `;
    document.head.appendChild(styleHide);

    const oldBoot = qs('#ac-boot-loader'); if (oldBoot) oldBoot.remove();
    const keep = [qs('#aw-boot'), qs('#aw-invalid')].filter(Boolean).map(n => n.cloneNode(true));
    document.body.innerHTML = doc.body.innerHTML;
    keep.forEach(n => document.body.appendChild(n));
  }

  // ---------- Carregar scripts em ordem (config -> notifyWhatsapp -> engine) ----------
  function loadScript(src, { optional = false } = {}) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false; // preserva ordem de execução
      s.onload  = () => resolve(s);
      s.onerror = (e) => {
        if (optional) { warn('script opcional falhou:', src); resolve(null); }
        else { err('falha ao carregar', src, e); reject(new Error('load:' + src)); }
      };
      document.body.appendChild(s);
    });
  }

  async function loadEngine() {
    // IMPORTANTE: replica EXATAMENTE a ordem de carregamento do agendamento-cliente.html
    // legado, para que window.triggerWhatsAppNotification exista quando criarAgendamento()
    // for chamado. Sem isso, o profissional NÃO recebe a notificação WhatsApp pos-agendamento.
    await loadScript(CONFIG_PATH + '?v=wa7', { optional: true });
    await loadScript(NOTIFY_PATH + '?v=wa7', { optional: true });
    if (typeof window.triggerWhatsAppNotification !== 'function') {
      warn('triggerWhatsAppNotification ausente após carregar notifyWhatsapp.js — notificação ao profissional pode falhar');
    } else {
      log('notifyWhatsapp.js carregado — pipeline notify-whatsapp ativo');
    }
    await loadScript(ENGINE_PATH + '?v=wa7');
  }

  // ---------- Helpers de UI ----------
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
  }
  async function typePhone(el, digits) {
    el.focus();
    setNativeValue(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    for (const ch of digits) {
      setNativeValue(el, (el.value || '') + ch);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(8);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }
  function setText(el, value) {
    if (!el) return;
    setNativeValue(el, value);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }
  function clickReal(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
    el.click();
    return true;
  }
  async function waitContinueIdle(timeout = 12000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const btn = qs('#ac-id-continuar');
      if (btn && !btn.disabled) return btn;
      await sleep(100);
    }
    return null;
  }

  // ---------- Modal de confirmação ----------
  function injectConfirmStyles() {
    if (qs('#wa-confirm-styles')) return;
    const st = document.createElement('style');
    st.id = 'wa-confirm-styles';
    st.textContent = `
      #wa-confirm-root { position: fixed; inset: 0; z-index: 2147483000;
        display: flex; align-items: center; justify-content: center;
        background: rgba(15,15,18,.55); backdrop-filter: blur(4px);
        font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        animation: wa-fade-in .18s ease-out; }
      @keyframes wa-fade-in { from { opacity: 0 } to { opacity: 1 } }
      #wa-confirm-card { width: min(440px, calc(100vw - 32px));
        background: #fff; color: #111; border-radius: 18px; padding: 24px;
        box-shadow: 0 20px 60px rgba(0,0,0,.35); position: relative;
        animation: wa-pop-in .22s cubic-bezier(.2,.8,.2,1.05); }
      @keyframes wa-pop-in { from { transform: translateY(8px) scale(.98); opacity: 0 } to { transform: none; opacity: 1 } }
      #wa-confirm-card h2 { margin: 0 0 18px; font-size: 18px; font-weight: 700; text-align: center; color: #111; }
      .wa-row { display: flex; align-items: center; gap: 14px; padding: 10px 0; }
      .wa-ico { width: 40px; height: 40px; border-radius: 50%;
        background: #eef2ff; color: #4f46e5; display: flex; align-items: center;
        justify-content: center; flex: 0 0 40px; }
      .wa-ico svg { width: 22px; height: 22px; }
      .wa-lbl { font-size: 13px; color: #6b7280; line-height: 1.2; }
      .wa-val { font-size: 17px; font-weight: 700; color: #111; line-height: 1.3; }
      .wa-help { display: flex; gap: 10px; align-items: flex-start;
        background: #f3f4f6; border-radius: 10px; padding: 12px;
        font-size: 13px; color: #4b5563; margin: 14px 0 18px; }
      .wa-help svg { width: 18px; height: 18px; flex: 0 0 18px; margin-top: 1px; color: #6b7280; }
      .wa-actions { display: flex; flex-direction: column; gap: 10px; }
      .wa-btn { width: 100%; padding: 13px 16px; border-radius: 10px;
        font-size: 15px; font-weight: 600; border: 0; cursor: pointer;
        transition: filter .15s ease, transform .05s ease; }
      .wa-btn:active { transform: translateY(1px); }
      .wa-btn-primary { background: #6d28d9; color: #fff; }
      .wa-btn-primary:hover { filter: brightness(1.05); }
      .wa-btn-secondary { background: #fff; color: #6d28d9; border: 1.5px solid #ddd6fe; }
      .wa-btn-secondary:hover { background: #faf5ff; }
      .wa-close { position: absolute; top: 14px; right: 14px; background: transparent;
        border: 0; cursor: pointer; color: #9ca3af; padding: 4px; line-height: 0; }
      .wa-back { position: absolute; top: 14px; left: 14px; background: transparent;
        border: 0; cursor: pointer; color: #9ca3af; padding: 4px; line-height: 0; }
      .wa-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
      .wa-field label { font-size: 13px; color: #374151; font-weight: 500; }
      .wa-field input { width: 100%; box-sizing: border-box; padding: 11px 12px;
        border: 1px solid #d1d5db; border-radius: 8px; font-size: 15px;
        background: #fff; color: #111; outline: none; }
      .wa-field input:focus { border-color: #6d28d9; box-shadow: 0 0 0 3px rgba(109,40,217,.15); }
    `;
    document.head.appendChild(st);
  }

  function buildConfirmHTML(name, phoneFormatted) {
    return `
      <div id="wa-confirm-card" role="dialog" aria-modal="true" aria-label="Confirme seus dados">
        <button class="wa-close" id="wa-close" aria-label="Fechar">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
        <h2>Confirme seus dados</h2>

        <div class="wa-row">
          <div class="wa-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg></div>
          <div>
            <div class="wa-lbl">Eu sou</div>
            <div class="wa-val" id="wa-name-val">${name || 'Cliente'}</div>
          </div>
        </div>

        <div class="wa-row">
          <div class="wa-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M11 18h2"/></svg></div>
          <div>
            <div class="wa-lbl">Meu telefone é</div>
            <div class="wa-val" id="wa-phone-val">${phoneFormatted}</div>
          </div>
        </div>

        <div class="wa-help">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          <span>Usaremos esses dados para identificar seus agendamentos.</span>
        </div>

        <div class="wa-actions">
          <button class="wa-btn wa-btn-secondary" id="wa-edit">Editar informações</button>
          <button class="wa-btn wa-btn-primary" id="wa-confirm">Confirmar e continuar</button>
        </div>
      </div>`;
  }

  function buildEditHTML(name, phoneFormatted) {
    return `
      <div id="wa-confirm-card" role="dialog" aria-modal="true" aria-label="Editar informações">
        <button class="wa-back" id="wa-back" aria-label="Voltar">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <button class="wa-close" id="wa-close" aria-label="Fechar">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
        <h2>Confirme seus dados</h2>

        <div class="wa-field">
          <label for="wa-name-input">Nome completo</label>
          <input id="wa-name-input" type="text" autocomplete="name" value="${(name || '').replace(/"/g,'&quot;')}" />
        </div>
        <div class="wa-field">
          <label for="wa-phone-input">Telefone</label>
          <input id="wa-phone-input" type="tel" inputmode="tel" autocomplete="tel" value="${phoneFormatted}" />
        </div>

        <div class="wa-help">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          <span>Usaremos esses dados para identificar seus agendamentos.</span>
        </div>

        <div class="wa-actions">
          <button class="wa-btn wa-btn-secondary" id="wa-cancel">Cancelar</button>
          <button class="wa-btn wa-btn-primary"   id="wa-save">Salvar e continuar</button>
        </div>
      </div>`;
  }

  function attachPhoneMask(input) {
    const fmt = (v) => {
      // Mascara progressiva, mas SEMPRE normalizando antes (remove 55 etc.)
      const d = normalizePhoneBR(v);
      if (d.length <= 2)  return d.length ? `(${d}` : '';
      if (d.length <= 6)  return `(${d.slice(0,2)}) ${d.slice(2)}`;
      if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
      return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
    };
    input.value = fmt(input.value);
    input.addEventListener('input', () => { input.value = fmt(input.value); });
  }

  /**
   * Mostra o modal de confirmação e resolve com { name, phoneDigits } finais.
   * Bloqueia interação com a tela de serviços até a confirmação.
   */
  function showConfirmModal(initialName, initialPhoneDigits) {
    return new Promise((resolve) => {
      injectConfirmStyles();
      document.documentElement.setAttribute('data-wa-confirm', '1');

      let root = qs('#wa-confirm-root');
      if (!root) {
        root = document.createElement('div');
        root.id = 'wa-confirm-root';
        document.body.appendChild(root);
      }

      let name  = (initialName || '').trim();
      let phone = normalizePhoneBR(initialPhoneDigits);

      const renderView = () => {
        root.innerHTML = buildConfirmHTML(name || ('Cliente ' + phone.slice(-4)), formatPhoneBR(phone));
        qs('#wa-edit').addEventListener('click', renderEdit);
        qs('#wa-confirm').addEventListener('click', confirm);
        qs('#wa-close').addEventListener('click', confirm);
      };
      const renderEdit = () => {
        root.innerHTML = buildEditHTML(name || ('Cliente ' + phone.slice(-4)), formatPhoneBR(phone));
        const nameInput  = qs('#wa-name-input');
        const phoneInput = qs('#wa-phone-input');
        attachPhoneMask(phoneInput);
        setTimeout(() => nameInput && nameInput.focus(), 30);
        qs('#wa-back').addEventListener('click', renderView);
        qs('#wa-cancel').addEventListener('click', renderView);
        qs('#wa-close').addEventListener('click', renderView);
        qs('#wa-save').addEventListener('click', () => {
          const newName  = (nameInput.value  || '').trim();
          const newPhone = normalizePhoneBR(phoneInput.value);
          if (!newName) { nameInput.focus(); return; }
          if (newPhone.length < 10) { phoneInput.focus(); return; }
          name  = newName;
          phone = newPhone;
          renderView();
        });
      };
      const confirm = () => {
        document.documentElement.removeAttribute('data-wa-confirm');
        root.remove();
        resolve({ name: (name || ('Cliente ' + phone.slice(-4))), phoneDigits: phone });
      };

      renderView();
    });
  }

  // ---------- Auto-identificação ----------
  async function autoIdentify(finalName, phoneDigits) {
    if (phoneDigits.length < 10) throw new Error('telefone-invalido');

    const idTel = await waitFor('#ac-id-tel', { timeout: 12000 });
    if (!idTel) { warn('STEP 0 não renderizou — motor pode já ter avançado'); return { route: 'unknown' }; }
    const idBtn = await waitFor('#ac-id-continuar', { timeout: 4000, predicate: el => !el.disabled });
    if (!idBtn) { warn('botão #ac-id-continuar não disponível'); return { route: 'unknown' }; }

    await typePhone(idTel, phoneDigits);
    await sleep(80);
    clickReal(idBtn);

    await waitContinueIdle(12000);
    await sleep(120);

    const found = qs('#ac-id-found');
    const cadModalEl = qs('#ac-modal-cadastro');
    const cadModalOpen = cadModalEl && !cadModalEl.hidden;

    if (found && !found.hidden && !cadModalOpen) {
      const seguir = await waitFor('#ac-id-seguir', { timeout: 3000 });
      if (seguir) { await sleep(80); clickReal(seguir); }
      return { route: 'existing' };
    }

    if (cadModalOpen || cadModalEl) {
      if (cadModalEl && cadModalEl.hidden) {
        await waitFor('#ac-modal-cadastro', { timeout: 2500, predicate: el => !el.hidden });
      }
      const cadNome = qs('#ac-cad-nome');
      const cadTel  = qs('#ac-cad-tel');
      const cadBtn  = qs('#ac-btn-cadastrar');
      if (!cadNome || !cadBtn) { warn('cadastro: campos ausentes'); return { route: 'new-failed' }; }

      setText(cadNome, finalName);
      if (cadTel && !cadTel.value) setText(cadTel, phoneDigits);

      await sleep(80);
      clickReal(cadBtn);

      const t0 = Date.now();
      while (Date.now() - t0 < 12000) {
        if (cadBtn.disabled === false &&
            (qs('#ac-modal-cadastro') ? qs('#ac-modal-cadastro').hidden : true)) break;
        await sleep(120);
      }
      await sleep(120);

      const seguir2 = await waitFor('#ac-id-seguir', { timeout: 4000 });
      if (seguir2) clickReal(seguir2);
      return { route: 'new' };
    }

    warn('estado inesperado pós-busca');
    return { route: 'unknown' };
  }

  // ---------- Update best-effort do cliente existente (se editado) ----------
  async function updateExistingClient(tenantId, phoneDigits, newName, newPhoneDigits) {
    try {
      const sb = getSupabase(); if (!sb) return;
      const patch = {};
      if (newName) patch.nome = newName;
      // Atualiza telefone também (se alterado pelo usuário).
      if (newPhoneDigits && newPhoneDigits !== phoneDigits) patch.telefone = newPhoneDigits;
      if (!Object.keys(patch).length) return;

      const candidates = [
        { table: 'clientes', phoneCol: 'telefone' },
        { table: 'clientes', phoneCol: 'phone' },
      ];
      for (const c of candidates) {
        const tryPatch = { ...patch };
        // Se a coluna de telefone for diferente, ajusta a chave
        if (c.phoneCol !== 'telefone' && tryPatch.telefone) {
          tryPatch[c.phoneCol] = tryPatch.telefone;
          delete tryPatch.telefone;
        }
        const { error } = await sb
          .from(c.table)
          .update(tryPatch)
          .eq('tenant_id', tenantId)
          .eq(c.phoneCol, phoneDigits);
        if (!error) { log('cliente atualizado em', c.table, c.phoneCol); return; }
      }
    } catch (_) { /* silencioso */ }
  }

  // ---------- Cleanup visual (loaders e overlays) ----------
  function removeLoaders() {
    ['#ac-boot-loader', '.ac-boot-loader', '.ac-loading-overlay', '#aw-boot'].forEach((sel) => {
      document.querySelectorAll(sel).forEach((n) => n.remove());
    });
    ['#ac-app', '.ac-app'].forEach((sel) => {
      document.querySelectorAll(sel).forEach((n) => {
        n.removeAttribute('hidden');
        if (n.style.display === 'none')      n.style.display = '';
        if (n.style.visibility === 'hidden') n.style.visibility = '';
      });
    });
    document.body.classList.remove('loading', 'is-loading', 'booting');
  }

  function finalizeUiCleanup() {
    [0, 400, 1200, 2500].forEach((t) => setTimeout(removeLoaders, t));
  }

  /**
   * Aguarda a tela de SERVIÇOS (Step 2) realmente aparecer e ficar visível.
   * Tenta vários seletores comuns do motor legado e cai em fallback de tempo.
   */
  async function waitForServicesRendered(timeout = 12000) {
    const isVisible = (el) => {
      if (!el) return false;
      if (el.hidden) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const SERVICE_SELECTORS = [
      '#ac-servicos',
      '[data-step-content="2"]',
      '[data-step="2"]',
      '#ac-step-servicos',
      '.ac-servicos',
      '[data-ac-step="services"]',
      '.ac-service-card',
      '.ac-servico-item',
    ];

    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      // Considera pronto se QUALQUER seletor de serviço estiver visível
      // E nenhum loader visível estiver ativo.
      const someServiceVisible = SERVICE_SELECTORS.some((sel) => {
        const el = qs(sel);
        return isVisible(el);
      });
      const loaderActive = !!qs('#ac-boot-loader, .ac-boot-loader, .ac-loading-overlay');
      if (someServiceVisible && !loaderActive) return true;
      await sleep(120);
    }
    warn('waitForServicesRendered: timeout — seguindo mesmo assim');
    return false;
  }

  // ---------- Main ----------
  async function boot() {
    try {
      const token = tokenFromUrl();
      if (!token) { showInvalid('Link sem token.'); return; }

      const session = await resolveSession(token);
      log('sessão OK', { tenant: session.tenant_id, phone: session.phone_e164 });

      // Normalização: remove country code 55 já aqui.
      const initialPhone = normalizePhoneBR(session.phone_e164);
      const initialName  = (session.push_name || '').trim();

      window.__AC_PREFILL__ = {
        tenant_id: session.tenant_id,
        tenant_slug: session.tenant_slug,
        telefone: initialPhone, // já normalizado (sem 55)
        nome: initialName,
      };
      window.__AC_HIDE_IDENTITY_STEP__ = true;

      await injectClientShell();
      await loadEngine();

      // 1) Auto-identifica PRIMEIRO usando os dados do WhatsApp.
      //    Isso faz o motor avançar para a tela de serviços (Step 2).
      const result = await autoIdentify(initialName, initialPhone);
      log('autoIdentify:', result);

      // 2) Remove loaders e aguarda a tela de serviços ficar visível.
      removeLoaders();
      await waitForServicesRendered(12000);
      removeLoaders();
      // Pequeno respiro para transições/fade do shell legado terminarem.
      await sleep(180);

      // 3) AGORA sim, abre o modal por cima da UI já renderizada.
      const confirmed = await showConfirmModal(initialName, initialPhone);
      log('confirmado pelo cliente:', confirmed);

      const wasNameEdited  = (confirmed.name || '').trim() !==
        (initialName || ('Cliente ' + initialPhone.slice(-4)));
      const wasPhoneEdited = confirmed.phoneDigits !== initialPhone;

      // 4) Se algo foi editado, atualiza o MESMO cadastro (best-effort).
      if (wasNameEdited || wasPhoneEdited) {
        await updateExistingClient(
          session.tenant_id,
          initialPhone,
          wasNameEdited ? confirmed.name : null,
          wasPhoneEdited ? confirmed.phoneDigits : null
        );
      }

      finalizeUiCleanup();

      try {
        const sb = getSupabase();
        if (sb) sb.rpc('wa_session_mark_used', { p_token: token }).then(() => {}, () => {});
      } catch (_) {}

      log('FIM — fluxo mágico pronto');
    } catch (e) {
      err('boot falhou:', e);
      const msg = (e && e.message) || '';
      if (msg.includes('sessao')) showInvalid('Sessão inválida ou expirada. Peça um novo link no WhatsApp.');
      else showInvalid('Não foi possível iniciar seu agendamento. Tente novamente em instantes.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
