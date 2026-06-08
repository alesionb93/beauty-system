/* =====================================================================
   ANALYTICS-PRODUTOS.JS — Add-on isolado (v1)
   ---------------------------------------------------------------------
   Carregue DEPOIS de script.js E DEPOIS de dashboard-pagamentos.js
   (e idealmente DEPOIS de analytics-cancelamentos.js) em agenda.html:

       <link rel="stylesheet" href="/analytics-produtos.css">
       <script src="/analytics-produtos.js?v=1" defer></script>

   Mesma arquitetura do analytics-cancelamentos.js:
     • wrap em window.loadDashboard
     • render isolado (mount/unmount via observer)
     • falha silenciosa
     • tema-aware via CSS vars
     • multi-tenant safe
     • respeita window.filtrosAplicados (período / profissional)

   FONTE DE DADOS:
     • window.appointments (carregado pelo script principal — já vem com
       a.produtos = [{produto_id, quantidade, preco_unitario, ...}]).
     • Tabela public.produtos (campos: id, nome, valor, custo) — buscada
       1x por tenant para enriquecer cada item com preço de custo.

   REGRAS DE NEGÓCIO:
     • Um produto é considerado "vendido" quando o agendamento NÃO é
       puramente cancelado. Ou seja:
         - status='cancelado'           => IGNORADO (produto perdeu venda)
         - status='cancelado_com_venda' => CONTA (mesma regra do dashboard)
         - demais status (concluido / agendado / etc) => CONTA
       Justificativa: o módulo de cancelamentos já trata o lado oposto.
     • custo IS NULL          => trata como 0 para o CMV/lucro, mas
                                  marca o produto como "sem custo" e
                                  o exclui do ranking de menor margem.
     • Filtro de período usa ag.data (mesmo critério do módulo de
       cancelamentos / dashboard).
   ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_ANALYTICS_PRODUTOS_LOADED__) return;
  window.__SLOTIFY_ANALYTICS_PRODUTOS_LOADED__ = true;

  console.log('%c📦 analytics-produtos.js v1 carregado',
    'background:#10b981;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700');

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------
  function fmtBRL(n) {
    n = Number(n) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function fmtPct(n, dec) {
    if (!isFinite(n)) return '0%';
    return n.toFixed(dec == null ? 1 : dec).replace('.', ',') + '%';
  }
  function fmtInt(n) { return (Number(n) || 0).toLocaleString('pt-BR'); }
  function getSb() { return window.supabaseClient || window.supabase || null; }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getTenantId() {
    var tid =
      window.currentTenantId || window.TENANT_ID || window.tenantId || window.tenant_id ||
      (window.appState && (window.appState.tenantId || window.appState.tenant_id)) ||
      (window.currentUser && (window.currentUser.tenant_id || window.currentUser.tenantId)) ||
      (window.usuarioLogado && (window.usuarioLogado.tenant_id || window.usuarioLogado.tenantId)) ||
      null;
    if (!tid) {
      var arr = window.appointments || window.allAppointments || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].tenant_id) { tid = arr[i].tenant_id; break; }
      }
    }
    return tid || null;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function toISO(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayISO() { return toISO(new Date()); }
  function fmtPeriodoLabel(iniISO, fimISO) {
    function br(iso){ var p = String(iso).slice(0,10).split('-'); return p[2]+'/'+p[1]; }
    if (!iniISO || !fimISO) return '';
    if (iniISO === fimISO) return br(iniISO);
    return br(iniISO) + ' a ' + br(fimISO);
  }

  function getPeriodo() {
    var fa = window.filtrosAplicados || {};
    var ini = fa.dataInicio || null;
    var fim = fa.dataFim || null;
    if ((!ini || !fim) && typeof window.getCalendarVisibleDateRange === 'function') {
      try {
        var r = window.getCalendarVisibleDateRange();
        ini = ini || (r && r.start) || null;
        fim = fim || (r && r.end) || null;
      } catch (_) {}
    }
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
  function isCanceladoPuro(ag) {
    return ag && String(ag.status || '').toLowerCase() === 'cancelado';
  }
  // BUG FIX (CT016): Analytics de Produtos deve contabilizar SOMENTE
  // agendamentos efetivamente concluídos. Antes, qualquer agendamento
  // não cancelado (incluindo "agendado", "confirmado", "em_andamento")
  // já entrava nas métricas de venda, inflando faturamento bruto, produto
  // mais vendido e quantidade vendida no momento da criação.
  function isConcluido(ag) {
    var s = String((ag && ag.status) || '').toLowerCase();
    // 'concluido' = atendimento finalizado.
    // 'cancelado_com_venda' = cancelado mas a venda do produto foi mantida
    // (mesma regra do dashboard de pagamentos), portanto também conta.
    return s === 'concluido' || s === 'concluído' || s === 'cancelado_com_venda';
  }

  // -------------------------------------------------------------------
  // Catálogo de produtos (com custo) — cache por tenant
  // -------------------------------------------------------------------
  var _produtosCatalog = { byId: {}, loadedFor: null };
  async function loadProdutosCatalog(tenantId) {
    if (_produtosCatalog.loadedFor === (tenantId || '__all__')) return _produtosCatalog;
    var sb = getSb();
    if (!sb) return _produtosCatalog;
    try {
      var q = sb.from('produtos').select('id, nome, valor, custo');
      if (tenantId) q = q.eq('tenant_id', tenantId);
      var res = await q;
      if (res.error) { console.warn('[aprod] catálogo produtos err', res.error); return _produtosCatalog; }
      var byId = {};
      (res.data || []).forEach(function (p) {
        byId[String(p.id)] = {
          id: p.id,
          nome: p.nome || 'Produto',
          valor: Number(p.valor) || 0,
          custo: (p.custo == null || p.custo === '') ? null : Number(p.custo)
        };
      });
      _produtosCatalog = { byId: byId, loadedFor: tenantId || '__all__' };
      console.log('[AnalyticsProdutos] Catálogo de produtos carregado:', Object.keys(byId).length, 'itens.');
    } catch (e) { console.warn('[aprod] catálogo produtos exception', e); }
    return _produtosCatalog;
  }

  // Permite invalidar cache quando o usuário cadastra/edita produto.
  window.__aprodInvalidateProdutos = function () {
    _produtosCatalog = { byId: {}, loadedFor: null };
  };

  // -------------------------------------------------------------------
  // Cálculo das métricas
  // -------------------------------------------------------------------
  function computeStats(appts, periodo, catalog) {
    var faturamento = 0;
    var cmv = 0;
    var qtdItens = 0;
    var qtdProdutosUnicos = {};
    var qtdAgendamentosComProduto = 0;
    var hasCusto = false;

    var perProduto = {}; // produto_id -> { nome, qtd, faturamento, cmv, lucro, hasCusto }

    (appts || []).forEach(function (ag) {
      if (!dentroDoPeriodo(ag, periodo)) return;
      if (!profissionalCasa(ag, periodo)) return;
      if (!isConcluido(ag)) return; // só contabiliza venda após conclusão do atendimento

      var prods = ag.produtos || [];
      if (!prods.length) return;
      qtdAgendamentosComProduto++;

      prods.forEach(function (p) {
        var pid = String(p.produto_id || '');
        if (!pid) return;
        var qtd = Number(p.quantidade) || 0;
        if (qtd <= 0) return;

        var meta = (catalog.byId && catalog.byId[pid]) || null;
        var nome = (meta && meta.nome) || 'Produto';
        var precoUnit = Number(p.preco_unitario);
        if (!isFinite(precoUnit)) precoUnit = (meta && meta.valor) || 0;
        var custoUnit = (meta && meta.custo != null) ? meta.custo : null;

        var fat = qtd * precoUnit;
        var custoTotal = (custoUnit != null) ? (qtd * custoUnit) : 0;

        faturamento += fat;
        cmv += custoTotal;
        qtdItens += qtd;
        qtdProdutosUnicos[pid] = true;
        if (custoUnit != null) hasCusto = true;

        if (!perProduto[pid]) {
          perProduto[pid] = {
            id: pid, nome: nome,
            qtd: 0, faturamento: 0, cmv: 0, lucro: 0,
            hasCusto: false
          };
        }
        var row = perProduto[pid];
        row.qtd += qtd;
        row.faturamento += fat;
        if (custoUnit != null) {
          row.cmv += custoTotal;
          row.hasCusto = true;
        }
      });
    });

    var produtos = Object.keys(perProduto).map(function (k) {
      var r = perProduto[k];
      r.lucro = r.faturamento - r.cmv;
      r.margem = r.faturamento > 0 ? (r.lucro / r.faturamento) * 100 : 0;
      return r;
    });

    var lucro = faturamento - cmv;
    var margem = faturamento > 0 ? (lucro / faturamento) * 100 : 0;

    var topVendidos = produtos.slice().sort(function (a, b) { return b.qtd - a.qtd; }).slice(0, 5);
    var topLucrativos = produtos.filter(function (p) { return p.hasCusto; })
      .slice().sort(function (a, b) { return b.lucro - a.lucro; }).slice(0, 5);
    var menorMargem = produtos.filter(function (p) { return p.hasCusto && p.faturamento > 0; })
      .slice().sort(function (a, b) { return a.margem - b.margem; }).slice(0, 5);

    return {
      faturamento: faturamento,
      cmv: cmv,
      lucro: lucro,
      margem: margem,
      qtdItens: qtdItens,
      qtdProdutosUnicos: Object.keys(qtdProdutosUnicos).length,
      qtdAgendamentos: qtdAgendamentosComProduto,
      hasCusto: hasCusto,
      topVendidos: topVendidos,
      topLucrativos: topLucrativos,
      menorMargem: menorMargem
    };
  }

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  function ensureContainer() {
    var dash = document.getElementById('page-dashboard');
    if (!dash || !dash.classList.contains('active')) return null;

    var existing = document.getElementById('aprod-root');
    if (existing) {
      if (!dash.contains(existing)) dash.appendChild(existing);
      return existing;
    }

    // Posicionar idealmente DEPOIS do bloco de analytics de cancelamentos,
    // ou depois do dash-pag-root, ou no final do dashboard.
    var anchor = dash.querySelector('#acan-root') || dash.querySelector('.dash-row') || dash.querySelector('#dash-pag-root');
    var root = document.createElement('section');
    root.id = 'aprod-root';
    root.className = 'aprod-root';
    root.innerHTML = ''
      + '<div class="aprod-header">'
      +   '<h3><i class="fas fa-box-open"></i> Analytics de Produtos</h3>'
      +   '<span class="aprod-help" id="aprod-periodo-label"></span>'
      + '</div>'
      + '<div class="aprod-grid-top" id="aprod-cards"></div>'
      + '<div class="aprod-grid-charts">'
      +   '<div class="aprod-chart-card">'
      +     '<h4><i class="fas fa-shopping-bag"></i> Produtos mais vendidos</h4>'
      +     '<div id="aprod-top-vendidos"></div>'
      +   '</div>'
      +   '<div class="aprod-chart-card">'
      +     '<h4><i class="fas fa-gem"></i> Produtos mais lucrativos</h4>'
      +     '<div id="aprod-top-lucrativos"></div>'
      +   '</div>'
      +   '<div class="aprod-chart-card aprod-chart-card--full">'
      +     '<h4><i class="fas fa-triangle-exclamation"></i> Produtos com menor margem</h4>'
      +     '<div id="aprod-menor-margem"></div>'
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
    var existing = document.getElementById('aprod-root');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function card(icon, title, value, sub, mod) {
    return ''
      + '<div class="aprod-card aprod-card--' + (mod || '') + '">'
      +   '<div class="aprod-card-title"><span>' + escapeHtml(title) + '</span><i class="fas ' + icon + '"></i></div>'
      +   '<div class="aprod-card-value">' + value + '</div>'
      +   (sub ? '<div class="aprod-card-sub">' + escapeHtml(sub) + '</div>' : '')
      + '</div>';
  }

  function renderCards(stats) {
    var el = document.getElementById('aprod-cards');
    if (!el) return;
    var subCmv = stats.hasCusto ? 'Custo × quantidade' : 'Cadastre o custo dos produtos';
    var subLucro = stats.hasCusto ? 'Faturamento − CMV' : 'Sem custo cadastrado';
    var subMargem = stats.hasCusto ? 'Lucro ÷ Faturamento' : '—';
    el.innerHTML = ''
      + card('fa-sack-dollar',          'Faturamento Bruto', fmtBRL(stats.faturamento), fmtInt(stats.qtdItens) + ' itens vendidos', 'ok')
      + card('fa-money-bill-wave',      'CMV',               fmtBRL(stats.cmv),         subCmv,                                     'warn')
      + card('fa-chart-line',           'Lucro Bruto',       fmtBRL(stats.lucro),       subLucro,                                   stats.lucro >= 0 ? 'ok' : 'danger')
      + card('fa-percent',              'Margem Média',      stats.hasCusto ? fmtPct(stats.margem) : '—', subMargem,                stats.margem >= 30 ? 'ok' : (stats.margem >= 10 ? 'warn' : 'danger'));
  }

  function renderRanking(elId, rows, mode) {
    var el = document.getElementById(elId);
    if (!el) return;
    if (!rows || !rows.length) {
      var msg = mode === 'lucrativos' || mode === 'menor-margem'
        ? 'Nenhum produto com custo cadastrado neste período.'
        : 'Nenhuma venda de produto no período.';
      el.innerHTML = '<div class="aprod-chart-empty">' + msg + '</div>';
      return;
    }
    var maxKey = mode === 'lucrativos' ? 'lucro' : (mode === 'menor-margem' ? 'margem' : 'qtd');
    var values = rows.map(function (r) { return Math.abs(r[maxKey]); });
    var max = Math.max.apply(null, values) || 1;

    var html = '<div class="aprod-hbar-list">';
    rows.forEach(function (r) {
      var val = r[maxKey];
      var pct;
      if (mode === 'menor-margem') {
        // barra inversa: menor margem => barra mais cheia (chama atenção)
        var clamped = Math.max(0, Math.min(100, val));
        pct = 100 - clamped;
      } else {
        pct = max ? (Math.abs(val) / max * 100) : 0;
      }
      var displayVal;
      if (mode === 'lucrativos')        displayVal = fmtBRL(r.lucro);
      else if (mode === 'menor-margem') displayVal = fmtPct(r.margem);
      else                              displayVal = fmtInt(r.qtd) + ' vend.';

      var subInfo = '';
      if (mode === 'vendidos')           subInfo = fmtBRL(r.faturamento);
      else if (mode === 'lucrativos')    subInfo = fmtPct(r.margem) + ' margem';
      else if (mode === 'menor-margem')  subInfo = fmtBRL(r.lucro) + ' lucro';

      html += ''
        + '<div class="aprod-hbar-row">'
        +   '<div class="aprod-hbar-label" title="' + escapeHtml(r.nome) + '">' + escapeHtml(r.nome) + '</div>'
        +   '<div class="aprod-hbar-val">' + displayVal + (subInfo ? ' <span class="aprod-hbar-sub">· ' + subInfo + '</span>' : '') + '</div>'
        +   '<div class="aprod-hbar-track"><div class="aprod-hbar-fill aprod-hbar-fill--' + mode + '" style="width:' + pct.toFixed(1) + '%"></div></div>'
        + '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  // -------------------------------------------------------------------
  // Render orquestrador
  // -------------------------------------------------------------------
  var _renderSeq = 0;
  async function renderAll() {
    try {
      var root = ensureContainer();
      if (!root) return;

      var periodo = getPeriodo();
      var lbl = document.getElementById('aprod-periodo-label');
      if (lbl) lbl.textContent = 'Período: ' + fmtPeriodoLabel(periodo.inicio, periodo.fim);

      var seq = ++_renderSeq;
      var tenantId = getTenantId();
      var catalog = await loadProdutosCatalog(tenantId);
      if (seq !== _renderSeq) return;
      if (!document.getElementById('aprod-root')) return;

      var appts = window.appointments || window.allAppointments || [];
      var stats = computeStats(appts, periodo, catalog);

      renderCards(stats);
      renderRanking('aprod-top-vendidos',    stats.topVendidos,    'vendidos');
      renderRanking('aprod-top-lucrativos',  stats.topLucrativos,  'lucrativos');
      renderRanking('aprod-menor-margem',    stats.menorMargem,    'menor-margem');
    } catch (e) {
      console.error('[aprod] render err', e);
    }
  }

  // -------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------
  function hookLoadDashboard() {
    var orig = window.loadDashboard;
    if (typeof orig === 'function' && !orig.__aprodWrapped) {
      var wrapped = async function () {
        var r = await orig.apply(this, arguments);
        renderAll();
        return r;
      };
      wrapped.__aprodWrapped = true;
      window.loadDashboard = wrapped;
    }
  }

  function hookAplicarFiltros() {
    var orig = window.aplicarFiltrosDashboard;
    if (typeof orig === 'function' && !orig.__aprodWrapped) {
      var wrapped = function () {
        var r = orig.apply(this, arguments);
        setTimeout(renderAll, 50);
        return r;
      };
      wrapped.__aprodWrapped = true;
      window.aplicarFiltrosDashboard = wrapped;
    }
  }

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
  window.SlotifyAnalyticsProdutos = {
    render: renderAll,
    remove: removeContainer,
    invalidate: function () {
      _produtosCatalog = { byId: {}, loadedFor: null };
      return renderAll();
    }
  };
})();
