/* =====================================================================
   DESCONTO-FINANCEIRO.JS — Add-on isolado (v1 — 2026-06-03)
   ---------------------------------------------------------------------
   Carregue DEPOIS de pagamentos.js, dashboard-pagamentos.js e
   agendamento-desconto.js, em agenda.html:

       <script src="/desconto-financeiro.js?v=1" defer></script>

   O QUE FAZ
   ---------
   Garante que TODO indicador financeiro do sistema use o valor LÍQUIDO
   (após desconto) — sem alterar fluxos de pacotes, produtos, estoque,
   histórico do cliente, agenda, quantidade de atendimentos/serviços ou
   caixinha.

   Como detecta o desconto (sem migration / sem novo campo):
     - status_pagamento === 'pago'  (pagamento foi fechado pelo modal)
     - bruto (services + produtos + venda de pacote) >
       valor_total_pago - caixinha
     ⇒ desconto = bruto - (pago - caixinha)

   Onde aplica:
     1) Hidrata ag.desconto_aplicado em window.appointments antes do
        loadDashboard rodar. dashboard-pagamentos.js já lê esse campo
        em calcularValorTotal → Pendente cai a zero.
     2) Após loadDashboard + caixinha + dashboard-pagamentos rodarem,
        ajusta no DOM:
          • #dash-faturamento  −= totalDescontos
          • #dash-ticket       recalcula com novo faturamento
          • Tabela "Por Profissional"  → faturamento e comissão por linha
          • Cards mobile "Por Profissional" → idem
     3) Atribuição de desconto por profissional segue o mesmo padrão da
        caixinha: 100% ao profissional principal do agendamento.

   NÃO TOCA:
     - regras de venda/uso de pacote
     - produtos / estoque
     - histórico do cliente
     - quantidade de agendamentos / serviços
     - caixinha
   ===================================================================== */
(function(){
  'use strict';
  if (window.__SLOTIFY_DESC_FIN_LOADED__) return;
  window.__SLOTIFY_DESC_FIN_LOADED__ = true;

  console.log('%c🧾 desconto-financeiro.js v1 carregado',
    'background:#0ea5e9;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700');

  // -------------------- Helpers --------------------
  function round2(n){ return Math.round((Number(n)||0)*100)/100; }
  function fmtBRL(n){ n=Number(n)||0; return n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
  function parseMoneyText(t){
    var s=String(t||'').replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',', '.');
    var v=parseFloat(s); return isNaN(v)?0:v;
  }
  function getSb(){
    if (typeof window.supabaseClient !== 'undefined' && window.supabaseClient) return window.supabaseClient;
    if (typeof window.supabase !== 'undefined') return window.supabase;
    return null;
  }
  function getTenantId(){
    if (typeof window.getCurrentTenantId === 'function') {
      try { var t = window.getCurrentTenantId(); if (t) return t; } catch(_){}
    }
    return window.currentTenantId || null;
  }
  function inFiltro(a){
    var range = (typeof window.getCalendarVisibleDateRange === 'function')
      ? window.getCalendarVisibleDateRange() : null;
    var fI = (window.filtrosAplicados && window.filtrosAplicados.dataInicio) || (range && range.start);
    var fF = (window.filtrosAplicados && window.filtrosAplicados.dataFim)    || (range && range.end);
    if (!fI || !fF || !a || !a.data) return true;
    return a.data >= fI && a.data <= fF;
  }
  function isOkParaFaturamento(a){
    if (!a) return false;
    if (typeof window.isAppointmentCancelled === 'function' && window.isAppointmentCancelled(a)) return false;
    if (typeof window.isAppointmentAutoCompleted === 'function' && !window.isAppointmentAutoCompleted(a)) return false;
    return true;
  }
  function primaryProf(a){
    if (typeof window.getAppointmentProfessionals === 'function') {
      try { var ps = window.getAppointmentProfessionals(a); if (ps && ps[0]) return ps[0]; } catch(_){}
    }
    return (a && (a.profissional || a.profissional_nome)) || '';
  }

  // Fallback gross caso __dashPagCalcGross ainda não esteja exposto.
  function grossFallback(a){
    if (!a) return 0;
    var sum = 0;
    var sp = window.servicePrices || {};
    var svcs = Array.isArray(a.servicos) ? a.servicos : (a.servico ? [{servico:a.servico, preco:a.preco||a.valor||0}] : []);
    svcs.forEach(function(s){
      if (!s) return;
      if (s.origem === 'pacote_uso' || s.cliente_pacote_id) return;
      var p = parseFloat(s.preco);
      if (!p && s.servico && sp[s.servico]) p = parseFloat(sp[s.servico].preco) || 0;
      sum += p || 0;
    });
    return round2(sum);
  }
  function grossDe(a){
    if (typeof window.__dashPagCalcGross === 'function') {
      try { return Number(window.__dashPagCalcGross(a)) || 0; } catch(_){}
    }
    return grossFallback(a);
  }

  // -------------------- Buscar caixinhas para inferir pagoNet --------------------
  async function fetchTipsPorAg(ids){
    var tips = {};
    var sb = getSb(); var tenant = getTenantId();
    if (!sb || !tenant || !ids.length) return tips;
    var chunk = 500;
    for (var i=0; i<ids.length; i+=chunk){
      var slice = ids.slice(i, i+chunk);
      try {
        var resp = await sb.from('agendamento_pagamentos')
          .select('agendamento_id, observacao')
          .in('agendamento_id', slice)
          .eq('tenant_id', tenant);
        if (resp.error) { console.warn('[desc-fin] fetch tips', resp.error); continue; }
        (resp.data || []).forEach(function(r){
          var m = /CAIXINHA:([\d\.]+)/i.exec(r.observacao || '');
          if (m){
            var v = parseFloat(m[1]) || 0;
            tips[r.agendamento_id] = (tips[r.agendamento_id] || 0) + v;
          }
        });
      } catch(e){ console.warn('[desc-fin] fetch tips ex', e); }
    }
    return tips;
  }

  // -------------------- Hidrata desconto_aplicado em window.appointments --------------------
  async function hidratarDescontos(){
    var out = { total: 0, porProf: {} };
    if (!Array.isArray(window.appointments)) return out;

    var ags = window.appointments.filter(function(a){ return inFiltro(a) && isOkParaFaturamento(a); });
    var ids = ags.map(function(a){ return a.id; }).filter(Boolean);
    if (!ids.length) return out;

    var tips = await fetchTipsPorAg(ids);

    ags.forEach(function(a){
      var st    = String(a.status_pagamento || '').toLowerCase();
      var pago  = Number(a.valor_total_pago) || 0;
      var tip   = Number(tips[a.id]) || 0;
      var pagoNet = round2(pago - tip);
      var bruto = grossDe(a);
      var desc = 0;

      // Só inferimos desconto quando o pagamento está fechado ('pago')
      // E o bruto é estritamente maior que o efetivamente recebido (líquido de caixinha).
      // Pagamentos parciais permanecem como pendência, não como desconto.
      if (st === 'pago' && bruto > 0 && pagoNet >= 0 && (bruto - pagoNet) > 0.01) {
        desc = round2(bruto - pagoNet);
      }
      a.desconto_aplicado = desc;

      if (desc > 0){
        out.total += desc;
        var prof = primaryProf(a);
        if (prof) out.porProf[prof] = round2((out.porProf[prof] || 0) + desc);
      }
    });
    out.total = round2(out.total);
    return out;
  }

  // -------------------- Ajuste de DOM (pós loadDashboard + caixinha + dash-pag) --------------------
  function ajustarFaturamentoETicket(totalDescontos){
    if (totalDescontos <= 0) return;
    var fatEl = document.getElementById('dash-faturamento');
    if (fatEl){
      var atual = parseMoneyText(fatEl.textContent);
      var novo  = round2(Math.max(0, atual - totalDescontos));
      fatEl.textContent = fmtBRL(novo);
      fatEl.dataset.descSum = String(totalDescontos);
      var prev = fatEl.title || '';
      fatEl.title = (prev ? prev + ' · ' : '') + 'Já desconta ' + fmtBRL(totalDescontos) + ' em descontos aplicados';
      // Ticket médio segue o faturamento
      var tickEl  = document.getElementById('dash-ticket');
      var totAgEl = document.getElementById('dash-total-ag');
      if (tickEl && totAgEl){
        var qtd = parseInt(String(totAgEl.textContent).replace(/\D/g,''), 10) || 0;
        if (qtd > 0) tickEl.textContent = fmtBRL(round2(novo / qtd));
      }
    }
  }

  function ajustarTabelaProf(porProf){
    var tbody = document.getElementById('dash-prof-tbody');
    if (!tbody) return;
    var table = tbody.closest('table');
    var thead = table ? table.querySelector('thead tr') : null;
    var idxNome = 0, idxFat = -1, idxCom = -1;
    if (thead){
      var ths = thead.querySelectorAll('th');
      ths.forEach(function(th, i){
        var txt = (th.textContent || '').trim().toLowerCase();
        if (txt.indexOf('faturamento') >= 0 && idxFat < 0) idxFat = i;
        if (txt.indexOf('comiss') >= 0 && idxCom < 0) idxCom = i;
      });
    }
    if (idxFat < 0) return;
    Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function(tr){
      var tds = tr.querySelectorAll('td');
      if (!tds.length || !tds[idxNome] || !tds[idxFat]) return;
      var nome = (tds[idxNome].textContent || '').trim();
      var desc = Number(porProf[nome]) || 0;
      if (!desc) return;
      var fatOld = parseMoneyText(tds[idxFat].textContent);
      var fatNew = round2(Math.max(0, fatOld - desc));
      if (idxCom >= 0 && tds[idxCom]){
        var comOld = parseMoneyText(tds[idxCom].textContent);
        var ratio  = fatOld > 0 ? (comOld / fatOld) : 0;
        tds[idxCom].textContent = fmtBRL(round2(fatNew * ratio));
      }
      tds[idxFat].textContent = fmtBRL(fatNew);
    });
  }

  function ajustarCardsProf(porProf){
    var box = document.getElementById('dash-prof-cards-mobile');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('.dash-prof-card'), function(card){
      var nameEl = card.querySelector('.dash-prof-card-name');
      if (!nameEl) return;
      var nome = (nameEl.textContent || '').trim();
      var desc = Number(porProf[nome]) || 0;
      if (!desc) return;
      var fatBlock = card.querySelector('.dash-prof-metric.faturamento .dash-prof-metric-value');
      var comBlock = card.querySelector('.dash-prof-metric.comissao .dash-prof-metric-value');
      if (!fatBlock) return;
      var fatOld = parseMoneyText(fatBlock.textContent);
      var fatNew = round2(Math.max(0, fatOld - desc));
      var comOld = comBlock ? parseMoneyText(comBlock.textContent) : 0;
      var ratio  = fatOld > 0 ? (comOld / fatOld) : 0;
      fatBlock.textContent = fmtBRL(fatNew);
      if (comBlock) comBlock.textContent = fmtBRL(round2(fatNew * ratio));
    });
  }

  // -------------------- Recalcula "Divisão de comissões" a partir da tabela já líquida --------------------
  // A box renderizada por renderDashComissoes() usa o faturamento BRUTO de profData.
  // Como já ajustamos a tabela "Por Profissional" (fat e comissão por linha proporcionalmente),
  // basta somar a coluna líquida: totalProf = Σ comissões, totalEstab = totalFat − totalProf.
  function ajustarDivisaoComissoes(){
    var tbody = document.getElementById('dash-prof-tbody');
    if (!tbody) return;
    var table = tbody.closest('table');
    var thead = table ? table.querySelector('thead tr') : null;
    var idxFat = -1, idxCom = -1;
    if (thead){
      var ths = thead.querySelectorAll('th');
      ths.forEach(function(th, i){
        var txt = (th.textContent || '').trim().toLowerCase();
        if (txt.indexOf('faturamento') >= 0 && idxFat < 0) idxFat = i;
        if (txt.indexOf('comiss')      >= 0 && idxCom < 0) idxCom = i;
      });
    }
    if (idxFat < 0) return;

    var totalFat = 0, totalProf = 0;
    Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function(tr){
      var tds = tr.querySelectorAll('td');
      if (!tds || !tds[idxFat]) return;
      totalFat += parseMoneyText(tds[idxFat].textContent);
      if (idxCom >= 0 && tds[idxCom]){
        totalProf += parseMoneyText(tds[idxCom].textContent);
      }
    });
    totalFat   = round2(totalFat);
    totalProf  = round2(totalProf);
    var totalEstab = round2(Math.max(0, totalFat - totalProf));

    var elTotal = document.getElementById('dash-com-total');
    var elE     = document.getElementById('dash-com-estab');
    var elP     = document.getElementById('dash-com-prof');
    var elEPct  = document.getElementById('dash-com-estab-pct');
    var elPPct  = document.getElementById('dash-com-prof-pct');
    if (elTotal) elTotal.textContent = fmtBRL(totalFat);
    if (elE)     elE.textContent     = fmtBRL(totalEstab);
    if (elP)     elP.textContent     = fmtBRL(totalProf);
    var pe = totalFat > 0 ? (totalEstab / totalFat) * 100 : 0;
    var pp = totalFat > 0 ? (totalProf  / totalFat) * 100 : 0;
    if (elEPct) elEPct.textContent = (Math.round(pe * 10) / 10) + '%';
    if (elPPct) elPPct.textContent = (Math.round(pp * 10) / 10) + '%';
  }

  // -------------------- Recalcula "Total a receber" (col. injetada por pagamentos.js) --------------------
  // pagamentos.js calculou totalReceber = caixinha + comissão ANTES do nosso ajuste de comissão.
  // Reaplicamos: totalReceber = caixinha + comissão (já líquida).
  function ajustarTotalReceber(){
    var tbody = document.getElementById('dash-prof-tbody');
    if (tbody){
      var table = tbody.closest('table');
      var thead = table ? table.querySelector('thead tr') : null;
      var idxCom = -1, idxCax = -1, idxRec = -1;
      if (thead){
        var ths = thead.querySelectorAll('th');
        ths.forEach(function(th, i){
          var txt = (th.textContent || '').trim().toLowerCase();
          if (txt.indexOf('comiss')   >= 0 && idxCom < 0) idxCom = i;
          if (txt.indexOf('caixinha') >= 0 && idxCax < 0) idxCax = i;
          if (txt.indexOf('receber')  >= 0 && idxRec < 0) idxRec = i;
        });
      }
      if (idxRec >= 0){
        Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function(tr){
          var tds = tr.querySelectorAll('td');
          if (!tds || !tds[idxRec]) return;
          var cax = (idxCax >= 0 && tds[idxCax]) ? parseMoneyText(tds[idxCax].textContent) : 0;
          var com = (idxCom >= 0 && tds[idxCom]) ? parseMoneyText(tds[idxCom].textContent) : 0;
          tds[idxRec].textContent = fmtBRL(round2(cax + com));
        });
      }
    }
    // Cards mobile
    var box = document.getElementById('dash-prof-cards-mobile');
    if (box){
      Array.prototype.forEach.call(box.querySelectorAll('.dash-prof-card'), function(card){
        var caxEl = card.querySelector('.dash-prof-metric.caixinha-extra .dash-prof-metric-value');
        var comEl = card.querySelector('.dash-prof-metric.comissao .dash-prof-metric-value');
        var recEl = card.querySelector('.dash-prof-metric.total-receber .dash-prof-metric-value');
        if (!recEl) return;
        var cax = caxEl ? parseMoneyText(caxEl.textContent) : 0;
        var com = comEl ? parseMoneyText(comEl.textContent) : 0;
        recEl.textContent = fmtBRL(round2(cax + com));
      });
    }
  }

  function aplicarNoDOM(resumo){
    if (!resumo) return;
    ajustarFaturamentoETicket(resumo.total);
    ajustarTabelaProf(resumo.porProf || {});
    ajustarCardsProf(resumo.porProf || {});
    // Após ajustar a tabela/cards de profissional, recompõe a box "Divisão de comissões"
    // e a coluna/linha "Total a receber" usando os valores já líquidos.
    try { ajustarDivisaoComissoes(); } catch(e){ console.warn('[desc-fin] ajustarDivisaoComissoes', e); }
    try { ajustarTotalReceber();     } catch(e){ console.warn('[desc-fin] ajustarTotalReceber', e); }
  }

  // -------------------- Hook em loadDashboard --------------------
  // Instala POR ÚLTIMO para envolver pagamentos.js (caixinha) e
  // dashboard-pagamentos.js (Recebido/Pendente). Como o nosso wrap é o
  // mais externo, ele roda PRIMEIRO (pré-hidratação) e por ÚLTIMO
  // (ajuste de DOM), exatamente o que queremos.
  function instalar(){
    if (typeof window.loadDashboard !== 'function') {
      return setTimeout(instalar, 400);
    }
    if (window.loadDashboard.__descFinWrapped) return;
    var orig = window.loadDashboard;
    var wrapped = async function(){
      var resumo = { total: 0, porProf: {} };
      try { resumo = await hidratarDescontos(); }
      catch(e){ console.warn('[desc-fin] hidratar', e); }
      var ret = await orig.apply(this, arguments);
      try { aplicarNoDOM(resumo); }
      catch(e){ console.warn('[desc-fin] aplicarNoDOM', e); }
      return ret;
    };
    wrapped.__descFinWrapped = true;
    window.loadDashboard = wrapped;
    console.log('[desc-fin] hook em loadDashboard instalado');

    // Se a página dashboard já está visível, força um refresh
    var page = document.getElementById('page-dashboard');
    if (page && page.classList.contains('active')) {
      setTimeout(function(){ try { window.loadDashboard(); } catch(_){} }, 250);
    }
  }

  // 1500ms garante que pagamentos.js (caixinha) e dashboard-pagamentos.js
  // já instalaram os wraps deles primeiro.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(instalar, 1500); });
  } else {
    setTimeout(instalar, 1500);
  }

  // Debug
  window.__descFinHidratar = hidratarDescontos;
  window.__descFinAplicar  = aplicarNoDOM;
})();
