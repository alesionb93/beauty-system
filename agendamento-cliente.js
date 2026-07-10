/* ============================================================
   AGENDAMENTO-CLIENTE v4
   - Lê tenantId do PATH (/agendar/{id}) E da querystring
   - Consulta tabelas reais do schema (sem RPCs/views inexistentes)
   - Valida feature flag tenant_settings.permitir_agendamento_cliente
   - Timeout em todas as chamadas Supabase (resolve loading infinito)
   - Fallback mock APENAS em modo DEMO real (sem Supabase configurado)
   ============================================================ */

(function () {
  'use strict';

  /* Normaliza nome para comparação: trim, colapsa espaços, lower, remove acentos */
  function normalizeName(n) {
    return String(n || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /* ============================================================
     TEMA DINÂMICO POR TENANT (agenda_themes)
     ============================================================ */
  function _hexToRgbStr(hex) {
    if (!hex) return null;
    var v = String(hex).trim().replace('#','');
    if (v.length === 3) v = v.split('').map(function(c){return c+c;}).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(v)) return null;
    var n = parseInt(v, 16);
    return ((n>>16)&255)+','+((n>>8)&255)+','+(n&255);
  }
  function _rgba(hex, a) { var r = _hexToRgbStr(hex); return r ? 'rgba('+r+','+a+')' : null; }
  function _shadeHex(hex, pct) {
    var rgb = _hexToRgbStr(hex); if (!rgb) return hex;
    var p = rgb.split(',').map(Number);
    var f = pct < 0 ? 0 : 255, t = Math.abs(pct)/100;
    var out = p.map(function(c){ return Math.round((f - c) * t + c); });
    return '#' + out.map(function(c){ return ('0'+c.toString(16)).slice(-2); }).join('');
  }
  function readLocalTenantTheme(tenantId) {
    try {
      var stored = localStorage.getItem('agenda_theme:' + tenantId);
      if (!stored) return null;
      var parsed = JSON.parse(stored);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
      console.warn('[ac] localStorage fallback falhou:', e);
      return null;
    }
  }

  function mergeThemeRecords(primary, fallback) {
    if (!primary && !fallback) return null;
    if (!primary) return fallback;
    if (!fallback) return primary;
    var merged = Object.assign({}, fallback, primary);
    if (fallback.booking_theme || primary.booking_theme) {
      merged.booking_theme = Object.assign({}, fallback.booking_theme || {}, primary.booking_theme || {});
    }
    return merged;
  }

  function chooseNewestTheme(serverTheme, localTheme) {
    if (!serverTheme) return localTheme || null;
    if (!localTheme) return serverTheme;
    var serverTime = Date.parse(serverTheme.updated_at || '') || 0;
    var localTime = Date.parse(localTheme.updated_at || '') || 0;
    if (localTime > serverTime) {
      console.log('[ac] tema local é mais recente; mesclando sobre tema do banco');
      return mergeThemeRecords(localTheme, serverTheme);
    }
    return mergeThemeRecords(serverTheme, localTheme);
  }

  async function requestThemeByBroadcast(tenantId) {
    try {
      return await new Promise(function(resolve) {
        if (typeof BroadcastChannel === 'undefined') { resolve(null); return; }
        var bc = new BroadcastChannel('beauty-theme-sync');
        var timer = setTimeout(function() { try { bc.close(); } catch(e){} resolve(null); }, 1500);
        bc.onmessage = function(ev) {
          if (ev.data && ev.data.type === 'theme-response' && ev.data.tenantId === tenantId) {
            clearTimeout(timer);
            try { bc.close(); } catch(e){}
            resolve(ev.data.theme || null);
          }
        };
        bc.postMessage({ type: 'theme-request', tenantId: tenantId });
      });
    } catch(e) { return null; }
  }

  async function loadTenantTheme(tenantId) {
    if (!tenantId) return null;
    var sb = initSupabase();
    var localTheme = readLocalTenantTheme(tenantId);
    var serverTheme = null;

    // ── Tentativa 1: Supabase (RPC pública) ──
    if (sb) {
      try {
        var rpc = await withTimeout(
          sb.rpc('get_public_agenda_theme', { _tenant_id: tenantId }),
          4000, 'rpc:get_public_agenda_theme'
        );
        if (!rpc.error && rpc.data) serverTheme = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
      } catch (e) {}

      // ── Tentativa 2: Supabase (SELECT direto) ──
      if (!serverTheme) {
        try {
          var resp = await withTimeout(
            sb.from('agenda_themes').select('*').eq('tenant_id', tenantId).maybeSingle(),
            4000, 'agenda_themes'
          );
          if (!resp.error && resp.data) serverTheme = resp.data;
        } catch (e) {}
      }
    }

    if (serverTheme || localTheme) {
      if (localTheme) console.log('[ac] tema local disponível para completar campos ausentes');
      return chooseNewestTheme(serverTheme, localTheme);
    }

    // ── Tentativa 3: BroadcastChannel pedido ao app principal ──
    // (útil se agenda.html está aberta em outra aba)
    var themeFromBroadcast = await requestThemeByBroadcast(tenantId);
    if (themeFromBroadcast) {
      console.log('[ac] tema recebido via BroadcastChannel');
      return themeFromBroadcast;
    }

    console.warn('[ac] loadTenantTheme: nenhuma fonte de tema disponível para tenantId=' + tenantId);
    return null;
  }
  var AC_BOOKING_DEFAULTS = {
    page_bg: '#F8F8F6', text: '#1A1A2E', title: '#1A1A2E', subtitle: '#6B7280', border: '#E5E7EB',
    btn_primary_bg: '#6C3AED', btn_primary_text: '#FFFFFF', btn_primary_hover: '#5B21B6',
    btn_secondary_bg: '#FFFFFF', btn_secondary_text: '#1A1A2E',
    step_active: '#6C3AED', step_done: '#16A34A', step_inactive: '#E5E7EB', step_text: '#1A1A2E', stepper_line: '#D1D5DB',
    card_bg: '#FFFFFF', card_hover: '#F0F0EE', card_title: '#1A1A2E', card_desc: '#6B7280',
    card_price: '#6C3AED', card_border: '#E5E7EB',
    input_bg: '#F9FAFB', input_text: '#1A1A2E', input_placeholder: '#9CA3AF',
    input_border: '#E5E7EB', input_focus: '#6C3AED',
    cal_bg: '#FFFFFF', cal_day: '#1A1A2E', cal_day_sel_bg: '#6C3AED', cal_day_sel_text: '#FFFFFF',
    cal_slot: '#1A1A2E', cal_slot_sel: '#6C3AED',
    modal_bg: '#FFFFFF', modal_text: '#1A1A2E', modal_highlight: '#6C3AED',
    success_icon: '#16A34A', success_text: '#1A1A2E', success_btn: '#6C3AED'
  };

  function normalizeBookingTheme(theme) {
    theme = theme || {};
    var primary = theme.gold || theme.primary_color || AC_BOOKING_DEFAULTS.btn_primary_bg;
    var text = theme.text_color || AC_BOOKING_DEFAULTS.text;
    var border = theme.cal_border || AC_BOOKING_DEFAULTS.border;
    var derived = {
      page_bg: theme.bg || theme.background_color || AC_BOOKING_DEFAULTS.page_bg,
      text: text,
      title: theme.title || theme.page_title_color || text,
      subtitle: theme.text_muted_color || theme.cal_text || AC_BOOKING_DEFAULTS.subtitle,
      border: border,
      btn_primary_bg: primary,
      btn_primary_text: theme.btn_primary_text || AC_BOOKING_DEFAULTS.btn_primary_text,
      btn_primary_hover: theme.gold_dark || _shadeHex(primary, -15),
      btn_secondary_bg: theme.card || theme.card_background || AC_BOOKING_DEFAULTS.btn_secondary_bg,
      btn_secondary_text: text,
      step_active: primary,
      step_done: theme.step_done || theme.stepper_done_color || AC_BOOKING_DEFAULTS.step_done,
      stepper_line: theme.stepper_line || theme.stepper_line_color || AC_BOOKING_DEFAULTS.stepper_line,
      step_inactive: border,
      step_text: text,
      card_bg: theme.card || theme.card_background || AC_BOOKING_DEFAULTS.card_bg,
      card_hover: theme.card_hover || AC_BOOKING_DEFAULTS.card_hover,
      card_title: text,
      card_desc: theme.text_muted_color || theme.cal_text || AC_BOOKING_DEFAULTS.card_desc,
      card_price: primary,
      card_border: border,
      input_bg: theme.input_bg || AC_BOOKING_DEFAULTS.input_bg,
      input_text: text,
      input_placeholder: theme.text_muted_color || AC_BOOKING_DEFAULTS.input_placeholder,
      input_border: border,
      input_focus: primary,
      cal_bg: theme.card || AC_BOOKING_DEFAULTS.cal_bg,
      cal_day: theme.cal_text || text,
      cal_day_sel_bg: theme.cal_selected_bg || primary,
      cal_day_sel_text: theme.cal_selected_text || AC_BOOKING_DEFAULTS.cal_day_sel_text,
      cal_slot: text,
      cal_slot_sel: primary,
      modal_bg: theme.modal_bg || theme.card || AC_BOOKING_DEFAULTS.modal_bg,
      modal_text: text,
      modal_highlight: primary,
      success_icon: AC_BOOKING_DEFAULTS.success_icon,
      success_text: text,
      success_btn: primary
    };
    return Object.assign({}, AC_BOOKING_DEFAULTS, derived, (theme.booking_theme && typeof theme.booking_theme === 'object') ? theme.booking_theme : {});
  }

  function setThemeVar(root, name, value) {
    if (value !== undefined && value !== null && value !== '') root.style.setProperty(name, value);
  }

  function ensureBookingThemeOverrides() {
    if (document.getElementById('ac-booking-overrides')) return;
    var st = document.createElement('style');
    st.id = 'ac-booking-overrides';
    st.textContent = [
      '/* Booking theme overrides — mantém o link externo 1:1 com o preview */',
      'body, .ac-app { background: var(--ac-bg) !important; color: var(--ac-text) !important; font-family: var(--ac-font) !important; }',
      '.ac-header, .ac-stepper { background: var(--ac-surface) !important; border-color: var(--ac-border) !important; }',
      '.ac-section-head h1, .ac-section-head h2, .ac-cal-month { color: var(--ac-title) !important; }',
      '.ac-section-sub, .ac-modal-sub, .ac-empty, .ac-period-title, .ac-prof-tag, .ac-servico-desc, .ac-resume-label, .ac-identify-greet small { color: var(--ac-text-muted) !important; }',
      '.ac-back, .ac-search i, .ac-resume-label i { color: var(--ac-text-dim) !important; }',
      '.ac-search input, .ac-field input, .ac-identify-card input[type="tel"], .ac-identify-card input[type="text"], .ac-identify-card input[type="date"] { background: var(--ac-surface-2) !important; color: var(--ac-input-text) !important; border-color: var(--ac-input-border) !important; }',
      '.ac-search input::placeholder, .ac-field input::placeholder, .ac-identify-card input::placeholder { color: var(--ac-input-placeholder) !important; }',
      '.ac-search input:focus, .ac-field input:focus, .ac-identify-card input:focus { border-color: var(--ac-input-focus) !important; box-shadow: 0 0 0 3px var(--ac-primary-soft) !important; }',
      '.ac-servico-card, .ac-prof-card, .ac-calendar-wrap, .ac-period, .ac-identify-card, .ac-modal-resume, .ac-upsell-item { background: var(--ac-surface) !important; border-color: var(--ac-card-border) !important; }',
      '.ac-servico-card:hover, .ac-prof-card:hover, .ac-upsell-item:hover { background: var(--ac-surface-3) !important; border-color: var(--ac-primary-border) !important; }',
      '.ac-servico-nome, .ac-prof-nome, .ac-identify-greet strong, .ac-pacote-title { color: var(--ac-card-title) !important; }',
      '.ac-servico-meta, .ac-pacote-sub { color: var(--ac-card-desc) !important; }',
      '.ac-servico-meta .price, .ac-upsell-item-meta .price, .ac-resume-row.total .ac-resume-value, .ac-price-highlight { color: var(--ac-price) !important; }',
      '.ac-btn-primary, .ac-servico-action .ac-btn-agendar, .ac-upsell-item-add { background: var(--ac-primary) !important; color: var(--ac-btn-primary-text) !important; border-color: var(--ac-primary) !important; }',
      '.ac-btn-primary:hover, .ac-servico-action .ac-btn-agendar:hover, .ac-upsell-item-add:hover { background: var(--ac-primary-hover) !important; border-color: var(--ac-primary-hover) !important; }',
      '.ac-btn-ghost { background: var(--ac-btn-secondary-bg) !important; color: var(--ac-btn-secondary-text) !important; border-color: var(--ac-border) !important; }',
      '.ac-btn-ghost:hover, .ac-modal-close:hover, .ac-cal-nav:hover { background: var(--ac-surface-3) !important; }',
      '.ac-step { color: var(--ac-step-text) !important; }',
      '.ac-step:not(.active):not(.completed) .ac-step-num { background: var(--ac-step-inactive) !important; border-color: var(--ac-step-inactive) !important; color: var(--ac-step-text) !important; }',
      '.ac-step.active .ac-step-num { background: var(--ac-step-active) !important; border-color: var(--ac-step-active) !important; color: var(--ac-btn-primary-text) !important; }',
      '.ac-step.completed .ac-step-num { background: var(--ac-step-done) !important; border-color: var(--ac-step-done) !important; color: var(--ac-btn-primary-text) !important; }',
      '.ac-step-divider { background: var(--ac-step-inactive) !important; }',
      '.ac-calendar-wrap, .ac-calendar { background: var(--ac-cal-bg) !important; }',
      '.ac-cal-day { color: var(--ac-cal-day) !important; border-color: var(--ac-border) !important; }',
      '.ac-cal-day .num { color: var(--ac-cal-day) !important; }',
      '.ac-cal-day .dow { color: var(--ac-text-muted) !important; }',
      '.ac-cal-day.today .num { color: var(--ac-cal-slot-sel) !important; }',
      '.ac-cal-day.selected { background: var(--ac-cal-day-sel-bg) !important; border-color: var(--ac-cal-day-sel-bg) !important; }',
      '.ac-cal-day.selected .dow, .ac-cal-day.selected .num { color: var(--ac-cal-day-sel-text) !important; }',
      '.ac-slot { color: var(--ac-cal-slot) !important; border-color: var(--ac-border) !important; background: var(--ac-surface-2) !important; }',
      '.ac-slot:hover { background: var(--ac-cal-slot-sel) !important; color: var(--ac-btn-primary-text) !important; border-color: var(--ac-cal-slot-sel) !important; }',
      '.ac-modal-card { background: var(--ac-modal-bg) !important; color: var(--ac-modal-text) !important; border-color: var(--ac-border) !important; }',
      '.ac-modal-card h3, .ac-modal-card .ac-resume-value, .ac-modal-card label, .ac-modal-card span { color: var(--ac-modal-text) !important; }',
      '.ac-modal-icon { background: var(--ac-primary-soft) !important; border-color: var(--ac-primary-border) !important; color: var(--ac-modal-highlight) !important; }',
      '.ac-modal .ac-highlight, .ac-pacote-box .ac-pacote-title i { color: var(--ac-modal-highlight) !important; }',
      '.ac-modal-close, .ac-cal-nav { background: var(--ac-surface-2) !important; color: var(--ac-text-muted) !important; border-color: var(--ac-border) !important; }',
      '.ac-success-icon { background: var(--ac-success-icon) !important; color: var(--ac-btn-primary-text) !important; }',
      '.ac-modal-card.success h3, .ac-modal-card.success .ac-modal-sub, #ac-success-msg { color: var(--ac-success-text) !important; }',
      '#ac-btn-novo { background: var(--ac-success-btn) !important; color: var(--ac-btn-primary-text) !important; }',
      '.ac-toast.success { border-color: var(--ac-success-icon) !important; }',
      '.ac-toast.success::before, .ac-identify-greet i { color: var(--ac-success-icon) !important; }',
      '.ac-pacote-box { background: var(--ac-primary-soft) !important; border-color: var(--ac-primary-border) !important; }',
      '.ac-logo, .ac-prof-avatar { background: linear-gradient(135deg, var(--ac-primary), var(--ac-primary-hover)) !important; color: var(--ac-btn-primary-text) !important; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function applyTenantTheme(theme) {
    if (!theme) return;
    var root = document.documentElement;
    var bk = normalizeBookingTheme(theme);
    var primary = bk.btn_primary_bg || theme.gold || AC_BOOKING_DEFAULTS.btn_primary_bg;
    var primaryHover = bk.btn_primary_hover || _shadeHex(primary, -15);
    var primaryLight = theme.gold_light || _shadeHex(primary, 18);
    var primarySoft = _rgba(primary, 0.08) || 'rgba(108,58,237,0.08)';
    var primaryBorder = _rgba(primary, 0.20) || 'rgba(108,58,237,0.20)';

    setThemeVar(root, '--ac-bg', bk.page_bg);
    setThemeVar(root, '--ac-text', bk.text);
    setThemeVar(root, '--ac-title', bk.title);
    setThemeVar(root, '--ac-text-muted', bk.subtitle);
    setThemeVar(root, '--ac-text-dim', bk.input_placeholder);
    setThemeVar(root, '--ac-border', bk.border);
    setThemeVar(root, '--ac-border-strong', bk.card_border || bk.border);

    setThemeVar(root, '--ac-primary', primary);
    setThemeVar(root, '--ac-primary-hover', primaryHover);
    setThemeVar(root, '--ac-primary-light', primaryLight);
    setThemeVar(root, '--ac-primary-soft', primarySoft);
    setThemeVar(root, '--ac-primary-border', primaryBorder);
    setThemeVar(root, '--ac-accent', primary);
    setThemeVar(root, '--ac-accent-hover', primaryHover);
    setThemeVar(root, '--ac-success', bk.success_icon);

    setThemeVar(root, '--ac-surface', bk.card_bg);
    setThemeVar(root, '--ac-surface-2', bk.input_bg);
    setThemeVar(root, '--ac-surface-3', bk.card_hover);
    setThemeVar(root, '--ac-card-bg', bk.card_bg);
    setThemeVar(root, '--ac-card-hover', bk.card_hover);
    setThemeVar(root, '--ac-card-border', bk.card_border || bk.border);
    setThemeVar(root, '--ac-card-title', bk.card_title);
    setThemeVar(root, '--ac-card-desc', bk.card_desc);
    setThemeVar(root, '--ac-price', bk.card_price);

    setThemeVar(root, '--ac-btn-primary-text', bk.btn_primary_text);
    setThemeVar(root, '--ac-btn-secondary-bg', bk.btn_secondary_bg);
    setThemeVar(root, '--ac-btn-secondary-text', bk.btn_secondary_text);

    setThemeVar(root, '--ac-step-active', bk.step_active);
    setThemeVar(root, '--ac-step-done', bk.step_done);
    setThemeVar(root, '--ac-step-inactive', bk.step_inactive);
    setThemeVar(root, '--ac-step-text', bk.step_text);
    setThemeVar(root, '--ac-step-line', bk.stepper_line);

    setThemeVar(root, '--ac-input-bg', bk.input_bg);
    setThemeVar(root, '--ac-input-text', bk.input_text);
    setThemeVar(root, '--ac-input-placeholder', bk.input_placeholder);
    setThemeVar(root, '--ac-input-border', bk.input_border);
    setThemeVar(root, '--ac-input-focus', bk.input_focus);

    setThemeVar(root, '--ac-cal-bg', bk.cal_bg);
    setThemeVar(root, '--ac-cal-day', bk.cal_day);
    setThemeVar(root, '--ac-cal-day-sel-bg', bk.cal_day_sel_bg);
    setThemeVar(root, '--ac-cal-day-sel-text', bk.cal_day_sel_text);
    setThemeVar(root, '--ac-cal-slot', bk.cal_slot);
    setThemeVar(root, '--ac-cal-slot-sel', bk.cal_slot_sel);

    setThemeVar(root, '--ac-modal-bg', bk.modal_bg);
    setThemeVar(root, '--ac-modal-text', bk.modal_text);
    setThemeVar(root, '--ac-modal-highlight', bk.modal_highlight);
    setThemeVar(root, '--ac-success-icon', bk.success_icon);
    setThemeVar(root, '--ac-success-text', bk.success_text);
    setThemeVar(root, '--ac-success-btn', bk.success_btn);

    if (theme.sidebar_bg) setThemeVar(root, '--ac-sidebar-bg', theme.sidebar_bg);
    if (theme.font) setThemeVar(root, '--ac-font', theme.font + ', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');

    ensureBookingThemeOverrides();
    console.log('[ac] tema aplicado com booking_theme completo:', bk);
  }
  window.__acApplyTenantTheme = applyTenantTheme;
  window.__acLoadTenantTheme  = loadTenantTheme;


  /* Busca bloqueios do tenant para a data e profissionais informados,
     convertendo cada bloqueio em uma "ocupação" (mesmo formato dos agendamentos).
     Se a tabela não existir ainda no banco, retorna array vazio (graceful). */
  async function fetchBloqueiosClienteAsOcupacoes(sb, tenantId, dataISO, profissionalIds) {
    if (!sb || !tenantId || !dataISO || !profissionalIds || !profissionalIds.length) return [];

    function toOcup(rows) {
      return (rows || []).map(function(b){
        var p1 = String(b.hora_inicio||'00:00').split(':');
        var p2 = String(b.hora_fim||'00:00').split(':');
        var ini = parseInt(p1[0],10)*60 + parseInt(p1[1]||'0',10);
        var fim = parseInt(p2[0],10)*60 + parseInt(p2[1]||'0',10);
        var dur = Math.max(fim - ini, 1);
        return {
          profissional_id: b.profissional_id,
          hora: String(b.hora_inicio||'').slice(0,5),
          duracao_total: dur
        };
      });
    }

    // 1) Caminho preferido: RPC pública (anon-friendly, SECURITY DEFINER).
    //    Necessário pois RLS de `agenda_bloqueios` bloqueia leitura anônima.
    try {
      var rpc = await sb.rpc('get_public_agenda_bloqueios', {
        _tenant_id: tenantId,
        _data: dataISO,
        _profissional_ids: profissionalIds
      });
      if (!rpc.error && Array.isArray(rpc.data)) {
        return toOcup(rpc.data);
      }
      if (rpc.error) {
        console.warn('[ac] RPC bloqueios indisponivel, tentando SELECT:', rpc.error.message);
      }
    } catch (e) {
      console.warn('[ac] RPC bloqueios erro:', e && e.message);
    }

    // 2) Fallback: SELECT direto (funciona quando a sessao tem permissao).
    try {
      var resp = await sb
        .from('agenda_bloqueios')
        .select('profissional_id, hora_inicio, hora_fim')
        .eq('tenant_id', tenantId)
        .eq('data', dataISO)
        .in('profissional_id', profissionalIds);
      if (resp.error) {
        console.warn('[ac] bloqueios indisponiveis:', resp.error.message);
        return [];
      }
      return toOcup(resp.data);
    } catch(e) {
      console.warn('[ac] fetchBloqueiosClienteAsOcupacoes erro:', e && e.message);
      return [];
    }
  }

  /* ============================================================
     0. UTILS
     ============================================================ */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function brl(n) { return 'R$ ' + Number(n || 0).toFixed(2).replace('.', ','); }
  function formatDateBR(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function formatDuracao(min) {
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return h + 'h' + (m ? pad(m) : '');
  }
  function avatarInitials(nome) {
    var parts = String(nome || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }
  function todayISO(offset) {
    var d = new Date(); d.setDate(d.getDate() + (offset || 0));
    // Usa data LOCAL (não UTC) para evitar problemas de timezone à noite
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }

  /**
   * Lê o tenantId de:
   *  1) /agendar/{tenantId}            (path-based — formato novo)
   *  2) ?tenantId=... ou ?tenant=...   (querystring — compat antigo)
   *  3) último segmento do path se for um UUID
   */
  function getTenantIdFromUrl() {
    try {
      var u = new URL(window.location.href);
      // 1) /agendar/{tenantId}
      var m = u.pathname.match(/\/agendar\/([^\/?#]+)/i);
      if (m && m[1]) return decodeURIComponent(m[1]);
      // 2) querystring
      var qs = u.searchParams.get('tenantId') || u.searchParams.get('tenant');
      if (qs) return qs;
      // 3) último segmento se parece com UUID
      var segs = u.pathname.split('/').filter(Boolean);
      var last = segs[segs.length - 1] || '';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(last)) return last;
      return null;
    } catch (e) { return null; }
  }

  function showToast(msg, type) {
    var el = $('#ac-toast');
    el.className = 'ac-toast ' + (type || '');
    el.textContent = msg;
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () { el.classList.remove('show'); }, 2800);
  }

  // Promise.race com timeout — IMPRESCINDÍVEL para nunca travar o boot
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('timeout: ' + (label || 'request') + ' (' + ms + 'ms)')); }, ms);
      })
    ]);
  }


  function emitNovoAgendamento(tenantId, agId, clienteNome) {
    var eventData = {
      type: 'novo-agendamento',
      tenantId: tenantId,
      agendamento_id: agId,
      cliente_nome: clienteNome,
      source: 'agendamento-cliente',
      ts: Date.now()
    };

    // BroadcastChannel: mantém o comportamento de produção e não pode depender do WhatsApp.
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        var bc = new BroadcastChannel('beauty-agenda');
        bc.postMessage(eventData);
        // Não fecha no mesmo tick: evita perda do evento em alguns navegadores.
        setTimeout(function () { try { bc.close(); } catch (e) {} }, 500);
      }
    } catch (e) {
      console.warn('[ac] BroadcastChannel falhou:', e);
    }

    // Fallback para abas/janelas da mesma origem quando BroadcastChannel falhar.
    try {
      if (window.localStorage) {
        localStorage.setItem('beauty-agenda:last-event', JSON.stringify(eventData));
      }
    } catch (e) {}

    // Mesmo documento: não depende de BroadcastChannel/localStorage.
    try {
      window.dispatchEvent(new CustomEvent('beauty-agenda:novo-agendamento', { detail: eventData }));
    } catch (e) {}
  }

  /* ============================================================
     1. SUPABASE CLIENT (lazy init)
     ============================================================ */
  var supabase = null;
  function initSupabase() {
    if (supabase) {
      window.__supabaseClient = supabase;
      return supabase;
    }
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) return null;
    var url = (window.SUPABASE_URL) || (window.CONFIG && window.CONFIG.SUPABASE_URL);
    var key = (window.SUPABASE_ANON_KEY) || (window.CONFIG && window.CONFIG.SUPABASE_ANON_KEY);
    if (!url || !key) return null;
    try {
      supabase = window.supabase.createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      window.__supabaseClient = supabase;
      return supabase;
    } catch (e) {
      console.warn('[ac] supabase init failed', e);
      return null;
    }
  }

  /* ============================================================
     2. MOCK (apenas modo DEMO — sem Supabase configurado)
     ============================================================ */
  var MOCK = {
    tenant: {
      tenant_id: 'mock', nome: 'Studio Beauty Premium (DEMO)',
      endereco: 'Av. Paulista, 1500 - São Paulo, SP',
      logo_url: '', cover_url: '',
      habilitado: true, horario_inicio: '09:00', horario_fim: '19:00', slot_minutos: 15
    },
    servicos: [
      { id: 'srv-1', nome: 'Corte Feminino',     descricao: 'Corte personalizado com finalização e escova.',     preco: 80,  duracao: 60 },
      { id: 'srv-2', nome: 'Coloração',          descricao: 'Coloração completa com produtos profissionais.',    preco: 180, duracao: 120 },
      { id: 'srv-3', nome: 'Manicure',           descricao: 'Cuidado completo das unhas com esmaltação.',        preco: 45,  duracao: 45 },
      { id: 'srv-4', nome: 'Pedicure',           descricao: 'Tratamento dos pés com hidratação e esmaltação.',   preco: 55,  duracao: 60 },
      { id: 'srv-5', nome: 'Sobrancelha',        descricao: 'Design de sobrancelhas com henna opcional.',        preco: 40,  duracao: 30 },
      { id: 'srv-6', nome: 'Hidratação Capilar', descricao: 'Tratamento profundo para cabelos ressecados.',      preco: 95,  duracao: 75 },
      { id: 'srv-7', nome: 'Escova Progressiva', descricao: 'Alisamento e tratamento dos fios em uma sessão.',   preco: 250, duracao: 180 },
      { id: 'srv-8', nome: 'Maquiagem Social',   descricao: 'Maquiagem para eventos e ocasiões especiais.',      preco: 120, duracao: 60 }
    ],
    profissionais: [
      { id: 'prof-1', nome: 'Lucas Almeida', foto_url: '' },
      { id: 'prof-2', nome: 'João Pereira',  foto_url: '' },
      { id: 'prof-3', nome: 'Julio Santos',  foto_url: '' },
      { id: 'prof-4', nome: 'Ana Costa',     foto_url: '' }
    ],
    profServicos: {
      'srv-1': ['prof-1','prof-2','prof-3'],
      'srv-2': ['prof-1','prof-3'],
      'srv-3': ['prof-4'],
      'srv-4': ['prof-4'],
      'srv-5': ['prof-2','prof-4'],
      'srv-6': ['prof-1','prof-3'],
      'srv-7': ['prof-1'],
      'srv-8': ['prof-2','prof-4']
    },
    agendamentos: [
      { profissional_id: 'prof-1', data: todayISO(),  hora: '10:00', duracao_total: 60 },
      { profissional_id: 'prof-2', data: todayISO(),  hora: '14:30', duracao_total: 45 },
      { profissional_id: 'prof-3', data: todayISO(1), hora: '09:00', duracao_total: 120 }
    ]
  };


  /* ============================================================
     CLIENTE / PACOTES — fluxo unificado com o app interno.
     Todas as operações trabalham com cliente_id como identidade.
     ============================================================ */
  function onlyDigits(s) { return String(s||'').replace(/\D/g,''); }
  function formatTelefoneDisplay(tel) {
    var v = onlyDigits(tel).replace(/^55/, '').slice(0, 11);
    if (v.length > 6)      return '+55 (' + v.slice(0,2) + ') ' + v.slice(2,7) + '-' + v.slice(7);
    if (v.length > 2)      return '+55 (' + v.slice(0,2) + ') ' + v.slice(2);
    if (v.length > 0)      return '+55 (' + v;
    return '+55 ';
  }
  // PADRÃO OFICIAL: persiste somente dígitos com prefixo 55 (ex: 5548996311331)
  function normalizeTelefoneBR(tel) {
    var d = onlyDigits(tel);
    if (!d) return '';
    if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) return d;
    if (d.length === 10 || d.length === 11) return '55' + d;
    if (d.indexOf('55') === 0) return d;
    return '55' + d;
  }

  var ClienteService = {
    /**
     * Busca cliente por telefone (compara por dígitos). Tenta RPC pública
     * primeiro; cai para SELECT direto se RPC não existir.
     * Retorna { found: bool, cliente?: { id, nome, telefone } }
     */
    async buscarPorTelefone(tenantId, telefone) {
      var sb = initSupabase();
      if (!sb || !tenantId) return { found: false };
      var telDigitsRaw = onlyDigits(telefone);
      if (telDigitsRaw.length < 10) return { found: false };

      // PADRÃO OFICIAL: clientes são persistidos com prefixo 55 (ex.: 5548996311212).
      // Geramos variantes para casar tanto registros antigos (sem 55) quanto novos (com 55).
      var telWith55    = onlyDigits(normalizeTelefoneBR(telefone));            // 5548996311212
      var telWithout55 = telWith55.replace(/^55/, '');                          // 48996311212
      var variants = Array.from(new Set([telWith55, telWithout55, telDigitsRaw].filter(Boolean)));

      // 1) RPC pública (preferida — anon-friendly). A RPC compara dígitos exatos,
      //    então tentamos as variantes na ordem (com 55 primeiro = padrão atual).
      for (var i = 0; i < variants.length; i++) {
        try {
          var rpc = await withTimeout(
            sb.rpc('get_public_cliente_by_telefone', {
              _tenant_id: tenantId, _telefone_digits: variants[i]
            }),
            REQ_TIMEOUT, 'rpc:get_public_cliente_by_telefone'
          );
          if (!rpc.error && rpc.data) {
            var row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
            if (row && row.id) return { found: true, cliente: { id: row.id, nome: row.nome, telefone: row.telefone } };
          }
        } catch(e) { /* tenta próxima variante / fallback abaixo */ }
      }

      // 2) Fallback: SELECT direto. Compara ignorando prefixo 55 dos dois lados.
      try {
        var resp = await withTimeout(
          sb.from('clientes').select('id, nome, telefone').eq('tenant_id', tenantId),
          REQ_TIMEOUT, 'clientes-by-tenant'
        );
        if (resp.error || !resp.data) return { found: false };
        var hit = resp.data.find(function(c){
          return onlyDigits(c.telefone).replace(/^55/, '') === telWithout55;
        });
        return hit ? { found: true, cliente: hit } : { found: false };
      } catch(e) { return { found: false }; }
    },

    /**
     * Cria cliente novo. Telefone é normalizado para máscara display.
     * Retorna o registro criado (ou existente, em caso de race).
     */
    async cadastrar(tenantId, dados) {
      var sb = initSupabase();
      if (!sb) throw new Error('Indisponível.');
      // PADRÃO OFICIAL: persiste 55 + DDD + número (sem máscara) — pronto para Evolution API
      var telFmt = normalizeTelefoneBR(dados.telefone);

      // Antes de inserir, valida novamente (evita duplicidade por concorrência)
      var jaExiste = await this.buscarPorTelefone(tenantId, telFmt);
      if (jaExiste.found) return jaExiste.cliente;

      // 1) RPC pública (preferida)
      try {
        var rpc = await withTimeout(
          sb.rpc('create_public_cliente', {
            _tenant_id: tenantId,
            _nome: dados.nome,
            _telefone: telFmt,
            _nascimento: dados.nascimento || null
          }),
          REQ_TIMEOUT, 'rpc:create_public_cliente'
        );
        if (!rpc.error && rpc.data) {
          var row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
          if (row && row.id) return { id: row.id, nome: row.nome || dados.nome, telefone: telFmt };
        }
      } catch(e) { /* fallback */ }

      // 2) Fallback: insert direto
      var row = { tenant_id: tenantId, nome: dados.nome, telefone: telFmt };
      if (dados.nascimento) row.nascimento = dados.nascimento;
      var ins = await withTimeout(
        sb.from('clientes').insert([row]).select('id, nome, telefone').single(),
        REQ_TIMEOUT, 'clientes-insert'
      );
      if (ins.error) {
        // Race-condition: alguém criou entre nossa checagem e o insert
        var retry = await this.buscarPorTelefone(tenantId, telFmt);
        if (retry.found) return retry.cliente;
        throw new Error('Não foi possível cadastrar: ' + (ins.error.message || ''));
      }
      return ins.data;
    }
  };

  var PacoteService = {
    /**
     * Lista cliente_pacotes ATIVOS deste cliente (com saldo, não expirados).
     * Usado para mostrar "Você tem pacotes" no fluxo.
     */
    async listarAtivosDoCliente(tenantId, clienteId) {
      var sb = initSupabase();
      if (!sb || !tenantId || !clienteId) return [];
      var hoje = todayISO();
      try {
        var rpc = await withTimeout(
          sb.rpc('get_public_cliente_pacotes_ativos', { _tenant_id: tenantId, _cliente_id: clienteId }),
          REQ_TIMEOUT, 'rpc:get_public_cliente_pacotes_ativos'
        );
        if (!rpc.error && Array.isArray(rpc.data)) return rpc.data;
      } catch(e) {}
      try {
        var resp = await withTimeout(
          sb.from('cliente_pacotes')
            .select('id, pacote_id, quantidade_total, quantidade_restante, preco_unitario, data_expiracao, status, pacotes!inner(id, nome, servico_id, ativo)')
            .eq('tenant_id', tenantId)
            .eq('cliente_id', clienteId)
            .eq('status', 'ativo')
            .gt('quantidade_restante', 0)
            .gte('data_expiracao', hoje)
            .eq('pacotes.ativo', true),
          REQ_TIMEOUT, 'cliente_pacotes'
        );
        if (resp.error || !resp.data) return [];
        return resp.data;
      } catch(e) { return []; }
    },

    /**
     * Busca o pacote (definição) ATIVO mais recente para venda deste serviço.
     */
    async buscarOfertaParaServico(tenantId, servicoId) {
      var sb = initSupabase();
      if (!sb || !tenantId || !servicoId) return null;
      try {
        var rpc = await withTimeout(
          sb.rpc('get_public_pacote_oferta', { _tenant_id: tenantId, _servico_id: servicoId }),
          REQ_TIMEOUT, 'rpc:get_public_pacote_oferta'
        );
        if (!rpc.error && rpc.data) {
          var r = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
          if (r && r.id) return r;
        }
      } catch(e) {}
      try {
        var resp = await withTimeout(
          sb.from('pacotes')
            .select('id, nome, servico_id, quantidade_total, preco_unitario_final, preco_total, validade_dias, ativo')
            .eq('tenant_id', tenantId)
            .eq('servico_id', servicoId)
            .eq('ativo', true)
            .order('created_at', { ascending: false })
            .limit(1),
          REQ_TIMEOUT, 'pacotes'
        );
        if (resp.error || !resp.data || !resp.data.length) return null;
        return resp.data[0];
      } catch(e) { return null; }
    },

    /**
     * Função CENTRAL — espelha resolveServicePricingAndPackage do app interno.
     * Decide se cliente pode usar pacote, vender pacote, ou pagar avulso.
     * Retorna:
     *  {
     *    modo: 'PACOTE_USO' | 'PACOTE_VENDA' | 'NORMAL',
     *    precoFinal: number,
     *    pacoteUso?: { clientePacoteId, saldoRestante, nomePacote },
     *    ofertaPacote?: { id, nome, quantidade_total, preco_total, preco_unitario_final }
     *  }
     */
    async resolveServicePricingAndPackage(tenantId, clienteId, servicoId, precoServicoAvulso) {
      var pacotesAtivos = state.pacotesAtivosCliente || [];
      var disponiveis = pacotesAtivos.filter(function(cp){
        var svc = cp.pacotes && cp.pacotes.servico_id;
        return svc === servicoId && Number(cp.quantidade_restante||0) > 0;
      });
      if (disponiveis.length > 0) {
        // Usa o que expira primeiro
        disponiveis.sort(function(a,b){ return String(a.data_expiracao).localeCompare(String(b.data_expiracao)); });
        var cp = disponiveis[0];
        return {
          modo: 'PACOTE_USO',
          precoFinal: 0,
          pacoteUso: {
            clientePacoteId: cp.id,
            saldoRestante: Number(cp.quantidade_restante||0),
            nomePacote: (cp.pacotes && cp.pacotes.nome) || 'Pacote'
          }
        };
      }
      // Sem pacote — verificar oferta de venda
      var oferta = await this.buscarOfertaParaServico(tenantId, servicoId);
      if (oferta) {
        return {
          modo: 'PACOTE_VENDA',
          precoFinal: Number(precoServicoAvulso||0),
          ofertaPacote: oferta
        };
      }
      return { modo: 'NORMAL', precoFinal: Number(precoServicoAvulso||0) };
    }
  };


  /* ============================================================
     3. TENANT DATA SERVICE — usa tabelas REAIS do schema
     ============================================================ */
  var REQ_TIMEOUT = 6000; // 6s — qualquer requisição que passar disso falha graceful

  var TenantDataService = {
    tenantId: null,
    usingMock: false,

    /**
     * Carrega dados do tenant + tenant_settings.
     * Retorna { habilitado:false } se feature flag desligada.
     */
    async carregarTenant(tenantId) {
      this.tenantId = tenantId;
      var sb = initSupabase();

      if (!sb || !tenantId) {
        this.usingMock = true;
        return Object.assign({}, MOCK.tenant, { tenant_id: tenantId || 'mock' });
      }

      try {
        console.log('[ac] carregarTenant: tentando RPC pública para tenantId=', tenantId);
        var rpcResp = await withTimeout(
          sb.rpc('get_public_booking_tenant', { _tenant_id: tenantId }),
          REQ_TIMEOUT,
          'rpc:get_public_booking_tenant'
        );

        var rpcRow = Array.isArray(rpcResp && rpcResp.data) ? rpcResp.data[0] : (rpcResp && rpcResp.data);
        if (!rpcResp.error && rpcRow) {
          console.log('[ac] carregarTenant: RPC pública OK', rpcRow);
          // FIX SLOT INTERVAL: RPC pode ser antiga e não retornar appointment_interval_minutes.
          // Nesse caso buscamos diretamente em tenant_settings para respeitar a config real.
          if (rpcRow.appointment_interval_minutes == null) {
            try {
              var sRes = await withTimeout(
                sb.from('tenant_settings')
                  .select('appointment_interval_minutes, slot_minutos')
                  .eq('tenant_id', tenantId)
                  .maybeSingle(),
                REQ_TIMEOUT, 'tenant_settings:interval-fallback'
              );
              if (sRes && sRes.data) {
                rpcRow.appointment_interval_minutes = sRes.data.appointment_interval_minutes;
                if (rpcRow.slot_minutos == null) rpcRow.slot_minutos = sRes.data.slot_minutos;
                console.log('[ac] carregarTenant: interval-fallback OK', sRes.data);
              } else {
                console.warn('[ac] carregarTenant: interval-fallback sem retorno (RLS?)', sRes && sRes.error);
              }
            } catch (fbErr) {
              console.warn('[ac] carregarTenant: interval-fallback falhou:', fbErr && fbErr.message);
            }
          }
          var _slotFinal = Number(rpcRow.appointment_interval_minutes || rpcRow.slot_minutos || 15);
          console.log('[TENANT] slot resolvido =', _slotFinal, {
            appointment_interval_minutes: rpcRow.appointment_interval_minutes,
            slot_minutos: rpcRow.slot_minutos
          });
          return {
            tenant_id: rpcRow.id || tenantId,
            nome: rpcRow.nome_fantasia || rpcRow.nome || 'Estabelecimento',
            endereco: rpcRow.endereco || '',
            logradouro: rpcRow.logradouro || '',
            numero: rpcRow.numero || '',
            complemento: rpcRow.complemento || '',
            cep: rpcRow.cep || '',
            bairro: rpcRow.bairro || '',
            cidade: rpcRow.cidade || '',
            estado: rpcRow.estado || '',
            logo_url: rpcRow.logo_url || '',
            cover_url: rpcRow.cover_url || '',
            habilitado: !!rpcRow.permitir_agendamento_cliente,
            horario_inicio: String(rpcRow.horario_inicio || '09:00:00').slice(0, 5),
            horario_fim: String(rpcRow.horario_fim || '19:00:00').slice(0, 5),
            // Novo: horários por dia da semana (jsonb). Pode vir nulo se a RPC for antiga.
            horarios_semanais: rpcRow.horarios_semanais || null,
            slot_minutos: _slotFinal
          };
        }

        console.warn('[ac] carregarTenant: RPC indisponível ou sem retorno; tentando fallback por tabelas');

        var results = await Promise.all([
          withTimeout(
            sb.from('tenants')
              .select('id, nome, nome_fantasia, logo_url, logradouro, numero, complemento, cep, bairro, cidade, estado')
              .eq('id', tenantId)
              .maybeSingle(),
            REQ_TIMEOUT, 'tenants'
          ),
          withTimeout(
            sb.from('tenant_settings')
              .select('permitir_agendamento_cliente, horario_inicio, horario_fim, slot_minutos, appointment_interval_minutes, horarios_semanais')
              .eq('tenant_id', tenantId)
              .maybeSingle(),
            REQ_TIMEOUT, 'tenant_settings'
          )
        ]);

        var tenantRow = results[0] && results[0].data;
        var settingsRow = results[1] && results[1].data;
        console.log('[ac] carregarTenant: tenantRow=', tenantRow, 'settingsRow=', settingsRow);

        if (!tenantRow) {
          console.warn('[ac] tenant não encontrado no banco — testando se é RLS...');
          try {
            var diag = await withTimeout(
              sb.from('tenants').select('id', { count: 'exact', head: true }),
              REQ_TIMEOUT, 'tenants-count'
            );
            console.warn('[ac] DIAG: SELECT count(*) em tenants retornou count=', diag.count, 'error=', diag.error);
            if (diag.count === 0) {
              console.warn('[ac] DIAG: RLS está bloqueando leitura anônima da tabela `tenants`. Instale as RPCs públicas do fluxo de agendamento.');
            } else if (diag.count > 0) {
              console.warn('[ac] DIAG: leitura funciona, mas o tenantId', tenantId, 'não existe na tabela.');
            }
          } catch (e) { console.warn('[ac] DIAG falhou:', e); }
          return null;
        }

        var habilitado = !!(settingsRow && settingsRow.permitir_agendamento_cliente === true);
        return {
          tenant_id: tenantRow.id,
          nome: tenantRow.nome_fantasia || tenantRow.nome || 'Estabelecimento',
          endereco: '',
          logradouro: tenantRow.logradouro || '',
          numero: tenantRow.numero || '',
          complemento: tenantRow.complemento || '',
          cep: tenantRow.cep || '',
          bairro: tenantRow.bairro || '',
          cidade: tenantRow.cidade || '',
          estado: tenantRow.estado || '',
          logo_url: tenantRow.logo_url || '',
          cover_url: '',
          habilitado: habilitado,
          horario_inicio: (settingsRow && String(settingsRow.horario_inicio || '09:00:00').slice(0,5)) || '09:00',
          horario_fim: (settingsRow && String(settingsRow.horario_fim || '19:00:00').slice(0,5)) || '19:00',
          horarios_semanais: (settingsRow && settingsRow.horarios_semanais) || null,
          slot_minutos: (settingsRow && (settingsRow.appointment_interval_minutes || settingsRow.slot_minutos)) || 15
        };
      } catch (e) {
        console.error('[ac] carregarTenant falhou:', e && e.message);
        return null;
      }
    },

    /* ============================================================
       IMAGENS DO CARROSSEL (tabela public.tenant_images)
       Retorna [] em qualquer falha (fallback gracioso = gradiente).
       ============================================================ */
    async getTenantImages(tenantId) {
      if (this.usingMock) {
        return [
          { id: 'm1', image_url: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=1200&q=80', order: 0 },
          { id: 'm2', image_url: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=1200&q=80', order: 1 },
          { id: 'm3', image_url: 'https://images.unsplash.com/photo-1580618672591-eb180b1a973f?w=1200&q=80', order: 2 }
        ];
      }
      var sb = initSupabase();
      if (!sb || !tenantId) return [];
      try {
        var resp = await withTimeout(
          sb.from('tenant_images')
            .select('id, image_url, "order"')
            .eq('tenant_id', tenantId)
            .order('order', { ascending: true })
            .limit(10),
          REQ_TIMEOUT,
          'tenant_images'
        );
        if (resp.error) {
          console.warn('[ac] getTenantImages erro:', resp.error.message);
          return [];
        }
        return (resp.data || []).filter(function (r) { return !!r.image_url; });
      } catch (e) {
        console.warn('[ac] getTenantImages falhou:', e && e.message);
        return [];
      }
    },

    async listarServicos() {
      if (this.usingMock) return MOCK.servicos.slice();
      var sb = initSupabase();
      try {
        var rpcResp = await withTimeout(
          sb.rpc('get_public_booking_services', { _tenant_id: this.tenantId }),
          REQ_TIMEOUT,
          'rpc:get_public_booking_services'
        );
        if (!rpcResp.error && Array.isArray(rpcResp.data)) {
          return rpcResp.data.map(function (row) {
            return { id: row.id, nome: row.nome, descricao: row.descricao || '', preco: Number(row.preco || 0), duracao: Number(row.duracao || 30) };
          });
        }

        var r = await withTimeout(
          sb.from('servicos')
            .select('id, nome, preco, duracao, ativo')
            .eq('tenant_id', this.tenantId)
            .eq('ativo', true)
            .order('nome', { ascending: true }),
          REQ_TIMEOUT, 'servicos'
        );
        if (r.error) { console.warn('[ac] listarServicos error', r.error); return []; }
        return (r.data || []).map(function (s) {
          return { id: s.id, nome: s.nome, descricao: '', preco: Number(s.preco || 0), duracao: Number(s.duracao || 30) };
        });
      } catch (e) {
        console.error('[ac] listarServicos timeout/erro', e && e.message);
        return [];
      }
    },

    async listarProfissionais(servicoId) {
      if (this.usingMock) {
        var ids = MOCK.profServicos[servicoId] || MOCK.profissionais.map(function (p) { return p.id; });
        return MOCK.profissionais.filter(function (p) { return ids.indexOf(p.id) >= 0; });
      }
      var sb = initSupabase();
      try {
        var rpcResp = await withTimeout(
          sb.rpc('get_public_booking_professionals', { _tenant_id: this.tenantId, _servico_id: servicoId }),
          REQ_TIMEOUT,
          'rpc:get_public_booking_professionals'
        );
        if (!rpcResp.error && Array.isArray(rpcResp.data)) {
          return rpcResp.data.map(function (p) {
            return { id: p.id, nome: p.nome, foto_url: p.foto_url || '' };
          });
        }

        var rPS = await withTimeout(
          sb.from('profissional_servicos')
            .select('profissional_id')
            .eq('tenant_id', this.tenantId)
            .eq('servico_id', servicoId),
          REQ_TIMEOUT, 'profissional_servicos'
        );
        if (rPS.error) { console.warn('[ac] profissional_servicos error', rPS.error); return []; }
        var profIds = (rPS.data || []).map(function (x) { return x.profissional_id; });
        if (profIds.length === 0) return [];

        var rP = await withTimeout(
          sb.from('profissionais')
            .select('id, nome, foto_url, ativo')
            .eq('tenant_id', this.tenantId)
            .eq('ativo', true)
            .in('id', profIds)
            .order('nome', { ascending: true }),
          REQ_TIMEOUT, 'profissionais'
        );
        if (rP.error) { console.warn('[ac] profissionais error', rP.error); return []; }
        return (rP.data || []).map(function (p) {
          return { id: p.id, nome: p.nome, foto_url: p.foto_url || '' };
        });
      } catch (e) {
        console.error('[ac] listarProfissionais timeout/erro', e && e.message);
        return [];
      }
    },

    async listarAgendamentosDoDia(dataISO, profissionalIds) {
      if (this.usingMock) {
        return MOCK.agendamentos.filter(function (a) {
          return a.data === dataISO && profissionalIds.indexOf(a.profissional_id) >= 0;
        });
      }
      if (!profissionalIds || profissionalIds.length === 0) return [];
      var sb = initSupabase();
      try {
        var rpcResp = await withTimeout(
          sb.rpc('get_public_busy_slots', {
            _tenant_id: this.tenantId,
            _data: dataISO,
            _profissional_ids: profissionalIds
          }),
          REQ_TIMEOUT,
          'rpc:get_public_busy_slots'
        );
        if (!rpcResp.error && Array.isArray(rpcResp.data)) {
          var ocupRpc = rpcResp.data.map(function (a) {
            return {
              profissional_id: a.profissional_id,
              hora: String(a.hora).slice(0, 5),
              duracao_total: Number(a.duracao_total || 30)
            };
          });
          var blqRpc = await fetchBloqueiosClienteAsOcupacoes(sb, this.tenantId, dataISO, profissionalIds);
          return ocupRpc.concat(blqRpc);
        }

        var rA = await withTimeout(
          sb.from('agendamentos')
            .select('id, profissional_id, hora, status')
            .eq('tenant_id', this.tenantId)
            .eq('data', dataISO)
            .in('profissional_id', profissionalIds)
            .neq('status', 'cancelado'),
          REQ_TIMEOUT, 'agendamentos'
        );
        if (rA.error || !rA.data) return [];
        if (rA.data.length === 0) return [];

        var ids = rA.data.map(function (a) { return a.id; });
        var rS = await withTimeout(
          sb.from('agendamento_servicos')
            .select('agendamento_id, duracao')
            .in('agendamento_id', ids),
          REQ_TIMEOUT, 'agendamento_servicos'
        );
        var durMap = {};
        if (!rS.error && rS.data) {
          rS.data.forEach(function (row) {
            durMap[row.agendamento_id] = (durMap[row.agendamento_id] || 0) + Number(row.duracao || 0);
          });
        }
        var ocupFb = rA.data.map(function (a) {
          return {
            profissional_id: a.profissional_id,
            hora: String(a.hora).slice(0, 5),
            duracao_total: durMap[a.id] || 30
          };
        });
        var blqFb = await fetchBloqueiosClienteAsOcupacoes(sb, this.tenantId, dataISO, profissionalIds);
        return ocupFb.concat(blqFb);
      } catch (e) {
        console.error('[ac] listarAgendamentosDoDia timeout/erro', e && e.message);
        return [];
      }
    },

    async listarRecomendacoes(servicoId) {
      if (this.usingMock) return [];
      var sb = initSupabase();
      if (!sb || !servicoId) return [];
      try {
        // RPC pública (preferida)
        var rpcResp = await withTimeout(
          sb.rpc('get_public_service_recommendations', { _tenant_id: this.tenantId, _servico_id: servicoId }),
          REQ_TIMEOUT, 'rpc:get_public_service_recommendations'
        );
        if (!rpcResp.error && Array.isArray(rpcResp.data)) {
          return rpcResp.data.map(function (r) {
            return { id: r.id, nome: r.nome, preco: Number(r.preco || 0), duracao: Number(r.duracao || 30) };
          });
        }
        console.warn('[ac] RPC recomendações indisponível, tentando fallback', rpcResp.error && rpcResp.error.message);
      } catch (e) {
        console.warn('[ac] listarRecomendacoes timeout/erro', e && e.message);
      }
      // Fallback (pode falhar se RLS não permitir leitura anônima)
      try {
        var sb2 = initSupabase();
        var r = await withTimeout(
          sb2.from('service_recommendations')
            .select('recommended_service_id, servicos!service_recommendations_rec_service_fkey(id, nome, preco, duracao, ativo)')
            .eq('tenant_id', this.tenantId)
            .eq('service_id', servicoId),
          REQ_TIMEOUT, 'service_recommendations'
        );
        if (r.error) return [];
        return (r.data || [])
          .map(function (row) { return row.servicos; })
          .filter(function (s) { return s && s.ativo !== false; })
          .map(function (s) { return { id: s.id, nome: s.nome, preco: Number(s.preco || 0), duracao: Number(s.duracao || 30) }; });
      } catch (e) { return []; }
    },

    async criarAgendamento(payload) {
      // Força origem='externo' para agendamentos do fluxo público
      payload.origem = 'externo';

      // payload: {
      //   cliente_id, cliente_nome, cliente_telefone,
      //   servico_id, profissional_id, data, hora,
      //   duracao, preco, servicos_extras,
      //   pacote: null | { acao:'usar', clientePacoteId } | { acao:'vender', pacoteDefId }
      // }
      if (this.usingMock) {
        MOCK.agendamentos.push({
          profissional_id: payload.profissional_id, data: payload.data,
          hora: payload.hora, duracao_total: payload.duracao
        });
        var mockAgId = 'mock-' + Date.now();
        emitNovoAgendamento(this.tenantId, mockAgId, payload.cliente_nome);
        return mockAgId;
      }
      var sb = initSupabase();
      var clienteId = payload.cliente_id;
      if (!clienteId) throw new Error('Cliente não identificado.');

      // Chama RPC SECURITY DEFINER que cria o agendamento + linhas de serviço
      // (e, se for venda de pacote, também cria o cliente_pacotes) em uma transação.
      var pac = payload.pacote || null;
      var extras = Array.isArray(payload.servicos_extras)
        ? payload.servicos_extras.map(function(ex){
            return { id: ex.id, preco: Number(ex.preco||0), duracao: Number(ex.duracao||30) };
          })
        : [];

      var rRpc = await withTimeout(
        sb.rpc('create_public_agendamento', {
          _tenant_id: this.tenantId,
          _cliente_id: clienteId,
          _cliente_nome: payload.cliente_nome,
          _cliente_telefone: payload.cliente_telefone,
          _profissional_id: payload.profissional_id,
          _data: payload.data,
          _hora: payload.hora,
          _servico_id: payload.servico_id,
          _duracao: Number(payload.duracao || 30),
          _preco: Number(payload.preco || 0),
          _pacote_acao: pac ? pac.acao : null,
          _cliente_pacote_id: pac && pac.acao === 'usar'   ? pac.clientePacoteId : null,
          _pacote_def_id:    pac && pac.acao === 'vender' ? pac.pacoteDefId     : null,
          _servicos_extras: extras
        }),
        REQ_TIMEOUT, 'create_public_agendamento'
      );
      if (rRpc.error) throw rRpc.error;
      var agId = rRpc.data;

      // UI primeiro: evento sempre emitido antes de qualquer integração externa.
      emitNovoAgendamento(this.tenantId, agId, payload.cliente_nome);

      // WhatsApp externo: fire-and-forget totalmente isolado do fluxo de UI.
      try {
        if (typeof window.triggerWhatsAppNotification === 'function') {
          Promise.resolve()
            .then(function () { return window.triggerWhatsAppNotification(agId); })
            .catch(function (err) { console.warn('[WHATSAPP] falha no disparo:', err); });
        } else {
          console.warn('[WHATSAPP] função não carregada ainda ou script não inicializado');
        }
      } catch (e) {
        console.warn('[WHATSAPP] erro inesperado ao disparar:', e);
      }

      return agId;
    }
  };

  /* ============================================================
     4. RODÍZIO (round-robin) por tenant
     ============================================================ */
  var Rodizio = {
    key: function () { return 'ac_rotation_queue:' + (TenantDataService.tenantId || 'default'); },
    pick: function (allIds, availableIds) {
      var queue;
      try { queue = JSON.parse(localStorage.getItem(this.key()) || '[]'); } catch (e) { queue = []; }
      allIds.forEach(function (id) { if (queue.indexOf(id) < 0) queue.push(id); });
      queue = queue.filter(function (id) { return allIds.indexOf(id) >= 0; });
      for (var i = 0; i < queue.length; i++) {
        if (availableIds.indexOf(queue[i]) >= 0) {
          var chosen = queue[i];
          queue.splice(i, 1); queue.push(chosen);
          try { localStorage.setItem(this.key(), JSON.stringify(queue)); } catch (e) {}
          return chosen;
        }
      }
      return availableIds[0] || null;
    }
  };

  /* ============================================================
     5. ESTADO
     ============================================================ */
  var state = {
    step: 1,
    tenant: null,
    servicos: [],
    profissionais: [],
    selectedServico: null,
    selectedProfissional: null,
    selectedDate: null,
    selectedSlot: null,
    autoChosenProf: null,
    calMonth: new Date().getMonth(),
    calYear: new Date().getFullYear(),
    ocupacoesCache: [],
    recomendacoes: [],      // serviços sugeridos para o serviço atual
    acceptedUpsells: [],    // serviços extras aceitos pelo cliente
    cliente: null,          // { id, nome, telefone } — sempre setado após Step 0
    pacotesAtivosCliente: [], // cliente_pacotes ativos com saldo (cache)
    pricingResolution: null, // resultado de resolveServicePricingAndPackage para o serviço atual
    myAppointments: [],
    pendingCancelApptId: null,
    pendingEditApptId: null,
    servicesReady: false,
    eventsBound: false
  };

  /* ============================================================
     6. CÁLCULO DE SLOTS
     ============================================================ */

  /* Mapeia ISO 'YYYY-MM-DD' (ou Date) para o horário daquele dia da semana,
     respeitando state.tenant.horarios_semanais (jsonb).
     Retorna { ativo, inicio, fim }. Fallback = horario_inicio/fim "globais". */
  var DIA_KEYS_AC = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
  function getHorarioForDate(isoOrDate) {
    var dt;
    if (isoOrDate instanceof Date) {
      dt = isoOrDate;
    } else {
      var p = String(isoOrDate).split('-');
      dt = new Date(parseInt(p[0],10), parseInt(p[1],10) - 1, parseInt(p[2],10));
    }
    var dow = dt.getDay();
    var fbInicio = (state.tenant && state.tenant.horario_inicio) || '09:00';
    var fbFim    = (state.tenant && state.tenant.horario_fim)    || '19:00';
    var hs = state.tenant && state.tenant.horarios_semanais;
    if (!hs) {
      return { ativo: true, inicio: fbInicio, fim: fbFim };
    }
    var key = DIA_KEYS_AC[dow];
    var d = hs[key];
    if (!d) return { ativo: true, inicio: fbInicio, fim: fbFim };
    return {
      ativo: d.ativo !== false,
      inicio: d.inicio ? String(d.inicio).slice(0,5) : fbInicio,
      fim:    d.fim    ? String(d.fim).slice(0,5)    : fbFim
    };
  }

  function buildAllSlots(horarioDia) {
    var hd = horarioDia || (state.selectedDate ? getHorarioForDate(state.selectedDate) : { inicio: state.tenant.horario_inicio, fim: state.tenant.horario_fim, ativo: true });
    if (!hd.ativo) return [];
    var hi = parseInt(String(hd.inicio || '09:00').split(':')[0], 10);
    var hfStr = String(hd.fim || '19:00').split(':');
    var hf = parseInt(hfStr[0], 10);
    if (parseInt(hfStr[1] || '0', 10) > 0) hf = hf + 1; // engloba 18:30 → vai até 19
    var step = state.tenant.slot_minutos || 15;
    console.log('[SLOTS]', {
      appointment_interval_minutes: state.tenant.appointment_interval_minutes,
      slot_minutos: state.tenant.slot_minutos,
      step: step
    });
    console.log('[TENANT]', state.tenant);
    var slots = [];
    for (var h = hi; h < hf; h++) {
      for (var m = 0; m < 60; m += step) slots.push(pad(h) + ':' + pad(m));
    }
    return slots;
  }
  function slotToMinutes(hhmm) { var p = hhmm.split(':'); return parseInt(p[0],10)*60 + parseInt(p[1],10); }
  function isProfFree(profId, slot, duracao, ocupacoes, horarioDia) {
    var inicio = slotToMinutes(slot), fim = inicio + duracao;
    var hd = horarioDia || (state.selectedDate ? getHorarioForDate(state.selectedDate) : { fim: state.tenant.horario_fim, ativo: true });
    if (!hd.ativo) return false;
    var fimParts = String(hd.fim || '19:00').split(':');
    var fimExp = parseInt(fimParts[0], 10) * 60 + parseInt(fimParts[1] || '0', 10);
    if (fim > fimExp) return false;
    return !ocupacoes.filter(function (a) { return a.profissional_id === profId; })
      .some(function (a) {
        var oi = slotToMinutes(a.hora), of = oi + (a.duracao_total || 30);
        return inicio < of && fim > oi;
      });
  }
  function profsLivresNoSlot(slot, duracao, ocupacoes, candidatos, horarioDia) {
    return candidatos.filter(function (p) { return isProfFree(p.id, slot, duracao, ocupacoes, horarioDia); });
  }

  /* ============================================================
     7. RENDER: Header / Serviços / Profissionais / Calendário / Slots
     ============================================================ */
  function formatCepDisplay(cep) {
    var d = String(cep || '').replace(/\D/g, '');
    if (d.length !== 8) return String(cep || '').trim();
    return d.slice(0,2) + '.' + d.slice(2,5) + '-' + d.slice(5);
  }
  function formatTenantEndereco(t) {
    if (!t) return '';
    // Se já vier um endereço pronto e não houver campos estruturados, usa o texto.
    var temEstruturado = t.logradouro || t.numero || t.complemento || t.cep || t.bairro || t.cidade;
    if (!temEstruturado) return String(t.endereco || '').trim();

    var logr = String(t.logradouro || '').trim();
    var num  = String(t.numero || '').trim();
    var comp = String(t.complemento || '').trim();
    var cep  = formatCepDisplay(t.cep);
    var bai  = String(t.bairro || '').trim();
    var cid  = String(t.cidade || '').trim();

    // Primeiro segmento: "Logradouro, Número" (vírgula só se ambos existirem)
    var first = '';
    if (logr && num) first = logr + ', ' + num;
    else first = logr || num || '';

    var partes = [];
    if (first) partes.push(first);
    if (comp)  partes.push(comp);
    if (cep)   partes.push(cep);
    if (bai)   partes.push(bai);
    if (cid)   partes.push(cid);
    return partes.join(' - ');
  }
  function renderTenant() {
    console.log('[ac] renderTenant: inicio');
    var nomeEl = $('#ac-tenant-nome');
    if (nomeEl) nomeEl.textContent = state.tenant.nome;
    else console.warn('[ac] renderTenant: #ac-tenant-nome ausente');

    var endP = $('#ac-tenant-endereco');
    var endSpan = endP ? (endP.querySelector('.ac-end-text') || endP.querySelector('span')) : null;
    var endText = formatTenantEndereco(state.tenant);
    if (endSpan) endSpan.textContent = endText;
    if (endP) {
      if (endText) endP.removeAttribute('hidden');
      else endP.setAttribute('hidden', '');
    }

    var logoEl = $('#ac-logo-wrap');
    if (logoEl) {
      if (state.tenant.logo_url) {
        logoEl.innerHTML = '<img src="' + escapeHtml(state.tenant.logo_url) + '" alt="logo" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">';
      } else {
        logoEl.textContent = avatarInitials(state.tenant.nome);
      }
    } else {
      console.warn('[ac] renderTenant: #ac-logo-wrap ausente');
    }

    var coverEl = $('#ac-cover');
    if (coverEl && state.tenant.cover_url) {
      coverEl.src = state.tenant.cover_url;
    } else if (!coverEl) {
      console.warn('[ac] renderTenant: #ac-cover ausente (ok, ignorando)');
    }

    // Carrossel de imagens (tenant_images). Não bloqueia o restante.
    initCarousel();

    console.log('[ac] renderTenant: fim');
  }

  /* ============================================================
     7.b CARROSSEL DO HEADER
     - Auto-play 4s
     - Prev/Next + dots
     - Swipe touch (mobile)
     - Pausa ao interagir; retoma após 8s
     - Fallback: vazio = gradiente padrão (oculta o carrossel)
     ============================================================ */
  var Carousel = (function () {
    var images = [];
    var idx = 0;
    var timer = null;
    var resumeTimer = null;
    var AUTOPLAY_MS = 4000;
    var RESUME_MS = 8000;

    function el(id) { return document.getElementById(id); }

    function render() {
      var root  = el('ac-carousel');
      var track = el('ac-carousel-track');
      var dots  = el('ac-carousel-dots');
      var prev  = el('ac-carousel-prev');
      var next  = el('ac-carousel-next');
      var legacyCover = el('ac-cover');
      if (!root || !track || !dots) return;

      if (!images.length) {
        root.setAttribute('data-empty', 'true');
        track.innerHTML = '';
        dots.innerHTML = '';
        if (prev) prev.hidden = true;
        if (next) next.hidden = true;
        return;
      }
      root.setAttribute('data-empty', 'false');
      // Quando há imagens novas, esconde a img legada de cover
      if (legacyCover) { legacyCover.removeAttribute('src'); legacyCover.style.display = 'none'; }

      track.innerHTML = images.map(function (im) {
        return '<li><img src="' + escapeHtml(im.image_url) + '" alt="" loading="lazy" /></li>';
      }).join('');

      dots.innerHTML = images.map(function (_, i) {
        return '<button type="button" class="ac-carousel-dot' + (i === 0 ? ' active' : '') + '" data-i="' + i + '" aria-label="Imagem ' + (i + 1) + '"></button>';
      }).join('');

      var multi = images.length > 1;
      if (prev) prev.hidden = !multi;
      if (next) next.hidden = !multi;

      idx = 0;
      apply(false);
    }

    function apply(animate) {
      var track = el('ac-carousel-track');
      var dots  = el('ac-carousel-dots');
      if (!track) return;
      track.style.transition = animate === false ? 'none' : '';
      track.style.transform = 'translateX(' + (-idx * 100) + '%)';
      if (dots) {
        Array.prototype.forEach.call(dots.children, function (d, i) {
          d.classList.toggle('active', i === idx);
        });
      }
      if (animate === false) {
        // força reflow para re-habilitar transição
        void track.offsetWidth;
        track.style.transition = '';
      }
    }

    function go(delta) {
      if (images.length < 2) return;
      idx = (idx + delta + images.length) % images.length;
      apply(true);
    }
    function goTo(i) {
      if (images.length < 2) return;
      idx = ((i % images.length) + images.length) % images.length;
      apply(true);
    }

    function startAuto() {
      stopAuto();
      if (images.length < 2) return;
      timer = setInterval(function () { go(1); }, AUTOPLAY_MS);
    }
    function stopAuto() {
      if (timer) { clearInterval(timer); timer = null; }
    }
    function pauseAndResume() {
      stopAuto();
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(startAuto, RESUME_MS);
    }

    function bind() {
      var root = el('ac-carousel');
      var prev = el('ac-carousel-prev');
      var next = el('ac-carousel-next');
      var dots = el('ac-carousel-dots');
      if (!root || root.dataset.bound === '1') return;
      root.dataset.bound = '1';

      if (prev) prev.addEventListener('click', function () { go(-1); pauseAndResume(); });
      if (next) next.addEventListener('click', function () { go(1);  pauseAndResume(); });
      if (dots) dots.addEventListener('click', function (e) {
        var b = e.target.closest('.ac-carousel-dot'); if (!b) return;
        goTo(parseInt(b.getAttribute('data-i'), 10) || 0);
        pauseAndResume();
      });

      // Swipe touch
      var startX = null, dx = 0;
      root.addEventListener('touchstart', function (e) {
        if (!e.touches || !e.touches[0]) return;
        startX = e.touches[0].clientX; dx = 0; stopAuto();
      }, { passive: true });
      root.addEventListener('touchmove', function (e) {
        if (startX == null) return;
        dx = e.touches[0].clientX - startX;
      }, { passive: true });
      root.addEventListener('touchend', function () {
        if (startX == null) return;
        if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        startX = null; dx = 0;
        pauseAndResume();
      });

      // Pausa quando aba fica oculta
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) stopAuto(); else startAuto();
      });
    }

    function setImages(list) {
      images = Array.isArray(list) ? list.slice(0, 10) : [];
      bind();
      render();
      startAuto();
    }

    return { setImages: setImages };
  })();

  function initCarousel() {
    var tid = state.tenant && state.tenant.tenant_id;
    TenantDataService.getTenantImages(tid).then(function (imgs) {
      console.log('[ac] carrossel: imagens =', imgs.length);
      Carousel.setImages(imgs || []);
    }).catch(function (e) {
      console.warn('[ac] carrossel falhou:', e);
      Carousel.setImages([]);
    });
  }

  function renderServicos(filter) {
    console.log('[ac] renderServicos: inicio, total=', state.servicos.length, 'filter=', filter);
    var list = $('#ac-servicos-list');
    var empty = $('#ac-servicos-empty');
    if (!list) {
      console.error('[ac] renderServicos: #ac-servicos-list NAO existe no DOM — abortando');
      return;
    }
    if (!empty) {
      console.warn('[ac] renderServicos: #ac-servicos-empty ausente — criando placeholder');
      empty = document.createElement('div');
      empty.id = 'ac-servicos-empty';
      empty.hidden = true;
      empty.innerHTML = '<p>Nenhum servico encontrado</p>';
      list.parentNode && list.parentNode.appendChild(empty);
    }
    var term = (filter || '').trim().toLowerCase();
    var rows = (state.servicos || []).filter(function (s) {
      if (!term) return true;
      return (s.nome || '').toLowerCase().indexOf(term) >= 0
          || (s.descricao || '').toLowerCase().indexOf(term) >= 0;
    });
    console.log('[ac] renderServicos: rows apos filtro=', rows.length);
    if (rows.length === 0) { list.innerHTML = ''; empty.hidden = false; console.log('[ac] renderServicos: nenhum resultado'); return; }
    empty.hidden = true;
    list.innerHTML = rows.map(function (s) {
      return '<article class="ac-servico-card" data-servico-id="' + escapeHtml(s.id) + '">' +
        '<div class="ac-servico-info">' +
          '<h3 class="ac-servico-nome">' + escapeHtml(s.nome) + '</h3>' +
          (s.descricao ? '<p class="ac-servico-desc">' + escapeHtml(s.descricao) + '</p>' : '') +
          '<div class="ac-servico-meta">' +
            '<span class="price">' + brl(s.preco) + '</span>' +
            '<span class="dur"><i class="far fa-clock"></i> ' + formatDuracao(s.duracao) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="ac-servico-action"><button type="button" class="ac-btn-agendar">Agendar</button></div>' +
      '</article>';
    }).join('');
    $$('.ac-servico-card', list).forEach(function (card) {
      card.addEventListener('click', function () {
        selectServico(card.getAttribute('data-servico-id'));
      });
    });
    console.log('[ac] renderServicos: fim — cards renderizados=', rows.length);
  }

  function renderProfissionais() {
    var grid = $('#ac-prof-grid');
    $('#ac-prof-sub').textContent = 'Para o serviço: ' + state.selectedServico.nome;
    var html = '<button type="button" class="ac-prof-card" data-prof-id="__no_pref__">' +
      '<div class="ac-prof-avatar no-pref"><i class="fas fa-user-friends"></i></div>' +
      '<div class="ac-prof-nome">Sem preferência</div>' +
      '<div class="ac-prof-tag">Atribuição automática</div>' +
    '</button>';
    state.profissionais.forEach(function (p) {
      var avatar = p.foto_url
        ? '<img src="' + escapeHtml(p.foto_url) + '" alt="' + escapeHtml(p.nome) + '">'
        : avatarInitials(p.nome);
      html += '<button type="button" class="ac-prof-card" data-prof-id="' + escapeHtml(p.id) + '">' +
        '<div class="ac-prof-avatar">' + avatar + '</div>' +
        '<div class="ac-prof-nome">' + escapeHtml(p.nome) + '</div>' +
      '</button>';
    });
    grid.innerHTML = html;
    $$('.ac-prof-card', grid).forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.ac-prof-card', grid).forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        var id = btn.getAttribute('data-prof-id');
        if (id === '__no_pref__') {
          state.selectedProfissional = { id: '__no_pref__', nome: 'Sem preferência' };
        } else {
          state.selectedProfissional = state.profissionais.filter(function (p) { return p.id === id; })[0];
        }
        setTimeout(function () { goToStep(3); }, 200);
      });
    });
  }

  function renderCalendar() {
    var months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    $('#ac-cal-month').textContent = months[state.calMonth] + ' ' + state.calYear;
    var cal = $('#ac-calendar');
    var daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
    var dows = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    var todayD = new Date(); todayD.setHours(0,0,0,0);
    var html = '';
    for (var d = 1; d <= daysInMonth; d++) {
      var dt = new Date(state.calYear, state.calMonth, d);
      var iso = state.calYear + '-' + pad(state.calMonth+1) + '-' + pad(d);
      var dow = dows[dt.getDay()];
      // Dia desabilitado se: passado OU estabelecimento fechado naquele dia da semana
      var horarioDow = getHorarioForDate(dt);
      var fechadoNoDow = !horarioDow.ativo;
      var disabled = (dt < todayD || fechadoNoDow) ? 'disabled' : '';
      var closedCls = fechadoNoDow ? 'ac-cal-closed' : '';
      var isToday = dt.getTime() === todayD.getTime() ? 'today' : '';
      var sel = state.selectedDate === iso ? 'selected' : '';
      var title = fechadoNoDow ? ' title="Fechado neste dia"' : '';
      html += '<button type="button" class="ac-cal-day ' + disabled + ' ' + closedCls + ' ' + isToday + ' ' + sel + '" data-date="' + iso + '"' + title + '>' +
        '<span class="dow">' + dow + '</span><span class="num">' + d + '</span></button>';
    }
    cal.innerHTML = html;
    $$('.ac-cal-day:not(.disabled)', cal).forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.ac-cal-day', cal).forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        state.selectedDate = btn.getAttribute('data-date');
        renderSlots();
      });
    });
    var target = $('.ac-cal-day.selected', cal) || $('.ac-cal-day.today', cal) || $('.ac-cal-day:not(.disabled)', cal);
    if (target) cal.scrollLeft = Math.max(0, target.offsetLeft - 16);
  }

  async function renderSlots() {
    var wrap = $('#ac-slots'), empty = $('#ac-slots-empty');
    if (!state.selectedDate) { wrap.innerHTML = ''; empty.hidden = false; return; }

    // Se o estabelecimento estiver fechado neste dia da semana → bloqueia
    var horarioDia = getHorarioForDate(state.selectedDate);
    if (!horarioDia.ativo) {
      wrap.innerHTML = '';
      empty.hidden = false;
      var msgEl = empty.querySelector('p');
      if (msgEl) msgEl.textContent = 'Estabelecimento fechado neste dia. Escolha outra data.';
      return;
    }

    var servico = state.selectedServico;
    var prof = state.selectedProfissional;
    var candidatos = prof.id === '__no_pref__' ? state.profissionais : [prof];
    var candidatoIds = candidatos.map(function (c) { return c.id; });

    wrap.innerHTML = '<div class="ac-loading"><i class="fas fa-spinner fa-spin"></i> Carregando horários...</div>';

    var ocup = await TenantDataService.listarAgendamentosDoDia(state.selectedDate, candidatoIds);
    state.ocupacoesCache = ocup;

    var allSlots = buildAllSlots(horarioDia);
    var hoje = new Date(); hoje.setSeconds(0,0);
    var isHoje = state.selectedDate === todayISO();
    var manha = [], tarde = [];
    allSlots.forEach(function (slot) {
      var livres = profsLivresNoSlot(slot, servico.duracao, ocup, candidatos, horarioDia);
      var disponivel = livres.length > 0;
      if (isHoje) {
        var slotDate = new Date(state.selectedDate + 'T' + slot + ':00');
        if (slotDate <= hoje) disponivel = false;
      }
      var item = { slot: slot, disponivel: disponivel };
      var hora = parseInt(slot.split(':')[0], 10);
      if (hora < 12) manha.push(item); else tarde.push(item);
    });
    var hasAnyM = manha.some(function (s) { return s.disponivel; });
    var hasAnyT = tarde.some(function (s) { return s.disponivel; });
    if (!hasAnyM && !hasAnyT) {
      wrap.innerHTML = '';
      empty.hidden = false;
      empty.querySelector('p').textContent = 'Nenhum horário disponível para esta data';
      return;
    }
    empty.hidden = true;
    function renderPeriod(title, icon, items) {
      if (items.length === 0) return '';
      return '<div class="ac-period">' +
        '<div class="ac-period-title"><i class="' + icon + '"></i> ' + title + '</div>' +
        '<div class="ac-slots-grid">' +
          items.map(function (it) {
            return '<button type="button" class="ac-slot ' + (it.disponivel ? '' : 'unavailable') + '" data-slot="' + it.slot + '">' + it.slot + '</button>';
          }).join('') +
        '</div></div>';
    }
    wrap.innerHTML = renderPeriod('Manhã', 'fas fa-sun', manha) + renderPeriod('Tarde', 'fas fa-cloud-sun', tarde);
    $$('.ac-slot:not(.unavailable)', wrap).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.selectedSlot = btn.getAttribute('data-slot');
        openConfirmModal();
      });
    });
  }

  /* ============================================================
     8. MODAL DE CONFIRMAÇÃO
     ============================================================ */
  function openConfirmModal() {
    var servico = state.selectedServico;
    var prof = state.selectedProfissional;
    var slot = state.selectedSlot;
    var profExibido = prof;
    state.autoChosenProf = null;

    if (prof.id === '__no_pref__') {
      var livres = profsLivresNoSlot(slot, servico.duracao, state.ocupacoesCache, state.profissionais);
      if (livres.length === 0) { showToast('Nenhum profissional disponível neste horário.', 'error'); return; }
      var allIds = state.profissionais.map(function (p) { return p.id; });
      var availableIds = livres.map(function (p) { return p.id; });
      var chosenId = Rodizio.pick(allIds, availableIds);
      var escolhido = state.profissionais.filter(function (p) { return p.id === chosenId; })[0] || livres[0];
      state.autoChosenProf = escolhido;
      profExibido = { id: escolhido.id, nome: escolhido.nome + ' (atribuído automaticamente)' };
    }

    var extras = state.acceptedUpsells || [];
    var nomeServico = servico.nome;
    var totalDuracao = servico.duracao;
    var totalPreco   = Number(servico.preco || 0);
    extras.forEach(function (e) {
      nomeServico += ' + ' + e.nome;
      totalDuracao += Number(e.duracao || 0);
      totalPreco   += Number(e.preco || 0);
    });

    $('#ac-r-servico').textContent = nomeServico;
    $('#ac-r-prof').textContent    = profExibido.nome;
    $('#ac-r-data').textContent    = formatDateBR(state.selectedDate);
    $('#ac-r-hora').textContent    = slot;
    $('#ac-r-duracao').textContent = formatDuracao(totalDuracao);
    $('#ac-r-valor').textContent   = brl(totalPreco);
    $('#ac-feedback').hidden = true;

    // Bloco de pacote: avalia em runtime usando state.pricingResolution
    var box = $('#ac-pacote-box');
    if (box) {
      box.hidden = true; box.innerHTML = ''; box.className = 'ac-pacote-box';
      var res = state.pricingResolution;
      if (res && res.modo === 'PACOTE_USO') {
        box.hidden = false;
        box.innerHTML =
          '<div class="ac-pacote-title"><i class="fas fa-box-open"></i> Uso de pacote disponível</div>' +
          '<div class="ac-pacote-sub">Pacote <strong>' + escapeHtml(res.pacoteUso.nomePacote) + '</strong> — ' +
            res.pacoteUso.saldoRestante + ' uso(s) restantes.</div>' +
          '<label><input type="checkbox" id="ac-pacote-usar" checked> Usar 1 sessão deste pacote (não será cobrado)</label>';
        // Atualiza valor exibido quando alterna o checkbox
        setTimeout(function(){
          var chk = document.getElementById('ac-pacote-usar');
          if (chk) chk.addEventListener('change', function(){
            $('#ac-r-valor').textContent = chk.checked ? brl(0) : brl(totalPreco);
          });
          $('#ac-r-valor').textContent = brl(0);
        }, 0);
      } else if (res && res.modo === 'PACOTE_VENDA') {
        var of = res.ofertaPacote;
        box.hidden = false;
        box.classList.add('venda');
        box.innerHTML =
          '<div class="ac-pacote-title"><i class="fas fa-tags"></i> Venda de pacote disponível</div>' +
          '<div class="ac-pacote-sub">' + escapeHtml(of.nome) + ' — ' + of.quantidade_total +
            ' usos por ' + brl(of.preco_total) + ' (' + brl(of.preco_unitario_final) + ' por uso).</div>' +
          '<label><input type="checkbox" id="ac-pacote-comprar"> Comprar este pacote agora e usar a 1ª sessão hoje (será marcado como Venda + Uso de pacote)</label>';
      }
    }

    $('#ac-modal-confirm').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModals() {
    $('#ac-modal-confirm').hidden = true;
    $('#ac-modal-success').hidden = true;
    document.body.style.overflow = '';
  }

  function showFeedback(msg) {
    var fb = $('#ac-feedback'); fb.hidden = false; fb.textContent = msg;
  }

  async function confirmarAgendamento() {
    if (!state.cliente || !state.cliente.id) {
      return showFeedback('Sessão expirada. Recomece informando seu telefone.');
    }
    var servico = state.selectedServico;
    var profId = state.selectedProfissional.id === '__no_pref__'
      ? state.autoChosenProf.id : state.selectedProfissional.id;
    var profNome = state.selectedProfissional.id === '__no_pref__'
      ? state.autoChosenProf.nome : state.selectedProfissional.nome;

    // Decidir info de pacote a enviar
    var pacotePayload = null;
    var res = state.pricingResolution;
    var chkUsar = document.getElementById('ac-pacote-usar');
    var chkComprar = document.getElementById('ac-pacote-comprar');
    if (res && res.modo === 'PACOTE_USO' && chkUsar && chkUsar.checked) {
      pacotePayload = { acao: 'usar', clientePacoteId: res.pacoteUso.clientePacoteId };
    } else if (res && res.modo === 'PACOTE_VENDA' && chkComprar && chkComprar.checked) {
      pacotePayload = { acao: 'vender', pacoteDefId: res.ofertaPacote.id };
    }

    var btn = $('#ac-btn-confirmar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Confirmando...';
    try {
      await TenantDataService.criarAgendamento({
        cliente_id: state.cliente.id,
        cliente_nome: state.cliente.nome,
        cliente_telefone: state.cliente.telefone,
        servico_id: servico.id,
        profissional_id: profId,
        data: state.selectedDate,
        hora: state.selectedSlot,
        duracao: servico.duracao,
        preco: servico.preco,
        pacote: pacotePayload,
        servicos_extras: (state.acceptedUpsells || []).map(function (e) {
          return { id: e.id, preco: e.preco, duracao: e.duracao };
        })
      });
      $('#ac-modal-confirm').hidden = true;
      $('#ac-success-msg').textContent =
        servico.nome + ' com ' + profNome + ' em ' + formatDateBR(state.selectedDate) +
        ' às ' + state.selectedSlot + '.';
      $('#ac-modal-success').hidden = false;
      // Recarrega pacotes (caso tenha vendido) para refletir saldo no próximo flow
      try {
        state.pacotesAtivosCliente = await PacoteService.listarAtivosDoCliente(state.tenant.tenant_id, state.cliente.id);
      } catch(e) {}
      try {
        await renderSlots();
      } catch(e) {
        console.warn('[ac] não foi possível atualizar horários após confirmação:', e);
      }
    } catch (err) {
      console.error(err);
      showFeedback((err && err.message) || 'Não foi possível confirmar. Tente novamente.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check"></i> Confirmar agendamento';
    }
  }

  function resetFlow() {
    window.location.reload();
  }













  /* ============================================================
     9. NAVEGAÇÃO
     ============================================================ */
  function goToStep(n) {
    // Bloqueia avanço se cliente não identificado
    if (n > 0 && (!state.cliente || !state.cliente.id)) { n = 0; }
    state.step = n;
    $$('.ac-step-content').forEach(function (el) {
      el.classList.toggle('active', parseInt(el.getAttribute('data-step-content'), 10) === n);
    });
    $$('.ac-step').forEach(function (el) {
      var sn = parseInt(el.getAttribute('data-step'), 10);
      el.classList.toggle('active', sn === n);
      el.classList.toggle('completed', sn < n);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (n === 3) { renderCalendar(); if (state.selectedDate) renderSlots(); }
  }

  function selectServico(id) {
    var srv = state.servicos.filter(function (s) { return s.id === id; })[0];
    if (!srv) return;
    state.selectedServico = srv;
    state.selectedProfissional = null;
    state.selectedDate = null;
    state.selectedSlot = null;
    state.acceptedUpsells = [];
    state.recomendacoes = [];
    state.pricingResolution = null;

    // Carregar profissionais, recomendações e pricing/pacote em paralelo
    Promise.all([
      TenantDataService.listarProfissionais(srv.id),
      TenantDataService.listarRecomendacoes(srv.id),
      (state.cliente && state.cliente.id)
        ? PacoteService.resolveServicePricingAndPackage(state.tenant.tenant_id, state.cliente.id, srv.id, srv.preco)
        : Promise.resolve({ modo:'NORMAL', precoFinal: srv.preco })
    ]).then(function (results) {
      state.pricingResolution = results[2] || { modo:'NORMAL', precoFinal: srv.preco };
      state.profissionais = results[0] || [];
      state.recomendacoes = (results[1] || []).filter(function (r) { return r.id !== srv.id; });
      if (state.profissionais.length === 0) {
        showToast('Nenhum profissional cadastrado para este serviço.', 'error');
        return;
      }
      renderProfissionais();
      // Se houver recomendações, mostrar modal antes de avançar (não-intrusivo: continua mesmo se ignorado)
      if (state.recomendacoes.length > 0) {
        openUpsellModal();
      } else {
        goToStep(2);
      }
    });
  }

  /* ============================================================
     UPSELL: modal de recomendação de serviços (fluxo cliente)
     ============================================================ */
  function openUpsellModal() {
    var modal = $('#ac-modal-upsell');
    var list  = $('#ac-upsell-list');
    if (!modal || !list) { goToStep(2); return; }

    list.innerHTML = state.recomendacoes.map(function (r) {
      var aceito = state.acceptedUpsells.some(function (a) { return a.id === r.id; });
      return '<div class="ac-upsell-item ' + (aceito ? 'added' : '') + '" data-rec-id="' + escapeHtml(r.id) + '">' +
        '<div class="ac-upsell-item-info">' +
          '<p class="ac-upsell-item-name">' + escapeHtml(r.nome) + '</p>' +
          '<div class="ac-upsell-item-meta">' +
            '<span class="price">' + brl(r.preco) + '</span>' +
            '<span><i class="far fa-clock"></i> ' + formatDuracao(r.duracao) + '</span>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="ac-upsell-item-add">' + (aceito ? '✓ Adicionado' : 'Adicionar') + '</button>' +
      '</div>';
    }).join('');

    $$('.ac-upsell-item-add', list).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = btn.closest('.ac-upsell-item');
        var recId = item && item.getAttribute('data-rec-id');
        var rec = state.recomendacoes.filter(function (r) { return r.id === recId; })[0];
        if (!rec) return;
        var jaAceito = state.acceptedUpsells.some(function (a) { return a.id === rec.id; });
        if (jaAceito) return;
        // Não duplicar com o serviço principal
        if (state.selectedServico && state.selectedServico.id === rec.id) return;
        state.acceptedUpsells.push(rec);
        item.classList.add('added');
        btn.textContent = '✓ Adicionado';
      });
    });

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeUpsellModalAndContinue() {
    var modal = $('#ac-modal-upsell');
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
    goToStep(2);
  }

  function dismissUpsell() {
    state.acceptedUpsells = [];
    closeUpsellModalAndContinue();
  }


  /* ============================================================
     STEP 0: lógica de identificação e cadastro
     ============================================================ */
  async function identificarClientePorTelefone() {
    var input = $('#ac-id-tel');
    var fb = $('#ac-id-feedback');
    fb.hidden = true;
    var tel = (input.value || '').trim();
    var digits = tel.replace(/\D/g,'');
    if (digits.length < 10) {
      fb.hidden = false; fb.textContent = 'Informe um telefone válido com DDD.';
      return;
    }
    var btn = $('#ac-id-continuar');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
    try {
      var tenantId = state.tenant && state.tenant.tenant_id;
      var result = await ClienteService.buscarPorTelefone(tenantId, tel);
      if (result.found) {
        state.cliente = result.cliente;
        // Carrega pacotes ativos imediatamente
        try {
          state.pacotesAtivosCliente = await PacoteService.listarAtivosDoCliente(tenantId, state.cliente.id);
        } catch(e) { state.pacotesAtivosCliente = []; }
        // Mostra painel de Meus Agendamentos (substitui a antiga saudação)
        var card = input.closest('.ac-identify-card');
        if (card) card.style.display = 'none';
        var found = $('#ac-id-found'); if (found) found.hidden = true;
        showMyAppointments();
      } else {
        // Abrir modal de cadastro com telefone preenchido
        $('#ac-cad-tel').value = formatTelefoneDisplay(tel);
        $('#ac-cad-nome').value = '';
        $('#ac-cad-nasc').value = '';
        $('#ac-cad-feedback').hidden = true;
        $('#ac-modal-cadastro').hidden = false;
        document.body.style.overflow = 'hidden';
        setTimeout(function(){ $('#ac-cad-nome').focus(); }, 50);
      }
    } catch(e) {
      console.error('[ac] identificar erro', e);
      fb.hidden = false; fb.textContent = 'Não foi possível verificar agora. Tente de novo.';
    } finally {
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-arrow-right"></i> Continuar';
    }
  }

  async function cadastrarNovoCliente() {
    var nome = ($('#ac-cad-nome').value || '').trim();
    var tel  = ($('#ac-cad-tel').value || '').trim();
    var nasc = $('#ac-cad-nasc').value || null;
    var fb = $('#ac-cad-feedback');
    fb.hidden = true;
    if (nome.length < 2) { fb.hidden = false; fb.textContent = 'Informe seu nome completo.'; return; }
    var btn = $('#ac-btn-cadastrar');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cadastrando...';
    try {
      var tenantId = state.tenant && state.tenant.tenant_id;
      var novo = await ClienteService.cadastrar(tenantId, { nome: nome, telefone: tel, nascimento: nasc });
      state.cliente = novo;
      try {
        state.pacotesAtivosCliente = await PacoteService.listarAtivosDoCliente(tenantId, state.cliente.id);
      } catch(e) { state.pacotesAtivosCliente = []; }
      $('#ac-modal-cadastro').hidden = true;
      document.body.style.overflow = '';
      // Mostra painel de Meus Agendamentos
      var card = $('#ac-id-tel').closest('.ac-identify-card');
      if (card) card.style.display = 'none';
      var found = $('#ac-id-found'); if (found) found.hidden = true;
      showMyAppointments();
    } catch(e) {
      console.error('[ac] cadastrar erro', e);
      fb.hidden = false; fb.textContent = (e && e.message) || 'Não foi possível cadastrar.';
    } finally {
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Cadastrar e continuar';
    }
  }

  /* ============================================================
     AUTO-IDENTIFICAÇÃO (Link Mágico / WhatsApp)
     Reutiliza EXATAMENTE a mesma lógica e o mesmo componente
     "Seus agendamentos" (#ac-my-appts) usado no fluxo de
     Agendamento Externo. Chamado por agendamento-whatsapp.js
     quando o cliente já vem identificado (nome + telefone).
     A ÚNICA diferença é a origem da identificação: aqui não há
     digitação de telefone — os dados chegam prontos do WhatsApp.
     ============================================================ */
  async function autoIdentificarCliente(nome, telefone, options) {
    options = options || {};

    // Aguarda o boot terminar (tenant carregado e eventos do fluxo externo registrados).
    var waited = 0;
    while (waited < 15000 && !(state.tenant && state.tenant.tenant_id && state.eventsBound)) {
      await new Promise(function (r) { setTimeout(r, 80); });
      waited += 80;
    }
    var tenantId = state.tenant && state.tenant.tenant_id;
    if (!tenantId) { console.warn('[ac] autoIdentificar: tenant não carregado'); return { route: 'unknown' }; }

    try {
      var result = null;
      var tokenClienteId = options.cliente_id || options.clienteId || null;
      var telDigits = onlyDigits(telefone || options.telefone || '');

      // IMPORTANTE: para que o Link Mágico produza EXATAMENTE o mesmo resultado
      // do fluxo externo (pacotes, sessões, valores, agendamentos), a identidade
      // do consumidor precisa ser a MESMA. A fonte da verdade é o cadastro do
      // cliente resolvido por telefone — o mesmo caminho do fluxo externo.
      // O cliente_id do token pode apontar para outro registro (ex.: contato do
      // WhatsApp) e por isso NÃO é usado diretamente para buscar dados.
      if (telDigits.length >= 10) {
        result = await ClienteService.buscarPorTelefone(tenantId, telefone);
        if (result && result.found) {
          state.cliente = result.cliente;
        } else {
          // Cliente novo: cadastra com os dados vindos do WhatsApp.
          state.cliente = await ClienteService.cadastrar(tenantId, { nome: nome, telefone: telefone, nascimento: null });
          result = { found: false };
        }
      } else if (tokenClienteId) {
        // Sem telefone utilizável: usa a identidade do token como último recurso.
        state.cliente = {
          id: tokenClienteId,
          nome: nome || options.nome || '',
          telefone: telefone || options.telefone || ''
        };
        result = { found: true, fromToken: true };
      } else {
        throw new Error('cliente-nao-identificado');
      }

      // Carrega pacotes ativos ANTES de exibir a tela — EXATAMENTE como o fluxo
      // externo (identificarClientePorTelefone/cadastrarNovoCliente) faz. Assim
      // os pacotes já estão disponíveis para a escolha de serviço e o valor é
      // calculado de forma idêntica nos dois fluxos.
      try {
        state.pacotesAtivosCliente = await PacoteService.listarAtivosDoCliente(tenantId, state.cliente.id);
      } catch (e) { state.pacotesAtivosCliente = []; }

      // Reutiliza EXATAMENTE o mesmo componente/estado do fluxo externo,
      // inclusive carregamento, lista, estado vazio e botão "+ Novo agendamento".
      await showMyAppointments();

      return { route: result && result.fromToken ? 'token' : ((result && result.found) ? 'existing' : 'new'), cliente_id: state.cliente.id };

    } catch (e) {
      console.error('[ac] autoIdentificar erro', e);
      return { route: 'error', error: e };
    }
  }
  window.__acAutoIdentify = autoIdentificarCliente;

  function showDisabled(msg) {
    console.log('[ac] showDisabled chamado:', msg);
    var app = $('#ac-app'); if (app) { app.hidden = true; app.style.display = 'none'; }
    var loader = $('#ac-boot-loader'); if (loader) { loader.hidden = true; loader.style.display = 'none'; }
    var dis = $('#ac-disabled'); if (dis) { dis.hidden = false; dis.style.display = 'flex'; }
    if (msg) { var m = $('#ac-disabled-msg'); if (m) m.textContent = msg; }
  }

  /* ============================================================
     MEUS AGENDAMENTOS — listagem, edição e cancelamento
     Requer RPCs públicas:
       - get_public_client_agendamentos(_tenant_id uuid, _cliente_id uuid)
       - cancel_public_agendamento(_tenant_id uuid, _cliente_id uuid, _agendamento_id uuid)
     ============================================================ */
  var MyAppointmentsService = {
    async listarFuturos(tenantId, clienteId) {
      var sb = initSupabase();
      if (!sb) { console.warn('[ac] listarFuturos: Supabase não inicializado'); return []; }
      try {
        console.log('[ac] listarFuturos → tenant:', tenantId, 'cliente:', clienteId);
        var r = await withTimeout(
          sb.rpc('get_public_client_agendamentos', { _tenant_id: tenantId, _cliente_id: clienteId }),
          REQ_TIMEOUT, 'rpc:get_public_client_agendamentos'
        );
        if (r.error) {
          console.error('[ac] RPC get_public_client_agendamentos ERRO:', r.error);
          return [];
        }
        var data = Array.isArray(r.data) ? r.data : [];
        console.log('[ac] listarFuturos ← retornou', data.length, 'agendamentos', data);
        return data;
      } catch (e) {
        console.warn('[ac] listarFuturos timeout/erro', e && e.message);
        return [];
      }
    },

    async cancelar(tenantId, clienteId, agendamentoId) {
      var sb = initSupabase();
      if (!sb) throw new Error('Sem conexão.');
      var r = await withTimeout(
        sb.rpc('cancel_public_agendamento', {
          _tenant_id: tenantId, _cliente_id: clienteId, _agendamento_id: agendamentoId
        }),
        REQ_TIMEOUT, 'rpc:cancel_public_agendamento'
      );
      if (r.error) throw r.error;
      return true;
    }
  };

  function _weekdayBR(iso) {
    try {
      var d = new Date(iso + 'T00:00:00');
      var wd = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
      return wd[d.getDay()] || '';
    } catch(e){ return ''; }
  }

  async function showMyAppointments() {
    var panel = $('#ac-my-appts');
    if (!panel) return;
    goToStep(0);
    panel.hidden = false;

    // Oculta somente os controles de identificação. Mantém header/banner,
    // layout e estrutura do Agendamento Externo intactos.
    var idTelEl = $('#ac-id-tel');
    var card = idTelEl && idTelEl.closest('.ac-identify-card');
    if (card) card.style.display = 'none';
    var found = $('#ac-id-found'); if (found) found.hidden = true;

    // Remove a saudação da etapa de identificação ("Olá! Vamos começar /
    // Informe seu telefone para identificarmos seu cadastro"). Essa mensagem
    // pertence apenas ao passo de identificação e não faz sentido em
    // "Seus agendamentos". A tela deve iniciar direto em "Seus agendamentos".
    var step0 = document.querySelector('.ac-step-content[data-step-content="0"]');
    if (step0) {
      step0.querySelectorAll('.ac-section-head').forEach(function (h) {
        if (!h.closest('#ac-my-appts')) h.style.display = 'none';
      });
    }


    var loading = $('#ac-my-appts-loading');
    var listEl  = $('#ac-appts-list');
    var emptyEl = $('#ac-appts-empty');
    if (loading) loading.hidden = false;
    if (listEl) listEl.innerHTML = '';
    if (emptyEl) emptyEl.hidden = true;

    var tenantId = state.tenant && state.tenant.tenant_id;
    var clienteId = state.cliente && state.cliente.id;
    if (!tenantId || !clienteId) { if (loading) loading.hidden = true; return; }

    var lista = [];
    try {
      lista = await MyAppointmentsService.listarFuturos(tenantId, clienteId);
    } catch (e) { console.warn('[ac] erro ao listar agendamentos', e); }

    if (loading) loading.hidden = true;
    state.myAppointments = lista;
    renderMyAppointments();
  }

  function renderMyAppointments() {
    var listEl  = $('#ac-appts-list');
    var emptyEl = $('#ac-appts-empty');
    var lista = state.myAppointments || [];
    if (!listEl) return;

    if (lista.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    // Ordena por data + hora ascendente
    lista.sort(function(a,b){
      var ka = String(a.data) + ' ' + String(a.hora);
      var kb = String(b.data) + ' ' + String(b.hora);
      return ka < kb ? -1 : (ka > kb ? 1 : 0);
    });

    listEl.innerHTML = lista.map(function (ap) {
      var dataBR = formatDateBR(ap.data);
      var wd = _weekdayBR(ap.data);
      var hora = String(ap.hora || '').slice(0,5);
      var dur = formatDuracao(Number(ap.duracao || 30));
      var servicoNome = ap.servico_nome || 'Serviço';
      var profNome = ap.profissional_nome || '—';
      return '<div class="ac-appt-card" data-appt-id="' + escapeHtml(ap.id) + '">' +
        '<div class="ac-appt-icon"><i class="far fa-calendar"></i></div>' +
        '<div class="ac-appt-body">' +
          '<div class="ac-appt-date">' +
            '<span class="ac-appt-date-main">' + escapeHtml(dataBR) + '</span>' +
            '<span class="ac-appt-date-weekday">' + escapeHtml(wd) + '</span>' +
            '<span class="ac-appt-date-time">' + escapeHtml(hora) + '</span>' +
          '</div>' +
          '<div class="ac-appt-info">' +
            '<span class="ac-appt-service">' + escapeHtml(servicoNome) + '</span>' +
            '<span class="ac-appt-prof">Profissional: ' + escapeHtml(profNome) + '</span>' +
            '<span class="ac-appt-duration"><i class="far fa-clock"></i> ' + escapeHtml(dur) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="ac-appt-actions">' +
          '<button type="button" class="ac-appt-btn ac-appt-btn-edit" data-edit-appt="' + escapeHtml(ap.id) + '" aria-label="Editar"><i class="fas fa-pen"></i></button>' +
          '<button type="button" class="ac-appt-btn ac-appt-btn-delete" data-cancel-appt="' + escapeHtml(ap.id) + '" aria-label="Excluir"><i class="fas fa-trash"></i></button>' +
        '</div>' +
      '</div>';
    }).join('');

    // bind buttons
    $$('[data-cancel-appt]', listEl).forEach(function (btn) {
      btn.addEventListener('click', function () {
        openCancelAppointmentModal(btn.getAttribute('data-cancel-appt'));
      });
    });
    $$('[data-edit-appt]', listEl).forEach(function (btn) {
      btn.addEventListener('click', function () {
        openEditAppointmentModal(btn.getAttribute('data-edit-appt'));
      });
    });
  }

  function _findAppt(id) {
    return (state.myAppointments || []).filter(function(a){ return a.id === id; })[0];
  }

  function openCancelAppointmentModal(id) {
    var ap = _findAppt(id); if (!ap) return;
    state.pendingCancelApptId = id;
    var info = $('#ac-cancel-appt-info');
    if (info) {
      info.innerHTML =
        '<strong>' + escapeHtml(ap.servico_nome || 'Serviço') + '</strong>' +
        '<span>' + escapeHtml(formatDateBR(ap.data)) + ' às ' + escapeHtml(String(ap.hora||'').slice(0,5)) +
        ' — Profissional: ' + escapeHtml(ap.profissional_nome || '—') + '</span>';
    }
    var fb = $('#ac-cancel-appt-feedback'); if (fb) { fb.hidden = true; fb.textContent = ''; }
    var modal = $('#ac-modal-cancel-appt'); if (modal) { modal.hidden = false; document.body.style.overflow = 'hidden'; }
  }

  function closeCancelAppointmentModal() {
    var modal = $('#ac-modal-cancel-appt'); if (modal) modal.hidden = true;
    document.body.style.overflow = '';
    state.pendingCancelApptId = null;
  }

  async function confirmCancelAppointment() {
    var id = state.pendingCancelApptId;
    if (!id) return closeCancelAppointmentModal();
    var btn = $('#ac-btn-confirmar-cancel-appt');
    var fb = $('#ac-cancel-appt-feedback');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelando...'; }
    try {
      var tenantId = state.tenant && state.tenant.tenant_id;
      var clienteId = state.cliente && state.cliente.id;
      await MyAppointmentsService.cancelar(tenantId, clienteId, id);
      // Remove da lista local
      state.myAppointments = (state.myAppointments || []).filter(function(a){ return a.id !== id; });
      renderMyAppointments();
      closeCancelAppointmentModal();
      showToast('Agendamento cancelado com sucesso.', 'success');
    } catch (e) {
      console.error('[ac] cancelar agendamento erro', e);
      if (fb) { fb.hidden = false; fb.textContent = (e && e.message) || 'Não foi possível cancelar. Tente novamente.'; }
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash"></i> Confirmar cancelamento'; }
    }
  }

  function openEditAppointmentModal(id) {
    var ap = _findAppt(id); if (!ap) return;
    state.pendingEditApptId = id;
    var info = $('#ac-edit-appt-info');
    if (info) {
      info.innerHTML =
        '<strong>' + escapeHtml(ap.servico_nome || 'Serviço') + '</strong>' +
        '<span>' + escapeHtml(formatDateBR(ap.data)) + ' às ' + escapeHtml(String(ap.hora||'').slice(0,5)) +
        ' — Profissional: ' + escapeHtml(ap.profissional_nome || '—') + '</span>';
    }
    var modal = $('#ac-modal-edit-appt'); if (modal) { modal.hidden = false; document.body.style.overflow = 'hidden'; }
  }

  function closeEditAppointmentModal() {
    var modal = $('#ac-modal-edit-appt'); if (modal) modal.hidden = true;
    document.body.style.overflow = '';
    state.pendingEditApptId = null;
  }

  async function confirmEditAppointment() {
    var id = state.pendingEditApptId;
    if (!id) return closeEditAppointmentModal();
    var ap = _findAppt(id);
    if (!ap) return closeEditAppointmentModal();

    var btn = $('#ac-btn-confirmar-edit-appt');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparando...'; }
    try {
      var tenantId = state.tenant && state.tenant.tenant_id;
      var clienteId = state.cliente && state.cliente.id;
      // Cancela o antigo para liberar o slot e evitar duplicidade
      await MyAppointmentsService.cancelar(tenantId, clienteId, id);
      state.myAppointments = (state.myAppointments || []).filter(function(a){ return a.id !== id; });
      renderMyAppointments();
      closeEditAppointmentModal();
      showToast('Escolha as novas informações do agendamento.', 'info');

      // Esconde painel de Meus Agendamentos e inicia fluxo com o serviço pré-selecionado
      var panel = $('#ac-my-appts'); if (panel) panel.hidden = true;
      // Se o serviço ainda existir na lista pública, pré-selecionar
      var srvId = ap.servico_id;
      if (srvId && (state.servicos || []).some(function(s){ return s.id === srvId; })) {
        selectServico(srvId);
      } else {
        goToStep(1);
      }
    } catch (e) {
      console.error('[ac] editar (cancelar antigo) erro', e);
      showToast((e && e.message) || 'Não foi possível iniciar a edição.', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-arrow-right"></i> Continuar'; }
    }
  }

  function startNewFromMyAppointments() {
    var panel = $('#ac-my-appts'); if (panel) panel.hidden = true;
    var search = $('#ac-search-servico');
    if (search) search.value = '';
    renderServicos();
    goToStep(1);
  }

  /* ============================================================
     10. BOOT — com proteção total contra travamentos
     ============================================================ */
  async function boot() {
    // Hard-stop de segurança: se em 12s nada renderizou, mostra estado "indisponível"
    var safetyTimer = setTimeout(function () {
      if (!$('#ac-boot-loader').hidden) {
        console.error('[ac] boot safety timeout — exibindo tela indisponível');
        showDisabled('Tempo de resposta excedido. Tente novamente em instantes.');
      }
    }, 12000);

    try {
      var tenantId = getTenantIdFromUrl();
      console.log('[ac] tenantId resolvido:', tenantId, '— pathname:', window.location.pathname);

      // Espera supabase-js estar pronto (até 1.5s) — opcional
      var waited = 0;
      while (waited < 1500 && (typeof window.supabase === 'undefined' || !window.supabase.createClient)) {
        await new Promise(function (r) { setTimeout(r, 50); });
        waited += 50;
      }

      // Sem tenantId E sem Supabase → modo DEMO (preview/dev)
      // Com tenantId mas sem Supabase configurado → também DEMO (assume que é preview)
      var sb = initSupabase();
      if (!sb && tenantId) {
        console.warn('[ac] tenantId presente mas Supabase não configurado — caindo em modo DEMO');
      }

      console.log('[ac] boot: chamando carregarTenant...');
      var tenant = await TenantDataService.carregarTenant(tenantId);
      console.log('[ac] boot: carregarTenant retornou:', tenant);

      // Aplica tema do tenant (cores configuradas no app interno) o quanto antes
      try {
        var _theme = await loadTenantTheme(tenantId);
        if (_theme) { applyTenantTheme(_theme); console.log('[ac] boot: tema do tenant aplicado'); }
      } catch (e) { console.warn('[ac] boot: falha ao aplicar tema do tenant', e); }

      if (!tenant) {
        clearTimeout(safetyTimer);
        return showDisabled('Estabelecimento não encontrado.');
      }
      if (tenant.habilitado === false) {
        clearTimeout(safetyTimer);
        return showDisabled('O estabelecimento não está aceitando agendamentos online no momento.');
      }

      state.tenant = tenant;
      console.log('[ac] boot: escondendo loader e renderizando tenant');
      var bootLoader = $('#ac-boot-loader'); if (bootLoader) { bootLoader.hidden = true; bootLoader.style.display = 'none'; }
      var appEl = $('#ac-app'); if (appEl) { appEl.hidden = false; appEl.style.display = ''; } else { console.error('[ac] boot: #ac-app NAO existe no DOM!'); }

      try { renderTenant(); console.log('[ac] boot: renderTenant OK'); }
      catch(e){ console.error('[ac] renderTenant FALHOU:', e, e && e.stack); }

      console.log('[ac] boot: carregando servicos...');
      try {
        state.servicos = await TenantDataService.listarServicos();
        state.servicesReady = true;
        console.log('[ac] boot: servicos carregados:', state.servicos.length, 'amostra=', state.servicos[0]);
      } catch (e) {
        console.error('[ac] boot: ERRO ao carregar servicos:', e, e && e.stack);
        state.servicos = [];
        state.servicesReady = true;
      }

      try {
        renderServicos();
        console.log('[ac] boot: renderServicos OK');
      } catch (e) {
        console.error('[ac] boot: ERRO em renderServicos:', e, e && e.stack);
      }

      try {
        bindEvents();
        console.log('[ac] boot: bindEvents OK');
      } catch (e) {
        console.error('[ac] boot: ERRO em bindEvents:', e, e && e.stack);
      }

      clearTimeout(safetyTimer);
      console.log('[ac] boot: FIM — fluxo pronto');
    } catch (e) {
      clearTimeout(safetyTimer);
      console.error('[ac] boot error', e, e && e.stack);
      showDisabled('Nao foi possivel carregar o agendamento. Tente novamente.');
    }
  }

  function bindEvents() {
    if (state.eventsBound) {
      console.log('[ac] bindEvents: já registrado');
      return;
    }
    state.eventsBound = true;
    console.log('[ac] bindEvents: inicio');
    var search = $('#ac-search-servico');
    if (search) search.addEventListener('input', function (e) { renderServicos(e.target.value); });
    else console.warn('[ac] bindEvents: #ac-search-servico ausente');

    $$('.ac-step').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var n = parseInt(btn.getAttribute('data-step'), 10);
        if (n < state.step) goToStep(n);
      });
    });
    $$('[data-back-to]').forEach(function (btn) {
      btn.addEventListener('click', function () { goToStep(parseInt(btn.getAttribute('data-back-to'), 10)); });
    });

    var calPrev = $('#ac-cal-prev');
    if (calPrev) calPrev.addEventListener('click', function () {
      var hoje = new Date();
      if (state.calYear < hoje.getFullYear() ||
         (state.calYear === hoje.getFullYear() && state.calMonth <= hoje.getMonth())) return;
      state.calMonth--;
      if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
      renderCalendar();
    });
    var calNext = $('#ac-cal-next');
    if (calNext) calNext.addEventListener('click', function () {
      state.calMonth++;
      if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
      renderCalendar();
    });

    $$('[data-close-modal]').forEach(function (el) { el.addEventListener('click', closeModals); });
    $$('[data-close-upsell]').forEach(function (el) { el.addEventListener('click', dismissUpsell); });
    var btnUpsellCont = $('#ac-btn-upsell-continue');
    if (btnUpsellCont) btnUpsellCont.addEventListener('click', closeUpsellModalAndContinue);
    var btnConf = $('#ac-btn-confirmar');
    if (btnConf) btnConf.addEventListener('click', confirmarAgendamento);
    else console.warn('[ac] bindEvents: #ac-btn-confirmar ausente');
    var btnNovo = $('#ac-btn-novo');
    if (btnNovo) btnNovo.addEventListener('click', resetFlow);
    else console.warn('[ac] bindEvents: #ac-btn-novo ausente');

    var tel = $('#ac-input-tel');
    if (tel) tel.addEventListener('input', function () {
      var v = tel.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 6)      tel.value = '(' + v.slice(0,2) + ') ' + v.slice(2,7) + '-' + v.slice(7);
      else if (v.length > 2) tel.value = '(' + v.slice(0,2) + ') ' + v.slice(2);
      else                   tel.value = v;
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var upsellModal = $('#ac-modal-upsell');
        if (upsellModal && !upsellModal.hidden) { dismissUpsell(); return; }
        closeModals();
      }
    });

    // ===== STEP 0: identificação por telefone =====
    var idTel = $('#ac-id-tel');
    if (idTel) idTel.addEventListener('input', function(){
      var v = idTel.value.replace(/\D/g,'').slice(0,11);
      if (v.length > 6)      idTel.value = '(' + v.slice(0,2) + ') ' + v.slice(2,7) + '-' + v.slice(7);
      else if (v.length > 2) idTel.value = '(' + v.slice(0,2) + ') ' + v.slice(2);
      else                   idTel.value = v;
    });

    var idBtn = $('#ac-id-continuar');
    if (idBtn) idBtn.addEventListener('click', identificarClientePorTelefone);
    if (idTel) idTel.addEventListener('keydown', function(e){
      if (e.key === 'Enter') { e.preventDefault(); identificarClientePorTelefone(); }
    });

    var idSeguir = $('#ac-id-seguir');
    if (idSeguir) idSeguir.addEventListener('click', function(){ goToStep(1); });

    // ===== Modal de cadastro =====
    $$('[data-close-cadastro]').forEach(function(el){
      el.addEventListener('click', function(){
        $('#ac-modal-cadastro').hidden = true;
        document.body.style.overflow = '';
      });
    });
    var cadTel = $('#ac-cad-tel');
    var cadBtn = $('#ac-btn-cadastrar');
    if (cadBtn) cadBtn.addEventListener('click', cadastrarNovoCliente);

    // ===== MEUS AGENDAMENTOS =====
    var btnNovoAppt = $('#ac-my-appts-new');
    if (btnNovoAppt) btnNovoAppt.addEventListener('click', startNewFromMyAppointments);

    $$('[data-close-cancel-appt]').forEach(function(el){
      el.addEventListener('click', closeCancelAppointmentModal);
    });
    var btnConfirmCancelAppt = $('#ac-btn-confirmar-cancel-appt');
    if (btnConfirmCancelAppt) btnConfirmCancelAppt.addEventListener('click', confirmCancelAppointment);

    $$('[data-close-edit-appt]').forEach(function(el){
      el.addEventListener('click', closeEditAppointmentModal);
    });
    var btnConfirmEditAppt = $('#ac-btn-confirmar-edit-appt');
    if (btnConfirmEditAppt) btnConfirmEditAppt.addEventListener('click', confirmEditAppointment);

    // Botão do estado vazio "Novo agendamento" (o mesmo #ac-my-appts-new já está no topo)
    // Estado vazio não tem botão próprio para evitar duplicação; o topo permanece sempre visível.

    console.log('[ac] bindEvents: fim');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
