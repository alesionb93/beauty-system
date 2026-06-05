/* =====================================================================
   COMISSOES-DESCONTO.JS — Add-on isolado (v1 — 2026-06-03)
   ---------------------------------------------------------------------
   Carregue DEPOIS de comissoes.js, pagamentos.js, dashboard-pagamentos.js
   e desconto-financeiro.js, em agenda.html:

       <script src="/comissoes-desconto.js?v=1" defer></script>

   O QUE FAZ
   ---------
   Garante que a tela "Comissões" (perfil colaborador) utilize o valor
   LÍQUIDO (após desconto) — exatamente a mesma base já utilizada pelo
   Dashboard Financeiro.

   COMO FAZ (sem mexer em comissoes.js nem na RPC)
   -----------------------------------------------
   - Monkey-patcha sb.rpc para interceptar chamadas a
     'get_comissoes_dashboard'.
   - Após o servidor retornar (com valores brutos), iteramos
     window.appointments no período (p_inicio..p_fim), detectamos descontos
     pela mesma heurística do desconto-financeiro.js
     (status_pagamento='pago' e bruto > pagoNet) e reduzimos:
        • comissao_valor de cada item da agenda do colaborador,
          proporcionalmente: novoCom = com * (bruto - desc) / bruto;
        • data.total_comissao  = Σ novoCom;
        • data.total_receber   = Σ (novoCom + caixinha do item).

   NÃO ALTERA:
     - RPC SQL / banco
     - regras de comissão (apenas a base passa a ser líquida)
     - dashboard / faturamento / pagamentos / caixinha / pacotes
     - produtos / estoque / agendamentos
   ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_COM_DESC_LOADED__) return;
  window.__SLOTIFY_COM_DESC_LOADED__ = true;

  console.log('%c🧾 comissoes-desconto.js v1 carregado',
    'background:#16a34a;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700');

  // -------------------- Helpers --------------------
  function round2(n){ return Math.round((Number(n)||0)*100)/100; }
  function getSb(){
    return window.supabaseClient || window.supabase || null;
  }
  function getTenantId(){
    if (typeof window.getCurrentTenantId === 'function') {
      try { var t = window.getCurrentTenantId(); if (t) return t; } catch(_){}
    }
    return window.currentTenantId || null;
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
  function grossFallback(a){
    if (!a) return 0;
    var sum = 0;
    var sp = window.servicePrices || {};
    var svcs = Array.isArray(a.servicos) ? a.servicos
              : (a.servico ? [{servico:a.servico, preco:a.preco||a.valor||0}] : []);
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

  // -------------------- Caixinhas (para inferir pagoNet) --------------------
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
        if (resp.error) { console.warn('[com-desc] tips', resp.error); continue; }
        (resp.data || []).forEach(function(r){
          var m = /CAIXINHA:([\d\.]+)/i.exec(r.observacao || '');
          if (m){
            var v = parseFloat(m[1]) || 0;
            tips[r.agendamento_id] = (tips[r.agendamento_id] || 0) + v;
          }
        });
      } catch(e){ console.warn('[com-desc] tips ex', e); }
    }
    return tips;
  }

  // -------------------- Nome do profissional do colaborador --------------------
  var _profNomeCache = null;
  async function getProfissionalNome(){
    if (_profNomeCache !== null) return _profNomeCache;
    var sb = getSb(); if (!sb) return '';
    try {
      var u = await sb.auth.getUser();
      var uid = u && u.data && u.data.user && u.data.user.id;
      if (!uid) { _profNomeCache = ''; return ''; }
      var r1 = await sb.from('usuarios').select('profissional_id').eq('id', uid).maybeSingle();
      var pid = r1 && r1.data && r1.data.profissional_id;
      if (!pid) { _profNomeCache = ''; return ''; }
      var r2 = await sb.from('profissionais').select('nome').eq('id', pid).maybeSingle();
      var nome = r2 && r2.data && r2.data.nome ? String(r2.data.nome).trim() : '';
      _profNomeCache = nome;
      return nome;
    } catch(_) { _profNomeCache = ''; return ''; }
  }

  // -------------------- Detecta desconto por agendamento --------------------
  function detectaDesconto(a, tip){
    var st    = String(a.status_pagamento || '').toLowerCase();
    var pago  = Number(a.valor_total_pago) || 0;
    var pagoNet = round2(pago - (Number(tip)||0));
    var bruto = grossDe(a);
    if (st === 'pago' && bruto > 0 && pagoNet >= 0 && (bruto - pagoNet) > 0.01) {
      return { bruto: bruto, desc: round2(bruto - pagoNet) };
    }
    return { bruto: bruto, desc: 0 };
  }

  // -------------------- Matching agenda RPC <-> appointment --------------------
  function normHora(h){ return String(h||'').trim().slice(0,5); }
  function normTxt(s){ return String(s||'').trim().toLowerCase(); }

  function buildApptIndex(appts, profNome){
    // mapa por data → lista de { appt, key(hora+cliente) }
    var idx = {};
    appts.forEach(function(a){
      if (!a || !a.data) return;
      if (!isOkParaFaturamento(a)) return;
      // só interessa appts onde o colaborador é o profissional principal
      if (profNome && normTxt(primaryProf(a)) !== normTxt(profNome)) return;
      var key = a.data;
      (idx[key] = idx[key] || []).push(a);
    });
    return idx;
  }

  function findAppt(idx, data, hora, cliente){
    var list = idx[data]; if (!list) return null;
    var h = normHora(hora), c = normTxt(cliente);
    // 1) match hora + cliente
    for (var i=0;i<list.length;i++){
      var a = list[i];
      if (normHora(a.hora) === h && normTxt(a.cliente || a.cliente_nome) === c) return a;
    }
    // 2) match só hora (caso cliente venha diferente)
    for (i=0;i<list.length;i++){
      if (normHora(list[i].hora) === h) return list[i];
    }
    return null;
  }

  // -------------------- Ajuste principal --------------------
  async function ajustarData(data, params){
    if (!data || typeof data !== 'object') return data;
    if (!Array.isArray(window.appointments)) return data;

    var pIni = params && (params.p_inicio || params.pInicio);
    var pFim = params && (params.p_fim    || params.pFim);
    if (!pIni || !pFim) return data;

    var profNome = await getProfissionalNome();

    // appts do colaborador no período
    var ags = window.appointments.filter(function(a){
      if (!a || !a.data) return false;
      if (a.data < pIni || a.data > pFim) return false;
      if (!isOkParaFaturamento(a)) return false;
      if (profNome && normTxt(primaryProf(a)) !== normTxt(profNome)) return false;
      return true;
    });

    if (!ags.length) return data;

    var ids = ags.map(function(a){ return a.id; }).filter(Boolean);
    var tips = await fetchTipsPorAg(ids);

    // pré-calcula desconto por appt
    var descByAppt = new Map();
    ags.forEach(function(a){
      var d = detectaDesconto(a, tips[a.id] || 0);
      if (d.desc > 0 && d.bruto > 0) descByAppt.set(a, d);
    });

    if (!descByAppt.size) return data;

    var idx = buildApptIndex(ags, profNome);

    // ajusta agenda item-a-item
    var agenda = Array.isArray(data.agenda) ? data.agenda : [];
    var totalCom = 0, totalCax = 0;
    agenda.forEach(function(it){
      var com = Number(it.comissao_valor) || 0;
      var cax = Number(it.caixinha) || 0;
      var dt  = it.data || it.dia || it.date;
      // se RPC não devolveu data, tenta achar por hora apenas (1 dia da agenda)
      var match = null;
      if (dt) match = findAppt(idx, dt, it.hora, it.cliente_nome);
      if (!match){
        // varre todos os dias do período
        Object.keys(idx).some(function(k){
          match = findAppt(idx, k, it.hora, it.cliente_nome);
          return !!match;
        });
      }
      var d = match ? descByAppt.get(match) : null;
      if (d && d.bruto > 0){
        var ratio = Math.max(0, (d.bruto - d.desc) / d.bruto);
        com = round2(com * ratio);
        it.comissao_valor = com;
      }
      totalCom += com;
      totalCax += cax;
    });

    // recompõe totais
    data.total_comissao = round2(totalCom);
    data.total_caixinha = round2(totalCax);
    data.total_receber  = round2(totalCom + totalCax);

    return data;
  }

  // -------------------- Monkey-patch sb.rpc --------------------
  function instalar(){
    var sb = getSb();
    if (!sb || typeof sb.rpc !== 'function') return setTimeout(instalar, 400);
    if (sb.rpc.__comDescWrapped) return;

    var orig = sb.rpc.bind(sb);
    var wrapped = function(name, params, opts){
      var p = orig(name, params, opts);
      if (name !== 'get_comissoes_dashboard') return p;
      // resp do supabase-js é thenable que retorna { data, error }
      var chained = p.then(async function(resp){
        if (!resp || resp.error || !resp.data) return resp;
        try {
          var nova = await ajustarData(resp.data, params || {});
          return Object.assign({}, resp, { data: nova });
        } catch(e){
          console.warn('[com-desc] ajustar', e);
          return resp;
        }
      });
      // preserva métodos do builder (caso exista .then encadeado)
      return chained;
    };
    wrapped.__comDescWrapped = true;
    sb.rpc = wrapped;
    console.log('[com-desc] hook em sb.rpc(get_comissoes_dashboard) instalado');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(instalar, 800); });
  } else {
    setTimeout(instalar, 800);
  }

  // Debug
  window.__comDescAjustar = ajustarData;
})();
