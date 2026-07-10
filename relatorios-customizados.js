/* ============================================================
   Módulo: Relatórios Customizados (drop-in)
   Build: 2026-07-10
   - Injeta o item no menu lateral (apenas admin/master_admin)
   - Injeta a página #page-relatorios no DOM
   - Renderiza dinamicamente a partir de public.custom_reports
   - Executa via RPC public.run_custom_report(slug, tenant, filtros)
   - Exportações: CSV, XML (extensível para XLSX/PDF)
   - Bloqueia acesso direto para roles sem permissão
   ============================================================ */
(function () {
  'use strict';

  var VERSION = 'rc-1.0.0';
  console.log('%c[Relatórios Customizados] '+VERSION, 'background:#6C3AED;color:#fff;padding:2px 6px;border-radius:4px');

  var ALLOWED_ROLES = ['master_admin', 'admin'];
  var FILTER_REGISTRY = {}; // definido mais abaixo
  var EXPORTERS = {};       // definido mais abaixo

  // -------- Helpers --------
  function sb() { return window.supabaseClient || null; }
  function role() { return (window.currentUser && window.currentUser.role) || ''; }
  function tenantId() {
    return (window.currentUser && window.currentUser.tenantId)
      || localStorage.getItem('currentTenantId')
      || null;
  }
  function isAllowed() { return ALLOWED_ROLES.indexOf(role()) !== -1; }

  function toast(msg, kind) {
    if (typeof window.showToast === 'function') return window.showToast(msg, kind || 'info');
    if (kind === 'error') alert('Erro: ' + msg); else console.log('[toast]', msg);
  }

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function todayISO(offsetDays) {
    var d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }
  function firstOfMonthISO() {
    var d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  }
  function fmtDateBR(iso) {
    if (!iso) return '';
    var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0];
  }

  // -------- Registry de filtros (extensível) --------
  FILTER_REGISTRY.date_range = {
    render: function (state) {
      state.filters.date_start = state.filters.date_start || firstOfMonthISO();
      state.filters.date_end   = state.filters.date_end   || todayISO();
      return ''
        + '<div class="rc-field"><label>Data inicial</label>'
        + '<input type="date" data-rc-filter="date_start" value="'+esc(state.filters.date_start)+'"></div>'
        + '<div class="rc-field"><label>Data final</label>'
        + '<input type="date" data-rc-filter="date_end" value="'+esc(state.filters.date_end)+'"></div>';
    },
    summary: function (state) {
      return { icon: 'far fa-calendar', label: 'Período selecionado',
        value: fmtDateBR(state.filters.date_start) + ' até ' + fmtDateBR(state.filters.date_end) };
    }
  };

  FILTER_REGISTRY.professional = {
    render: function (state) {
      var opts = ['<option value="">Todos os profissionais</option>'];
      (state.cache.professionals || []).forEach(function (p) {
        var sel = state.filters.professional_id === p.id ? ' selected' : '';
        opts.push('<option value="'+esc(p.id)+'"'+sel+'>'+esc(p.nome)+'</option>');
      });
      return '<div class="rc-field"><label>Profissional</label>'
        + '<select data-rc-filter="professional_id">'+opts.join('')+'</select></div>';
    },
    summary: function (state) {
      var id = state.filters.professional_id;
      if (!id) return { icon: 'far fa-user', label: 'Profissional', value: 'Todos os profissionais' };
      var p = (state.cache.professionals || []).find(function (x) { return x.id === id; });
      return { icon: 'far fa-user', label: 'Profissional', value: (p && p.nome) || '—' };
    },
    load: async function (state) {
      if (state.cache.professionals) return;
      var r = await sb().from('profissionais')
        .select('id, nome, ativo')
        .eq('tenant_id', tenantId())
        .eq('ativo', true)
        .order('nome');
      state.cache.professionals = (r.data || []);
    }
  };

  // Filtros placeholder para futuros relatórios (extensíveis)
  FILTER_REGISTRY.client = {
    render: function () { return '<div class="rc-field"><label>Cliente</label><input type="text" data-rc-filter="cliente_nome" placeholder="Nome do cliente"></div>'; },
    summary: function (state) { return { icon: 'far fa-user', label: 'Cliente', value: state.filters.cliente_nome || 'Todos' }; }
  };
  FILTER_REGISTRY.payment_status = {
    render: function () {
      return '<div class="rc-field"><label>Status pagamento</label>'
        + '<select data-rc-filter="payment_status">'
        + '<option value="">Todos</option><option value="pago">Pago</option>'
        + '<option value="pendente">Pendente</option><option value="parcial">Parcial</option>'
        + '</select></div>';
    },
    summary: function (state) { return { icon: 'far fa-credit-card', label: 'Status pagamento', value: state.filters.payment_status || 'Todos' }; }
  };
  FILTER_REGISTRY.service = {
    render: function (state) {
      var opts = ['<option value="">Todos os serviços</option>'];
      (state.cache.services || []).forEach(function (s) {
        opts.push('<option value="'+esc(s.id)+'">'+esc(s.nome)+'</option>');
      });
      return '<div class="rc-field"><label>Serviço</label><select data-rc-filter="service_id">'+opts.join('')+'</select></div>';
    },
    load: async function (state) {
      if (state.cache.services) return;
      var r = await sb().from('servicos').select('id, nome').eq('tenant_id', tenantId()).eq('ativo', true).order('nome');
      state.cache.services = r.data || [];
    },
    summary: function (state) {
      var id = state.filters.service_id;
      if (!id) return { icon: 'fa-solid fa-scissors', label: 'Serviço', value: 'Todos' };
      var s = (state.cache.services || []).find(function (x) { return x.id === id; });
      return { icon: 'fa-solid fa-scissors', label: 'Serviço', value: (s && s.nome) || '—' };
    }
  };

  // -------- Exportadores (extensíveis) --------
  EXPORTERS.csv = {
    label: 'CSV',
    subtitle: 'Arquivo de texto separado por vírgulas (recomendado para Excel)',
    mime: 'text/csv;charset=utf-8;',
    ext: 'csv',
    build: function (columns, rows) {
      var head = columns.map(function (c) { return csvCell(c.label); }).join(',');
      var body = rows.map(function (r) {
        return columns.map(function (c) { return csvCell(r[c.key]); }).join(',');
      }).join('\r\n');
      // BOM para Excel ler acentuação
      return '\uFEFF' + head + '\r\n' + body;
    }
  };
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    if (/[",\r\n;]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  EXPORTERS.xml = {
    label: 'XML',
    subtitle: 'Arquivo XML (recomendado para integrações)',
    mime: 'application/xml;charset=utf-8;',
    ext: 'xml',
    build: function (columns, rows) {
      var lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<report>'];
      rows.forEach(function (r) {
        lines.push('  <row>');
        columns.forEach(function (c) {
          var v = r[c.key];
          if (v === null || v === undefined) v = '';
          lines.push('    <' + c.key + '>' + esc(v) + '</' + c.key + '>');
        });
        lines.push('  </row>');
      });
      lines.push('</report>');
      return lines.join('\n');
    }
  };

  function downloadFile(name, mime, content) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 500);
  }

  // -------- Injeção de estilos/menu/página --------
  function ensureCss() {
    if (document.getElementById('rc-css')) return;
    var l = document.createElement('link');
    l.id = 'rc-css'; l.rel = 'stylesheet'; l.href = 'relatorios-customizados.css';
    document.head.appendChild(l);
  }

  function ensureMenu() {
    var sidebar = document.querySelector('#sidebar nav') || document.querySelector('#sidebar');
    if (!sidebar) return;
    if (document.querySelector('.nav-btn[data-page="relatorios"]')) return;

    var btn = document.createElement('button');
    btn.className = 'nav-btn';
    btn.setAttribute('data-page', 'relatorios');
    btn.innerHTML = '<i class="fa-solid fa-chart-line"></i> Relatórios Customizados';
    btn.addEventListener('click', function () {
      if (typeof window.switchPage === 'function') window.switchPage('relatorios');
    });

    // Inserir entre "Dashboard" e "Configurações"
    var config = sidebar.querySelector('.nav-btn[data-page="configuracoes"]');
    if (config) sidebar.insertBefore(btn, config); else sidebar.appendChild(btn);
  }

  function ensurePage() {
    if (document.getElementById('page-relatorios')) return;
    var mount = document.querySelector('main') || document.body;
    var page = document.createElement('div');
    page.id = 'page-relatorios';
    page.className = 'page';
    page.innerHTML = ''
      + '<div class="rc-header">'
      + '  <h2>Relatórios Customizados</h2>'
      + '  <p>Exporte relatórios personalizados para análises, financeiro, contabilidade e integrações.</p>'
      + '</div>'
      + '<div id="rc-root"></div>';
    mount.appendChild(page);
  }

  // -------- Estado --------
  var STATE = {
    reports: [],
    currentSlug: null,
    filters: {},
    format: 'csv',
    cache: {},
    preview: { columns: [], rows: [], total: 0 },
    loading: false,
    error: null
  };

  function currentReport() {
    return STATE.reports.find(function (r) { return r.slug === STATE.currentSlug; }) || null;
  }

  // -------- Renderização --------
  function render() {
    var root = document.getElementById('rc-root');
    if (!root) return;

    if (!isAllowed()) {
      root.innerHTML = '<div class="rc-error">Você não tem permissão para acessar este módulo.</div>';
      return;
    }

    var rep = currentReport();
    var reportOpts = STATE.reports.map(function (r) {
      var sel = r.slug === STATE.currentSlug ? ' selected' : '';
      return '<option value="'+esc(r.slug)+'"'+sel+'>'+esc(r.name)+'</option>';
    }).join('');

    var filtersHtml = '';
    if (rep) {
      filtersHtml = (rep.filters || []).map(function (fkey) {
        var f = FILTER_REGISTRY[fkey];
        return f ? f.render(STATE) : '';
      }).join('');
    }

    var formats = (rep && rep.export_formats && rep.export_formats.length) ? rep.export_formats : ['csv'];
    var formatsHtml = formats.map(function (fk) {
      var ex = EXPORTERS[fk];
      if (!ex) return '';
      var active = STATE.format === fk ? ' is-active' : '';
      return ''
        + '<label class="rc-format-option'+active+'">'
        + '  <input type="radio" name="rc-format" value="'+esc(fk)+'"'+(STATE.format===fk?' checked':'')+'>'
        + '  <span><span class="rc-format-title">'+esc(ex.label)+'</span>'
        + '  <span class="rc-format-sub">'+esc(ex.subtitle)+'</span></span>'
        + '</label>';
    }).join('');

    // Resumo
    var summaryRows = [];
    if (rep) {
      (rep.filters || []).forEach(function (fkey) {
        var f = FILTER_REGISTRY[fkey];
        if (f && f.summary) summaryRows.push(f.summary(STATE));
      });
      summaryRows.push({ icon: 'far fa-file', label: 'Formato', value: (EXPORTERS[STATE.format] && EXPORTERS[STATE.format].label) || STATE.format.toUpperCase() });
      summaryRows.push({ icon: 'fa-solid fa-list', label: 'Quantidade prevista', value: STATE.preview.total + ' registro(s)' });
    }
    var summaryHtml = summaryRows.map(function (s) {
      return '<div class="rc-summary-row"><i class="'+s.icon+'"></i><div><span class="rc-sum-label">'+esc(s.label)+'</span><span class="rc-sum-value">'+esc(s.value)+'</span></div></div>';
    }).join('');

    // Preview
    var previewHtml;
    if (STATE.loading) {
      previewHtml = '<div class="rc-loading"><i class="fa-solid fa-spinner fa-spin"></i> Carregando prévia…</div>';
    } else if (!STATE.preview.rows.length) {
      previewHtml = '<div class="rc-preview-empty">Sem registros para os filtros selecionados.</div>';
    } else {
      var cols = STATE.preview.columns;
      var rowsShow = STATE.preview.rows.slice(0, 5);
      previewHtml = ''
        + '<div class="rc-preview-wrap"><table class="rc-preview-table"><thead><tr>'
        + cols.map(function(c){return '<th>'+esc(c.label)+'</th>';}).join('')
        + '</tr></thead><tbody>'
        + rowsShow.map(function (r) {
            return '<tr>' + cols.map(function (c) { return '<td>'+esc(r[c.key])+'</td>'; }).join('') + '</tr>';
          }).join('')
        + '</tbody></table></div>'
        + '<div class="rc-preview-count">Visualizando '+rowsShow.length+' de '+STATE.preview.total+' registros</div>';
    }

    root.innerHTML = ''
      + (STATE.error ? '<div class="rc-error">'+esc(STATE.error)+'</div>' : '')
      + '<div class="rc-card">'
      + '  <h3><span class="rc-step-num">1.</span> Escolha o relatório</h3>'
      + '  <div class="rc-report-select-row">'
      + '    <div class="rc-report-icon">'+esc(rep && rep.icon || '📈')+'</div>'
      + '    <div>'
      + '      <select id="rc-report-select" class="rc-field-select" style="width:100%;height:44px;padding:0 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface-input);color:var(--text);font-size:0.95rem">'
      +          reportOpts
      + '      </select>'
      + '      <div class="rc-report-desc">'+esc(rep && rep.description || '')+'</div>'
      + '    </div>'
      + '  </div>'
      + '</div>'
      + (rep ? (''
          + '<div class="rc-card">'
          + '  <h3><span class="rc-step-num">2.</span> Filtros</h3>'
          + '  <div class="rc-filters-grid">'+filtersHtml
          + '    <button type="button" class="rc-clear-btn" id="rc-clear"><i class="fa-solid fa-rotate"></i> Limpar filtros</button>'
          + '  </div>'
          + '</div>'
          + '<div class="rc-card">'
          + '  <h3><span class="rc-step-num">3.</span> Formato de exportação</h3>'
          + '  <div class="rc-format-wrapper">'
          + '    <div class="rc-format-options">'+formatsHtml+'</div>'
          + '    <div class="rc-summary"><h4>Resumo da extração</h4>'+summaryHtml+'</div>'
          + '  </div>'
          + '</div>'
          + '<div class="rc-card">'
          + '  <h3><span class="rc-step-num">4.</span> Prévia dos dados</h3>'
          + previewHtml
          + '</div>'
          + '<button class="rc-export-btn" id="rc-export"'+(STATE.preview.total ? '' : ' disabled')+'>'
          + '  <i class="fa-solid fa-download"></i> Exportar relatório'
          + '</button>'
        ) : '');

    bindEvents();
  }

  function bindEvents() {
    var sel = document.getElementById('rc-report-select');
    if (sel) sel.onchange = function () { selectReport(sel.value); };

    document.querySelectorAll('[data-rc-filter]').forEach(function (el) {
      var evt = (el.tagName === 'SELECT' || el.type === 'date') ? 'change' : 'input';
      el.addEventListener(evt, function () {
        STATE.filters[el.getAttribute('data-rc-filter')] = el.value;
        debouncedPreview();
      });
    });

    document.querySelectorAll('input[name="rc-format"]').forEach(function (el) {
      el.onchange = function () { STATE.format = el.value; render(); };
    });

    var clearBtn = document.getElementById('rc-clear');
    if (clearBtn) clearBtn.onclick = function () {
      STATE.filters = {};
      loadAndPreview();
    };

    var exp = document.getElementById('rc-export');
    if (exp) exp.onclick = doExport;
  }

  var _t;
  function debouncedPreview() { clearTimeout(_t); _t = setTimeout(loadPreview, 350); }

  // -------- Dados --------
  async function loadReports() {
    var r = await sb().from('custom_reports')
      .select('*').eq('active', true).order('display_order');
    if (r.error) throw r.error;
    STATE.reports = r.data || [];
  }

  async function selectReport(slug) {
    STATE.currentSlug = slug;
    STATE.filters = {};
    STATE.preview = { columns: [], rows: [], total: 0 };
    var rep = currentReport();
    if (rep && rep.export_formats && rep.export_formats.indexOf(STATE.format) === -1) {
      STATE.format = rep.export_formats[0];
    }
    await loadFiltersData();
    render();
    loadPreview();
  }

  async function loadFiltersData() {
    var rep = currentReport();
    if (!rep) return;
    var tasks = (rep.filters || []).map(function (fk) {
      var f = FILTER_REGISTRY[fk];
      return (f && f.load) ? f.load(STATE) : null;
    }).filter(Boolean);
    try { await Promise.all(tasks); } catch (e) { console.error('[rc] load filters', e); }
  }

  async function runReportRPC() {
    var rep = currentReport();
    if (!rep) return null;
    var { data, error } = await sb().rpc('run_custom_report', {
      _slug: rep.slug,
      _tenant_id: tenantId(),
      _filters: STATE.filters || {}
    });
    if (error) {
      if (error.code === '42501' || /forbidden/i.test(error.message || '')) {
        throw new Error('Sem permissão para gerar este relatório (403).');
      }
      throw error;
    }
    return data || { columns: [], rows: [] };
  }

  async function loadAndPreview() { await loadFiltersData(); render(); loadPreview(); }

  async function loadPreview() {
    if (!currentReport()) return;
    STATE.loading = true; STATE.error = null; render();
    try {
      var data = await runReportRPC();
      STATE.preview = {
        columns: data.columns || [],
        rows: data.rows || [],
        total: (data.rows || []).length
      };
    } catch (e) {
      console.error('[rc] preview', e);
      STATE.error = e.message || 'Falha ao gerar prévia';
      STATE.preview = { columns: [], rows: [], total: 0 };
    } finally {
      STATE.loading = false; render();
    }
  }

  async function doExport() {
    var rep = currentReport(); if (!rep) return;
    var ex = EXPORTERS[STATE.format];
    if (!ex) { toast('Formato não suportado', 'error'); return; }
    var btn = document.getElementById('rc-export');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando…'; }
    try {
      var data = await runReportRPC();
      var content = ex.build(data.columns || [], data.rows || []);
      var parts = [rep.slug];
      if (STATE.filters.date_start) parts.push(STATE.filters.date_start);
      if (STATE.filters.date_end)   parts.push(STATE.filters.date_end);
      downloadFile(parts.join('_') + '.' + ex.ext, ex.mime, content);
      toast('Relatório exportado ('+ (data.rows||[]).length +' registros)', 'success');
    } catch (e) {
      console.error('[rc] export', e);
      toast(e.message || 'Falha ao exportar', 'error');
    } finally {
      render();
    }
  }

  // -------- Init / navegação --------
  async function initPage() {
    ensureCss();
    if (!STATE.reports.length) {
      try { await loadReports(); }
      catch (e) {
        document.getElementById('rc-root').innerHTML =
          '<div class="rc-error">Falha ao carregar catálogo de relatórios: '+esc(e.message||e)+'</div>';
        return;
      }
    }
    if (!STATE.currentSlug && STATE.reports.length) {
      await selectReport(STATE.reports[0].slug);
    } else {
      render();
    }
  }

  function hookSwitchPage() {
    if (window.__rcHooked) return; window.__rcHooked = true;
    var orig = window.switchPage;
    window.switchPage = function (page) {
      if (page === 'relatorios' && !isAllowed()) {
        toast('Você não tem permissão para acessar Relatórios Customizados', 'error');
        page = 'agendamentos';
      }
      var r = (typeof orig === 'function') ? orig.apply(this, arguments) : undefined;
      if (page === 'relatorios' && isAllowed()) initPage();
      return r;
    };
  }

  function updateMenuVisibility() {
    var btn = document.querySelector('.nav-btn[data-page="relatorios"]');
    if (!btn) return;
    btn.style.display = isAllowed() ? '' : 'none';
  }

  function boot() {
    if (!sb()) { setTimeout(boot, 300); return; }
    ensureCss();
    ensurePage();
    ensureMenu();
    updateMenuVisibility();
    hookSwitchPage();
    // Reavalia após login/carregamento do usuário
    var tries = 0;
    var iv = setInterval(function () {
      updateMenuVisibility();
      if (role() || ++tries > 40) clearInterval(iv);
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Expor API mínima para debug/extensões
  window.RelatoriosCustomizados = {
    version: VERSION,
    registerFilter: function (key, def) { FILTER_REGISTRY[key] = def; },
    registerExporter: function (key, def) { EXPORTERS[key] = def; },
    open: function () { if (typeof window.switchPage === 'function') window.switchPage('relatorios'); },
    _state: STATE
  };
})();
