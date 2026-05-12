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

  console.log('%c📊 dashboard-pagamentos.js v2 carregado (pendências de agendamentos abertos)',
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

  function calcularValorTotal(ag){
    if (!ag) return 0;
    var total = 0;
    var sp = window.servicePrices || {};
    getServicos(ag).forEach(function(s){
      var p = sp[s.servico];
      total += (p && Number(p.preco)) ? Number(p.preco) : 0;
    });
    (getProdutosDoAgendamento(ag.id) || []).forEach(function(p){
      total += (Number(p.preco_unitario)||0) * (Number(p.quantidade)||0);
    });
    return Math.round(total * 100) / 100;
  }

  function isAtendimentoFaturavel(a){
    if (!a) return false;
    if (typeof window.isCanceladoComVenda === 'function' && window.isCanceladoComVenda(a)) return true;
    if (typeof window.isAppointmentCancelled === 'function' && window.isAppointmentCancelled(a)) return false;
    if (a.status === 'nao_compareceu' || a.status === 'no_show') return false;
    if (typeof window.isAppointmentAutoCompleted === 'function' && window.isAppointmentAutoCompleted(a)) return true;
    if (typeof window.isAppointmentManuallyCompleted === 'function' && window.isAppointmentManuallyCompleted(a)) return true;
    return a.status === 'concluido';
  }

  // v2 — status que ainda não viraram receita realizada mas têm valor previsto
  // (entram em PENDENTE / Pendências Financeiras, NUNCA em Recebido/Faturamento)
  function isStatusPendenteFuturo(a){
    if (!a) return false;
    var s = a.status;
    return s === 'agendado' || s === 'confirmado' || s === 'em_atendimento';
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
    return isAtendimentoFaturavel(a) || isStatusPendenteFuturo(a);
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
    var faturaveis = universo.filter(isAtendimentoFaturavel);

    var idsUniverso = universo.map(function(a){ return a.id; }).filter(Boolean);
    if (!idsUniverso.length) {
      renderFormas({}, 0);
      renderTicket({}, {});
      renderRecebidoPendente(0, 0, 0);
      renderPendencias([]);
      renderChart({});
      return;
    }

    // 2) Carregar pagamentos (apenas dos faturáveis — só esses podem ter pagamento)
    var idsFaturaveis = faturaveis.map(function(a){ return a.id; }).filter(Boolean);
    var pagamentos = [];
    if (idsFaturaveis.length) {
      try { pagamentos = await fetchPagamentosByAgIds(idsFaturaveis); }
      catch(e){ console.warn('[dash-pag] fetch falhou', e); }
    }

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
