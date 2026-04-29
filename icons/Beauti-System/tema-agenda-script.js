(function() {
  'use strict';

  /* ══════════════════════════════════════════════
     UTILIDADES DE COR
     ══════════════════════════════════════════════ */
  function hexToRgb(hex) {
    if (!hex) return { r: 0, g: 0, b: 0 };
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    return {
      r: parseInt(hex.substring(0, 2), 16),
      g: parseInt(hex.substring(2, 4), 16),
      b: parseInt(hex.substring(4, 6), 16)
    };
  }

  function hexToRgba(hex, alpha) {
    var rgb = hexToRgb(hex);
    return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')';
  }

  function hexToHSL(hex) {
    hex = hex.replace('#', '');
    var r = parseInt(hex.substr(0, 2), 16) / 255;
    var g = parseInt(hex.substr(2, 2), 16) / 255;
    var b = parseInt(hex.substr(4, 2), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2;
    var r, g, b;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    var toHex = function(v) {
      var hx = Math.round((v + m) * 255).toString(16);
      return hx.length === 1 ? '0' + hx : hx;
    };
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  function isDarkColor(hex) {
    var rgb = hexToRgb(hex);
    return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255 < 0.55;
  }

  function pickContrast(hex, lightColor, darkColor) {
    return isDarkColor(hex) ? lightColor : darkColor;
  }

  function generateAccentVariations(hex) {
    var hsl = hexToHSL(hex);
    return {
      gold: hex,
      gold_light: hslToHex(hsl.h, Math.min(hsl.s + 8, 100), Math.min(hsl.l + 12, 92)),
      gold_dark: hslToHex(hsl.h, hsl.s, Math.max(hsl.l - 16, 10)),
      gold_bg: hexToRgba(hex, 0.08),
      gold_border: hexToRgba(hex, 0.20)
    };
  }

  /* ══════════════════════════════════════════════
     DEFAULTS — Fonte única de verdade
     ══════════════════════════════════════════════ */
  var DEFAULTS = {
    gold: '#6C3AED',
    gold_light: '#8B5CF6',
    gold_dark: '#5B21B6',
    gold_bg: 'rgba(108,58,237,0.08)',
    gold_border: 'rgba(108,58,237,0.20)',
    bg: '#F8F8F6',
    card: '#FFFFFF',
    card_hover: '#F0F0EE',
    sidebar_bg: '#1B1340',
    font: 'Inter',
    logo_url: null,
    text_color: '#1A1A2E',
    cal_border: '#E5E7EB',
    cal_text: '#6B7280',
    cal_month: '#1A1A2E',
    cal_selected_bg: '#6C3AED',
    cal_selected_text: '#FFFFFF',
    // Appointment block
    appt_border_color: '#6C3AED',
    appt_time_color: '#6C3AED',
    appt_client_color: '#1A1A2E',
    appt_service_color: '#6B7280',
    appt_bg_color: 'rgba(108,58,237,0.08)',
    page_title_color: '#1A1A2E',
    // Surface / Modal (novos)
    modal_bg: null,
    input_bg: null,
    text_muted_color: null
  };

  var currentTheme = Object.assign({}, DEFAULTS);
  var temaLogoFile = null;

  /* ══════════════════════════════════════════════
     PICKR — Configuração e instâncias
     ══════════════════════════════════════════════ */
  var pickrInstances = {};

  var PICKR_CONFIG = [
    // Bloco 1 — Global
    { id: 'tema-gold',              themeKey: 'gold',              hasHexInput: 'tema-gold-hex',        block: 1 },
    { id: 'tema-bg',                themeKey: 'bg',                label: 'tema-bg-label',              block: 1 },
    { id: 'tema-sidebar-bg',        themeKey: 'sidebar_bg',        label: 'tema-sidebar-bg-label',      block: 1 },
    { id: 'tema-text-color',        themeKey: 'text_color',        hasHexInput: 'tema-text-color-hex',  block: 1 },
    { id: 'tema-page-title-color',  themeKey: 'page_title_color',  label: 'tema-page-title-color-label',block: 1 },
    // Bloco 2 — Calendário
    { id: 'tema-card',              themeKey: 'card',              label: 'tema-card-label',            block: 2 },
    { id: 'tema-card-hover',        themeKey: 'card_hover',        label: 'tema-card-hover-label',      block: 2 },
    { id: 'tema-cal-border',        themeKey: 'cal_border',        label: 'tema-cal-border-label',      block: 2 },
    { id: 'tema-cal-text',          themeKey: 'cal_text',          label: 'tema-cal-text-label',        block: 2 },
    { id: 'tema-cal-month',         themeKey: 'cal_month',         label: 'tema-cal-month-label',       block: 2 },
    { id: 'tema-cal-selected-bg',   themeKey: 'cal_selected_bg',   label: 'tema-cal-selected-bg-label', block: 2 },
    { id: 'tema-cal-selected-text', themeKey: 'cal_selected_text', label: 'tema-cal-selected-text-label',block: 2 },
    // Bloco 3 — Agendamento
    { id: 'tema-appt-border',       themeKey: 'appt_border_color', label: 'tema-appt-border-label',     block: 3 },
    { id: 'tema-appt-time',         themeKey: 'appt_time_color',   label: 'tema-appt-time-label',       block: 3 },
    { id: 'tema-appt-client',       themeKey: 'appt_client_color', label: 'tema-appt-client-label',     block: 3 },
    { id: 'tema-appt-service',      themeKey: 'appt_service_color',label: 'tema-appt-service-label',    block: 3 },
    { id: 'tema-appt-bg',           themeKey: 'appt_bg_color',     label: 'tema-appt-bg-label',         block: 3 }
  ];

  function initPickr(cfg) {
    var el = document.getElementById(cfg.id);
    if (!el) return null;
    var defaultColor = el.getAttribute('data-default') || DEFAULTS[cfg.themeKey] || '#000000';

    var pickr = Pickr.create({
      el: el,
      theme: 'classic',
      container: 'body',
      default: defaultColor,
      swatches: [
        '#6C3AED', '#8B5CF6', '#3B82F6', '#06B6D4', '#10B981',
        '#F59E0B', '#EF4444', '#EC4899', '#1B1340', '#1A1A2E',
        '#F8F8F6', '#FFFFFF', '#F0F0EE', '#E5E7EB', '#6B7280',
        '#000000', '#c8a45a', '#b8860b'
      ],
      components: {
        preview: true,
        opacity: false,
        hue: true,
        interaction: { hex: true, rgba: true, hsla: true, input: true, save: true }
      },
      i18n: { 'btn:save': 'OK' }
    });

    pickr.on('save', function(color) {
      if (!color) return;
      var hex = color.toHEXA().toString();
      currentTheme[cfg.themeKey] = hex;
      syncPickrToUI(cfg, hex);
      if (cfg.themeKey === 'gold') renderColorChips();
      updateBlockPreview(cfg.block);
      pickr.hide();
    });

    pickr.on('change', function(color) {
      if (!color) return;
      var hex = color.toHEXA().toString();
      currentTheme[cfg.themeKey] = hex;
      syncPickrToUI(cfg, hex);
      if (cfg.themeKey === 'gold') renderColorChips();
      updateBlockPreview(cfg.block);
    });

    return pickr;
  }

  function syncPickrToUI(cfg, hex) {
    if (cfg.hasHexInput) {
      var inp = document.getElementById(cfg.hasHexInput);
      if (inp) inp.value = hex;
    }
    if (cfg.label) {
      var lbl = document.getElementById(cfg.label);
      if (lbl) lbl.textContent = hex;
    }
  }

  function initAllPickrs() {
    PICKR_CONFIG.forEach(function(cfg) {
      var p = initPickr(cfg);
      if (p) pickrInstances[cfg.id] = p;
    });
    setupPickrScrollClose();
  }

  function setPickrColor(id, hex) {
    var p = pickrInstances[id];
    if (p && hex) {
      try { p.setColor(hex); } catch(e) { console.warn("setPickrColor error:", e); }
    }
  }

  /* ── Close pickrs on scroll ── */
  function setupPickrScrollClose() {
    var scrollContainers = [document, document.querySelector('.main-content'), document.querySelector('.config-content')];
    scrollContainers.forEach(function(container) {
      if (!container) return;
      (container === document ? window : container).addEventListener('scroll', function() {
        Object.keys(pickrInstances).forEach(function(key) {
          var p = pickrInstances[key];
          if (p && p.isOpen && p.isOpen()) p.hide();
        });
      }, { passive: true });
    });
  }

  /* ══════════════════════════════════════════════
     HELPERS DOM
     ══════════════════════════════════════════════ */
  function setVal(id, value) { var el = document.getElementById(id); if (el) el.value = value; }
  function getVal(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function setLabel(id, value) { var el = document.getElementById(id); if (el) el.textContent = value; }

  function setStyle(id, styles) {
    var el = document.getElementById(id);
    if (!el) return;
    for (var key in styles) el.style[key] = styles[key];
  }

  function ensureDynamicStyle() {
    var style = document.getElementById('tema-dynamic-css');
    if (!style) {
      style = document.createElement('style');
      style.id = 'tema-dynamic-css';
      document.head.appendChild(style);
    }
    return style;
  }

  /* ══════════════════════════════════════════════
     COLOR CHIPS (Variações do accent)
     ══════════════════════════════════════════════ */
  function renderColorChips() {
    var container = document.getElementById('tema-color-chips');
    if (!container) return;
    var vars = generateAccentVariations(currentTheme.gold);
    var items = [
      { label: 'Clara', color: vars.gold_light },
      { label: 'Escura', color: vars.gold_dark },
      { label: 'Fundo', color: vars.gold_bg },
      { label: 'Borda', color: vars.gold_border }
    ];
    container.innerHTML = items.map(function(item) {
      return '<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:var(--bg-card);border:1px solid var(--border);">' +
        '<span style="width:14px;height:14px;border-radius:999px;background:' + item.color + ';border:1px solid rgba(0,0,0,0.08);"></span>' +
        '<span style="font-size:0.78rem;color:var(--text-muted);font-weight:500;">' + item.label + '</span>' +
      '</div>';
    }).join('');
  }

  /* ══════════════════════════════════════════════
     BLOCK PREVIEWS — Cada bloco tem seu preview
     ══════════════════════════════════════════════ */
  function updateBlockPreview(block) {
    if (block === 1 || !block) updatePreviewGlobal();
    if (block === 2 || !block) updatePreviewCalendar();
    if (block === 3 || !block) updatePreviewAppointment();
  }

  function updateAllPreviews() {
    updatePreviewGlobal();
    updatePreviewCalendar();
    updatePreviewAppointment();
  }

  /* ── BLOCO 1: Preview Global (Sidebar + Background + Botões) ── */
  function updatePreviewGlobal() {
    var accent    = currentTheme.gold;
    var bg        = currentTheme.bg;
    var sidebarBg = currentTheme.sidebar_bg;
    var textColor = currentTheme.text_color || DEFAULTS.text_color;
    var pageTitleColor = currentTheme.page_title_color || textColor;
    var font      = currentTheme.font || DEFAULTS.font;
    var vars      = generateAccentVariations(accent);
    var sidebarText  = pickContrast(sidebarBg, '#FFFFFF', '#1A1A2E');
    var sidebarMuted = hexToRgba(sidebarText, 0.66);
    var accentText   = pickContrast(accent, '#FFFFFF', '#111111');

    // Sidebar
    setStyle('tp-sidebar', { background: sidebarBg, color: sidebarText, fontFamily: font });
    setStyle('tp-logo', { background: vars.gold_bg, color: accent, border: '1px solid ' + vars.gold_border });
    setStyle('tp-brand-name', { color: sidebarText });
    setStyle('tp-brand-caption', { color: sidebarMuted });
    setStyle('tp-menu-active', { background: hexToRgba(accent, 0.18), color: '#FFFFFF', borderLeft: '3px solid ' + accent });

    document.querySelectorAll('#tp-sidebar .tema-preview-menu-item:not(.is-active)').forEach(function(el) {
      el.style.color = sidebarMuted;
    });

    // Body
    setStyle('tp-global-body', { background: bg, color: textColor, fontFamily: font });
    setStyle('tp-global-title', { color: pageTitleColor, fontFamily: font });
    setStyle('tp-global-filter-btn', { background: 'transparent', color: accent, border: '1px solid ' + vars.gold_border, fontFamily: font });
    setStyle('tp-global-new-btn', { background: accent, color: accentText, border: 'none', fontFamily: font });

    // Logo preview
    var logoEl = document.getElementById('tp-logo');
    if (logoEl) {
      if (currentTheme.logo_url) {
        logoEl.innerHTML = '<img src="' + currentTheme.logo_url + '" alt="Logo" style="width:100%;height:100%;object-fit:contain;border-radius:12px;">';
      } else {
        logoEl.textContent = 'BS';
      }
    }
  }

  /* ── BLOCO 2: Preview Calendário ── */
  function updatePreviewCalendar() {
    var card      = currentTheme.card;
    var calBorder = currentTheme.cal_border || DEFAULTS.cal_border;
    var calText   = currentTheme.cal_text || DEFAULTS.cal_text;
    var calMonth  = currentTheme.cal_month || DEFAULTS.cal_month;
    var calSelBg  = currentTheme.cal_selected_bg || currentTheme.gold;
    var calSelTxt = currentTheme.cal_selected_text || DEFAULTS.cal_selected_text;
    var font      = currentTheme.font || DEFAULTS.font;

    setStyle('tp-cal-card', { background: card, border: '1px solid ' + calBorder, fontFamily: font });
    setStyle('tp-cal-month', { color: calMonth, fontFamily: font });
    setStyle('tp-cal-nav-l', { color: calText });
    setStyle('tp-cal-nav-r', { color: calText });

    document.querySelectorAll('#tp-cal-weekdays span').forEach(function(el) {
      el.style.color = calText;
    });

    // Build calendar grid
    var grid = document.getElementById('tp-cal-grid');
    if (!grid) return;
    var html = '';
    var startDay = 3; // April 2026 starts on Wednesday
    for (var i = 0; i < startDay; i++) {
      html += '<div class="tema-preview-cal-day is-empty"></div>';
    }
    for (var d = 1; d <= 30; d++) {
      var isSelected = d === 14;
      var isToday = d === new Date().getDate();
      var style = isSelected
        ? 'background:' + calSelBg + ';color:' + calSelTxt + ';font-weight:700;box-shadow:0 4px 12px ' + hexToRgba(calSelBg, 0.3) + ';'
        : (isToday ? 'border:1px solid ' + (currentTheme.gold || DEFAULTS.gold) + ';color:' + (currentTheme.gold || DEFAULTS.gold) + ';' : 'color:' + calText + ';');
      html += '<div class="tema-preview-cal-day' + (isSelected ? ' is-selected' : '') + (isToday && !isSelected ? ' is-today' : '') + '" style="' + style + '">' + d + '</div>';
    }
    grid.innerHTML = html;
  }

  /* ── BLOCO 3: Preview Agendamento ── */
  function updatePreviewAppointment() {
    var borderColor  = currentTheme.appt_border_color || currentTheme.gold;
    var timeColor    = currentTheme.appt_time_color || currentTheme.gold;
    var clientColor  = currentTheme.appt_client_color || currentTheme.text_color || DEFAULTS.text_color;
    var serviceColor = currentTheme.appt_service_color || DEFAULTS.appt_service_color;
    var bgColor      = currentTheme.appt_bg_color || hexToRgba(currentTheme.gold, 0.08);
    var calBorder    = currentTheme.cal_border || DEFAULTS.cal_border;
    var textColor    = currentTheme.text_color || DEFAULTS.text_color;
    var calMonth     = currentTheme.cal_month || DEFAULTS.cal_month;
    var card         = currentTheme.card || DEFAULTS.card;

    // Day header uses same color as calendar month title
    setStyle('tp-appt-day-header', { color: calMonth });
    // Card background
    setStyle('tp-appt-card-bg', { background: card });

    // Timeline hours
    document.querySelectorAll('#tp-appt-timeline .tema-preview-time').forEach(function(el) {
      el.style.color = currentTheme.cal_text || DEFAULTS.cal_text;
    });
    document.querySelectorAll('#tp-appt-timeline .tema-preview-line').forEach(function(el) {
      el.style.borderColor = hexToRgba(textColor, 0.10);
    });

    // Appointment blocks
    document.querySelectorAll('.tp-appt-block').forEach(function(el) {
      el.style.background = bgColor;
      el.style.borderLeft = '4px solid ' + borderColor;
      el.style.border = '1px solid ' + hexToRgba(borderColor, 0.25);
      el.style.borderLeft = '4px solid ' + borderColor;
    });
    document.querySelectorAll('.tp-appt-block .appt-time').forEach(function(el) {
      el.style.color = timeColor;
    });
    document.querySelectorAll('.tp-appt-block .appt-client').forEach(function(el) {
      el.style.color = clientColor;
    });
    document.querySelectorAll('.tp-appt-block .appt-service').forEach(function(el) {
      el.style.color = serviceColor;
    });
  }

  /* ══════════════════════════════════════════════
     APLICAR TEMA NA AGENDA REAL
     Usa EXATAMENTE as mesmas CSS variables do estilos.css
     ══════════════════════════════════════════════ */
  function aplicarTemaNoAgenda(theme) {
    var vars = generateAccentVariations(theme.gold);
    var root = document.documentElement;
    var sidebarText  = pickContrast(theme.sidebar_bg || DEFAULTS.sidebar_bg, '#FFFFFF', '#1A1A2E');
    var sidebarMuted = hexToRgba(sidebarText, 0.76);
    var accentText   = pickContrast(theme.gold, '#FFFFFF', '#111111');

    // Determine if dark theme
    var bgIsDark = isDarkColor(theme.bg);
    var cardIsDark = isDarkColor(theme.card);

    // Surface colors: explicit values win, otherwise smart auto-derive
    var surfaceCard, surfaceInput, surfaceModal;

    if (theme.modal_bg) {
      surfaceModal = theme.modal_bg;
    } else {
      surfaceModal = theme.card;
    }

    if (theme.input_bg) {
      surfaceInput = theme.input_bg;
    } else if (bgIsDark) {
      // Dark theme: derive inputs from card or bg
      if (cardIsDark) {
        // Card is also dark — lighten it slightly for inputs
        var cardHsl = hexToHSL(theme.card);
        surfaceInput = hslToHex(cardHsl.h, cardHsl.s, Math.min(cardHsl.l + 6, 95));
      } else {
        // bg dark but card light (user set explicitly) — keep card_hover
        surfaceInput = theme.card_hover;
      }
    } else {
      surfaceInput = theme.card === '#FFFFFF' ? '#F9FAFB' : theme.card_hover;
    }

    surfaceCard = theme.card;

    // Auto-fix: if bg is dark but card is still default white, derive dark card
    if (bgIsDark && theme.card === '#FFFFFF') {
      var bgHsl = hexToHSL(theme.bg);
      surfaceCard = hslToHex(bgHsl.h, Math.min(bgHsl.s, 20), Math.min(bgHsl.l + 8, 28));
      surfaceModal = theme.modal_bg || surfaceCard;
      surfaceInput = theme.input_bg || hslToHex(bgHsl.h, Math.min(bgHsl.s, 20), Math.min(bgHsl.l + 12, 32));
    }

    // Derive muted text color
    var textMutedColor = theme.text_muted_color || hexToRgba(theme.text_color || DEFAULTS.text_color, 0.55);

    // ── CSS Variables (matching estilos.css :root) ──
    root.style.setProperty('--gold', theme.gold);
    root.style.setProperty('--gold-light', vars.gold_light);
    root.style.setProperty('--gold-dark', vars.gold_dark);
    root.style.setProperty('--gold-bg', vars.gold_bg);
    root.style.setProperty('--gold-border', vars.gold_border);
    root.style.setProperty('--sidebar-bg', theme.sidebar_bg);
    root.style.setProperty('--sidebar-active', hexToRgba(theme.gold, 0.18));
    root.style.setProperty('--sidebar-text', sidebarText === '#FFFFFF' ? '#C4B5FD' : sidebarText);
    root.style.setProperty('--sidebar-text-active', '#FFFFFF');
    root.style.setProperty('--bg', theme.bg);
    root.style.setProperty('--bg-card', theme.card);
    root.style.setProperty('--bg-card-hover', theme.card_hover);
    root.style.setProperty('--text', theme.text_color || DEFAULTS.text_color);
    root.style.setProperty('--text-muted', hexToRgba(theme.text_color || DEFAULTS.text_color, 0.55));
    root.style.setProperty('--border', theme.cal_border || DEFAULTS.cal_border);
    // Surface tokens
    root.style.setProperty('--surface-input', surfaceInput);
    root.style.setProperty('--surface-card', surfaceCard);
    root.style.setProperty('--surface-dropdown', surfaceCard);
    root.style.setProperty('--surface-modal', surfaceModal);
    root.style.setProperty('--modal-text', theme.text_color || DEFAULTS.text_color);
    root.style.setProperty('--modal-label', theme.text_color || DEFAULTS.text_color);
    root.style.setProperty('--modal-border', theme.cal_border || DEFAULTS.cal_border);

    // Font
    root.style.setProperty('--font', (theme.font || DEFAULTS.font) + ', sans-serif');

    // Logo
    var sidebarLogoEl = document.getElementById('sidebar-logo');
    if (sidebarLogoEl && theme.logo_url) {
      sidebarLogoEl.src = theme.logo_url;
    }

    // ── Dynamic CSS for elements not covered by variables ──
    var style = ensureDynamicStyle();
    var pageTitleColor = theme.page_title_color || theme.text_color || DEFAULTS.text_color;
    var apptBorder  = theme.appt_border_color || theme.gold;
    var apptTime    = theme.appt_time_color || theme.gold;
    var apptClient  = theme.appt_client_color || theme.text_color || DEFAULTS.text_color;
    var apptService = theme.appt_service_color || DEFAULTS.appt_service_color;
    var apptBg      = theme.appt_bg_color || hexToRgba(theme.gold, 0.08);
    var calMonth    = theme.cal_month || DEFAULTS.cal_month;
    var calText     = theme.cal_text || DEFAULTS.cal_text;
    var calSelBg    = theme.cal_selected_bg || theme.gold;
    var calSelTxt   = theme.cal_selected_text || DEFAULTS.cal_selected_text;
    var textColor   = theme.text_color || DEFAULTS.text_color;

    style.textContent = [
      '/* Sidebar */',
      '.sidebar { background: ' + theme.sidebar_bg + ' !important; }',
      '.sidebar .brand h2, .sidebar .brand p { color: ' + sidebarText + ' !important; }',
      '.sidebar-nav .nav-btn { color: ' + sidebarMuted + ' !important; }',
      '.sidebar-nav .nav-btn.active, .sidebar-nav .nav-btn:hover { background: ' + hexToRgba(theme.gold, 0.18) + ' !important; color: #fff !important; border-left-color: ' + theme.gold + ' !important; }',

      '/* Buttons */',
      '.btn-novo, .btn-submit { background: linear-gradient(135deg, ' + theme.gold + ', ' + vars.gold_light + ') !important; color: ' + accentText + ' !important; }',
      '.btn-novo:hover, .btn-submit:hover { background: linear-gradient(135deg, ' + vars.gold_light + ', ' + theme.gold + ') !important; }',
      '.btn-filter { color: ' + theme.gold + ' !important; border-color: ' + vars.gold_border + ' !important; }',

      '/* Calendar — ISOLATED scope */',
      '.calendar-card { background: ' + theme.card + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',
      '.day-detail-card { background: ' + theme.card + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',
      '.calendar-nav .month-year { color: ' + calMonth + ' !important; }',
      '.calendar-weekdays span { color: ' + calText + ' !important; }',
      '.calendar-days .calendar-day { color: ' + calText + ' !important; background: transparent !important; }',
      '.calendar-days .calendar-day:hover { background: ' + theme.card_hover + ' !important; }',
      '.calendar-days .calendar-day.selected { background: ' + calSelBg + ' !important; color: ' + calSelTxt + ' !important; }',
      '.calendar-days .calendar-day.today { border-color: ' + theme.gold + ' !important; color: ' + theme.gold + ' !important; }',
      '.calendar-days .calendar-day.today.selected { background: ' + calSelBg + ' !important; color: ' + calSelTxt + ' !important; }',
      '.calendar-nav button { color: ' + calText + ' !important; }',

      '/* Main */',
      'body { background: ' + theme.bg + ' !important; }',
      '.main-content { background: ' + theme.bg + ' !important; }',
      '.page-header h2 { color: ' + pageTitleColor + ' !important; }',

      '/* Day detail */',
      '.day-detail-header { color: ' + calMonth + ' !important; }',

      '/* Timeline & Appointments */',
      '.timeline-row { border-bottom-color: ' + hexToRgba(textColor, 0.08) + ' !important; }',
      '.timeline-hour { color: ' + calText + ' !important; }',
      '.timeline-block { background: ' + apptBg + ' !important; border: 1px solid ' + hexToRgba(apptBorder, 0.25) + ' !important; border-left: 4px solid ' + apptBorder + ' !important; }',
      '.timeline-block:hover { background: ' + hexToRgba(apptBorder, 0.15) + ' !important; }',
      '.tb-time { color: ' + apptTime + ' !important; }',
      '.tb-client { color: ' + apptClient + ' !important; }',
      '.tb-service { color: ' + apptService + ' !important; }',

      '/* Modals — respect theme */',
      '.modal { background: ' + surfaceModal + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; color: ' + textColor + ' !important; }',
      '.modal-header h3 { color: ' + textColor + ' !important; }',
      '.modal-close { color: ' + hexToRgba(textColor, 0.5) + ' !important; }',
      '.form-group label { color: ' + textColor + ' !important; }',
      '.form-group input, .form-group select, .form-group textarea { background: ' + surfaceInput + ' !important; color: ' + textColor + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',
      '.form-group select option { background: ' + surfaceCard + ' !important; color: ' + textColor + ' !important; }',
      '.btn-cancel { color: ' + textColor + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; background: transparent !important; }',
      '.btn-cancel:hover { background: ' + surfaceInput + ' !important; }',
      '.modal p, .modal span, .modal div { color: inherit; }',
      '.modal-body { color: ' + textColor + ' !important; }',
      '.modal input::placeholder, .modal textarea::placeholder { color: ' + textMutedColor + ' !important; }',
      '.form-group input:focus, .form-group select:focus, .form-group textarea:focus { border-color: ' + theme.gold + ' !important; }',
      '.historico-info p { color: ' + textMutedColor + ' !important; }',
      '.historico-info strong { color: ' + textColor + ' !important; }',
      '.historico-lista li { color: ' + textMutedColor + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',

      '/* Service box inside modal */',
      '.servico-block { background: ' + surfaceInput + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',
      '.servico-block label, .servico-block span { color: ' + textColor + ' !important; }',
      '.servico-block-title { color: ' + theme.gold + ' !important; }',

      '/* Dropdown & select custom */',
      '.cor-dropdown { background: ' + surfaceCard + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',
      '.cor-option:hover { background: ' + theme.card_hover + ' !important; }',
      '.cor-select-display { background: ' + surfaceInput + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',
      '.cor-select-display .cor-label { color: ' + textColor + ' !important; }',
      '.cor-select-display .cor-label.placeholder { color: ' + hexToRgba(textColor, 0.5) + ' !important; }',

      '/* Filter bar */',
      '.filter-bar { background: ' + surfaceCard + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',
      '.filter-chip { color: ' + hexToRgba(textColor, 0.6) + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',
      '.filter-chip.active { background: ' + theme.gold + ' !important; color: #fff !important; border-color: ' + theme.gold + ' !important; }',

      '/* Toast */',
      '.toast { background: ' + surfaceCard + ' !important; color: ' + textColor + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',

      '/* Clients table */',
      '.clients-table th { color: ' + hexToRgba(textColor, 0.55) + ' !important; }',
      '.clients-table td { color: ' + textColor + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',
      '.clients-table tr:hover td { background: ' + theme.card_hover + ' !important; }',

      '/* Dashboard — ISOLATED scope */',
      '.dash-card { background: ' + surfaceCard + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',
      '.dash-card-title { color: ' + hexToRgba(textColor, 0.55) + ' !important; }',
      '.dash-card-value { color: ' + textColor + ' !important; }',
      '.dash-section { background: ' + surfaceCard + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',
      '.dash-section h3 { color: ' + textColor + ' !important; }',
      '.dash-table th { color: ' + hexToRgba(textColor, 0.55) + ' !important; }',
      '.dash-table td { color: ' + textColor + ' !important; }',
      '.dash-filters label { color: ' + textColor + ' !important; }',
      '.dash-filters input { background: ' + surfaceInput + ' !important; color: ' + textColor + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',

      '/* Professional cards */',
      '.professional-card { background: ' + surfaceCard + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',
      '.professional-card .name { color: ' + textColor + ' !important; }',
      '.professional-card:hover { background: ' + theme.card_hover + ' !important; }',

      '/* Config panels (except theme editor) */',
      '#config-meu-perfil, #config-usuarios, #config-dados-cadastrais { color: ' + textColor + ' !important; }',
      '.config-section h3 { color: ' + textColor + ' !important; }',
      '.config-help-text { color: ' + hexToRgba(textColor, 0.55) + ' !important; }',
      '.config-sidebar .config-tab { color: ' + hexToRgba(textColor, 0.6) + ' !important; }',
      '.config-sidebar .config-tab.active { color: ' + theme.gold + ' !important; border-color: ' + theme.gold + ' !important; }',

      '/* Modal overlay */',
      '.modal-overlay { background: ' + hexToRgba('#000000', 0.55) + ' !important; }',

      '/* Hamburger */',
      '.hamburger { background: ' + surfaceCard + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; color: ' + theme.gold + ' !important; }',


      '/* Servico block inside modal */',
      '.servico-block { background: ' + surfaceInput + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; color: ' + textColor + ' !important; }',
      '.servico-block-title { color: ' + theme.gold + ' !important; }',
      '.servico-block label { color: ' + textColor + ' !important; }',
      '.servico-block select, .servico-block input { background: ' + surfaceInput + ' !important; color: ' + textColor + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',
      '.servico-remove-btn { color: ' + textMutedColor + ' !important; }',
      '.servico-remove-btn:hover { color: #DC2626 !important; }',
      '.btn-add-servico { color: ' + theme.gold + ' !important; border-color: ' + hexToRgba(theme.gold, 0.25) + ' !important; }',
      '.btn-add-servico:hover { background: ' + hexToRgba(theme.gold, 0.08) + ' !important; }',

      '/* Pig/base dropdowns */',
      '.pig-dropdown, .base-grid-dropdown { background: ' + surfaceCard + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',

      '/* Config content */',
      '.config-content { background: ' + surfaceCard + ' !important; }',
      '.config-sidebar { background: ' + surfaceCard + ' !important; }',
      '.config-tab:hover { background: ' + theme.card_hover + ' !important; }',

      '/* Users table */',
      '.config-users-table th { color: ' + hexToRgba(textColor, 0.55) + ' !important; }',
      '.config-users-table td { color: ' + textColor + ' !important; }',
      '.config-users-table tr:hover td { background: ' + theme.card_hover + ' !important; }',

      '/* Login card */',
      '.login-card { background: ' + surfaceCard + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',
      '.login-card input { background: ' + surfaceInput + ' !important; color: ' + textColor + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',

      '/* Hist badge */',
      '.hist-cor-badge { background: ' + theme.card_hover + ' !important; }',
      '.btn-icon:hover { background: ' + theme.card_hover + ' !important; }',
      '.vincular-servico-item:hover { background: ' + theme.card_hover + ' !important; }',
      '.role-badge.colaborador { background: ' + theme.card_hover + ' !important; }',

      '/* Birthday banner text stays white */',

      '/* Multi-agenda */',
      '.multi-agenda-header { background: ' + surfaceCard + ' !important; border-color: ' + hexToRgba(theme.gold, 0.20) + ' !important; }',
      '.multi-agenda-col-header { color: ' + theme.gold + ' !important; }',
      '.multi-agenda-row { border-color: ' + hexToRgba(textColor, 0.05) + ' !important; }',
      '.multi-agenda-cell { border-color: ' + hexToRgba(textColor, 0.05) + ' !important; }',

      '/* Clients table wrapper */',
      '.clients-table-wrapper { background: ' + surfaceCard + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',

      '/* Dash bar track */',
      '.dash-bar-track { background: ' + theme.card_hover + ' !important; }',
      '.dash-bar-label { color: ' + hexToRgba(textColor, 0.6) + ' !important; }',
      '.dash-bar-value { color: ' + theme.gold + ' !important; }',

      '/* Scrollbar */',
      '.modal::-webkit-scrollbar-track, .timeline-container::-webkit-scrollbar-track { background: ' + surfaceInput + ' !important; }',

      '/* User card */',
      '.user-card { background: ' + surfaceInput + ' !important; border-color: ' + (theme.cal_border || DEFAULTS.cal_border) + ' !important; }',
      '.user-card-name { color: ' + textColor + ' !important; }',
      '.user-card-email { color: ' + hexToRgba(textColor, 0.6) + ' !important; }',

      '/* No appointments */',
      '.no-appointments { color: ' + hexToRgba(textColor, 0.55) + ' !important; }'
    ].join('\n');
  }

  function aplicarTemaNoForm() {
    // Bloco 1
    setPickrColor('tema-gold', currentTheme.gold);
    setVal('tema-gold-hex', currentTheme.gold);
    setPickrColor('tema-bg', currentTheme.bg);
    setPickrColor('tema-sidebar-bg', currentTheme.sidebar_bg);
    setPickrColor('tema-text-color', currentTheme.text_color || DEFAULTS.text_color);
    setVal('tema-text-color-hex', currentTheme.text_color || DEFAULTS.text_color);
    setPickrColor('tema-page-title-color', currentTheme.page_title_color || currentTheme.text_color || DEFAULTS.text_color);

    setLabel('tema-bg-label', currentTheme.bg);
    setLabel('tema-sidebar-bg-label', currentTheme.sidebar_bg);
    setLabel('tema-page-title-color-label', currentTheme.page_title_color || currentTheme.text_color || DEFAULTS.text_color);

    // Bloco 2
    setPickrColor('tema-card', currentTheme.card);
    setPickrColor('tema-card-hover', currentTheme.card_hover);
    setPickrColor('tema-cal-border', currentTheme.cal_border || DEFAULTS.cal_border);
    setPickrColor('tema-cal-text', currentTheme.cal_text || DEFAULTS.cal_text);
    setPickrColor('tema-cal-month', currentTheme.cal_month || DEFAULTS.cal_month);
    setPickrColor('tema-cal-selected-bg', currentTheme.cal_selected_bg || currentTheme.gold);
    setPickrColor('tema-cal-selected-text', currentTheme.cal_selected_text || DEFAULTS.cal_selected_text);

    setLabel('tema-card-label', currentTheme.card);
    setLabel('tema-card-hover-label', currentTheme.card_hover);
    setLabel('tema-cal-border-label', currentTheme.cal_border || DEFAULTS.cal_border);
    setLabel('tema-cal-text-label', currentTheme.cal_text || DEFAULTS.cal_text);
    setLabel('tema-cal-month-label', currentTheme.cal_month || DEFAULTS.cal_month);
    setLabel('tema-cal-selected-bg-label', currentTheme.cal_selected_bg || currentTheme.gold);
    setLabel('tema-cal-selected-text-label', currentTheme.cal_selected_text || DEFAULTS.cal_selected_text);

    // Bloco 3
    setPickrColor('tema-appt-border', currentTheme.appt_border_color || currentTheme.gold);
    setPickrColor('tema-appt-time', currentTheme.appt_time_color || currentTheme.gold);
    setPickrColor('tema-appt-client', currentTheme.appt_client_color || DEFAULTS.appt_client_color);
    setPickrColor('tema-appt-service', currentTheme.appt_service_color || DEFAULTS.appt_service_color);
    setPickrColor('tema-appt-bg', currentTheme.appt_bg_color || DEFAULTS.appt_bg_color);

    setLabel('tema-appt-border-label', currentTheme.appt_border_color || currentTheme.gold);
    setLabel('tema-appt-time-label', currentTheme.appt_time_color || currentTheme.gold);
    setLabel('tema-appt-client-label', currentTheme.appt_client_color || DEFAULTS.appt_client_color);
    setLabel('tema-appt-service-label', currentTheme.appt_service_color || DEFAULTS.appt_service_color);
    setLabel('tema-appt-bg-label', currentTheme.appt_bg_color || DEFAULTS.appt_bg_color);

    // Font
    setVal('tema-font', currentTheme.font);
    atualizarFontPreview();

    // Logo
    var img = document.getElementById('tema-logo-img');
    var icon = document.getElementById('tema-logo-icon');
    var removeBtn = document.getElementById('btn-remover-tema-logo');
    if (currentTheme.logo_url) {
      if (img) { img.src = currentTheme.logo_url; img.style.display = 'block'; }
      if (icon) icon.style.display = 'none';
      if (removeBtn) removeBtn.style.display = 'inline-flex';
    } else {
      if (img) { img.src = ''; img.style.display = 'none'; }
      if (icon) icon.style.display = 'inline-flex';
      if (removeBtn) removeBtn.style.display = 'none';
    }

    renderColorChips();
  }

  function atualizarFontPreview() {
    var font = getVal('tema-font') || DEFAULTS.font;
    var el = document.getElementById('tema-font-preview');
    if (el) el.style.fontFamily = font + ', sans-serif';
  }

  /* ══════════════════════════════════════════════
     FEEDBACK
     ══════════════════════════════════════════════ */
  function mostrarFeedback(msg, success) {
    var el = document.getElementById('tema-feedback');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    el.style.background = success ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)';
    el.style.color = success ? '#15803d' : '#b91c1c';
    el.style.border = '1px solid ' + (success ? 'rgba(34,197,94,0.20)' : 'rgba(239,68,68,0.20)');
    setTimeout(function() { el.style.display = 'none'; }, 4000);
  }

  /* ══════════════════════════════════════════════
     SYNC HEX INPUTS MANUAIS
     ══════════════════════════════════════════════ */
  window.syncColorFromHex = function() {
    var hex = getVal('tema-gold-hex');
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      setPickrColor('tema-gold', hex);
      currentTheme.gold = hex;
      renderColorChips();
      updateBlockPreview(1);
    }
  };

  window.syncTextColorFromHex = function() {
    var hex = getVal('tema-text-color-hex');
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      setPickrColor('tema-text-color', hex);
      currentTheme.text_color = hex;
      updateBlockPreview(1);
    }
  };

  /* ══════════════════════════════════════════════
     LOGO
     ══════════════════════════════════════════════ */
  window.onTemaLogoChange = function(input) {
    if (!input.files || !input.files[0]) return;
    temaLogoFile = input.files[0];
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = document.getElementById('tema-logo-img');
      var icon = document.getElementById('tema-logo-icon');
      var removeBtn = document.getElementById('btn-remover-tema-logo');
      if (img) { img.src = e.target.result; img.style.display = 'block'; }
      if (icon) icon.style.display = 'none';
      if (removeBtn) removeBtn.style.display = 'inline-flex';
      // Update preview logo
      var logoEl = document.getElementById('tp-logo');
      if (logoEl) logoEl.innerHTML = '<img src="' + e.target.result + '" alt="Logo" style="width:100%;height:100%;object-fit:contain;border-radius:12px;">';
    };
    reader.readAsDataURL(input.files[0]);
  };

  window.removerTemaLogo = function() {
    temaLogoFile = null;
    currentTheme.logo_url = null;
    var img = document.getElementById('tema-logo-img');
    var icon = document.getElementById('tema-logo-icon');
    var removeBtn = document.getElementById('btn-remover-tema-logo');
    var input = document.getElementById('tema-logo-input');
    if (img) { img.src = ''; img.style.display = 'none'; }
    if (icon) icon.style.display = 'inline-flex';
    if (removeBtn) removeBtn.style.display = 'none';
    if (input) input.value = '';
    var logoEl = document.getElementById('tp-logo');
    if (logoEl) logoEl.textContent = 'BS';
    updateBlockPreview(1);
  };

  /* ══════════════════════════════════════════════
     CARREGAR TEMA DO BANCO
     ══════════════════════════════════════════════ */
  window.carregarTema = async function() {
    var tenantId = localStorage.getItem('currentTenantId');
    if (!tenantId || typeof supabaseClient === 'undefined') return;
    try {
      var resp = await supabaseClient.from('agenda_themes').select('*').eq('tenant_id', tenantId).maybeSingle();
      if (resp && resp.data) {
        currentTheme = Object.assign({}, DEFAULTS, resp.data);
      } else {
        currentTheme = Object.assign({}, DEFAULTS);
      }
      aplicarTemaNoForm();
      updateAllPreviews();
      aplicarTemaNoAgenda(currentTheme);
    } catch (e) {
      console.error('Erro ao carregar tema:', e);
    }
  };

  /* ══════════════════════════════════════════════
     SALVAR TEMA
     ══════════════════════════════════════════════ */
  window.salvarTema = async function() {
    var tenantId = localStorage.getItem('currentTenantId');
    if (!tenantId) { mostrarFeedback('Tenant não identificado.', false); return; }
    if (typeof supabaseClient === 'undefined') { mostrarFeedback('Supabase client não encontrado.', false); return; }

    var accent = currentTheme.gold;
    var vars = generateAccentVariations(accent);
    var logoUrl = currentTheme.logo_url;

    // Upload logo if needed
    if (temaLogoFile) {
      var ext = (temaLogoFile.name.split('.').pop() || 'png').toLowerCase();
      var path = 'logos/' + tenantId + '/logo_' + Date.now() + '.' + ext;
      var uploadResp = await supabaseClient.storage.from('agenda-assets').upload(path, temaLogoFile, { upsert: true });
      if (uploadResp.error) {
        mostrarFeedback('Erro ao fazer upload da logo: ' + uploadResp.error.message, false);
        return;
      }
      var urlResp = supabaseClient.storage.from('agenda-assets').getPublicUrl(path);
      logoUrl = urlResp.data.publicUrl;
      temaLogoFile = null;
    }

    var theme = {
      tenant_id: tenantId,
      gold: accent,
      gold_light: vars.gold_light,
      gold_dark: vars.gold_dark,
      gold_bg: vars.gold_bg,
      gold_border: vars.gold_border,
      bg: currentTheme.bg,
      card: currentTheme.card,
      card_hover: currentTheme.card_hover,
      sidebar_bg: currentTheme.sidebar_bg,
      font: currentTheme.font || DEFAULTS.font,
      text_color: currentTheme.text_color || DEFAULTS.text_color,
      cal_border: currentTheme.cal_border || DEFAULTS.cal_border,
      cal_text: currentTheme.cal_text || DEFAULTS.cal_text,
      cal_month: currentTheme.cal_month || DEFAULTS.cal_month,
      cal_selected_bg: currentTheme.cal_selected_bg || accent,
      cal_selected_text: currentTheme.cal_selected_text || DEFAULTS.cal_selected_text,
      logo_url: logoUrl,
      // Surface/Modal fields
      modal_bg: currentTheme.modal_bg || null,
      input_bg: currentTheme.input_bg || null,
      text_muted_color: currentTheme.text_muted_color || null,
      // New appointment fields
      appt_border_color: currentTheme.appt_border_color || accent,
      appt_time_color: currentTheme.appt_time_color || accent,
      appt_client_color: currentTheme.appt_client_color || DEFAULTS.appt_client_color,
      appt_service_color: currentTheme.appt_service_color || DEFAULTS.appt_service_color,
      appt_bg_color: currentTheme.appt_bg_color || DEFAULTS.appt_bg_color,
      page_title_color: currentTheme.page_title_color || DEFAULTS.page_title_color,
      updated_at: new Date().toISOString()
    };

    var resp = await supabaseClient.from('agenda_themes').upsert(theme, { onConflict: 'tenant_id' });
    if (resp.error) {
      var msg = resp.error.message || 'Erro ao salvar.';
      if (msg.indexOf('appt_') !== -1 || msg.indexOf('page_title') !== -1 || msg.indexOf('modal_bg') !== -1 || msg.indexOf('input_bg') !== -1 || msg.indexOf('text_muted') !== -1) {
        mostrarFeedback('Faltam colunas novas no banco. Rode o SQL sql_add_appointment_colors.sql.', false);
        return;
      }
      mostrarFeedback('Erro ao salvar: ' + msg, false);
      return;
    }

    currentTheme = Object.assign({}, theme);
    aplicarTemaNoAgenda(currentTheme);
    updateAllPreviews();
    mostrarFeedback('Tema salvo com sucesso!', true);
  };

  /* ══════════════════════════════════════════════
     RESTAURAR PADRÃO
     ══════════════════════════════════════════════ */
  window.resetarTema = function() {
    currentTheme = Object.assign({}, DEFAULTS);
    temaLogoFile = null;
    aplicarTemaNoForm();
    updateAllPreviews();
    aplicarTemaNoAgenda(currentTheme);
  };

  /* ══════════════════════════════════════════════
     SIDEBAR COLLAPSE ao abrir tema
     ══════════════════════════════════════════════ */
  function setupTemaFullscreen() {
    document.querySelectorAll('.config-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        if (tab.getAttribute('data-config-tab') === 'tema-agenda') {
          document.body.classList.add('tema-fullscreen');
        } else {
          document.body.classList.remove('tema-fullscreen');
        }
      });
    });
    document.querySelectorAll('.nav-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (btn.getAttribute('data-page') !== 'configuracoes') {
          document.body.classList.remove('tema-fullscreen');
        }
      });
    });
  }

  /* ══════════════════════════════════════════════
     TOOLTIP POSICIONAMENTO
     ══════════════════════════════════════════════ */
  function setupTooltips() {
    document.querySelectorAll('.tema-help').forEach(function(help) {
      var box = help.querySelector('.tema-help-box');
      if (!box) return;
      help.addEventListener('mouseenter', function() {
        var rect = help.getBoundingClientRect();
        var bw = 280;
        var left = rect.right + 8;
        var top = rect.top + rect.height / 2;
        if (left + bw > window.innerWidth - 16) left = rect.left - bw - 8;
        if (top - 40 < 0) top = 16;
        if (top + 60 > window.innerHeight) top = window.innerHeight - 80;
        box.style.left = left + 'px';
        box.style.top = top + 'px';
        box.style.transform = 'translateY(-50%)';
      });
    });
  }

  /* ══════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', function() {
    initAllPickrs();
    setupTemaFullscreen();
    setupTooltips();

    var goldHex = document.getElementById('tema-gold-hex');
    if (goldHex) goldHex.addEventListener('input', window.syncColorFromHex);

    var textHex = document.getElementById('tema-text-color-hex');
    if (textHex) textHex.addEventListener('input', window.syncTextColorFromHex);

    var fontSelect = document.getElementById('tema-font');
    if (fontSelect) {
      fontSelect.addEventListener('change', function() {
        currentTheme.font = this.value;
        atualizarFontPreview();
        updateBlockPreview(1);
      });
    }

    carregarTema();
    updateAllPreviews();

    var activeTab = document.querySelector('.config-tab.active');
    if (activeTab && activeTab.getAttribute('data-config-tab') === 'tema-agenda') {
      document.body.classList.add('tema-fullscreen');
    }
  });
})();

/* ── Master-only visibility ── */
(function() {
  function esconderMasterOnly() {
    var role = localStorage.getItem('userRole') || '';
    var isMaster = role === 'master_admin';
    document.querySelectorAll('.master-only-tab, .master-only-panel').forEach(function(el) {
      el.style.display = isMaster ? '' : 'none';
    });
  }
  document.addEventListener('DOMContentLoaded', esconderMasterOnly);
  window.addEventListener('storage', esconderMasterOnly);
  window.checkMasterOnly = esconderMasterOnly;
})();
