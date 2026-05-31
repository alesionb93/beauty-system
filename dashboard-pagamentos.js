/* =====================================================================
   DASHBOARD-PAGAMENTOS.JS — Add-on isolado (v1)
   ---------------------------------------------------------------------
   Carregue DEPOIS do script.js E DEPOIS do pagamentos.js, em agenda.html:

       <link rel="stylesheet" href="/dashboard-pagamentos.css">
       <script src="/dashboard-pagamentos.js?v=1" defer></script>

   O que faz:
   • Hook em window.loadDashboard (após o original rodar) para injetar:
       1) Faturamento por forma de pagamento (barras + %)
       2) Recebido vs Pendente
       3) Lista de pendências financeiras (clique → abre o agendamento)
       4) Ticket médio por forma de pagamento
       5) Recebimentos por dia (gráfico empilhado por forma)
   • 100% baseado em window.appointments + tabela agendamento_pagamentos.
   • Não altera o cálculo de faturamento existente (só adiciona widgets).
   • Multi-tenant safe (RLS na tabela já garante isolamento).
   ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_DASH_PAG_LOADED__) return;
  window.__SLOTIFY_DASH_PAG_LOADED__ = true;
  console.log('%c📊 dashboard-pagamentos.js v5 carregado (venda de pacote no dashboard)',
    'background:#0ea5e9;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700');
  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------
  var FORMAS = [
    { id: 'pix',                label: 'PIX',                color: '#10b981' },
    { id: 'dinheiro',           label: 'Dinheiro',           color: '#f59e0b' },
    { id: 'debito',             label: 'Débito',             color: '#3b82f6' },
    { id: 'credito',            label: 'Crédito',            color: '#8b5cf6' },
    { id: 'credito_parcelado',  label: 'Crédito Parcelado',  color: '#ec4899' }
  ];
  var FORMA_INDEX = {};
  FORMAS.forEach(function(f){ FORMA_INDEX[f.id] = f; });
  function fmtBRL(n){
    n = Number(n) || 0;
    return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  }
  function pct(v, total){
    if (!total) return '0%';
    return (v / total * 100).toFixed(1).replace('.', ',') + '%';
  }
  function round2(n){ return Math.round((Number(n)||0) * 100) / 100; }
  function parseValor(v){
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      var s = v.replace(/[^\d,.-]/g, '');
      if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
      var n = parseFloat(s);
      return isNaN(n) ? 0 : n;
    }
    return 0;
  }
  function valorPorCampos(item, campos){
    if (!item) return 0;
    for (var i = 0; i < campos.length; i++) {
      var v = parseValor(item[campos[i]]);
      if (v > 0) return v;
    }
    if (item.pacote && typeof item.pacote === 'object') {
      for (var j = 0; j < campos.length; j++) {
        var pv = parseValor(item.pacote[campos[j]]);
        if (pv > 0) return pv;
      }
    }
    return 0;
  }
  function valorServicoItem(item){
    var v = valorPorCampos(item, ['preco','valor','valor_total','valorTotal','total','preco_total','precoTotal','price','amount']);
    if (v > 0) return v;
    var qtd = parseValor(item && (item.quantidade || item.qtd || item.quantity));
    var unit = parseValor(item && (item.preco_unitario || item.valor_unitario || item.unit_price));
    return qtd > 0 && unit > 0 ? qtd * unit : 0;
  }
  function valorPacoteVendaItem(item){
    var v = valorPorCampos(item, [
      'valor_total','valorTotal','total','preco_total','precoTotal',
      'preco_pacote','precoPacote','valor_pacote','valorPacote',
      'pacote_valor','pacoteValor','valor','preco','price','amount'
    ]);
    if (v > 0) return v;
    var qtd = parseValor(item && (item.quantidade || item.qtd || item.quantity));
    var unit = parseValor(item && (item.preco_unitario || item.valor_unitario || item.unit_price));
    return qtd > 0 && unit > 0 ? qtd * unit : 0;
  }
  function getSb(){ return window.supabaseClient || window.supabase || null; }

  function getServicos(ag){
    if (!ag) return [];
    if (typeof window.getAppointmentServicos === 'function') {
      try { return window.getAppointmentServicos(ag) || []; } catch(_){}
    }
    return ag.servicos || (ag.servico ? [{ servico: ag.servico, profissional: ag.profissional }] : []);
  }

  function getProdutosDoAgendamento(agId){
    var st = window.__produtosVendaState;
    if (st && st.porAgendamento && st.porAgendamento[agId]) return st.porAgendamento[agId];
    if (window.produtosPorAgendamento && window.produtosPorAgendamento[agId])
      return window.produtosPorAgendamento[agId];
    return [];
  }
  // Itens de USO de pacote (consumo de saldo) vinculados ao agendamento
  function getPacoteUsoItems(ag){
    if (!ag) return [];
    var arr = ag._pacoteUsoItems || ag.pacoteUsoItems || ag.pacote_uso_items ||
              ag.usosPacote || ag.usos_pacote || ag.pacotesUsados || ag.pacotes_usados;
    return Array.isArray(arr) ? arr : [];
  }
  // Itens de VENDA de pacote vinculados ao agendamento (preenchido pelo script.js)
  function getPacoteVendaItems(ag){
    if (!ag) return [];
    var out = [];
    var seen = {};
    function pushItem(it){
      if (!it) return;
      var key = it.id || it.agendamento_servico_id || it.item_id || it.pacote_venda_id || null;
      if (key) {
        key = String(key);
        if (seen[key]) return;
        seen[key] = true;
      }
      out.push(it);
    }
    var campos = [
      '_pacoteVendaItems','pacoteVendaItems','pacote_venda_items',
      'pacotesVendidos','pacotes_vendidos','pacotes_venda','pacotesVenda',
      'pacotes_para_venda','pacotesParaVenda','venda_pacotes','vendasPacotes','packagesSold'
    ];
    campos.forEach(function(c){
      var arr = ag[c];
      if (Array.isArray(arr) && arr.length) arr.forEach(pushItem);
    });
    if (ag._hasVendaPacote) {
      ['pacoteVenda','pacote_venda','pacoteVendido','pacote_vendido','pacote'].forEach(function(c){
        var item = ag[c];
        if (Array.isArray(item)) item.forEach(pushItem);
        else if (item && typeof item === 'object') pushItem(item);
      });
    }
    // Em alguns carregamentos a venda de pacote vem misturada em ag.servicos
    // como uma linha tipo='pacote_venda', sem preencher _pacoteVendaItems.
    getServicos(ag).forEach(function(s){
      if (isServicoVendaPacote(s)) pushItem(s);
    });
    // Fallback final: quando existe a flag de venda e o valor do pacote está
    // direto no objeto do agendamento. Só entra se houver valor de pacote.
    if (!out.length && ag._hasVendaPacote && valorPacoteVendaItem(ag) > 0) pushItem(ag);
    return out;
  }
  function possuiVendaPacote(ag){
    return getPacoteVendaItems(ag).some(function(it){ return valorPacoteVendaItem(it) > 0 || isServicoVendaPacote(it); }) || !!(ag && ag._hasVendaPacote);
  }

  function _sid(x){
    if (!x) return null;
    return x.servico_id || x.servicoId || x.servico || x.id || null;
  }
  function _kind(item){
    if (!item) return '';
    return String(item.tipo || item.type || item.kind || item.categoria ||
                  item.origem || item.source || item.modo || item.mode || '')
      .toLowerCase();
  }

  // Um serviço é "uso de pacote" quando consome saldo (não gera venda).
  function isServicoUsoPacote(s, ag){
    if (!s) return false;
    if (s.pacote_uso || s.pacoteUso || s.usoPacote || s.uso_pacote ||
        s.is_pacote_uso || s.from_pacote || s.fromPacote) return true;
    var k = _kind(s);
    if (k === 'pacote_uso' || k === 'uso_pacote' ||
        (k.indexOf('pacote') >= 0 && (k.indexOf('uso') >= 0 || k.indexOf('consumo') >= 0))) return true;
    // Heurística: serviço com vínculo de pacote do cliente é consumo
    if (s.pacote_id || s.pacoteId || s.cliente_pacote_id || s.clientePacoteId ||
        s.pacote_cliente_id || s.pacoteClienteId) return true;
    // Cruzar com lista de usos do agendamento
    if (ag) {
      var usos = getPacoteUsoItems(ag);
      if (usos.length) {
        var sid = _sid(s);
        if (sid && usos.some(function(u){
          var uid = _sid(u);
          return uid && uid === sid;
        })) return true;
      }
    }
    return false;
  }

  // Linha de serviço que é VENDA de pacote (não deve ser cobrada como serviço avulso)
  function isServicoVendaPacote(s){
    if (!s) return false;
    var k = _kind(s);
    return k === 'pacote_venda' || k === 'venda_pacote' || k === 'pacote' ||
           (k.indexOf('pacote') >= 0 && k.indexOf('venda') >= 0);
  }
  // Quando o agendamento tem VENDA de pacote, os serviços cobertos por ela
  // não devem somar preço individual (o valor do pacote já cobre).
  function servicoCobertoPorVendaPacote(s, ag){
    var items = getPacoteVendaItems(ag);
    if (!items.length || !s) return false;
    var sid = _sid(s);
    if (!sid) return false;
    return items.some(function(it){
      if (!it) return false;
      var arr = it.servicos || it.servicos_inclusos || it.services ||
                it.itens || it.items;
      if (Array.isArray(arr) && arr.some(function(x){ var xid = _sid(x); return xid && xid === sid; })) return true;
      var direct = _sid(it);
      return direct && direct === sid;
    });
  }
  function possuiServicoComVenda(ag){
    var sp = window.servicePrices || {};
    return getServicos(ag).some(function(s){
      if (isServicoUsoPacote(s, ag)) return false;
      if (isServicoVendaPacote(s)) return false;
      if (servicoCobertoPorVendaPacote(s, ag)) return false;
      var preco = valorServicoItem(s);
      if (!preco && s.servico && sp[s.servico]) preco = Number(sp[s.servico].preco) || 0;
      return preco > 0;
    });
  }
  function possuiProdutosVendidos(ag){
    return (getProdutosDoAgendamento(ag && ag.id) || []).length > 0;
  }
  function possuiVendaFinanceira(ag){
    return possuiVendaPacote(ag) || possuiServicoComVenda(ag) || possuiProdutosVendidos(ag);
  }
  function calcularValorTotal(ag){
    if (!ag) return 0;
    var total = 0;
    var sp = window.servicePrices || {};
    // Serviços: ignora uso de pacote, linhas de venda de pacote (somadas abaixo),
    // e serviços já cobertos pela venda do pacote no mesmo agendamento
    getServicos(ag).forEach(function(s){
      if (isServicoUsoPacote(s, ag)) return;
      if (isServicoVendaPacote(s)) return;
      if (servicoCobertoPorVendaPacote(s, ag)) return;
      var preco = valorServicoItem(s);
      if (!preco && s.servico && sp[s.servico]) preco = Number(sp[s.servico].preco) || 0;
      total += preco || 0;
    });
    // Produtos vendidos no agendamento
    (getProdutosDoAgendamento(ag.id) || []).forEach(function(p){
      total += (Number(p.preco_unitario)||0) * (Number(p.quantidade)||0);
    });
    // Pacotes VENDIDOS dentro do agendamento (valor cheio do pacote)
    getPacoteVendaItems(ag).forEach(function(it){
      total += valorPacoteVendaItem(it);
    });
    return round2(total);
  }

  // v2 — status que ainda não viraram receita realizada mas têm valor previsto
  // (entram em PENDENTE / Pendências Financeiras, NUNCA em Recebido/Faturamento)
  function isStatusPendenteFuturo(a){
    if (!a) return false;
    var s = String(a.status || '').trim().toLowerCase();
    return s === 'agendado' || s === 'confirmado' || s === 'em_atendimento' ||
           s === 'scheduled' || s === 'confirmed' || s === 'open';
  }

  function isAtendimentoFaturavelDash(a){
    if (!a) return false;
    if (typeof window.isAtendimentoFaturavel === 'function') {
      try { if (window.isAtendimentoFaturavel(a)) return true; } catch(_){}
    }
    if (typeof window.isCanceladoComVenda === 'function') {
      try { if (window.isCanceladoComVenda(a)) return true; } catch(_){}
    }
    if (typeof window.isAppointmentAutoCompleted === 'function') {
      try { if (window.isAppointmentAutoCompleted(a)) return true; } catch(_){}
    }
    var st = String(a.status || '').trim().toLowerCase();
    return st === 'concluido' || st === 'concluído' || st === 'completed' ||
           st === 'finalizado' || st === 'atendido' || st === 'realizado' ||
           st === 'cancelado_com_venda';
  }

  // v2 — universo considerado pelo dashboard (faturáveis + previstos)
  function isRelevanteFinanceiro(a){
    if (!a) return false;
    // exclui cancelado puro, no-show, etc.
    if (typeof window.isCanceladoComVenda === 'function' && window.isCanceladoComVenda(a)) return true;
    if (typeof window.isAppointmentCancelled === 'function' && window.isAppointmentCancelled(a)) return false;
    if (a.status === 'cancelado') return false;
    if (a.status === 'nao_compareceu' || a.status === 'no_show') return false;
    if (a.status === 'excluido') return false;
    return isAtendimentoFaturavelDash(a) || isStatusPendenteFuturo(a);
  }

  function dentroDoFiltro(a){
    var f = window.filtrosAplicados || {};
    if (f.dataInicio && a.data && a.data < f.dataInicio) return false;
    if (f.dataFim && a.data && a.data > f.dataFim) return false;
    if (f.profissionalId && f.profissionalId !== '__all__') {
      // profissional pode estar no agendamento ou nos serviços
      var match = (a.profissional_id === f.profissionalId);
      if (!match) {
        match = getServicos(a).some(function(s){ return s.profissional_id === f.profissionalId; });
      }
      if (!match) return false;
    }
    return true;
  }

  // -------------------------------------------------------------------
  // Fetch pagamentos do range em chunks (.in() limita ~1000 ids)
  // -------------------------------------------------------------------
  async function fetchPagamentosByAgIds(agIds){
    var sb = getSb();
    if (!sb || !agIds.length) return [];
    var out = [];
    var CHUNK = 200;
    for (var i = 0; i < agIds.length; i += CHUNK) {
      var slice = agIds.slice(i, i + CHUNK);
      var resp = await sb.from('agendamento_pagamentos')
        .select('agendamento_id, forma_pagamento, valor, parcelas, created_at')
        .in('agendamento_id', slice);
      if (resp.error) {
        console.warn('[dash-pag] erro ao buscar pagamentos:', resp.error.message);
        continue;
      }
      out = out.concat(resp.data || []);
    }
    return out;
  }

  // -------------------------------------------------------------------
  // Container — injeta DOM no #page-dashboard
  // -------------------------------------------------------------------
  function ensureContainer(){
    var page = document.getElementById('page-dashboard');
    if (!page) return null;
    var box = document.getElementById('dash-pag-root');
    if (box) return box;

    box = document.createElement('div');
    box.id = 'dash-pag-root';
    box.className = 'dash-pag-root';
    box.innerHTML = [
      '<div class="dash-pag-header">',
      '  <h3><i class="fa-solid fa-credit-card"></i> Formas de Pagamento</h3>',
      '  <span class="dash-pag-help">Baseado em pagamentos registrados no período filtrado</span>',
      '</div>',

      '<div class="dash-pag-grid-top">',
      '  <div class="dash-pag-card dash-pag-card--rec-pend">',
      '    <div class="dash-pag-card-title">Recebido vs Pendente</div>',
      '    <div class="dash-pag-rec-pend">',
      '      <div class="dash-pag-rp-item dash-pag-rp-rec">',
      '        <span class="dash-pag-rp-label">Recebido</span>',
      '        <span class="dash-pag-rp-val" id="dash-pag-recebido">R$ 0,00</span>',
      '      </div>',
      '      <div class="dash-pag-rp-item dash-pag-rp-pen">',
      '        <span class="dash-pag-rp-label">Pendente</span>',
      '        <span class="dash-pag-rp-val" id="dash-pag-pendente">R$ 0,00</span>',
      '        <span class="dash-pag-rp-sub" id="dash-pag-pendente-qtd">0 pendências</span>',
      '      </div>',
      '    </div>',
      '    <div class="dash-pag-progress"><div class="dash-pag-progress-bar" id="dash-pag-progress-bar"></div></div>',
      '  </div>',

      '  <div class="dash-pag-card dash-pag-card--formas">',
      '    <div class="dash-pag-card-title">Faturamento por forma de pagamento</div>',
      '    <div class="dash-pag-formas-list" id="dash-pag-formas-list"></div>',
      '  </div>',

      '  <div class="dash-pag-card dash-pag-card--ticket">',
      '    <div class="dash-pag-card-title">Ticket médio por forma</div>',
      '    <div class="dash-pag-ticket-list" id="dash-pag-ticket-list"></div>',
      '  </div>',
      '</div>',

      '<div class="dash-pag-card dash-pag-card--full">',
      '  <div class="dash-pag-card-title">Recebimentos por dia</div>',
      '  <div class="dash-pag-chart-wrapper"><canvas id="dash-pag-chart" height="220"></canvas></div>',
      '  <div class="dash-pag-chart-legend" id="dash-pag-chart-legend"></div>',
      '</div>',

      '<div class="dash-pag-card dash-pag-card--full">',
      '  <div class="dash-pag-card-title">',
      '    <span><i class="fa-solid fa-clock"></i> Pendências financeiras</span>',
      '    <span class="dash-pag-help" id="dash-pag-pend-info">Agendamentos abertos e atendimentos sem pagamento total</span>',
      '  </div>',
      '  <div class="dash-pag-pend-list" id="dash-pag-pend-list">',
      '    <div class="dash-pag-empty">Sem pendências no período.</div>',
      '  </div>',
      '</div>'
    ].join('');

    // Inserir antes do bloco "Por Profissional" se existir, senão no final
    var anchor = page.querySelector('.dash-section .dash-table-wrapper.dash-prof-table-wrapper');
    var section = anchor ? anchor.closest('.dash-section') : null;
    if (section && section.parentNode) {
      section.parentNode.insertBefore(box, section);
    } else {
      page.appendChild(box);
    }
    return box;
  }

  // -------------------------------------------------------------------
  // Renderers
  // -------------------------------------------------------------------
  function renderFormas(porForma, totalRecebido){
    var host = document.getElementById('dash-pag-formas-list');
    if (!host) return;
    if (totalRecebido <= 0) {
      host.innerHTML = '<div class="dash-pag-empty">Nenhum pagamento registrado.</div>';
      return;
    }
    host.innerHTML = FORMAS.map(function(f){
      var v = porForma[f.id] || 0;
      var p = totalRecebido ? (v / totalRecebido * 100) : 0;
      return [
        '<div class="dash-pag-forma-row">',
        '  <div class="dash-pag-forma-head">',
        '    <span class="dash-pag-dot" style="background:'+f.color+'"></span>',
        '    <span class="dash-pag-forma-label">'+f.label+'</span>',
        '    <span class="dash-pag-forma-val">'+fmtBRL(v)+'</span>',
        '    <span class="dash-pag-forma-pct">'+pct(v,totalRecebido)+'</span>',
        '  </div>',
        '  <div class="dash-pag-forma-bar"><div class="dash-pag-forma-fill" style="width:'+p.toFixed(1)+'%;background:'+f.color+'"></div></div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function renderTicket(porForma, qtdPorForma){
    var host = document.getElementById('dash-pag-ticket-list');
    if (!host) return;
    var algum = FORMAS.some(function(f){ return (qtdPorForma[f.id]||0) > 0; });
    if (!algum) {
      host.innerHTML = '<div class="dash-pag-empty">Sem dados.</div>';
      return;
    }
    host.innerHTML = FORMAS.map(function(f){
      var v = porForma[f.id] || 0;
      var q = qtdPorForma[f.id] || 0;
      var t = q ? (v/q) : 0;
      return [
        '<div class="dash-pag-ticket-row">',
        '  <span class="dash-pag-dot" style="background:'+f.color+'"></span>',
        '  <span class="dash-pag-ticket-label">'+f.label+'</span>',
        '  <span class="dash-pag-ticket-val">'+fmtBRL(t)+'</span>',
        '  <span class="dash-pag-ticket-qtd">'+q+(q===1?' transação':' transações')+'</span>',
        '</div>'
      ].join('');
    }).join('');
  }

  function renderRecebidoPendente(recebido, pendenteValor, pendenteQtd){
    var elR = document.getElementById('dash-pag-recebido');
    var elP = document.getElementById('dash-pag-pendente');
    var elQ = document.getElementById('dash-pag-pendente-qtd');
    var bar = document.getElementById('dash-pag-progress-bar');
    if (elR) elR.textContent = fmtBRL(recebido);
    if (elP) elP.textContent = fmtBRL(pendenteValor);
    if (elQ) elQ.textContent = pendenteQtd + (pendenteQtd === 1 ? ' pendência' : ' pendências');
    if (bar) {
      var tot = recebido + pendenteValor;
      var p = tot ? (recebido/tot*100) : 0;
      bar.style.width = p.toFixed(1) + '%';
    }
  }

  function renderPendencias(lista){
    var host = document.getElementById('dash-pag-pend-list');
    var info = document.getElementById('dash-pag-pend-info');
    if (info) info.textContent = lista.length
      ? lista.length + (lista.length === 1 ? ' pendência' : ' pendências') + ' no período'
      : 'Nenhuma pendência no período';
    if (!host) return;
    if (!lista.length) {
      host.innerHTML = '<div class="dash-pag-empty">Sem pendências no período.</div>';
      return;
    }
    // Ordenar mais recente primeiro
    lista.sort(function(a,b){
      return (b.data||'').localeCompare(a.data||'') || (b.hora||'').localeCompare(a.hora||'');
    });
    host.innerHTML = lista.map(function(p){
      var data = p.data ? p.data.split('-').reverse().join('/') : '—';
      var serv = p.servicos.join(', ') || '—';
      return [
        '<div class="dash-pag-pend-row" data-ag-id="'+p.id+'" role="button" tabindex="0">',
        '  <div class="dash-pag-pend-main">',
        '    <div class="dash-pag-pend-cliente">'+(p.cliente||'Sem cliente')+'</div>',
        '    <div class="dash-pag-pend-meta">'+serv+' · <em>'+(p.profissional||'—')+'</em></div>',
        '  </div>',
        '  <div class="dash-pag-pend-side">',
        '    <div class="dash-pag-pend-valor">'+fmtBRL(p.pendente)+'</div>',
        '    <div class="dash-pag-pend-data">'+data+(p.hora?' · '+p.hora:'')+'</div>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    host.querySelectorAll('.dash-pag-pend-row').forEach(function(row){
      row.addEventListener('click', function(){
        var id = row.getAttribute('data-ag-id');
        var ag = (window.appointments||[]).find(function(x){return x.id===id;});
        if (!ag) return;
        try {
          if (typeof window.openAgendamentoParaEditar === 'function') {
            window.openAgendamentoParaEditar(ag);
          } else if (typeof window.openAgendamentoModal === 'function') {
            window.openAgendamentoModal(ag.id, ag.cliente, ag.telefone);
          }
        } catch(e){ console.warn('[dash-pag] falha ao abrir agendamento', e); }
      });
    });
  }

  // -------------------------------------------------------------------
  // Mini chart (canvas) — barras empilhadas por forma de pagamento
  // -------------------------------------------------------------------
  function renderChart(porDia){
    var canvas = document.getElementById('dash-pag-chart');
    var legendHost = document.getElementById('dash-pag-chart-legend');
    if (!canvas) return;
    var dias = Object.keys(porDia).sort();
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.parentNode.clientWidth || 600;
    var cssH = 220;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,cssW,cssH);

    if (!dias.length) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Nenhum pagamento no período.', cssW/2, cssH/2);
      if (legendHost) legendHost.innerHTML = '';
      return;
    }

    // Calcular max
    var max = 0;
    dias.forEach(function(d){
      var t = 0;
      FORMAS.forEach(function(f){ t += (porDia[d][f.id]||0); });
      if (t > max) max = t;
    });
    if (max <= 0) max = 1;

    var padL = 48, padR = 12, padT = 12, padB = 28;
    var w = cssW - padL - padR;
    var h = cssH - padT - padB;
    var barW = Math.max(6, Math.min(40, w / dias.length * 0.7));
    var step = w / dias.length;

    // Eixo Y (4 ticks)
    ctx.strokeStyle = '#e5e7eb';
    ctx.fillStyle = '#6b7280';
    ctx.font = '11px Inter, sans-serif';
    ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var y = padT + h - (h * i / 4);
      ctx.beginPath();
      ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke();
      var v = max * i / 4;
      ctx.textAlign = 'right';
      ctx.fillText(fmtBRL(v).replace('R$', '').trim(), padL - 6, y + 3);
    }

    // Barras empilhadas
    dias.forEach(function(d, idx){
      var x = padL + step * idx + (step - barW)/2;
      var stackY = padT + h;
      FORMAS.forEach(function(f){
        var v = porDia[d][f.id] || 0;
        if (!v) return;
        var bh = (v / max) * h;
        ctx.fillStyle = f.color;
        ctx.fillRect(x, stackY - bh, barW, bh);
        stackY -= bh;
      });
      // label data
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'center';
      var parts = d.split('-');
      var lbl = parts[2] + '/' + parts[1];
      ctx.fillText(lbl, x + barW/2, padT + h + 16);
    });

    // Legenda
    if (legendHost) {
      legendHost.innerHTML = FORMAS.map(function(f){
        return '<span class="dash-pag-leg"><i style="background:'+f.color+'"></i>'+f.label+'</span>';
      }).join('');
    }
  }

  // -------------------------------------------------------------------
  // Aggregator principal
  // -------------------------------------------------------------------
  async function rodarPagamentosDashboard(){
    if (!ensureContainer()) return;
    if (!Array.isArray(window.appointments)) return;

    // 1) Universo financeiro do range:
    //    - faturáveis (concluídos / auto-concluídos / cancelado_com_venda)  → podem virar Recebido
    //    - previstos  (agendado / confirmado / em_atendimento)              → entram só em Pendente
    var universo = window.appointments.filter(function(a){
      return isRelevanteFinanceiro(a) && dentroDoFiltro(a);
    });
    var faturaveis = universo.filter(isAtendimentoFaturavelDash);

    var idsUniverso = universo.map(function(a){ return a.id; }).filter(Boolean);
    if (!idsUniverso.length) {
      renderFormas({}, 0);
      renderTicket({}, {});
      renderRecebidoPendente(0, 0, 0);
      renderPendencias([]);
      renderChart({});
      return;
    }

    // 2) Carregar pagamentos reais do universo financeiro.
    // Se um pacote foi pago e o status do agendamento ainda não sincronizou,
    // o recebimento ainda precisa aparecer no dashboard.
    var pagamentos = [];
    try { pagamentos = await fetchPagamentosByAgIds(idsUniverso); }
    catch(e){ console.warn('[dash-pag] fetch falhou', e); }

    // 3) Agregar pagamentos REAIS → Recebido / Faturamento por forma / Ticket / Por dia
    var porForma = {}, qtdForma = {}, porDia = {};
    var pagosPorAg = {};
    pagamentos.forEach(function(p){
      var v = Number(p.valor) || 0;
      var f = p.forma_pagamento;
      if (!FORMA_INDEX[f]) return;
      porForma[f] = (porForma[f]||0) + v;
      qtdForma[f] = (qtdForma[f]||0) + 1;
      pagosPorAg[p.agendamento_id] = (pagosPorAg[p.agendamento_id]||0) + v;
      var ag = faturaveis.find(function(a){ return a.id === p.agendamento_id; });
      var dia = (ag && ag.data) || (p.created_at||'').slice(0,10);
      if (!dia) return;
      porDia[dia] = porDia[dia] || {};
      porDia[dia][f] = (porDia[dia][f]||0) + v;
    });

    var totalRecebido = 0;
    Object.keys(porForma).forEach(function(k){ totalRecebido += porForma[k]; });

    // 4) PENDÊNCIAS — todo o universo (faturáveis sem pagto total + agendado/confirmado/em_atendimento)
    var pendList = [];
    var totalPendente = 0;
    universo.forEach(function(a){
      // Agendamentos SEM venda financeira (ex.: uso puro de pacote)
      // NÃO devem aparecer como pendência.
      if (!possuiVendaFinanceira(a)) return;
      var total = calcularValorTotal(a);
      if (total <= 0) return;
      var pago = pagosPorAg[a.id] || 0;
      var falta = total - pago;
      if (falta < 0.01) return;
      totalPendente += falta;
      pendList.push({
        id: a.id,
        cliente: a.cliente,
        profissional: a.profissional,
        servicos: getServicos(a).map(function(s){ return s.servico; }).filter(Boolean),
        data: a.data,
        hora: a.hora || a.horario,
        pendente: falta,
        status: a.status
      });
    });

    // 5) Render
    renderFormas(porForma, totalRecebido);
    renderTicket(porForma, qtdForma);
    renderRecebidoPendente(totalRecebido, totalPendente, pendList.length);
    renderPendencias(pendList);
    renderChart(porDia);

    console.log('[dash-pag] agregados', {
      universo: universo.length,
      faturaveis: faturaveis.length,
      pagamentos: pagamentos.length,
      recebido: totalRecebido,
      pendente: totalPendente,
      pendencias: pendList.length
    });
  }

  // -------------------------------------------------------------------
  // Hook em loadDashboard — roda DEPOIS do original (sem tocar nele)
  // -------------------------------------------------------------------
  function instalarHook(){
    if (typeof window.loadDashboard !== 'function') {
      return setTimeout(instalarHook, 400);
    }
    if (window.loadDashboard.__pagDashWrapped) return;
    var orig = window.loadDashboard;
    var wrapped = async function(){
      var ret = await orig.apply(this, arguments);
      try { await rodarPagamentosDashboard(); }
      catch(e){ console.warn('[dash-pag] erro no widget', e); }
      return ret;
    };
    wrapped.__pagDashWrapped = true;
    window.loadDashboard = wrapped;
    console.log('[dash-pag] hook em loadDashboard instalado');

    // Se a página dashboard já está visível, roda agora
    var page = document.getElementById('page-dashboard');
    if (page && page.classList.contains('active')) {
      setTimeout(rodarPagamentosDashboard, 200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', instalarHook);
  } else {
    instalarHook();
  }

  // Recalcular ao trocar tema/redimensionar (canvas)
  window.addEventListener('resize', function(){
    clearTimeout(window.__dashPagResizeTO);
    window.__dashPagResizeTO = setTimeout(function(){
      var page = document.getElementById('page-dashboard');
      if (page && page.classList.contains('active')) rodarPagamentosDashboard();
    }, 250);
  });

  // Expor para debug
  window.__rodarDashboardPagamentos = rodarPagamentosDashboard;
})();
