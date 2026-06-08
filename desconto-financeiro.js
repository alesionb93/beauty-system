/* =====================================================================
   DESCONTO-FINANCEIRO.JS — Add-on isolado (v3 — 2026-06-06)
   ---------------------------------------------------------------------
   Carregue DEPOIS de pagamentos.js, dashboard-pagamentos.js e
   agendamento-desconto.js, em agenda.html:

       <script src="/desconto-financeiro.js?v=3" defer></script>

   v3 (2026-06-06) — CORREÇÃO: filtro do Dashboard era ignorado
   ---------------------------------------------------------
   • Bug "valores piscam de R$ 80 → R$ 70" no primeiro Aplicar:
     causado por o loadDashboard original escrever o valor BRUTO
     sincronamente e só depois (após awaits de caixinha/widgets) o
     desconto era subtraído. Agora um MutationObserver instalado
     durante o ciclo de loadDashboard reaplica o desconto IMEDIATAMENTE
     a cada escrita em #dash-faturamento, eliminando a pintura
     intermediária do valor bruto.
   • Bug "cada clique em Aplicar subtrai mais R$ 10 (70 → 60 → 50 …)":
     causado por o ajuste no DOM ser não-idempotente sob race entre
     múltiplas execuções de loadDashboard (cliques rápidos no
     "Aplicar" disparam wraps concorrentes). Agora:
       1) `dataset.descSum` rastreia QUANTO já foi descontado do
          texto atual. `base = atual + jáAplicado` garante que cada
          reaplicação parte do valor BRUTO real.
       2) Antes do orig rodar, resetamos `descSum=0` (porque o orig
          regrava o texto sem nosso ajuste). Assim, depois do orig
          escrever, `atual` é o bruto e subtraímos o desconto UMA vez.
       3) As chamadas a loadDashboard são serializadas via um lock
          (`__descFinRunning`) — múltiplos cliques em Aplicar passam
          a compartilhar a MESMA execução em curso. Idempotência total.

   O QUE FAZ (mantido da v1)
   -------------------------
   Garante que TODO indicador financeiro do sistema use o valor LÍQUIDO
   (após desconto) — sem alterar fluxos de pacotes, produtos, estoque,
   histórico do cliente, agenda, quantidade de atendimentos/serviços ou
   caixinha.

   Como detecta o desconto (sem migration / sem novo campo):
     - status_pagamento === 'pago'  (pagamento foi fechado pelo modal)
     - bruto (services + produtos + venda de pacote) >
       valor_total_pago - caixinha
     ⇒ desconto = bruto - (pago - caixinha)

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

  console.log('%c🧾 desconto-financeiro.js v2 carregado (idempotente + anti-flicker)',
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
    if (!ids.length) {
      // Limpa qualquer desconto_aplicado de execuções anteriores em ags fora do filtro,
      // mas mantém o campo nos demais para evitar mutação desnecessária.
      return out;
    }

    var tips = await fetchTipsPorAg(ids);

    ags.forEach(function(a){
      var st    = String(a.status_pagamento || '').toLowerCase();
      var pago  = Number(a.valor_total_pago) || 0;
      var tip   = Number(tips[a.id]) || 0;
      var pagoNet = round2(pago - tip);
      var bruto = grossDe(a);
      var desc = 0;

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

  // -------------------- Ajuste de DOM (idempotente) --------------------
  // Estratégia: dataset.descSum guarda quanto JÁ subtraímos do texto atual.
  // base = atual + jáAplicado  →  representa o valor que o orig escreveu.
  // novo = base - totalDescontos.  Repetir N vezes ⇒ mesmo resultado.
  function ajustarFaturamentoETicket(totalDescontos){
    var fatEl = document.getElementById('dash-faturamento');
    if (!fatEl) return;
    var atual = parseMoneyText(fatEl.textContent);
    var jaAplicado = parseFloat(fatEl.dataset.descSum || '0') || 0;
    var base = round2(atual + jaAplicado);
    var novo = round2(Math.max(0, base - (Number(totalDescontos) || 0)));
    if (Math.abs(novo - atual) > 0.005) {
      fatEl.textContent = fmtBRL(novo);
    }
    fatEl.dataset.descSum = String(totalDescontos > 0 ? totalDescontos : 0);

    // Title: preserva mensagens prévias (produtos/caixinha) e adiciona a nossa
    var titleParts = [];
    if (fatEl.dataset.prodSum && parseFloat(fatEl.dataset.prodSum) > 0) {
      titleParts.push('Inclui ' + fmtBRL(parseFloat(fatEl.dataset.prodSum)) + ' em produtos vendidos');
    }
    if (fatEl.dataset.tipSum && parseFloat(fatEl.dataset.tipSum) > 0) {
      titleParts.push('Inclui ' + fmtBRL(parseFloat(fatEl.dataset.tipSum)) + ' em caixinhas (gorjetas)');
    }
    if (totalDescontos > 0) {
      titleParts.push('Já desconta ' + fmtBRL(totalDescontos) + ' em descontos aplicados');
    }
    fatEl.title = titleParts.join(' · ');

    // Ticket médio segue o faturamento
    var tickEl  = document.getElementById('dash-ticket');
    var totAgEl = document.getElementById('dash-total-ag');
    if (tickEl && totAgEl){
      var qtd = parseInt(String(totAgEl.textContent).replace(/\D/g,''), 10) || 0;
      if (qtd > 0) tickEl.textContent = fmtBRL(round2(novo / qtd));
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

      // Idempotência por célula
      var fatOldShown = parseMoneyText(tds[idxFat].textContent);
      var prevFat = parseFloat(tds[idxFat].dataset.descSum || '0') || 0;
      var fatBase = round2(fatOldShown + prevFat);
      var fatNew = round2(Math.max(0, fatBase - desc));

      if (idxCom >= 0 && tds[idxCom]){
        var comOldShown = parseMoneyText(tds[idxCom].textContent);
        var prevCom = parseFloat(tds[idxCom].dataset.descSum || '0') || 0;
        var comBase = round2(comOldShown + prevCom);
        var ratio = fatBase > 0 ? (comBase / fatBase) : 0;
        var comNew = round2(fatNew * ratio);
        tds[idxCom].textContent = fmtBRL(comNew);
        tds[idxCom].dataset.descSum = String(round2(comBase - comNew));
      }
      tds[idxFat].textContent = fmtBRL(fatNew);
      tds[idxFat].dataset.descSum = String(desc > 0 ? desc : 0);
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
      var fatBlock = card.querySelector('.dash-prof-metric.faturamento .dash-prof-metric-value');
      var comBlock = card.querySelector('.dash-prof-metric.comissao .dash-prof-metric-value');
      if (!fatBlock) return;

      var fatOldShown = parseMoneyText(fatBlock.textContent);
      var prevFat = parseFloat(fatBlock.dataset.descSum || '0') || 0;
      var fatBase = round2(fatOldShown + prevFat);
      var fatNew = round2(Math.max(0, fatBase - desc));

      if (comBlock){
        var comOldShown = parseMoneyText(comBlock.textContent);
        var prevCom = parseFloat(comBlock.dataset.descSum || '0') || 0;
        var comBase = round2(comOldShown + prevCom);
        var ratio = fatBase > 0 ? (comBase / fatBase) : 0;
        var comNew = round2(fatNew * ratio);
        comBlock.textContent = fmtBRL(comNew);
        comBlock.dataset.descSum = String(round2(comBase - comNew));
      }
      fatBlock.textContent = fmtBRL(fatNew);
      fatBlock.dataset.descSum = String(desc > 0 ? desc : 0);
    });
  }

  // -------------------- Recalcula "Divisão de comissões" --------------------
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

  // -------------------- "Total a receber" (col. injetada por pagamentos.js) --------------------
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
    ajustarFaturamentoETicket(Number(resumo.total) || 0);
    ajustarTabelaProf(resumo.porProf || {});
    ajustarCardsProf(resumo.porProf || {});
    try { ajustarDivisaoComissoes(); } catch(e){ console.warn('[desc-fin] ajustarDivisaoComissoes', e); }
    try { ajustarTotalReceber();     } catch(e){ console.warn('[desc-fin] ajustarTotalReceber', e); }
  }

  // -------------------- Reset de marcadores antes do orig (idempotência) --------------------
  function resetDatasetMarkers(){
    var fatEl = document.getElementById('dash-faturamento');
    if (fatEl) fatEl.dataset.descSum = '0';

    var tbody = document.getElementById('dash-prof-tbody');
    if (tbody){
      Array.prototype.forEach.call(tbody.querySelectorAll('td'), function(td){
        if (td.dataset && td.dataset.descSum) td.dataset.descSum = '0';
      });
    }
    var box = document.getElementById('dash-prof-cards-mobile');
    if (box){
      Array.prototype.forEach.call(box.querySelectorAll('.dash-prof-metric-value'), function(v){
        if (v.dataset && v.dataset.descSum) v.dataset.descSum = '0';
      });
    }
  }

  // -------------------- Hook em loadDashboard --------------------
  function instalar(){
    if (typeof window.loadDashboard !== 'function') {
      return setTimeout(instalar, 400);
    }
    if (window.loadDashboard.__descFinWrapped) return;
    var orig = window.loadDashboard;

    // ----- Estado de runtime -----
    var running = null;          // serialização: promessa em curso
    var lastResumo = { total: 0, porProf: {} };
    var observer = null;

    // MutationObserver: enquanto o ciclo de loadDashboard estiver em curso,
    // reaplica o ajuste de desconto a cada escrita em #dash-faturamento.
    // Isso elimina o "flicker" de R$80 → R$70 entre o write síncrono do
    // orig e o término dos awaits subsequentes (caixinha, widgets, etc.).
    function startObserver(){
      try {
        if (observer) return;
        var fatEl = document.getElementById('dash-faturamento');
        if (!fatEl || typeof MutationObserver === 'undefined') return;
        observer = new MutationObserver(function(){
          // Reaplica usando o último resumo conhecido. Idempotente.
          try { ajustarFaturamentoETicket(Number(lastResumo.total) || 0); }
          catch(_){}
        });
        observer.observe(fatEl, { childList: true, characterData: true, subtree: true });
      } catch(_){}
    }
    function stopObserver(){
      try { if (observer) { observer.disconnect(); observer = null; } } catch(_){}
    }

    // Fila serial: NUNCA compartilhar a promessa em curso — isso devolve
    // resultados com filtros antigos. Em vez disso, encadeamos: se já
    // está rodando, esperamos terminar e rodamos uma nova execução com
    // os argumentos/filtros ATUAIS.
    var queueTail = Promise.resolve();
    var wrapped = function(){
      var self = this;
      var args = arguments;
      var run = function(){
        return (async function(){
          var resumo = { total: 0, porProf: {} };
          try { resumo = await hidratarDescontos(); }
          catch(e){ console.warn('[desc-fin] hidratar', e); }
          lastResumo = resumo;

          // Zera marcadores: o orig vai regravar valores BRUTOS, e queremos
          // que nosso ajuste subtraia exatamente UMA vez sobre eles.
          resetDatasetMarkers();

          // Observer ativo durante o orig — mata o flicker do valor bruto.
          startObserver();

          var ret;
          try {
            ret = await orig.apply(self, args);
          } finally {
            stopObserver();
          }
          try { aplicarNoDOM(resumo); }
          catch(e){ console.warn('[desc-fin] aplicarNoDOM', e); }
          return ret;
        })();
      };
      var p = queueTail.then(run, run);
      // Mantém a cauda viva mesmo após erro, sem propagar rejeição.
      queueTail = p.catch(function(){});
      return p;
    };
    wrapped.__descFinWrapped = true;
    window.loadDashboard = wrapped;
    console.log('[desc-fin] hook v3 em loadDashboard instalado (idempotente + fila serial + observer)');
    // NÃO auto-executar loadDashboard aqui — disparar agora roda com
    // filtros antigos e enfileira execuções "fantasma" que atrapalham o
    // clique do usuário no botão Aplicar.
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(instalar, 1500); });
  } else {
    setTimeout(instalar, 1500);
  }

  // Debug
  window.__descFinHidratar = hidratarDescontos;
  window.__descFinAplicar  = aplicarNoDOM;
})();
