/* =====================================================================
   ANALYTICS-CANCELAMENTOS.JS — Add-on isolado (v5)
   ---------------------------------------------------------------------
   Carregue DEPOIS de script.js E DEPOIS de dashboard-pagamentos.js
   em agenda.html:

       <link rel="stylesheet" href="/analytics-cancelamentos.css">
       <script src="/analytics-cancelamentos.js?v=5" defer></script>

   v3 — correções:
     • Motivos: SELECT * em cancelamento_log; aceita várias colunas
       possíveis (motivo, motivo_nome, motivo_slug, motivo_id, reason,
       motivo_cancelamento, descricao, observacao).
     • Profissionais: resolve nome via window.profissionais /
       window.professionals / window.allProfissionais quando o
       agendamento não traz objeto profissional embutido.
     • Removido o box "Tendência de cancelamentos".
   v2 — correções:
     • Render APENAS na tela Dashboard (mount/unmount via observer).
     • Usa o filtro global do dashboard: window.filtrosAplicados
       ({ dataInicio, dataFim, profissionalId }).
     • Cards / motivos / tendência / valor perdido respeitam o período
       selecionado pelo usuário.
     • "Cancelamentos Hoje" -> "Cancelamentos no período".
     • "Cancelamentos últimos 7 dias" -> "Tendência de cancelamentos".
     • Removida frase visual "Conta como receita" no card
       "Cancelado com Venda" (regra de negócio inalterada).
     • Hook em aplicarFiltrosDashboard() para re-render ao clicar Aplicar.
     • status='cancelado'           => conta / valor perdido
     • status='cancelado_com_venda' OU conclusion_type='cancelado_com_venda'
                                    => NÃO entra como prejuízo
   ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_ANALYTICS_CANCEL_LOADED__) return;
  window.__SLOTIFY_ANALYTICS_CANCEL_LOADED__ = true;

  console.log('%c📉 analytics-cancelamentos.js v6 carregado (cancelado-com-venda inclui concluído excluído)',
    'background:#ef4444;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700');

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------
  function fmtBRL(n) {
    n = Number(n) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function fmtPct(v, total, dec) {
    if (!total) return '0%';
    var p = (v / total) * 100;
    return p.toFixed(dec == null ? 1 : dec).replace('.', ',') + '%';
  }
  function getSb() { return window.supabaseClient || window.supabase || null; }

  // Tenta resolver nome do profissional pelo id usando coleções globais
  function resolveProfNome(pid) {
    if (!pid) return null;
    var pools = [
      window.profissionais,
      window.professionals,
      window.allProfissionais,
      window.allProfessionals,
      (window.appState && window.appState.profissionais),
      (window.appState && window.appState.professionals)
    ];
    for (var i = 0; i < pools.length; i++) {
      var arr = pools[i];
      if (!arr || !arr.length) continue;
      for (var j = 0; j < arr.length; j++) {
        var p = arr[j];
        if (!p) continue;
        if (p.id === pid || String(p.id) === String(pid)) {
          return p.nome || p.name || p.full_name || null;
        }
      }
    }
    return null;
  }

  function normalizeText(v) {
    if (v == null) return null;
    if (typeof v === 'object') return null;
    var s = String(v).trim();
    if (!s) return null;
    if (/^(null|undefined|none|nan)$/i.test(s)) return null;
    return s;
  }

  function isUuidLike(v) {
    var s = normalizeText(v);
    return !!(s && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s));
  }

  function pickText(obj, keys, allowUuid) {
    if (!obj) return null;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v && typeof v === 'object') {
        var nested = pickText(v, ['nome', 'name', 'titulo', 'title', 'label', 'texto', 'descricao', 'description', 'slug'], allowUuid);
        if (nested) return nested;
        continue;
      }
      var s = normalizeText(v);
      if (s && (allowUuid || !isUuidLike(s))) return s;
    }
    return null;
  }

  function pickId(obj, keys) {
    if (!obj) return null;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v && typeof v === 'object') v = v.id || v.uuid || null;
      var s = normalizeText(v);
      if (s) return s;
    }
    return null;
  }

  function humanizeSlug(slug) {
    var s = normalizeText(slug);
    if (!s || isUuidLike(s)) return null;
    s = s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
  }

  function parseJsonMaybe(v) {
    if (!v) return null;
    if (typeof v === 'object') return v;
    if (typeof v !== 'string') return null;
    try { return JSON.parse(v); } catch (_) { return null; }
  }

  function motivoPayloads(r) {
    var arr = [r];
    ['payload', 'dados', 'data', 'metadata', 'meta', 'detalhes', 'details'].forEach(function (k) {
      var p = parseJsonMaybe(r && r[k]);
      if (p) arr.push(p);
    });
    return arr;
  }

  // Cache do catálogo de motivos (id -> nome, slug -> nome).
  // Usa SELECT * de propósito: em algumas bases a coluna do texto chama
  // nome, motivo, descricao, titulo ou label. Selecionar colunas fixas fazia
  // o catálogo falhar e tudo cair em "Sem motivo informado".
  var _motivosCatalog = { byId: {}, bySlug: {}, loadedFor: null };
  async function loadMotivosCatalog(tenantId) {
    if (_motivosCatalog.loadedFor === (tenantId || '__all__')) return _motivosCatalog;
    var sb = getSb();
    if (!sb) return _motivosCatalog;
    try {
      var q = sb.from('cancelamento_motivos').select('*');
      if (tenantId) q = q.or('tenant_id.is.null,tenant_id.eq.' + tenantId);
      var res = await q;
      if (res.error && tenantId) {
        console.warn('[acan] catálogo motivos com tenant err; tentando sem filtro', res.error);
        res = await sb.from('cancelamento_motivos').select('*');
      }
      if (res.error) { console.warn('[acan] catálogo motivos err', res.error); return _motivosCatalog; }
      var byId = {}, bySlug = {};
      (res.data || []).forEach(function (m) {
        var label = pickText(m, ['nome', 'motivo', 'motivo_nome', 'titulo', 'title', 'label', 'texto', 'descricao', 'description', 'name']) || humanizeSlug(m.slug) || m.id;
        var id = pickId(m, ['id', 'motivo_id', 'cancelamento_motivo_id', 'reason_id', 'uuid']);
        var slug = pickText(m, ['slug', 'motivo_slug', 'codigo', 'code', 'key'], true);
        if (id && label) byId[String(id)] = String(label);
        if (slug && label) bySlug[String(slug)] = String(label);
      });
      _motivosCatalog = { byId: byId, bySlug: bySlug, loadedFor: tenantId || '__all__' };
      console.log('[AnalyticsCancelamentos] Catálogo de motivos carregado:', Object.keys(byId).length, 'itens.');
    } catch (e) { console.warn('[acan] catálogo motivos exception', e); }
    return _motivosCatalog;
  }

  function getLogAgendamentoId(r) {
    return pickId(r, ['agendamento_id', 'appointment_id', 'agendamentoId', 'appointmentId', 'booking_id', 'bookingId']);
  }

  // Extrai motivo legível de uma linha de cancelamento_log com schema variável
  function extractMotivo(r, catalog) {
    if (!r) return { key: 'sem-motivo', label: 'Sem motivo informado' };
    catalog = catalog || _motivosCatalog;

    var payloads = motivoPayloads(r);
    var ids = [];
    var slugs = [];
    var direct = null;
    var outro = null;

    payloads.forEach(function (obj) {
      var id = pickId(obj, ['motivo_id', 'cancelamento_motivo_id', 'motivo_cancelamento_id', 'reason_id', 'cancel_reason_id', 'cancelamento_motivos_id', 'id_motivo']);
      if (id) ids.push(id);

      var slug = pickText(obj, ['motivo_slug', 'reason_slug', 'slug', 'codigo', 'code', 'key'], true);
      if (slug) slugs.push(slug);

      direct = direct || pickText(obj, [
        'motivo_nome', 'cancelamento_motivo_nome', 'motivo_label', 'motivo_texto',
        'motivo', 'motivo_cancelamento', 'reason_name', 'reason_label', 'reason',
        'nome_motivo', 'titulo_motivo'
      ]);

      outro = outro || pickText(obj, [
        'descricao_outro', 'descricao_motivo', 'descricao', 'description',
        'observacao', 'observacoes', 'obs', 'comentario', 'comentarios'
      ]);
    });

    var label = direct || null;

    for (var i = 0; !label && i < ids.length; i++) {
      if (catalog.byId && catalog.byId[String(ids[i])]) label = catalog.byId[String(ids[i])];
    }
    for (var j = 0; !label && j < slugs.length; j++) {
      if (catalog.bySlug && catalog.bySlug[String(slugs[j])]) label = catalog.bySlug[String(slugs[j])];
    }

    if (!label) label = outro || null;
    if (!label && slugs.length) label = humanizeSlug(slugs[0]);

    var key = ids[0] || slugs[0] || label || 'sem-motivo';
    if (!label) label = 'Sem motivo informado';
    return { key: String(key), label: String(label) };
  }

  function getTenantId() {
    var tid =
      window.currentTenantId ||
      window.TENANT_ID ||
      window.tenantId ||
      window.tenant_id ||
      (window.appState && (window.appState.tenantId || window.appState.tenant_id)) ||
      (window.currentUser && (window.currentUser.tenant_id || window.currentUser.tenantId)) ||
      (window.usuarioLogado && (window.usuarioLogado.tenant_id || window.usuarioLogado.tenantId)) ||
      null;
    if (!tid) {
      // tenta deduzir do primeiro agendamento carregado
      var arr = window.appointments || window.allAppointments || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].tenant_id) { tid = arr[i].tenant_id; break; }
      }
    }
    return tid || null;
  }

  function isCancelado(ag) {
    return ag && String(ag.status || '').toLowerCase() === 'cancelado';
  }
  function isCanceladoComVenda(ag) {
    if (!ag) return false;
    var s = String(ag.status || '').toLowerCase();
    var c = String(ag.conclusion_type || '').toLowerCase();
    return s === 'cancelado_com_venda' || c === 'cancelado_com_venda';
  }

  function getValorAgendamento(ag) {
    if (!ag) return 0;
    if (typeof window.getAppointmentTotal === 'function') {
      try { return Number(window.getAppointmentTotal(ag)) || 0; } catch (_) {}
    }
    if (typeof window.calcAppointmentTotal === 'function') {
      try { return Number(window.calcAppointmentTotal(ag)) || 0; } catch (_) {}
    }
    var servicos = (typeof window.getAppointmentServicos === 'function')
      ? (window.getAppointmentServicos(ag) || [])
      : (ag.servicos || []);
    var soma = 0;
    servicos.forEach(function (s) {
      var p = Number(s && (s.preco != null ? s.preco : (s.servico && s.servico.preco))) || 0;
      soma += p;
    });
    if (!soma && ag.valor_total != null) soma = Number(ag.valor_total) || 0;
    return soma;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function toISO(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function todayISO() { return toISO(new Date()); }
  function parseISO(s) {
    // 'YYYY-MM-DD' -> Date local meio-dia (evita timezone shift)
    if (!s) return null;
    var p = String(s).slice(0, 10).split('-');
    if (p.length !== 3) return null;
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
  }
  function diffDays(aISO, bISO) {
    var a = parseISO(aISO), b = parseISO(bISO);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000);
  }
  function addDaysISO(iso, n) {
    var d = parseISO(iso); if (!d) return iso;
    d.setDate(d.getDate() + n);
    return toISO(d);
  }
  function fmtPeriodoLabel(iniISO, fimISO) {
    function br(iso){ var p = String(iso).slice(0,10).split('-'); return p[2]+'/'+p[1]; }
    if (!iniISO || !fimISO) return '';
    if (iniISO === fimISO) return br(iniISO);
    return br(iniISO) + ' a ' + br(fimISO);
  }

  // -------------------------------------------------------------------
  // Período / filtros do dashboard
  // -------------------------------------------------------------------
  function getPeriodo() {
    var fa = window.filtrosAplicados || {};
    var ini = fa.dataInicio || null;
    var fim = fa.dataFim || null;
    // fallback: range do calendário, se disponível
    if ((!ini || !fim) && typeof window.getCalendarVisibleDateRange === 'function') {
      try {
        var r = window.getCalendarVisibleDateRange();
        ini = ini || (r && r.start) || null;
        fim = fim || (r && r.end)   || null;
      } catch (_) {}
    }
    // último fallback: hoje
    var hoje = todayISO();
    ini = ini || hoje;
    fim = fim || hoje;
    if (fim < ini) { var t = ini; ini = fim; fim = t; }
    return {
      inicio: ini,
      fim: fim,
      profissionalId: fa.profissionalId || '__all__'
    };
  }

  function dentroDoPeriodo(ag, periodo) {
    var d = String(ag && ag.data || '').slice(0, 10);
    if (!d) return false;
    return d >= periodo.inicio && d <= periodo.fim;
  }
  function profissionalCasa(ag, periodo) {
    if (!periodo.profissionalId || periodo.profissionalId === '__all__') return true;
    var pid = ag.profissional_id || (ag.profissional && ag.profissional.id);
    return pid === periodo.profissionalId;
  }

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  function ensureContainer() {
    var dash = document.getElementById('page-dashboard');
    if (!dash || !dash.classList.contains('active')) return null; // só no dashboard

    var existing = document.getElementById('acan-root');
    if (existing) {
      // se por algum motivo escapou para fora do dashboard, move para dentro
      if (!dash.contains(existing)) dash.appendChild(existing);
      return existing;
    }

    // Posicionar APÓS o bloco operacional (Top Serviços / Top Clientes — .dash-row).
    // Fallback: depois do dashboard-pagamentos. Último recurso: append no final.
    var anchor = dash.querySelector('.dash-row') || dash.querySelector('#dash-pag-root');
    var root = document.createElement('section');
    root.id = 'acan-root';
    root.className = 'acan-root';
    root.innerHTML = ''
      + '<div class="acan-header">'
      +   '<h3><i class="fas fa-ban"></i> Analytics de Cancelamentos</h3>'
      +   '<span class="acan-help" id="acan-periodo-label"></span>'
      + '</div>'
      + '<div class="acan-grid-top" id="acan-cards"></div>'
      + '<div class="acan-grid-charts">'
      +   '<div class="acan-chart-card">'
      +     '<h4><i class="fas fa-list"></i> Motivos de Cancelamento</h4>'
      +     '<div id="acan-motivos"></div>'
      +   '</div>'
      +   '<div class="acan-chart-card">'
      +     '<h4><i class="fas fa-user-clock"></i> Profissionais com mais Cancelamentos</h4>'
      +     '<div id="acan-profs"></div>'
      +   '</div>'
      + '</div>';

    if (anchor && anchor.parentNode === dash) {
      dash.insertBefore(root, anchor.nextSibling);
    } else if (anchor) {
      anchor.parentNode.insertBefore(root, anchor.nextSibling);
    } else {
      dash.appendChild(root);
    }
    return root;
  }

  function removeContainer() {
    var existing = document.getElementById('acan-root');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function renderCards(stats, periodo) {
    var el = document.getElementById('acan-cards');
    if (!el) return;
    el.innerHTML = ''
      + card('fa-calendar-xmark', 'Cancelamentos no período', String(stats.canceladosPeriodo), fmtPeriodoLabel(periodo.inicio, periodo.fim), 'danger')
      + card('fa-percent',         'Taxa de Cancelamento', stats.taxaStr, stats.taxaSub, 'warn')
      + card('fa-money-bill-trend-up', 'Valor Perdido', fmtBRL(stats.valorPerdido), 'Apenas status=cancelado', 'danger')
      + card('fa-handshake',       'Cancelado com Venda', String(stats.canceladoComVenda), '', 'ok');
  }
  function card(icon, title, value, sub, mod) {
    return ''
      + '<div class="acan-card acan-card--' + (mod || '') + '">'
      +   '<div class="acan-card-title"><span>' + title + '</span><i class="fas ' + icon + '"></i></div>'
      +   '<div class="acan-card-value">' + value + '</div>'
      +   (sub ? '<div class="acan-card-sub">' + sub + '</div>' : '')
      + '</div>';
  }

  function renderMotivos(rows) {
    var el = document.getElementById('acan-motivos');
    if (!el) return;
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="acan-chart-empty">Sem cancelamentos no período.</div>';
      return;
    }
    var max = Math.max.apply(null, rows.map(function (r) { return r.qtd; }));
    var html = '<div class="acan-hbar-list">';
    rows.forEach(function (r) {
      var pct = max ? (r.qtd / max * 100) : 0;
      html += ''
        + '<div class="acan-hbar-row">'
        +   '<div class="acan-hbar-label" title="' + escapeHtml(r.label) + '">' + escapeHtml(r.label) + '</div>'
        +   '<div class="acan-hbar-val">' + r.qtd + '</div>'
        +   '<div class="acan-hbar-track"><div class="acan-hbar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>'
        + '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  function renderProfs(rows, total) {
    var el = document.getElementById('acan-profs');
    if (!el) return;
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="acan-chart-empty">Sem dados de profissionais no período.</div>';
      return;
    }
    var max = Math.max.apply(null, rows.map(function (r) { return r.qtd; }));
    var html = '<div class="acan-hbar-list">';
    rows.forEach(function (r) {
      var pct = max ? (r.qtd / max * 100) : 0;
      var pctTotal = total ? fmtPct(r.qtd, total) : '';
      html += ''
        + '<div class="acan-hbar-row">'
        +   '<div class="acan-hbar-label" title="' + escapeHtml(r.label) + '">' + escapeHtml(r.label) + '</div>'
        +   '<div class="acan-hbar-val">' + r.qtd + (pctTotal ? ' · ' + pctTotal : '') + '</div>'
        +   '<div class="acan-hbar-track"><div class="acan-hbar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>'
        + '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  function renderTrend(days) {
    var el = document.getElementById('acan-trend');
    if (!el) return;
    if (!days || !days.length) {
      el.innerHTML = '<div class="acan-chart-empty">Sem dados no período.</div>';
      return;
    }
    var max = Math.max.apply(null, days.map(function (d) { return d.qtd; }));
    var html = '<div class="acan-cols">';
    days.forEach(function (d) {
      var h = max ? (d.qtd / max * 100) : 0;
      html += ''
        + '<div class="acan-col">'
        +   '<div class="acan-col-val">' + d.qtd + '</div>'
        +   '<div class="acan-col-bar-wrap">'
        +     '<div class="acan-col-bar" data-zero="' + (d.qtd ? '0' : '1') + '" '
        +          'style="height:' + Math.max(h, d.qtd ? 6 : 4).toFixed(1) + '%"></div>'
        +   '</div>'
        +   '<div class="acan-col-day">' + d.label + '</div>'
        + '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // -------------------------------------------------------------------
  // Cálculos a partir de window.appointments + período
  // -------------------------------------------------------------------
  function computeFromAppointments(appts, periodo) {
    var canceladosPeriodo = 0;
    var totalGeralPeriodo = 0;
    var valorPerdido = 0;
    var canceladoComVenda = 0;
    var profMap = {};
    var agIdsCancelados = [];

    (appts || []).forEach(function (ag) {
      if (!dentroDoPeriodo(ag, periodo)) return;
      if (!profissionalCasa(ag, periodo)) return;

      totalGeralPeriodo++;

      if (isCanceladoComVenda(ag)) {
        canceladoComVenda++;
        return; // não entra em prejuízo
      }
      if (isCancelado(ag)) {
        canceladosPeriodo++;
        valorPerdido += getValorAgendamento(ag);
        if (ag.id) agIdsCancelados.push(ag.id);

        var pid = ag.profissional_id || (ag.profissional && ag.profissional.id) || 'sem';
        var pname =
          (ag.profissional && (ag.profissional.nome || ag.profissional.name)) ||
          ag.profissional_nome || ag.profissionalNome ||
          resolveProfNome(pid) ||
          'Sem profissional';
        if (!profMap[pid]) profMap[pid] = { label: pname, qtd: 0 };
        profMap[pid].qtd++;
      }
    });

    var profs = Object.keys(profMap).map(function (k) { return profMap[k]; })
      .sort(function (a, b) { return b.qtd - a.qtd; })
      .slice(0, 6);

    return {
      canceladosPeriodo: canceladosPeriodo,
      totalGeralPeriodo: totalGeralPeriodo,
      taxaStr: fmtPct(canceladosPeriodo, totalGeralPeriodo),
      taxaSub: canceladosPeriodo + ' de ' + totalGeralPeriodo + ' agendamentos',
      valorPerdido: valorPerdido,
      canceladoComVenda: canceladoComVenda,
      profs: profs,
      agIdsCancelados: agIdsCancelados
    };
  }

  // -------------------------------------------------------------------
  // Queries (cancelamento_log) — motivos + tendência por período
  // -------------------------------------------------------------------
  async function fetchMotivos(tenantId, periodo, agIdsCancelados) {
    // Sempre devolve pelo menos os fallbacks "Sem motivo informado", para que
    // o total do box bata com o card "Cancelamentos no período".
    function buildFromLogs(logs, catalog) {
      var byAg = {};
      (logs || []).forEach(function (r) {
        var agId = getLogAgendamentoId(r);
        if (!r || !agId) return;
        var prev = byAg[agId];
        if (!prev || (r.created_at && r.created_at > prev.created_at)) {
          byAg[agId] = r;
        }
      });
      var map = {};
      (agIdsCancelados || []).forEach(function (agId) {
        var r = byAg[agId];
        var fallbackAg = null;
        if (!r) {
          var appts = window.appointments || window.allAppointments || [];
          for (var i = 0; i < appts.length; i++) {
            if (appts[i] && String(appts[i].id) === String(agId)) { fallbackAg = appts[i]; break; }
          }
        }
        var m = r ? extractMotivo(r, catalog) : (fallbackAg ? extractMotivo(fallbackAg, catalog) : { key: 'sem-motivo', label: 'Sem motivo informado' });
        if (!map[m.key]) map[m.key] = { label: m.label, qtd: 0 };
        map[m.key].qtd++;
      });
      return Object.keys(map).map(function (k) { return map[k]; })
        .sort(function (a, b) { return b.qtd - a.qtd; })
        .slice(0, 8);
    }

    if (!agIdsCancelados || !agIdsCancelados.length) {
      console.log('[AnalyticsCancelamentos] Nenhum agendamento cancelado no período — pulando query de motivos.');
      return [];
    }

    var sb = getSb();
    if (!sb) {
      console.warn('[AnalyticsCancelamentos] supabaseClient ausente — usando fallback sem query.');
      return buildFromLogs([], _motivosCatalog);
    }

    try {
      // Carrega catálogo de motivos (id -> nome) — necessário quando o log
      // armazenou apenas motivo_id sem motivo_nome.
      var catalog = await loadMotivosCatalog(tenantId);

      // Busca em chunks por agendamento_id.
      var CHUNK = 200;
      var all = [];
      var seenLogs = {};
      function addLogs(rows) {
        (rows || []).forEach(function (r) {
          var k = r.id || (getLogAgendamentoId(r) + '|' + (r.created_at || ''));
          if (k && seenLogs[k]) return;
          if (k) seenLogs[k] = true;
          all.push(r);
        });
      }
      for (var i = 0; i < agIdsCancelados.length; i += CHUNK) {
        var slice = agIdsCancelados.slice(i, i + CHUNK);
        var q = sb.from('cancelamento_log').select('*').in('agendamento_id', slice);
        if (tenantId) q = q.eq('tenant_id', tenantId);
        var res = await q;
        if (res.error) { console.warn('[acan] motivos err', res.error); continue; }
        addLogs(res.data);
      }

      var encontradosPorAg = {};
      all.forEach(function (r) { var agId = getLogAgendamentoId(r); if (agId) encontradosPorAg[String(agId)] = true; });
      var faltando = (agIdsCancelados || []).filter(function (id) { return !encontradosPorAg[String(id)]; });

      async function buscarFallbackRecentes() {
        if (!tenantId) return;
        var fallback = await sb
          .from('cancelamento_log')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(1000);
        if (fallback.error) {
          console.warn('[acan] motivos fallback err', fallback.error);
          return;
        }
        var encontrados = {};
        all.forEach(function (r) { var agId = getLogAgendamentoId(r); if (agId) encontrados[String(agId)] = true; });
        var faltandoSet = {};
        (agIdsCancelados || []).forEach(function (id) { if (!encontrados[String(id)]) faltandoSet[String(id)] = true; });
        addLogs((fallback.data || []).filter(function (r) {
          var agId = getLogAgendamentoId(r);
          return agId && faltandoSet[String(agId)];
        }));
      }

      if (faltando.length && tenantId) {
        await buscarFallbackRecentes();
      }

      var encontradosDepois = {};
      all.forEach(function (r) { var agId = getLogAgendamentoId(r); if (agId) encontradosDepois[String(agId)] = true; });
      var faltandoDepois = (agIdsCancelados || []).filter(function (id) { return !encontradosDepois[String(id)]; });
      if (faltandoDepois.length && tenantId) {
        // Ao cancelar um agendamento recém-criado, às vezes o dashboard recarrega
        // antes do INSERT do cancelamento_log ficar visível no cliente. Uma
        // retentativa curta evita classificar como "Sem motivo informado".
        await new Promise(function (resolve) { setTimeout(resolve, 700); });
        for (var rtry = 0; rtry < faltandoDepois.length; rtry += CHUNK) {
          var retrySlice = faltandoDepois.slice(rtry, rtry + CHUNK);
          var retryQ = sb.from('cancelamento_log').select('*').in('agendamento_id', retrySlice);
          if (tenantId) retryQ = retryQ.eq('tenant_id', tenantId);
          var retryRes = await retryQ;
          if (retryRes.error) { console.warn('[acan] motivos retry err', retryRes.error); continue; }
          addLogs(retryRes.data);
        }
        await buscarFallbackRecentes();
      }

      console.log('[AnalyticsCancelamentos] Logs encontrados:', all.length, 'de', agIdsCancelados.length, 'agendamentos cancelados (tenantId=', tenantId, ').');

      return buildFromLogs(all, catalog);
    } catch (e) {
      console.warn('[acan] motivos exception', e);
      return buildFromLogs([], _motivosCatalog);
    }
  }

  function buildEmptyDays(periodo) {
    var labels = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
    var totalDias = diffDays(periodo.inicio, periodo.fim) + 1;
    if (totalDias < 1) totalDias = 1;
    if (totalDias > 92) totalDias = 92; // proteção visual
    var days = [];
    for (var i = 0; i < totalDias; i++) {
      var iso = addDaysISO(periodo.inicio, i);
      var d = parseISO(iso);
      var lab;
      if (totalDias <= 14) {
        lab = labels[d.getDay()];
      } else {
        lab = pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1);
      }
      days.push({ iso: iso, label: lab, qtd: 0 });
    }
    return days;
  }

  async function fetchTrend(tenantId, periodo, agIdsCancelados) {
    var days = buildEmptyDays(periodo);
    var sb = getSb();
    if (!sb || !tenantId) return days;

    try {
      var sinceIso = periodo.inicio + 'T00:00:00.000Z';
      var untilIso = addDaysISO(periodo.fim, 1) + 'T00:00:00.000Z';
      var res = await sb
        .from('cancelamento_log')
        .select('created_at, agendamento_id')
        .eq('tenant_id', tenantId)
        .gte('created_at', sinceIso)
        .lt('created_at', untilIso);
      if (res.error) { console.warn('[acan] trend err', res.error); return days; }

      var data = res.data || [];
      if (periodo.profissionalId && periodo.profissionalId !== '__all__') {
        var setIds = {};
        agIdsCancelados.forEach(function (id) { setIds[id] = true; });
        data = data.filter(function (r) { return setIds[r.agendamento_id]; });
      }

      var byIso = {};
      days.forEach(function (d) { byIso[d.iso] = d; });
      data.forEach(function (r) {
        var iso = String(r.created_at || '').slice(0, 10);
        if (byIso[iso]) byIso[iso].qtd++;
      });
    } catch (e) {
      console.warn('[acan] trend exception', e);
    }
    return days;
  }

  // -------------------------------------------------------------------
  // Cancelado com Venda via cancelamento_log:
  // conta entradas no período cujo status anterior era "concluído"
  // (agendamento concluído que foi posteriormente excluído/cancelado).
  // -------------------------------------------------------------------
  function isStatusConcluido(v) {
    if (v == null) return false;
    var s = String(v).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s === 'concluido' || s === 'completed' || s === 'done' || s === 'finalizado';
  }
  function logIndicaConcluidoExcluido(r) {
    if (!r) return false;
    var payloads = motivoPayloads(r);
    var prevKeys = [
      'status_anterior', 'statusAnterior', 'previous_status', 'previousStatus',
      'status_prev', 'prev_status', 'old_status', 'oldStatus', 'status_old',
      'status_before', 'statusBefore', 'status_origem', 'from_status', 'fromStatus'
    ];
    for (var i = 0; i < payloads.length; i++) {
      var obj = payloads[i] || {};
      for (var k = 0; k < prevKeys.length; k++) {
        if (isStatusConcluido(obj[prevKeys[k]])) return true;
      }
      // conclusion_type capturado no momento do cancelamento
      if (isStatusConcluido(obj.conclusion_type) || isStatusConcluido(obj.conclusionType)) return true;
      // marcação explícita
      var s = String(obj.status || '').toLowerCase();
      if (s === 'cancelado_com_venda') return true;
    }
    return false;
  }

  async function fetchCanceladoComVendaFromLog(tenantId, periodo, agIdsJaContados) {
    var sb = getSb();
    if (!sb || !tenantId) return 0;
    try {
      var sinceIso = periodo.inicio + 'T00:00:00.000Z';
      var untilIso = addDaysISO(periodo.fim, 1) + 'T00:00:00.000Z';
      var res = await sb
        .from('cancelamento_log')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('created_at', sinceIso)
        .lt('created_at', untilIso);
      if (res.error) { console.warn('[acan] cancelado-com-venda log err', res.error); return 0; }

      var jaContados = {};
      (agIdsJaContados || []).forEach(function (id) { jaContados[String(id)] = true; });

      // Dedup por agendamento (último log por ag).
      var byAg = {};
      (res.data || []).forEach(function (r) {
        var agId = getLogAgendamentoId(r);
        if (!agId) return;
        var prev = byAg[String(agId)];
        if (!prev || (r.created_at && r.created_at > prev.created_at)) {
          byAg[String(agId)] = r;
        }
      });

      var count = 0;
      Object.keys(byAg).forEach(function (agId) {
        if (jaContados[agId]) return; // já contado via window.appointments
        if (logIndicaConcluidoExcluido(byAg[agId])) count++;
      });
      console.log('[AnalyticsCancelamentos] Cancelado-com-venda extra via log (concluído excluído):', count);
      return count;
    } catch (e) {
      console.warn('[acan] cancelado-com-venda log exception', e);
      return 0;
    }
  }

  // -------------------------------------------------------------------
  // Render orquestrador
  // -------------------------------------------------------------------
  var _renderSeq = 0;
  async function renderAll() {
    try {
      var root = ensureContainer();
      if (!root) return; // não está no dashboard

      var periodo = getPeriodo();
      var lbl = document.getElementById('acan-periodo-label');
      if (lbl) lbl.textContent = 'Período: ' + fmtPeriodoLabel(periodo.inicio, periodo.fim);

      var appts = window.appointments || window.allAppointments || [];
      var stats = computeFromAppointments(appts, periodo);
      renderCards(stats, periodo);
      renderProfs(stats.profs, stats.canceladosPeriodo);

      var seq = ++_renderSeq;
      var tenantId = getTenantId();

      // IDs já reconhecidos como cancelado-com-venda em window.appointments
      var jaContadosCcv = [];
      (appts || []).forEach(function (ag) {
        if (!dentroDoPeriodo(ag, periodo)) return;
        if (!profissionalCasa(ag, periodo)) return;
        if (isCanceladoComVenda(ag) && ag.id) jaContadosCcv.push(ag.id);
      });

      var [motivos, ccvExtra] = await Promise.all([
        fetchMotivos(tenantId, periodo, stats.agIdsCancelados),
        fetchCanceladoComVendaFromLog(tenantId, periodo, jaContadosCcv)
      ]);
      if (seq !== _renderSeq) return; // chegou render mais novo
      // só renderiza se ainda estiver no dashboard
      if (!document.getElementById('acan-root')) return;

      if (ccvExtra > 0) {
        stats.canceladoComVenda = (stats.canceladoComVenda || 0) + ccvExtra;
        renderCards(stats, periodo);
      }
      renderMotivos(motivos);
    } catch (e) {
      console.error('[acan] render err', e);
    }
  }

  // -------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------
  function hookLoadDashboard() {
    var orig = window.loadDashboard;
    if (typeof orig === 'function' && !orig.__acanWrapped) {
      var wrapped = async function () {
        var r = await orig.apply(this, arguments);
        renderAll();
        return r;
      };
      wrapped.__acanWrapped = true;
      window.loadDashboard = wrapped;
    }
  }

  function hookAplicarFiltros() {
    var orig = window.aplicarFiltrosDashboard;
    if (typeof orig === 'function' && !orig.__acanWrapped) {
      var wrapped = function () {
        var r = orig.apply(this, arguments);
        // loadDashboard já foi chamado dentro do orig; nosso hook em
        // loadDashboard cuidará do re-render. Mas garantimos um refresh.
        setTimeout(renderAll, 50);
        return r;
      };
      wrapped.__acanWrapped = true;
      window.aplicarFiltrosDashboard = wrapped;
    }
  }

  // Mount/unmount conforme troca de view
  function observePage() {
    var dash = document.getElementById('page-dashboard');
    if (!dash) return;
    var lastActive = dash.classList.contains('active');
    if (lastActive) renderAll();

    var mo = new MutationObserver(function () {
      var nowActive = dash.classList.contains('active');
      if (nowActive && !lastActive) {
        lastActive = true;
        renderAll();
      } else if (!nowActive && lastActive) {
        lastActive = false;
        removeContainer();
      }
    });
    mo.observe(dash, { attributes: true, attributeFilter: ['class'] });

    // Defesa extra: se outras views ficarem ativas, garantir remoção.
    var pages = document.querySelectorAll('.page');
    pages.forEach(function (p) {
      if (p === dash) return;
      var moP = new MutationObserver(function () {
        if (p.classList.contains('active')) removeContainer();
      });
      moP.observe(p, { attributes: true, attributeFilter: ['class'] });
    });
  }

  function init() {
    hookLoadDashboard();
    hookAplicarFiltros();
    observePage();
    // Tentativas tardias: alguns scripts redefinem loadDashboard depois
    setTimeout(hookLoadDashboard, 500);
    setTimeout(hookAplicarFiltros, 500);
    setTimeout(hookLoadDashboard, 2000);
    setTimeout(hookAplicarFiltros, 2000);

    var dash = document.getElementById('page-dashboard');
    if (dash && dash.classList.contains('active')) {
      setTimeout(renderAll, 300);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expostos para refresh manual / debug
  window.SlotifyAnalyticsCancelamentos = {
    render: renderAll,
    remove: removeContainer
  };
})();
