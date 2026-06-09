/* =====================================================================
   DESCONTO-FINANCEIRO.JS — Add-on isolado (v6 — 2026-06-09 (invariante valor_total_pago))
   ---------------------------------------------------------------------
   Carregue DEPOIS de pagamentos.js, dashboard-pagamentos.js e
   agendamento-desconto.js, em agenda.html:

       <script src="/desconto-financeiro.js?v=5" defer></script>

   v5 (2026-06-09) — FONTE ÚNICA DE VERDADE PARA DESCONTO
   -----------------------------------------------------------
   Regra de negócio formalizada:
       faturamento = serviço - desconto + caixinha
       comissão    = (serviço - desconto) * pct
       receber     = comissão + caixinha          (caixinha é 100% do prof.)

   Mudanças:
   • Removidas TODAS as heurísticas (bruto > pago−caixinha).
   • Desconto agora é PERSISTIDO em agendamento_pagamentos.observacao,
     no mesmo formato da caixinha — pagamentos.js v16 grava
     `CAIXINHA:<v> DESCONTO:<v>` na 1ª linha do pagamento.
   • hidratarDescontos() lê esses marcadores num ÚNICO SELECT,
     popula `a.desconto_aplicado` em window.appointments (consumido por
     dashboard-pagamentos.js calcularValorTotal e por comissoes-desconto.js)
     e devolve { total, porProf } para o ajuste de DOM.
   • Caixinha em #dash-faturamento continua sob a pagamentos.js v16
     (idempotente via dataset.baseFat).
   • Após v5: nenhum KPI depende de estado só-em-memória — recarregar a
     página dá o mesmo resultado.

   NÃO TOCA:
     - regras de venda/uso de pacote
     - produtos / estoque
     - histórico do cliente
     - quantidade de agendamentos / serviços
     - caixinha (segue 100% do barbeiro)
   ===================================================================== */
(function(){
  'use strict';
  if (window.__SLOTIFY_DESC_FIN_LOADED__) return;
  window.__SLOTIFY_DESC_FIN_LOADED__ = true;

  console.log('%c🧾 desconto-financeiro.js v6 carregado (marker DESCONTO + invariante valor_total_pago como fallback/validação)',
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

  // -------------------- Fonte única: lê DESCONTO de agendamento_pagamentos --------------------
  // Retorna mapa { agId: descontoTotal } a partir do marcador DESCONTO:<v>
  // gravado pelo pagamentos.js v16 na coluna observacao.
  async function fetchMarcadoresPorAg(ids){
    // Retorna { descByAg: {agId: descTotal}, caxByAg: {agId: caixinhaTotal} }
    var out = { descByAg: {}, caxByAg: {} };
    var sb = getSb(); var tenant = getTenantId();
    if (!sb || !tenant || !ids.length) return out;
    var seen = Object.create(null);
    var chunk = 500;
    for (var i=0; i<ids.length; i+=chunk){
      var slice = ids.slice(i, i+chunk);
      try {
        var resp = await sb.from('agendamento_pagamentos')
          .select('id, agendamento_id, observacao')
          .in('agendamento_id', slice)
          .eq('tenant_id', tenant);
        if (resp.error) { console.warn('[desc-fin] fetch marc', resp.error); continue; }
        (resp.data || []).forEach(function(r){
          if (!r || r.id == null) return;
          if (seen[r.id]) return;
          seen[r.id] = true;
          var obs = r.observacao || '';
          var md = /DESCONTO:([\d\.]+)/i.exec(obs);
          if (md){
            var vd = parseFloat(md[1]) || 0;
            if (vd > 0) out.descByAg[r.agendamento_id] = round2((out.descByAg[r.agendamento_id] || 0) + vd);
          }
          var mc = /CAIXINHA:([\d\.]+)/i.exec(obs);
          if (mc){
            var vc = parseFloat(mc[1]) || 0;
            if (vc > 0) out.caxByAg[r.agendamento_id] = round2((out.caxByAg[r.agendamento_id] || 0) + vc);
          }
        });
      } catch(e){ console.warn('[desc-fin] fetch marc ex', e); }
    }
    return out;
  }

  // Compat: mantém nome antigo para chamadas externas
  async function fetchDescontosPorAg(ids){
    var r = await fetchMarcadoresPorAg(ids);
    return r.descByAg;
  }

  // Soma serviços brutos (preço da venda real, ignora usos de pacote).
  function servicoBrutoDoAg(a){
    if (!a) return 0;
    var total = 0;
    var svcs = [];
    try {
      svcs = (typeof window.getAppointmentServicos === 'function')
        ? (window.getAppointmentServicos(a) || [])
        : ((a.servicos) || []);
    } catch(_){ svcs = (a.servicos) || []; }
    svcs.forEach(function(s){
      if (!s) return;
      // ignora uso de pacote (preço 0 efetivo)
      if (s.origem === 'pacote_uso' || s.cliente_pacote_id) return;
      var preco = parseFloat(s.preco);
      if (isNaN(preco)) preco = 0;
      total += preco;
    });
    return round2(total);
  }

  // -------------------- Hidrata desconto_aplicado em window.appointments --------------------
  // v5: fonte de verdade = marcador DESCONTO em agendamento_pagamentos.observacao.
  // Sem heurística. Sem inferência. Sem dependência de status_pagamento /
  // valor_total_pago / sincronia de caixinha.
  async function hidratarDescontos(){
    var out = { total: 0, porProf: {} };
    if (!Array.isArray(window.appointments)) return out;

    var ags = window.appointments.filter(function(a){
      return a && a.id && inFiltro(a) && isOkParaFaturamento(a);
    });
    if (!ags.length) return out;

    var ids = ags.map(function(a){ return a.id; });
    var marc = await fetchMarcadoresPorAg(ids);
    var descByAg = marc.descByAg;
    var caxByAg  = marc.caxByAg;

    ags.forEach(function(a){
      var marker   = round2(descByAg[a.id] || 0);
      var caixinha = round2(caxByAg[a.id] != null ? caxByAg[a.id] : (Number(a.tip_amount) || 0));
      var servico  = servicoBrutoDoAg(a);
      var pago     = round2(Number(a.valor_total_pago) || 0);

      // Invariante de negócio:
      //   valor_total_pago = serviço - desconto + caixinha
      //   => desconto = serviço + caixinha - valor_total_pago
      // Quando temos dados suficientes (serviço > 0 e pago > 0), o invariante
      // é a fonte de verdade absoluta. Se o marker DESCONTO: divergir do
      // invariante (ex: marker stale/contaminado de uma execução anterior
      // ou de outro registro), CONFIAMOS no invariante — não na string.
      var temInvariante = (servico > 0 && pago > 0);
      var inferido = temInvariante ? round2(Math.max(0, servico + caixinha - pago)) : marker;

      var desc;
      if (!temInvariante) {
        desc = marker; // sem como validar, usa marker como antes
      } else if (Math.abs(marker - inferido) <= 0.01) {
        desc = marker; // marker confere com o invariante
      } else {
        // Divergência: marker é stale OU foi gravado errado. Usa invariante.
        if (marker > 0) {
          console.warn('[desc-fin] DESCONTO marker divergente do invariante; usando invariante',
            { agId: a.id, marker: marker, inferido: inferido,
              servico: servico, caixinha: caixinha, pago: pago });
        }
        desc = inferido;
      }

      a.desconto_aplicado = desc;
      if (desc > 0) {
        out.total += desc;
        var prof = primaryProf(a);
        if (prof) out.porProf[prof] = round2((out.porProf[prof] || 0) + desc);
      }
    });
    out.total = round2(out.total);
    return out;
  }


  // -------------------- Ajuste de DOM (idempotente) --------------------
  // dataset.descSum guarda quanto JÁ subtraímos do texto atual.
  // base = atual + jáAplicado  → representa o valor escrito pelo orig (+ caixinha do pagamentos v16).
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
        if (txt.indexOf('comiss')      >= 0 && idxCom < 0) idxCom = i;
      });
    }
    if (idxFat < 0) return;
    Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function(tr){
      var tds = tr.querySelectorAll('td');
      if (!tds.length || !tds[idxNome] || !tds[idxFat]) return;
      var nome = (tds[idxNome].textContent || '').trim();
      var desc = Number(porProf[nome]) || 0;

      var fatOldShown = parseMoneyText(tds[idxFat].textContent);
      var prevFat = parseFloat(tds[idxFat].dataset.descSum || '0') || 0;
      var fatBase = round2(fatOldShown + prevFat);
      var fatNew = round2(Math.max(0, fatBase - desc));

      if (idxCom >= 0 && tds[idxCom]){
        var comOldShown = parseMoneyText(tds[idxCom].textContent);
        var prevCom = parseFloat(tds[idxCom].dataset.descSum || '0') || 0;
        var comBase = round2(comOldShown + prevCom);
        // comissão é proporcional ao faturamento LÍQUIDO de desconto
        // (pct = comBase/fatBase). Caixinha NÃO entra na comissão.
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
  // total_receber = comissao (líquida) + caixinha. Sem desconto sobre a caixinha.
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

    var lastResumo = { total: 0, porProf: {} };

    // v7 (2026-06-09) — REMOVIDO MutationObserver em #dash-faturamento.
    // O observer disparava em CADA escrita no nodo (incluindo a escrita
    // de caixinha feita por pagamentos.js v17). Mesmo sendo idempotente
    // dentro de uma "rodada", em cenários com polling / realtime /
    // múltiplos wraps concorrentes ele participava de races em que a
    // caixinha acabava sendo recalculada sobre um valor já inflado,
    // produzindo o sintoma 90 → 100 → 110 ... a cada poucos segundos
    // no Dashboard. A aplicação pós-orig.apply (aplicarNoDOM) é
    // suficiente: pagamentos.js v17 grava o valor + caixinha sem
    // depender de baseFat dataset, e nossa subtração de desconto é
    // idempotente via dataset.descSum.

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

          resetDatasetMarkers();

          var ret = await orig.apply(self, args);

          try { aplicarNoDOM(resumo); }
          catch(e){ console.warn('[desc-fin] aplicarNoDOM', e); }
          return ret;
        })();
      };
      var p = queueTail.then(run, run);
      queueTail = p.catch(function(){});
      return p;
    };
    wrapped.__descFinWrapped = true;
    window.loadDashboard = wrapped;
    console.log('[desc-fin] hook v7 em loadDashboard instalado (sem MutationObserver)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(instalar, 1500); });
  } else {
    setTimeout(instalar, 1500);
  }

  // Debug
  window.__descFinHidratar = hidratarDescontos;
  window.__descFinAplicar  = aplicarNoDOM;
  window.__descFinFetch    = fetchDescontosPorAg;
})();
