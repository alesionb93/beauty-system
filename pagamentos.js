/* =====================================================================
   PAGAMENTOS.JS — Add-on isolado  (v7 — badge via pagamentos reais + hook afterSave)
   ---------------------------------------------------------------------
   Carregue DEPOIS do script.js, em agenda.html:
       <link rel="stylesheet" href="/pagamentos.css">
       <script src="/pagamentos.js?v=7" defer></script>

   v6 (2026-05-22):
   • Badge nos cards: deriva o status do valor pago (valor_total_pago) e
     de possui_pagamento — NÃO depende mais só de status_pagamento, que
     nem sempre é atualizado. Resultado: agendamentos pagos param de
     mostrar "Pagamento pendente".
   • Pré-pago: NÃO renderiza badge de pagamento (evita conflito com o
     badge "✓ Pré-pago" do agendamento-prepago.js).
   • Novo hook window.__pagRegisterAfterSave(fn) — roda após salvar
     pagamentos e ANTES de fechar o modal, permitindo que o add-on de
     pré-pago crie o próximo agendamento de forma determinística (sem
     depender do MutationObserver do fechamento do modal).

   v5 (anterior): pré-pago aware no interceptor de conclusão e no botão
   "Registrar pagamento".
   v4 (anterior): expõe __pagSetExtraTotal / __pagGetCtx.
   ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_PAG_LOADED__) return;
  window.__SLOTIFY_PAG_LOADED__ = true;

  console.log('%c💳 pagamentos.js v18 (caixinha dashboard idempotente mesmo quando loadDashboard não reescreve KPIs)', 'background:#6c3aed;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700');



  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  // SVG inline icons (silhuetas elegantes, herdando currentColor)
  var FORMA_ICONS = {
    pix:
      '<img class="pag-forma-ic pag-forma-ic-pix" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAHpUExURQAAAFC0q022rE21rE+zqUW5olPCsEu4sUi2o0y2rEy2qwDtvFidpgBzjDu5k2LNsVzpx1O8s0qmvlPBqE+1slKzr069sE27rku1rU21q0+yqVu9rk61r1C4sFTDuUu3rVG4sFO6r0y1rFO5sE22q1a4uEy2rlG4r1DAtUq4rk66rky3sE+zr0y8rlTAqVG4tE6wsFG+tkihu1/JsFbr4AB6eDizlivOyFeoply5tlC5tEy4rky1q022rE22rE22rEy0q022rE22rE22rE22rE22rE22rE22rE22rE22rE22rE22rE22rE22rE22rEy2rE22rE22rE22rE22rEy2rEy1q022rE22rE22rEu2q022rE22rE22rE22rE22rE22rE22rE22rEy2rE22rE22rE22rE22rE22rE22rE22rE22rE21rEuzq022rE22rE22rEuzqEy1q022rE22rE22rE22rE22rE22rE22rE22rE22rE22rE22rE22rE22rE22rE22rE22rE22rE22rE22q022rE22rE22rE22rEy0rE22rE22rE20q0y0qk22rE22rE22rE22rE22rEu1q022rE21qku0q022rE22rEuzqk21q022rE22rEy1rE22rEy1rEy2q022rP///4r/XzMAAAChdFJOUwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEcP1YBNZfa9f38B3HncgiF+oYI+4cKiAoCaeD0AgIbJTt1yf7KAhV+8X9NW1AqBAFj7u8BA/jmH2HBJ2AmwMNfxCjtXsVd7AdcKcYQAcg6AQHonm1VbAE5AQGWTwEDFjwCNAEBeqL5fwAAAAFiS0dEorDd34wAAAAJcEhZcwAACxMAAAsTAQCanBgAAAAHdElNRQfqBgQVKhOKERzeAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTA2LTA0VDIxOjQxOjIzKzAwOjAwJ65jkgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0wNi0wNFQyMTo0MToyMyswMDowMFbz2y4AAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMDYtMDRUMjE6NDI6MTkrMDA6MDDALhlfAAAC/0lEQVRYw7WX91cTQRCAcUIUsHexd8XeK0lIIQ0SY1BASggiVQFpBgVSKAFBDbGBiuX+UzdHcuRuS3bjc367d/t97253dma3oOD/xTpIhw4K8+F1Oig3GE0mo6ECSYRxPcB6s8Vqq7TbrBbzBoAiYd7hdEnpcLkdggbEV1V7JCU83gdChhTv9UlZ4XsoYsB5MQOJFzGQeX4Djec10Hk+A4vnMbB5DgOAv4bBI0PNIyhmCR7X1tWzBPV1tU9KWIKGxqbmQEuQTAdbA81NjU9pX6DPbH9oe9ZO4ts72pQhRUTe39nV1dXd8xxe9PbhfH/vSxjo6UZDOv0Egzz/g8Fg0DdkGYaNI5ihf2QTDFuGfGjIIGFvqtbvVQg2j2oMfSNb4PUb6mpq1n8sBFvHVYa+0W0QGqPmA5Y/E2HYPh5Ze46M78jmtQZC/iHDzqhiiER3qXmNgZS/sTDsnpzK8HsgPEHK6gw/XY3nLzLsnZENkcl9OI8M3mkoTfH74YDbI+ERi8PBlGFq5hCEY4QBHvfh0iPyB5hdEilm43DU1NJiOgbxGHGAyyz/BJRbJIlmgLk5gPgsZYDlrS4lMFgp76X5hXcA7xfmae+tBvkLjDbaAOlDYnEx4aK+thllgalSyjPsyVWB/R8FjF9wJT5y/AJrEj+hSfycaxK/5L+MX4/zJNKJHIlUePKUk5LKp1dT+QwllZ1ndWXMzXQus5nOkzeTA3Rr21n7DaggXJhMF4RI9CJpO1cpRy89bkD8peyCchkvKIi/UkAzTITgqrqkXdOWtGweM6Ciel1bVG+oi6qax8v6Tbys38oq614tr20st0mN5Q4ML6UbC86vtbbl+ABUkFvbN/geX063NoxXNdcOSnP9oQwh8Ep7Xwm00tv7SlNjA+vgzXPA+MkU5D7i+JlHfz0pqxn5I2rIzbMNPDzLwMfTDbw8zcDPkw0iPPnKI8JTLl0CPHbtczoEedlw99eS1WaXL573hHkUxSXw22BMJo2GP/lcfVHcV3Y/lOXDc8ZfxjXItiy/8JAAAAAASUVORK5CYII=" alt="PIX" width="18" height="18" />',
    dinheiro:
      '<svg class="pag-forma-ic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
      + '<rect x="2.5" y="6" width="19" height="12" rx="2"/>'
      + '<circle cx="12" cy="12" r="2.5"/>'
      + '<path d="M6 9.5h.01M18 14.5h.01"/>'
      + '</svg>',
    debito:
      '<svg class="pag-forma-ic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
      + '<rect x="2.5" y="5" width="19" height="14" rx="2"/>'
      + '<path d="M2.5 10h19"/>'
      + '<path d="M6 15h4"/>'
      + '</svg>',
    credito:
      '<svg class="pag-forma-ic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
      + '<rect x="2.5" y="5" width="19" height="14" rx="2"/>'
      + '<path d="M2.5 9h19"/>'
      + '<path d="M6 15h3M12 15h3"/>'
      + '</svg>',
    credito_parcelado:
      '<svg class="pag-forma-ic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
      + '<rect x="2.5" y="5" width="19" height="14" rx="2"/>'
      + '<path d="M2.5 9h19"/>'
      + '<path d="M6 15h3M11 15h3M16 15h2"/>'
      + '</svg>'
  };

  var FORMAS = [
    { id: 'pix',                label: 'PIX' },
    { id: 'dinheiro',           label: 'Dinheiro' },
    { id: 'debito',             label: 'Débito' },
    { id: 'credito',            label: 'Crédito' },
    { id: 'credito_parcelado',  label: 'Crédito Parcelado' }
  ];
  function formaIcon(id){ return FORMA_ICONS[id] || FORMA_ICONS.pix; }
  function formaLabel(id){
    for (var i = 0; i < FORMAS.length; i++) if (FORMAS[i].id === id) return FORMAS[i].label;
    return id;
  }

  function fmtBRL(n) {
    n = Number(n) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function round2(n){ return Math.round((Number(n)||0) * 100) / 100; }

  function normKey(v) {
    return String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  }

  function parseValor(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      var s = v.replace(/[^\d,.-]/g, '');
      if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
      var n = parseFloat(s);
      return isNaN(n) ? 0 : n;
    }
    return 0;
  }

  function itemKind(item) {
    if (!item) return '';
    return normKey([
      item.origem, item.tipo, item.tipo_item, item.item_tipo, item.categoria,
      item.tipoServico, item.tipo_servico, item.source, item.kind, item.modalidade
    ].filter(Boolean).join('_'));
  }

  function isPacoteUso(item) {
    var k = itemKind(item);
    return k === 'pacote_uso' || k === 'uso_pacote' || (k.indexOf('pacote') >= 0 && (k.indexOf('uso') >= 0 || k.indexOf('consumo') >= 0));
  }

  function isPacoteVenda(item) {
    var k = itemKind(item);
    return k === 'pacote_venda' || k === 'venda_pacote' || k === 'pacote' || (k.indexOf('pacote') >= 0 && k.indexOf('venda') >= 0);
  }

  function valorItem(item) {
    if (!item) return 0;
    var campos = ['preco', 'valor', 'valor_total', 'valorTotal', 'total', 'preco_total', 'precoTotal', 'preco_pacote', 'precoPacote', 'valor_pacote', 'valorPacote', 'pacote_valor', 'pacoteValor', 'price', 'amount'];
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
    var qtd = parseValor(item.quantidade || item.qtd || item.quantity);
    var unit = parseValor(item.preco_unitario || item.valor_unitario || item.unit_price);
    return qtd > 0 && unit > 0 ? qtd * unit : 0;
  }

  function valorPacoteVendaItem(item) {
    if (!item) return 0;
    // Para pacote vendido, o valor correto é o total do pacote. Se a linha
    // também tiver preço unitário do serviço, ele NÃO deve ganhar prioridade.
    var campos = ['valor_total','valorTotal','total','preco_total','precoTotal',
                  'preco_pacote','precoPacote','valor_pacote','valorPacote',
                  'pacote_valor','pacoteValor','valor','preco','price','amount'];
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
    var qtd = parseValor(item.quantidade || item.qtd || item.quantity);
    var unit = parseValor(item.preco_unitario || item.valor_unitario || item.unit_price);
    return qtd > 0 && unit > 0 ? qtd * unit : 0;
  }

  function getSb(){ return window.supabaseClient || window.supabase || null; }
  function getTenantId(){
    return (typeof window.getCurrentTenantId === 'function')
      ? window.getCurrentTenantId() : (window.currentTenantId || null);
  }

  function getServicos(ag) {
    if (!ag) return [];
    if (typeof window.getAppointmentServicos === 'function') {
      try { return window.getAppointmentServicos(ag) || []; } catch(_){}
    }
    return ag.servicos || [];
  }

  function getProdutosDoAgendamento(agId) {
    var st = window.__produtosVendaState;
    if (st && st.porAgendamento && st.porAgendamento[agId]) return st.porAgendamento[agId];
    var legacy = window.produtosPorAgendamento;
    if (legacy && legacy[agId]) return legacy[agId];
    return [];
  }

  var __pagResumoCache = {};
  var __pagResumoLoading = {};

  function normalizePaymentStatus(v) {
    v = String(v || '').trim().toLowerCase();
    if (v === 'paid') return 'pago';
    if (v === 'partial') return 'parcial';
    return v;
  }

  function isPrepaidPaid(ag) {
    if (!ag || ag.prepaid !== true) return false;
    var st = normalizePaymentStatus(ag.status_pagamento || ag.payment_status);
    return st === 'pago' || Number(ag.valor_total_pago || 0) > 0 || !!ag.possui_pagamento;
  }

  function getResumoPagamento(ag) {
    var cached = ag && ag.id ? __pagResumoCache[ag.id] : null;
    var pagoDenorm = Number(ag && ag.valor_total_pago) || 0;
    var pagoCache = cached ? (Number(cached.valor) || 0) : 0;
    var st = normalizePaymentStatus((ag && (ag.status_pagamento || ag.payment_status)) || '');
    var temDenorm = !!(ag && (ag.possui_pagamento || pagoDenorm > 0 || st === 'pago' || st === 'parcial'));
    return {
      cacheLoaded: !!cached,
      temDenorm: temDenorm,
      status: st,
      pago: Math.max(pagoDenorm, pagoCache),
      possui: temDenorm || !!(cached && cached.qtd > 0)
    };
  }

  async function carregarResumoPagamentos(ids) {
    ids = (ids || []).filter(function(id){ return id && !__pagResumoCache[id] && !__pagResumoLoading[id]; });
    if (!ids.length) return;
    ids.forEach(function(id){ __pagResumoLoading[id] = true; });
    var sb = getSb();
    if (!sb) {
      ids.forEach(function(id){ __pagResumoCache[id] = { valor: 0, qtd: 0 }; delete __pagResumoLoading[id]; });
      return;
    }
    try {
      var q = sb.from('agendamento_pagamentos').select('agendamento_id, valor').in('agendamento_id', ids);
      var tenantId = getTenantId();
      if (tenantId) q = q.eq('tenant_id', tenantId);
      var resp = await q;
      ids.forEach(function(id){ __pagResumoCache[id] = { valor: 0, qtd: 0 }; });
      if (resp.error) throw resp.error;
      (resp.data || []).forEach(function(row){
        var id = row.agendamento_id;
        if (!__pagResumoCache[id]) __pagResumoCache[id] = { valor: 0, qtd: 0 };
        __pagResumoCache[id].valor += Number(row.valor) || 0;
        __pagResumoCache[id].qtd += 1;
      });
    } catch(e) {
      console.warn('[pag] resumo pagamentos', e);
      ids.forEach(function(id){ if (!__pagResumoCache[id]) __pagResumoCache[id] = { valor: 0, qtd: 0 }; });
    } finally {
      ids.forEach(function(id){ delete __pagResumoLoading[id]; });
    }
  }

  // ------------------------------------------------------------------
  // Detecção de VENDA financeira no agendamento
  // ------------------------------------------------------------------
  // Regra de negócio (fluxogramas 1 e 2):
  //   A abertura do modal de pagamento deve ser decidida EXCLUSIVAMENTE
  //   pela existência de uma VENDA neste agendamento. NUNCA pela
  //   existência/uso/saldo de pacote.
  //
  //   Existe venda quando há ao menos um dos itens abaixo:
  //     • venda de pacote      → ag._pacoteVendaItems (script.js) OU
  //                              ag.pacotes_venda / pacotesVenda / ...
  //     • serviço pago         → serviço cujo preço > 0 e que NÃO é
  //                              pacote_uso (consumo de saldo)
  //     • produto vendido      → linhas em agendamento_produtos
  //
  //   Uso/consumo de pacote NÃO é venda e não deve abrir modal.
  function getVendaPacoteItems(ag) {
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

    // Fonte primária populada por loadAppointments em script.js + fallbacks
    // legados. Não retorna no primeiro campo para não perder venda quando
    // mais de uma origem vier preenchida.
    var campos = [
      '_pacoteVendaItems','pacoteVendaItems','pacote_venda_items',
      'pacotesVendidos','pacotes_vendidos','pacotes_venda','pacotesVenda',
      'pacotes_para_venda','pacotesParaVenda','venda_pacotes','vendasPacotes','packagesSold'
    ];
    campos.forEach(function(c){
      var lista = ag[c];
      if (Array.isArray(lista) && lista.length) lista.forEach(pushItem);
    });

    if (ag._hasVendaPacote) {
      ['pacoteVenda','pacote_venda','pacoteVendido','pacote_vendido','pacote'].forEach(function(c){
        var item = ag[c];
        if (Array.isArray(item)) item.forEach(pushItem);
        else if (item && typeof item === 'object') pushItem(item);
      });
    }

    // Em alguns estados do app a venda do pacote ainda vem misturada em
    // ag.servicos como tipo='pacote_venda'. Ela também é VENDA e precisa
    // abrir o modal / compor o total.
    getServicos(ag).forEach(function(s){
      if (isPacoteVenda(s)) pushItem(s);
    });

    // Fallback final: há flag de venda e o valor do pacote está direto no
    // agendamento. Só adiciona se houver valor para não criar cobrança vazia.
    if (!out.length && ag._hasVendaPacote && valorPacoteVendaItem(ag) > 0) pushItem(ag);

    return out;
  }

  function possuiVendaPacote(ag) {
    return getVendaPacoteItems(ag).length > 0 || !!(ag && ag._hasVendaPacote);
  }

  function possuiServicoPago(ag) {
    if (!ag) return false;
    var sp = window.servicePrices || {};
    var servicos = getServicos(ag);
    for (var i = 0; i < servicos.length; i++) {
      var s = servicos[i];
      if (!s) continue;
      if (isPacoteUso(s)) continue;       // consumo de saldo → não é venda
      if (isPacoteVenda(s)) continue;     // já contabilizado em getVendaPacoteItems
      var preco = valorItem(s);
      if (!preco && s.servico && sp[s.servico]) preco = Number(sp[s.servico].preco) || 0;
      if (preco > 0) return true;
    }
    return false;
  }

  function possuiProdutosVendidos(ag) {
    if (!ag) return false;
    var prods = getProdutosDoAgendamento(ag.id);
    if (!prods || !prods.length) return false;
    for (var i = 0; i < prods.length; i++) {
      var p = prods[i];
      var qtd = Number(p && p.quantidade) || 0;
      var unit = Number(p && p.preco_unitario) || 0;
      if (qtd > 0 && unit > 0) return true;
    }
    return false;
  }

  function possuiVendaFinanceira(ag) {
    return possuiVendaPacote(ag) || possuiServicoPago(ag) || possuiProdutosVendidos(ag);
  }

  function calcularValorTotalAgendamento(ag) {
    if (!ag) return 0;
    var total = 0;
    var sp = window.servicePrices || {};

    // 1) Serviços pagos (avulsos). Ignora pacote_uso (consumo de saldo)
    //    e pacote_venda (somado abaixo via _pacoteVendaItems para evitar
    //    contagem dupla — em loadAppointments as linhas pacote_venda já
    //    são filtradas de agendamento_servicos, mas mantemos a guarda).
    getServicos(ag).forEach(function(s){
      if (!s) return;
      if (isPacoteUso(s)) return;
      if (isPacoteVenda(s)) return;
      var preco = valorItem(s);
      if (!preco && s.servico && sp[s.servico]) preco = Number(sp[s.servico].preco) || 0;
      total += preco || 0;
    });

    // 2) Vendas de pacote — usa a fonte real populada por script.js
    //    (ag._pacoteVendaItems). O preço de cada linha pacote_venda já é
    //    o preco_total do pacote, então cobramos o VALOR DO PACOTE
    //    (nunca o valor unitário do serviço).
    getVendaPacoteItems(ag).forEach(function(v){
      total += valorPacoteVendaItem(v);
    });

    // 3) Produtos vendidos no atendimento
    var prods = getProdutosDoAgendamento(ag.id);
    prods.forEach(function(p){
      total += (Number(p.quantidade)||0) * (Number(p.preco_unitario)||0);
    });

    return round2(total);
  }

  // Exposto para debug/inspeção em console
  try {
    window.__pagPossuiVendaFinanceira = possuiVendaFinanceira;
    window.__pagCalcularTotal         = calcularValorTotalAgendamento;
  } catch(_){}

  // ------------------------------------------------------------------
  // Modal: injeção de markup (1 só vez) — usa convenção .modal-overlay
  // ------------------------------------------------------------------
  function ensureModal() {
    if (document.getElementById('modal-pagamento-ag')) return;
    var html = ''
      + '<div class="modal-overlay" id="modal-pagamento-ag">'
      +   '<div class="modal pag-modal-v2">'
      +     '<div class="modal-header pag-v2-header">'
      +       '<h3><span class="pag-v2-h-icon"><i class="fa-solid fa-money-bill-wave"></i></span>Registrar pagamento</h3>'
      +       '<button type="button" class="modal-close" data-pag-close="1" aria-label="Fechar">&times;</button>'
      +     '</div>'
      +     '<div class="modal-body pag-modal-body pag-v2-body">'

      +       '<div class="pag-v2-headcard">'
      +         '<div class="pag-v2-hc-item">'
      +           '<span class="pag-v2-hc-ic"><i class="fa-regular fa-user"></i></span>'
      +           '<span class="pag-v2-hc-text"><span class="pag-v2-hc-label">Cliente</span><strong id="pag-cliente">—</strong></span>'
      +         '</div>'
      +         '<div class="pag-v2-hc-sep"></div>'
      +         '<div class="pag-v2-hc-item">'
      +           '<span class="pag-v2-hc-ic"><i class="fa-regular fa-calendar"></i></span>'
      +           '<span class="pag-v2-hc-text"><span class="pag-v2-hc-label">Atendimento</span><strong id="pag-data">—</strong></span>'
      +         '</div>'
      +       '</div>'

      +       '<div class="pag-v2-cols">'

      +         '<div class="pag-v2-col-left">'
      +           '<div class="pag-v2-pending">'
      +             '<span class="pag-v2-pending-label">VALOR PENDENTE</span>'
      +             '<div class="pag-v2-pending-value" id="pag-pending-value">R$ 0,00</div>'
      +             '<span class="pag-v2-pending-desc">Atualizado em tempo real conforme os pagamentos</span>'
      +           '</div>'

      +           '<div class="pag-action-row" id="pag-tip-row-wrap">'
      +             '<button type="button" class="pag-tip-btn" id="pag-tip-btn">'
      +               '<i class="fa-solid fa-gift pag-tip-ic" aria-hidden="true"></i> <span id="pag-tip-btn-label">Adicionar caixinha</span>'
      +             '</button>'
      +           '</div>'
      +           '<div class="pag-v2-section-label">FORMA DE PAGAMENTO</div>'
      +           '<div class="pag-formas-list" id="pag-formas-list"></div>'
      +           '<button type="button" class="pag-add-btn" id="pag-add-btn">'
      +             '<i class="fa-solid fa-plus"></i> Adicionar mais formas de pagamento'
      +           '</button>'
      +         '</div>'

      +         '<div class="pag-v2-col-right">'
      +           '<div class="pag-resumo">'
      +             '<div class="pag-resumo-row"><span>Subtotal (serviços)</span><strong id="pag-subtotal">R$ 0,00</strong></div>'
      +             '<div class="pag-resumo-row pag-resumo-desc-row" id="pag-desc-row" hidden><span>Desconto</span><strong id="pag-desc-val" class="pag-v2-neg">R$ 0,00</strong></div>'
      // tip row will be injected here by renderTipRow() (before :last-child)
      +             '<div class="pag-resumo-row pag-resumo-total"><span>TOTAL</span><span class="pag-total" id="pag-total">R$ 0,00</span></div>'
      +           '</div>'
      +           '<div class="pag-restante" id="pag-restante"></div>'
      +         '</div>'

      +       '</div>'
      +     '</div>'
      +     '<div class="modal-actions pag-v2-actions">'
      +       '<button type="button" class="btn-cancel" data-pag-close="1">Cancelar</button>'
      +       '<button type="button" class="btn-submit" id="pag-confirmar" disabled>'
      +         '<i class="fa-solid fa-circle-check"></i> <span id="pag-confirmar-label">Confirmar e concluir</span>'
      +       '</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);

    document.querySelectorAll('#modal-pagamento-ag [data-pag-close]').forEach(function(b){
      b.addEventListener('click', function(){ closePagModal(); });
    });
    document.getElementById('pag-add-btn').addEventListener('click', function(){
      addLinhaPagamento();
      recomputar();
    });
    document.getElementById('pag-tip-btn').addEventListener('click', function(){
      abrirModalCaixinha();
    });
    document.getElementById('pag-confirmar').addEventListener('click', onConfirmar);
  }

  function openPagModal() {
    ensureModal();
    if (typeof window.openModal === 'function') {
      try { window.openModal('modal-pagamento-ag'); return; } catch(_){}
    }
    var m = document.getElementById('modal-pagamento-ag');
    if (m) { m.classList.add('active'); m.style.display = 'flex'; }
  }
  function closePagModal(){
    if (typeof window.closeModal === 'function') {
      try { window.closeModal('modal-pagamento-ag'); } catch(_){}
    } else {
      var m = document.getElementById('modal-pagamento-ag');
      if (m) { m.classList.remove('active'); m.style.display = 'none'; }
    }
    __ctx = null;
  }

  // ------------------------------------------------------------------
  // Estado
  // ------------------------------------------------------------------
  var __ctx = null; // { agendamentoId, total, mode, onSuccess }

  function addLinhaPagamento(prefill) {
    var list = document.getElementById('pag-formas-list');
    var row = document.createElement('div');
    row.className = 'pag-forma-item';
    // Dropdown customizado com ícone + select nativo oculto (mantém compatibilidade com lerPagamentos)
    var ddBtn = '<button type="button" class="pag-forma-toggle" aria-haspopup="listbox" aria-expanded="false">'
      + '<span class="pag-forma-ic-wrap">'+formaIcon('pix')+'</span>'
      + '<span class="pag-forma-label">'+formaLabel('pix')+'</span>'
      + '<i class="fa-solid fa-chevron-down pag-forma-caret" aria-hidden="true"></i>'
      + '</button>';
    var ddMenu = '<ul class="pag-forma-menu" role="listbox" hidden>'
      + FORMAS.map(function(f){
          return '<li role="option" data-value="'+f.id+'">'
            + '<span class="pag-forma-ic-wrap">'+formaIcon(f.id)+'</span>'
            + '<span>'+f.label+'</span>'
            + '</li>';
        }).join('')
      + '</ul>';
    var formaSel = '<div class="pag-forma-dd">'
      + ddBtn + ddMenu
      + '<select class="pag-forma" aria-hidden="true" tabindex="-1">'
      +   FORMAS.map(function(f){ return '<option value="'+f.id+'">'+f.label+'</option>'; }).join('')
      + '</select>'
      + '</div>';
    row.innerHTML = formaSel
      + '<input type="number" step="0.01" min="0.01" class="pag-valor" placeholder="0,00">'
      + '<button type="button" class="pag-remove" title="Remover"><i class="fa-solid fa-trash"></i></button>';
    list.appendChild(row);

    var dd     = row.querySelector('.pag-forma-dd');
    var sel    = row.querySelector('.pag-forma');
    var btn    = row.querySelector('.pag-forma-toggle');
    var menu   = row.querySelector('.pag-forma-menu');
    var labEl  = row.querySelector('.pag-forma-label');
    var icEl   = row.querySelector('.pag-forma-toggle .pag-forma-ic-wrap');
    var valEl  = row.querySelector('.pag-valor');
    var rmBtn  = row.querySelector('.pag-remove');

    function applyForma(v){
      sel.value = v;
      labEl.textContent = formaLabel(v);
      icEl.innerHTML = formaIcon(v);
      menu.querySelectorAll('li').forEach(function(li){
        li.classList.toggle('is-active', li.getAttribute('data-value') === v);
      });
    }
    function closeMenu(){
      menu.hidden = true;
      btn.setAttribute('aria-expanded','false');
      dd.classList.remove('open');
    }
    function openMenu(){
      // fecha outros abertos
      document.querySelectorAll('.pag-forma-dd.open').forEach(function(o){
        if (o !== dd) {
          o.classList.remove('open');
          var m = o.querySelector('.pag-forma-menu'); if (m) m.hidden = true;
          var b = o.querySelector('.pag-forma-toggle'); if (b) b.setAttribute('aria-expanded','false');
        }
      });
      menu.hidden = false;
      btn.setAttribute('aria-expanded','true');
      dd.classList.add('open');
    }
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      if (menu.hidden) openMenu(); else closeMenu();
    });
    menu.addEventListener('click', function(e){
      var li = e.target.closest('li[data-value]');
      if (!li) return;
      applyForma(li.getAttribute('data-value'));
      closeMenu();
      syncParcelas();
      recomputar();
    });
    document.addEventListener('click', function(e){
      if (!dd.contains(e.target)) closeMenu();
    });

    function syncParcelas() {
      var existing = row.querySelector('.pag-parcelas');
      if (sel.value === 'credito_parcelado') {
        if (!existing) {
          var pInput = document.createElement('input');
          pInput.type = 'number'; pInput.min = '2'; pInput.max = '24'; pInput.value = '2';
          pInput.className = 'pag-parcelas'; pInput.placeholder = 'x';
          row.insertBefore(pInput, rmBtn);
          row.classList.add('parcelado');
          pInput.addEventListener('input', recomputar);
        }
      } else if (existing) {
        existing.remove();
        row.classList.remove('parcelado');
      }
    }

    sel.addEventListener('change', function(){ syncParcelas(); recomputar(); });
    valEl.addEventListener('input', recomputar);
    rmBtn.addEventListener('click', function(){ row.remove(); recomputar(); });

    // estado inicial
    applyForma((prefill && prefill.forma) || 'pix');

    if (prefill) {
      valEl.value = prefill.valor || '';
      syncParcelas();
      var p = row.querySelector('.pag-parcelas');
      if (p && prefill.parcelas) p.value = prefill.parcelas;
    }
  }

  function lerPagamentos() {
    var rows = document.querySelectorAll('#pag-formas-list .pag-forma-item');
    var out = [];
    rows.forEach(function(r){
      var forma = r.querySelector('.pag-forma').value;
      var valor = parseFloat(String(r.querySelector('.pag-valor').value).replace(',','.'));
      if (!valor || valor <= 0) return;
      var parcelas = 1;
      var p = r.querySelector('.pag-parcelas');
      if (p) parcelas = Math.max(1, Math.min(24, parseInt(p.value, 10) || 1));
      out.push({ forma_pagamento: forma, valor: round2(valor), parcelas: parcelas });
    });
    return out;
  }

  function recomputar() {
    if (!__ctx) return;
    var pags = lerPagamentos();
    var somado = pags.reduce(function(s,p){ return s + p.valor; }, 0);
    var totalAlvo = round2((__ctx.total || 0) + (__ctx.tipAmount || 0));
    var restante = round2(totalAlvo - somado);
    var pending = restante > 0 ? restante : 0;

    // ----- Resumo financeiro (coluna direita) -----
    var base = (__ctx.baseTotal != null ? __ctx.baseTotal : __ctx.total) || 0;
    var extra = Number(__ctx.extraTotal) || 0;
    var sub = document.getElementById('pag-subtotal');
    if (sub) sub.textContent = fmtBRL(base);

    // Linha de desconto (extra negativo = desconto). Linhas POSITIVAS de extra
    // (pré-pago) NÃO viram "desconto" — mantemos o comportamento atual de
    // somar direto em "Subtotal" para não criar nova regra de negócio.
    var descRow = document.getElementById('pag-desc-row');
    var descVal = document.getElementById('pag-desc-val');
    if (descRow && descVal) {
      if (extra < 0) {
        descRow.hidden = false;
        descVal.textContent = '- ' + fmtBRL(Math.abs(extra));
      } else {
        descRow.hidden = true;
      }
    }

    var totalDisp = document.getElementById('pag-total');
    if (totalDisp) totalDisp.textContent = fmtBRL(totalAlvo);

    // Hero "VALOR PENDENTE"
    var pendingEl = document.getElementById('pag-pending-value');
    if (pendingEl) pendingEl.textContent = fmtBRL(pending);

    renderTipRow();

    // ----- Card de conferência -----
    var box = document.getElementById('pag-restante');
    var btn = document.getElementById('pag-confirmar');
    if (Math.abs(restante) < 0.01) {
      box.className = 'pag-restante ok pag-confer-card';
      box.innerHTML =
        '<div class="pag-confer-ic"><i class="fa-solid fa-circle-check"></i></div>'
      + '<div class="pag-confer-text">'
      +   '<strong>Pagamento conferido</strong>'
      +   '<span>Total informado: '+fmtBRL(somado)+'<br>Tudo certo! Você pode concluir.</span>'
      + '</div>';
      btn.disabled = pags.length === 0;
    } else if (restante > 0) {
      box.className = 'pag-restante faltando pag-confer-card';
      box.innerHTML =
        '<div class="pag-confer-ic warn"><i class="fa-solid fa-triangle-exclamation"></i></div>'
      + '<div class="pag-confer-text">'
      +   '<strong>Valor pendente</strong>'
      +   '<span>Ainda faltam '+fmtBRL(restante)+' para concluir.</span>'
      + '</div>';
      btn.disabled = true;
    } else {
      box.className = 'pag-restante excedido pag-confer-card';
      box.innerHTML =
        '<div class="pag-confer-ic warn"><i class="fa-solid fa-triangle-exclamation"></i></div>'
      + '<div class="pag-confer-text">'
      +   '<strong>Valor excedido</strong>'
      +   '<span>Excedeu em '+fmtBRL(Math.abs(restante))+'.</span>'
      + '</div>';
      btn.disabled = true;
    }
  }

  // ------------------------------------------------------------------
  // CAIXINHA / GORJETA — render da linha no resumo + modal
  // ------------------------------------------------------------------
  function renderTipRow() {
    var tip = Number(__ctx && __ctx.tipAmount) || 0;

    // ----- Linha "Caixinha" no resumo financeiro (apenas quando > 0) -----
    var resumoEl = document.querySelector('#modal-pagamento-ag .pag-resumo');
    if (resumoEl) {
      var existing = resumoEl.querySelector('.pag-tip-row');
      if (tip <= 0) {
        if (existing) existing.remove();
      } else {
        if (!existing) {
          existing = document.createElement('div');
          existing.className = 'pag-resumo-row pag-tip-row';
          var totalRow = resumoEl.querySelector('.pag-resumo-row:last-child');
          resumoEl.insertBefore(existing, totalRow);
        }
        existing.innerHTML = '<span>Caixinha</span><strong class="pag-v2-pos">+ '+fmtBRL(tip)+'</strong>';
      }
    }

    // ----- Estado do botão original (Adicionar caixinha / Caixinha adicionada + lixeira) -----
    var tipBtn = document.getElementById('pag-tip-btn');
    var label  = document.getElementById('pag-tip-btn-label');
    var wrap   = document.getElementById('pag-tip-row-wrap');
    if (!tipBtn || !wrap) return;
    var trash = wrap.querySelector('#pag-tip-remove-btn');

    if (tip > 0) {
      if (label) label.textContent = 'Caixinha adicionada';
      tipBtn.classList.add('is-active');
      if (!trash) {
        trash = document.createElement('button');
        trash.type = 'button';
        trash.id = 'pag-tip-remove-btn';
        trash.className = 'pag-action-remove';
        trash.title = 'Remover caixinha';
        trash.setAttribute('aria-label', 'Remover caixinha');
        trash.innerHTML = '<i class="fa-solid fa-trash"></i>';
        trash.addEventListener('click', function(e){
          e.preventDefault();
          e.stopPropagation();
          __ctx.tipAmount = 0;
          var first = document.querySelector('#pag-formas-list .pag-forma-item .pag-valor');
          if (first) first.value = round2(__ctx.total).toFixed(2);
          recomputar();
        });
        wrap.appendChild(trash);
      }
    } else {
      if (label) label.textContent = 'Adicionar caixinha';
      tipBtn.classList.remove('is-active');
      if (trash) trash.remove();
    }
  }

  // -------- Modal de caixinha --------
  var TIP_PRESETS = [2, 5, 10, 15];

  function ensureCaixinhaModal() {
    if (document.getElementById('modal-caixinha')) return;
    var presetsHtml = TIP_PRESETS.map(function(v){
      return '<button type="button" class="tip-preset" data-tip="'+v+'">'+fmtBRL(v).replace(/\u00a0/g,' ')+'</button>';
    }).join('');
    var html = ''
      + '<div class="modal-overlay" id="modal-caixinha">'
      +   '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="tip-title">'
      +     '<div class="modal-header">'
      +       '<h3 id="tip-title"><i class="fa-solid fa-gift" aria-hidden="true" style="color:var(--gold,#6c3aed);margin-right:6px;"></i> Adicionar caixinha</h3>'
      +       '<button type="button" class="modal-close" data-tip-close="1" aria-label="Fechar">&times;</button>'
      +     '</div>'
      +     '<div class="modal-body">'
      +       '<p class="tip-desc">Valorize o atendimento do profissional com uma caixinha.</p>'
      +       '<span class="tip-label">Sugestões de valores</span>'
      +       '<div class="tip-presets" id="tip-presets">'+presetsHtml+'</div>'
      +       '<span class="tip-label">Outro valor</span>'
      +       '<div class="tip-input-wrap">'
      +         '<span class="tip-input-prefix">R$</span>'
      +         '<input type="text" inputmode="decimal" class="tip-input" id="tip-input" placeholder="0,00" autocomplete="off">'
      +       '</div>'
      +       '<p class="tip-helper">Digite o valor que deseja adicionar como caixinha.</p>'
      +       '<div class="tip-summary" id="tip-summary">'
      +         '<div class="tip-summary-row"><span>Total do atendimento</span><strong id="tip-sum-atend">R$ 0,00</strong></div>'
      +         '<div class="tip-summary-row"><span>Caixinha</span><strong id="tip-sum-tip">R$ 0,00</strong></div>'
      +         '<div class="tip-summary-row is-total"><span>Total final</span><strong id="tip-sum-total">R$ 0,00</strong></div>'
      +       '</div>'
      +       '<div class="tip-emotional">'
      +         '<span class="tip-heart">♥</span>'
      +         '<span><strong>Obrigado por valorizar o profissional!</strong><br>Essa caixinha faz toda a diferença.</span>'
      +       '</div>'
      +     '</div>'
      +     '<div class="modal-actions">'
      +       '<button type="button" class="tip-btn-cancel" data-tip-close="1">Cancelar</button>'
      +       '<button type="button" class="tip-btn-confirm" id="tip-confirm"><i class="fa-solid fa-circle-check"></i> Adicionar caixinha</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);

    var modal = document.getElementById('modal-caixinha');
    modal.querySelectorAll('[data-tip-close]').forEach(function(b){
      b.addEventListener('click', closeCaixinhaModal);
    });
    modal.addEventListener('click', function(e){
      if (e.target === modal) closeCaixinhaModal();
    });

    var input = document.getElementById('tip-input');
    input.addEventListener('input', function(){
      var raw = input.value.replace(/[^\d,\.]/g, '').replace(/\./g, '').replace(',', '.');
      var v = parseFloat(raw);
      // Marca/desmarca preset
      modal.querySelectorAll('.tip-preset').forEach(function(b){
        b.classList.toggle('active', !isNaN(v) && Number(b.dataset.tip) === round2(v));
      });
      updateTipSummary();
    });
    input.addEventListener('blur', function(){
      var raw = input.value.replace(/[^\d,\.]/g, '').replace(/\./g, '').replace(',', '.');
      var v = parseFloat(raw);
      if (!isNaN(v) && v > 0) input.value = v.toFixed(2).replace('.', ',');
    });

    modal.querySelectorAll('.tip-preset').forEach(function(b){
      b.addEventListener('click', function(){
        var v = Number(b.dataset.tip) || 0;
        modal.querySelectorAll('.tip-preset').forEach(function(x){ x.classList.toggle('active', x === b); });
        input.value = v.toFixed(2).replace('.', ',');
        updateTipSummary();
      });
    });

    document.getElementById('tip-confirm').addEventListener('click', confirmarCaixinha);
  }

  function readTipInput() {
    var input = document.getElementById('tip-input');
    if (!input) return 0;
    var raw = String(input.value || '').replace(/[^\d,\.]/g, '').replace(/\./g, '').replace(',', '.');
    var v = parseFloat(raw);
    return isNaN(v) ? 0 : round2(v);
  }

  function updateTipSummary() {
    if (!__ctx) return;
    var atend = round2(__ctx.total || 0);
    var tip = readTipInput();
    var total = round2(atend + (tip > 0 ? tip : 0));
    var elA = document.getElementById('tip-sum-atend');
    var elT = document.getElementById('tip-sum-tip');
    var elF = document.getElementById('tip-sum-total');
    if (elA) elA.textContent = fmtBRL(atend);
    if (elT) elT.textContent = fmtBRL(tip > 0 ? tip : 0);
    if (elF) elF.textContent = fmtBRL(total);
    var btn = document.getElementById('tip-confirm');
    if (btn) btn.disabled = !(tip > 0);
  }

  function abrirModalCaixinha() {
    if (!__ctx) return;
    ensureCaixinhaModal();
    var modal = document.getElementById('modal-caixinha');
    var input = document.getElementById('tip-input');
    var existing = Number(__ctx.tipAmount) || 0;
    input.value = existing > 0 ? existing.toFixed(2).replace('.', ',') : '';
    modal.querySelectorAll('.tip-preset').forEach(function(b){
      b.classList.toggle('active', existing > 0 && Number(b.dataset.tip) === existing);
    });
    updateTipSummary();
    modal.classList.add('active');
    modal.style.display = 'flex';
    setTimeout(function(){ try { input.focus(); } catch(_){} }, 50);
  }

  function closeCaixinhaModal() {
    var modal = document.getElementById('modal-caixinha');
    if (!modal) return;
    modal.classList.remove('active');
    modal.style.display = 'none';
  }

  function confirmarCaixinha() {
    if (!__ctx) return;
    var tip = readTipInput();
    if (!(tip > 0)) return;
    var prevTip = Number(__ctx.tipAmount) || 0;
    __ctx.tipAmount = tip;
    // Auto-ajusta 1ª linha de pagamento para casar com o novo total
    var firstVal = document.querySelector('#pag-formas-list .pag-forma-item .pag-valor');
    if (firstVal) {
      var atual = parseFloat(String(firstVal.value).replace(',', '.')) || 0;
      var totalAlvo = round2((__ctx.total || 0) + tip);
      // Soma de todas as outras linhas
      var rows = document.querySelectorAll('#pag-formas-list .pag-forma-item');
      var outras = 0;
      rows.forEach(function(r, idx){
        if (idx === 0) return;
        var v = parseFloat(String(r.querySelector('.pag-valor').value).replace(',', '.')) || 0;
        outras += v;
      });
      var novo = round2(totalAlvo - outras);
      if (novo > 0) firstVal.value = novo.toFixed(2);
    }
    closeCaixinhaModal();
    recomputar();
    if (typeof window.showToast === 'function') {
      window.showToast(prevTip > 0 ? 'Caixinha atualizada' : 'Caixinha adicionada');
    }
  }

  // ------------------------------------------------------------------
  // Persistência
  // ------------------------------------------------------------------
  async function salvarPagamentos(agId, pagamentos) {
    var sb = getSb(); var tenantId = getTenantId();
    if (!sb || !tenantId) throw new Error('Supabase/tenant indisponível');
    var tip = Number(__ctx && __ctx.tipAmount) || 0;
    // v16: persiste DESCONTO na mesma observacao. O modal de desconto chama
    // __pagSetExtraTotal(-N) → __ctx.extraTotal = -N. Aqui materializamos
    // esse desconto como marcador DESCONTO:<valor> em agendamento_pagamentos.
    // Assim a reidratação no dashboard (desconto-financeiro.js v5 e
    // comissoes-desconto.js) lê desconto e caixinha da MESMA fonte —
    // nunca mais heurística, nunca mais estado só-em-memória.
    var extra = Number(__ctx && __ctx.extraTotal) || 0;
    var desc  = extra < 0 ? Math.abs(extra) : 0;
    var rows = pagamentos.map(function(p, idx){
      var row = {
        tenant_id: tenantId,
        agendamento_id: agId,
        forma_pagamento: p.forma_pagamento,
        valor: p.valor,
        parcelas: p.parcelas || 1
      };
      // Marca metadados de caixinha + desconto na 1ª linha (sem alterar schema)
      if (idx === 0) {
        var marks = [];
        if (tip > 0)  marks.push('CAIXINHA:' + tip.toFixed(2));
        if (desc > 0) marks.push('DESCONTO:' + desc.toFixed(2));
        if (marks.length) row.observacao = marks.join(' ');
      }
      return row;
    });
    var resp = await sb.from('agendamento_pagamentos').insert(rows);
    if (resp.error) throw resp.error;
  }

  async function carregarPagamentos(agId) {
    var sb = getSb(); if (!sb) return [];
    var resp = await sb.from('agendamento_pagamentos')
      .select('id, forma_pagamento, valor, parcelas, created_at')
      .eq('agendamento_id', agId)
      .order('created_at', { ascending: true });
    if (resp.error) { console.warn('[pag] load', resp.error); return []; }
    return resp.data || [];
  }

  async function removerPagamentosDoAgendamento(agId) {
    var sb = getSb(); if (!sb) return;
    await sb.from('agendamento_pagamentos').delete().eq('agendamento_id', agId);
    delete __pagResumoCache[agId];
  }

  async function atualizarResumoFinanceiroAgendamento(agId, totalPago, totalEsperado) {
    var sb = getSb();
    if (!sb || !agId) return;
    var status = Math.abs((Number(totalPago)||0) - (Number(totalEsperado)||0)) < 0.01 ? 'pago' : ((Number(totalPago)||0) > 0 ? 'parcial' : 'pendente');
    var variants = [
      { valor_total_pago: round2(totalPago), status_pagamento: status, possui_pagamento: (Number(totalPago)||0) > 0 },
      { valor_total_pago: round2(totalPago), status_pagamento: status },
      { status_pagamento: status },
      { valor_total_pago: round2(totalPago) }
    ];
    var lastErr = null;
    for (var i = 0; i < variants.length; i++) {
      try {
        var r = await sb.from('agendamentos').update(variants[i]).eq('id', agId);
        if (!r.error) return;
        lastErr = r.error;
      } catch(e) { lastErr = e; }
    }
    if (lastErr) console.warn('[pag] não atualizou resumo em agendamentos (badge usa cache):', lastErr);
  }

  // ------------------------------------------------------------------
  // Confirmar
  // ------------------------------------------------------------------
  async function onConfirmar() {
    if (!__ctx) return;
    var pags = lerPagamentos();
    var somado = pags.reduce(function(s,p){ return s + p.valor; }, 0);
    var totalAlvo = round2((__ctx.total || 0) + (Number(__ctx.tipAmount)||0));
    if (Math.abs(somado - totalAlvo) >= 0.01) return;

    var btn = document.getElementById('pag-confirmar');
    btn.disabled = true;
    var labEl = document.getElementById('pag-confirmar-label');
    var origLabel = labEl.textContent;
    labEl.textContent = 'Salvando...';

    try {
      if (__ctx.mode === 'registrar') {
        await removerPagamentosDoAgendamento(__ctx.agendamentoId);
      }
      await salvarPagamentos(__ctx.agendamentoId, pags);
      __pagResumoCache[__ctx.agendamentoId] = { valor: round2(somado), qtd: pags.length };
      try {
        var agLocal = (window.appointments || []).find(function(x){ return x.id === __ctx.agendamentoId; });
        if (agLocal) {
          agLocal.valor_total_pago = round2(somado);
          agLocal.possui_pagamento = pags.length > 0;
          agLocal.status_pagamento = Math.abs(somado - totalAlvo) < 0.01 ? 'pago' : 'parcial';
          agLocal.tip_amount = Number(__ctx.tipAmount) || 0;
        }
      } catch(_){}
      try { await atualizarResumoFinanceiroAgendamento(__ctx.agendamentoId, somado, totalAlvo); } catch(_){}

      // 🔧 v7: hook síncrono para add-ons (pré-pago) — roda ANTES do close,
      // garantindo que a criação do próximo agendamento não dependa do
      // MutationObserver do fechamento do modal.
      try {
        var ctxSnap = {
          agendamentoId: __ctx.agendamentoId,
          total: totalAlvo,
          serviceAmount: round2(__ctx.total || 0),
          tipAmount: round2(__ctx.tipAmount || 0),
          totalAmount: round2(totalAlvo),
          baseTotal: __ctx.baseTotal,
          extraTotal: __ctx.extraTotal,
          mode: __ctx.mode,
          pagamentos: pags
        };
        var hooks = window.__pagAfterSaveHooks || [];
        for (var i = 0; i < hooks.length; i++) {
          try { await hooks[i](ctxSnap); } catch(eh){ console.error('[pag][afterSaveHook]', eh); }
        }
      } catch(eh){ console.error('[pag][afterSave]', eh); }

      var cb = __ctx.onSuccess;
      closePagModal();

      if (typeof cb === 'function') {
        try { await cb(); } catch(e){ console.error(e); }
      }
      if (typeof window.showToast === 'function') {
        window.showToast('Pagamento registrado com sucesso');
      }
      try { if (typeof window.loadAppointments === 'function') await window.loadAppointments(); } catch(_){}
      try { if (typeof window.renderDayDetail === 'function') window.renderDayDetail(); } catch(_){}
      try { if (typeof window.__rodarDashboardPagamentos === 'function') await window.__rodarDashboardPagamentos(); } catch(_){}
    } catch(e) {
      console.error('[pag][confirmar]', e);
      if (typeof window.showToast === 'function') window.showToast('Erro ao salvar pagamento.');
      btn.disabled = false;
      labEl.textContent = origLabel;
    }
  }

  // API pública para add-ons registrarem hooks de pós-save
  window.__pagAfterSaveHooks = window.__pagAfterSaveHooks || [];
  window.__pagRegisterAfterSave = function(fn){
    if (typeof fn !== 'function') return;
    if (window.__pagAfterSaveHooks.indexOf(fn) < 0) window.__pagAfterSaveHooks.push(fn);
  };

  // ------------------------------------------------------------------
  // Abrir modal
  // ------------------------------------------------------------------
  async function abrirModalPagamento(opts) {
    ensureModal();
    var ag = (window.appointments || []).find(function(x){ return x.id === opts.agendamentoId; });
    if (!ag) { console.warn('[pag] agendamento não encontrado', opts.agendamentoId); return; }

    var total = round2(opts.total != null ? opts.total : calcularValorTotalAgendamento(ag));
    __ctx = {
      agendamentoId: opts.agendamentoId,
      total: total,
      baseTotal: total,   // total original do atendimento (sem pré-pago)
      extraTotal: 0,      // extra do pré-pago (próximo agendamento)
      tipAmount: 0,       // 🎁 caixinha (gorjeta)
      mode: opts.mode || 'concluir',
      onSuccess: opts.onSuccess || null
    };

    document.getElementById('pag-cliente').textContent = ag.cliente_nome || ag.nome_cliente || ag.nomeCliente || ag.cliente_name || (ag.cliente && (ag.cliente.nome || ag.cliente.name)) || (typeof ag.cliente === 'string' ? ag.cliente : '') || ag.nome || '—';
    document.getElementById('pag-data').textContent =
      (ag.data ? ag.data.split('-').reverse().join('/') : '') + ' · ' + (ag.hora || '').slice(0,5);
    document.getElementById('pag-total').textContent = fmtBRL(total);
    // (Layout v2) — a linha do resumo já tem rótulo "TOTAL" fixo.
    document.getElementById('pag-confirmar-label').textContent =
      __ctx.mode === 'concluir' ? 'Confirmar e concluir' : 'Salvar pagamento';

    var list = document.getElementById('pag-formas-list');
    list.innerHTML = '';

    if (__ctx.mode === 'registrar') {
      var existentes = await carregarPagamentos(opts.agendamentoId);
      // Detectar caixinha já registrada (CAIXINHA:X.XX em observacao)
      try {
        var sb2 = getSb();
        if (sb2 && existentes.length) {
          var idsObs = existentes.map(function(p){ return p.id; });
          var rObs = await sb2.from('agendamento_pagamentos').select('id, observacao').in('id', idsObs);
          var byId = {};
          (rObs.data || []).forEach(function(r){ byId[r.id] = r.observacao || ''; });
          var tipDetect = 0;
          existentes.forEach(function(p){
            var obs = byId[p.id] || '';
            var m = /CAIXINHA:([\d\.]+)/i.exec(obs);
            if (m) tipDetect += parseFloat(m[1]) || 0;
          });
          if (tipDetect > 0) __ctx.tipAmount = round2(tipDetect);
        }
      } catch(_){}
      if (existentes.length > 0) {
        existentes.forEach(function(p){
          addLinhaPagamento({ forma: p.forma_pagamento, valor: p.valor, parcelas: p.parcelas });
        });
      } else {
        addLinhaPagamento({ forma: 'pix', valor: '' });
      }
    } else {
      addLinhaPagamento({ forma: 'pix', valor: '' });
    }

    openPagModal();
    recomputar();
  }

  // ------------------------------------------------------------------
  // INTERCEPTA conclusão manual
  // ------------------------------------------------------------------
  function instalarInterceptorConclusao() {
    var tries = 0;
    var iv = setInterval(function(){
      if (typeof window.confirmarConcluirAtendimento === 'function' && !window.confirmarConcluirAtendimento.__pagWrapped) {
        clearInterval(iv);
        var original = window.confirmarConcluirAtendimento;
        var wrapper = async function() {
          try {
            var agId = window.editingAppointmentId;
            if (!agId) return original.apply(this, arguments);
            var ag = (window.appointments || []).find(function(x){ return x.id === agId; });
            if (!ag) return original.apply(this, arguments);

            // 🔧 PRÉ-PAGO v5: agendamento criado como pré-pago já pago → não cobra de novo.
            if (isPrepaidPaid(ag)) {
              console.log('[pag] pré-pago detectado — pulando modal de cobrança');
              return original.apply(this, arguments);
            }

            var total = calcularValorTotalAgendamento(ag);
            var temVenda = possuiVendaFinanceira(ag);
            console.log('[pag] conclusão manual — temVenda:', temVenda,
                        '| total:', total,
                        '| venda_pacote:', possuiVendaPacote(ag),
                        '| servico_pago:', possuiServicoPago(ag),
                        '| produtos:', possuiProdutosVendidos(ag));

            // REGRA PRINCIPAL (fluxogramas 1 e 2):
            // Só abre modal se EXISTIR venda financeira. Uso/consumo de
            // pacote nunca abre modal e nunca gera recebimento.
            if (!temVenda || !total || total <= 0) {
              return original.apply(this, arguments);
            }


            // Já tem pagamentos integrais? Segue direto
            var jaPagos = await carregarPagamentos(agId);
            var somado = jaPagos.reduce(function(s,p){ return s + Number(p.valor); }, 0);
            if (somado + 0.01 >= total) return original.apply(this, arguments);

            // Fecha o modal de confirmação e abre o de pagamento
            try { if (typeof window.closeModal === 'function') window.closeModal('modal-concluir-atendimento'); } catch(_){}

            return abrirModalPagamento({
              agendamentoId: agId,
              total: total,
              mode: 'concluir',
              onSuccess: async function(){
                // Após salvar pagamento, executa a conclusão original
                await original.call(window);
              }
            });
          } catch (err) {
            console.error('[pag][interceptor] erro — caindo p/ conclusão original:', err);
            return original.apply(this, arguments);
          }
        };
        wrapper.__pagWrapped = true;
        window.confirmarConcluirAtendimento = wrapper;
        console.log('[pag] interceptor de conclusão manual instalado');
      } else if (++tries > 50) {
        clearInterval(iv);
        console.warn('[pag] confirmarConcluirAtendimento não encontrado');
      }
    }, 200);
  }

  // ------------------------------------------------------------------
  // Botão "Registrar pagamento" + auto-hide do "Concluir" em auto-concluídos
  // ------------------------------------------------------------------
  function isConcluido(ag) {
    if (!ag) return false;
    var st = String(ag.status || '').toLowerCase();
    if (st === 'concluido' || st === 'concluído') return true;
    if (typeof window.isAppointmentAutoCompleted === 'function') {
      try { return !!window.isAppointmentAutoCompleted(ag); } catch(_){}
    }
    return false;
  }

  function injetarBotaoRegistrarPagamento() {
    var modalAg = document.getElementById('modal-agendamento');
    if (!modalAg) return;
    if (document.getElementById('btn-registrar-pagamento')) return;

    var anchor = document.getElementById('btn-concluir-atendimento') || modalAg.querySelector('.modal-actions, .modal-footer');
    if (!anchor) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btn-registrar-pagamento';
    btn.className = 'btn-registrar-pagamento';
    btn.style.display = 'none';
    btn.innerHTML = '<i class="fa-solid fa-money-bill-wave"></i> <span>Registrar pagamento</span>';
    if (anchor.id === 'btn-concluir-atendimento') {
      anchor.parentNode.insertBefore(btn, anchor);
    } else {
      anchor.appendChild(btn);
    }

    btn.addEventListener('click', function(){
      var agId = window.editingAppointmentId;
      if (!agId) return;
      var ag = (window.appointments || []).find(function(x){ return x.id === agId; });
      if (!ag) return;
      abrirModalPagamento({
        agendamentoId: agId,
        total: calcularValorTotalAgendamento(ag),
        mode: 'registrar'
      });
    });

    var btnConcluir = document.getElementById('btn-concluir-atendimento');

    var mo = new MutationObserver(function(){
      var aberto = (modalAg.classList && modalAg.classList.contains('active')) ||
                   (modalAg.style.display && modalAg.style.display !== 'none');
      if (!aberto) { btn.style.display = 'none'; return; }
      var agId = window.editingAppointmentId;
      var ag = (window.appointments || []).find(function(x){ return x.id === agId; });
      if (!ag) { btn.style.display = 'none'; return; }

      var concluido = isConcluido(ag);
      var total = calcularValorTotalAgendamento(ag);
      var pago  = Number(ag.valor_total_pago) || 0;
      var falta = total > 0 && (pago + 0.01 < total);

      // FIX: esconde "Concluir atendimento" também em auto-concluídos
      if (btnConcluir && concluido) {
        btnConcluir.style.display = 'none';
      }

      // 🔧 PRÉ-PAGO v5: pré-pago já pago não precisa de botão de cobrança
      var ehPrepaidPago = isPrepaidPaid(ag);

      var label = (pago > 0) ? 'Editar pagamento' : 'Registrar pagamento';
      btn.querySelector('span').textContent = label;
      btn.style.display = (concluido && falta && !ehPrepaidPago) ? 'inline-flex' : 'none';
    });
    mo.observe(modalAg, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  // ------------------------------------------------------------------
  // Badge de status de pagamento nos cards do dia
  // ------------------------------------------------------------------
  function injetarBadgesNosCards() {
    if (!Array.isArray(window.appointments)) return;
    var cards = document.querySelectorAll('#day-appointments [data-appointment-id], #day-appointments .appointment-card');
    var idsParaCarregar = [];
    cards.forEach(function(card){
      var agId = card.getAttribute('data-appointment-id') || (card.dataset && (card.dataset.appointmentId || card.dataset.id));
      if (!agId) return;
      var ag = window.appointments.find(function(x){ return x.id === agId; });
      if (!ag) return;
      // Remove badges anteriores SEMPRE (evita "fantasmas" após pagamento)
      card.querySelectorAll('.pag-badge-pendente,.pag-badge-pago,.pag-badge-parcial').forEach(function(b){ b.remove(); });

      // Pré-pago usa badge próprio. Não misturar com pendente/pago/parcial.
      if (ag.prepaid === true) return;

      if (!isConcluido(ag)) return;
      var total = calcularValorTotalAgendamento(ag);
      if (total <= 0) return;

      var resumo = getResumoPagamento(ag);
      if (!resumo.cacheLoaded && !resumo.temDenorm) {
        idsParaCarregar.push(agId);
        return;
      }

      var pago = round2(resumo.pago);
      var possuiPag = resumo.possui;
      var st = resumo.status;
      var sp;
      if (st === 'pago' || (pago > 0 && pago + 0.01 >= total)) {
        sp = 'pago';
      } else if (st === 'parcial' || (possuiPag && pago > 0 && pago < total)) {
        sp = 'parcial';
      } else if (possuiPag && pago <= 0) {
        // Há registro, mas o valor não veio agregado: nunca mostrar pendente falso.
        sp = 'pago';
      } else {
        sp = 'pendente';
      }

      var badge = document.createElement('span');
      if (sp === 'pago') {
        badge.className = 'pag-badge-pago';
        badge.innerHTML = '<i class="fa-solid fa-check"></i> Pago';
      } else if (sp === 'parcial') {
        badge.className = 'pag-badge-parcial';
        badge.innerHTML = '<i class="fa-solid fa-circle-half-stroke"></i> Parcial';
      } else {
        badge.className = 'pag-badge-pendente';
        badge.innerHTML = '<i class="fa-solid fa-clock"></i> Pagamento pendente';
      }
      var anchor = card.querySelector('.appointment-status, .status-badge, .appointment-header, .card-header, .tb-time') || card;
      anchor.appendChild(badge);
    });
    if (idsParaCarregar.length) {
      carregarResumoPagamentos(idsParaCarregar).then(function(){
        setTimeout(injetarBadgesNosCards, 0);
      });
    }
  }

  function instalarObserverDayDetail() {
    var host = document.getElementById('day-appointments');
    if (!host) { setTimeout(instalarObserverDayDetail, 500); return; }
    var mo = new MutationObserver(function(){
      clearTimeout(window.__pagBadgeTO);
      window.__pagBadgeTO = setTimeout(injetarBadgesNosCards, 80);
    });
    mo.observe(host, { childList: true, subtree: true });
    injetarBadgesNosCards();
  }

  // ------------------------------------------------------------------
  // Hook público p/ add-on de pré-pago: bumpa o total do modal aberto.
  // Chamado pelo agendamento-prepago.js quando o usuário marca/altera o
  // valor do próximo agendamento pré-pago.
  // ------------------------------------------------------------------
  window.__pagSetExtraTotal = function (extra) {
    if (!__ctx) return false;
    var ex = round2(Number(extra) || 0);
    var base = __ctx.baseTotal != null ? __ctx.baseTotal : __ctx.total;
    if (__ctx.baseTotal == null) __ctx.baseTotal = base;
    __ctx.extraTotal = ex;
    __ctx.total = round2(__ctx.baseTotal + ex);
    var t = document.getElementById('pag-total');
    if (t) t.textContent = fmtBRL(__ctx.total);
    // Auto-ajusta o valor da PRIMEIRA linha de pagamento para casar
    var firstVal = document.querySelector('#pag-formas-list .pag-forma-item .pag-valor');
    if (firstVal) firstVal.value = __ctx.total.toFixed(2);
    recomputar();
    return true;
  };
  window.__pagGetCtx = function () {
    if (!__ctx) return null;
    return { agendamentoId: __ctx.agendamentoId, total: __ctx.total,
             baseTotal: __ctx.baseTotal, extraTotal: __ctx.extraTotal, mode: __ctx.mode };
  };

  // Boot
  function boot() {
    instalarInterceptorConclusao();
    injetarBotaoRegistrarPagamento();
    instalarObserverDayDetail();
    instalarHookDashboardCaixinha();
  }

  // ------------------------------------------------------------------
  // DASHBOARD — soma das caixinhas no Faturamento Total
  // Lê agendamento_pagamentos.observacao = "CAIXINHA:X.XX" dos agendamentos
  // CONCLUÍDOS no range filtrado e acrescenta ao card "Faturamento Total".
  // Também recalcula o Ticket Médio para refletir o novo total.
  // ------------------------------------------------------------------
  // v13 — instrumentação ampla para rastrear quem reaplica a caixinha.
  var __pagDashTipBootTs = Date.now();
  function dashTipElapsed(){
    return ((Date.now() - __pagDashTipBootTs) / 1000).toFixed(3) + 's';
  }
  function dashTipNowIso(){
    try { return new Date().toISOString(); } catch(_) { return String(Date.now()); }
  }
  function dashTipStack(skip){
    var st = '';
    try { throw new Error('dash-tip-trace'); } catch (e) { st = String((e && e.stack) || ''); }
    if (!skip) return st;
    var lines = st.split('\n');
    return [lines[0]].concat(lines.slice(1 + skip)).join('\n');
  }
  function dashTipOriginFromStack(stack){
    var lines = String(stack || '').split('\n').map(function(line){ return String(line || '').trim(); }).filter(Boolean);
    var firstPag = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('at ') !== 0) continue;
      if (/dashTip(Elapsed|NowIso|Stack|OriginFromStack|KpiSnapshot|Log|CaptureMeta|InstallKpiSetterTrace)/.test(line)) continue;
      if (line.indexOf('pagamentos.js') >= 0) {
        if (!firstPag) firstPag = line;
        continue;
      }
      return line;
    }
    return firstPag || lines[1] || lines[0] || '(sem stack)';
  }
  function dashTipKpiSnapshot(){
    var fatEl = document.getElementById('dash-faturamento');
    var tickEl = document.getElementById('dash-ticket');
    var totAgEl = document.getElementById('dash-total-ag');
    return {
      faturamento: fatEl ? fatEl.textContent : null,
      ticket: tickEl ? tickEl.textContent : null,
      totalAg: totAgEl ? totAgEl.textContent : null,
      baseFat: fatEl ? (fatEl.dataset.baseFat || null) : null,
      tipSum: fatEl ? (fatEl.dataset.tipSum || null) : null,
      prodSum: fatEl ? (fatEl.dataset.prodSum || null) : null,
      filtrosAplicados: (typeof window.filtrosAplicados !== 'undefined' && window.filtrosAplicados)
        ? {
            dataInicio: window.filtrosAplicados.dataInicio || null,
            dataFim: window.filtrosAplicados.dataFim || null,
            profissionalId: window.filtrosAplicados.profissionalId || null
          }
        : null
    };
  }
  function dashTipLog(evento, payload){
    var data = {
      ts: dashTipNowIso(),
      elapsed: dashTipElapsed(),
      evento: evento
    };
    if (payload && typeof payload === 'object') {
      Object.keys(payload).forEach(function(k){ data[k] = payload[k]; });
    }
    try { console.log('[pag][dash-tip][trace]', data); } catch(_) {}
  }
  function dashTipCaptureMeta(source, extra){
    var stack = dashTipStack(1);
    var meta = {
      source: source || 'desconhecida',
      origin: dashTipOriginFromStack(stack),
      stackTrace: stack,
      capturedAt: dashTipNowIso(),
      elapsed: dashTipElapsed()
    };
    if (extra && typeof extra === 'object') {
      Object.keys(extra).forEach(function(k){ meta[k] = extra[k]; });
    }
    return meta;
  }
  function dashTipInstallKpiSetterTrace(){
    if (window.__pagDashTipKpiSetterInstalled) return;
    var desc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    if (!desc || typeof desc.get !== 'function' || typeof desc.set !== 'function') {
      dashTipLog('boot:kpi-setter-unavailable', {});
      return;
    }
    var alvoIds = { 'dash-ticket': true, 'dash-faturamento': true, 'dash-total-ag': true };
    Object.defineProperty(Node.prototype, 'textContent', {
      configurable: true,
      enumerable: desc.enumerable,
      get: function(){
        return desc.get.call(this);
      },
      set: function(v){
        var isTarget = !!(this && this.nodeType === 1 && this.id && alvoIds[this.id]);
        var prev = isTarget ? desc.get.call(this) : undefined;
        var stack = isTarget ? dashTipStack(1) : '';
        var origin = isTarget ? dashTipOriginFromStack(stack) : '';
        if (isTarget) {
          window.__pagDashTipKpiWriteSeq = (window.__pagDashTipKpiWriteSeq || 0) + 1;
          if (this.id === 'dash-faturamento') {
            window.__pagDashTipFatWriteSeq = (window.__pagDashTipFatWriteSeq || 0) + 1;
          }
          dashTipLog('kpi-write:before', {
            kpi: this.id,
            previousValue: prev,
            nextValue: String(v),
            origin: origin,
            stackTrace: stack,
            activeSource: window.__pagDashTipActiveSource || null,
            writeSeq: window.__pagDashTipKpiWriteSeq || 0,
            fatWriteSeq: window.__pagDashTipFatWriteSeq || 0,
            snapshot: dashTipKpiSnapshot()
          });
        }
        var ret = desc.set.call(this, v);
        if (isTarget) {
          dashTipLog('kpi-write:after', {
            kpi: this.id,
            previousValue: prev,
            nextValue: desc.get.call(this),
            origin: origin,
            stackTrace: stack,
            activeSource: window.__pagDashTipActiveSource || null,
            snapshot: dashTipKpiSnapshot()
          });
        }
        return ret;
      }
    });
    window.__pagDashTipKpiSetterInstalled = true;
    dashTipLog('boot:kpi-setter-installed', { origin: 'Node.prototype.textContent' });
  }

  // v12 — SEM MutationObserver (causava acumulação +10/+10 em race).
  // Estratégia idempotente baseada em dataset.baseFat (valor SEM caixinha
  // capturado após o original do loadDashboard rodar). Cada apply
  // recalcula novo = baseFat + caixinha, então N chamadas produzem o
  // mesmo resultado — independente do que o realtime/products faça no meio.
  function instalarHookDashboardCaixinha() {
    dashTipInstallKpiSetterTrace();
    var tries = 0;
    var iv = setInterval(function(){
      if (typeof window.loadDashboard === 'function' && !window.loadDashboard.__pagTipWrapped) {
        clearInterval(iv);
        var original = window.loadDashboard;

        // Fila serial: garante que cliques rápidos no "Aplicar" não
        // sobreponham execuções e causem oscilação dos valores.
        var queueTail = Promise.resolve();
        var wrapped = function(){
          var self = this, args = arguments;
          var run = async function(){
            var callMeta = dashTipCaptureMeta('window.loadDashboard wrapped');
            window.__pagDashTipActiveSource = callMeta.origin;
            dashTipLog('loadDashboard:wrapped:start', {
              source: callMeta.source,
              origin: callMeta.origin,
              stackTrace: callMeta.stackTrace,
              snapshot: dashTipKpiSnapshot()
            });
            var resumo = { total: 0, porProf: {} };
            try {
              resumo = await calcularResumoCaixinhasDashboard(callMeta);
              dashTipLog('loadDashboard:wrapped:resumo', {
                source: callMeta.source,
                origin: callMeta.origin,
                resumoTotal: resumo && resumo.total,
                resumoPorProfKeys: resumo && resumo.porProf ? Object.keys(resumo.porProf) : [],
                snapshot: dashTipKpiSnapshot()
              });
            }
            catch(e){ console.warn('[pag][dash-tip] calcular resumo', e); }

            // v18 — NÃO zerar tipSum antes do original.
            // O bug regressivo acontecia quando loadDashboard era chamado por
            // polling/debug/realtime, mas o original não reescrevia os KPIs
            // (ex.: retorno 300/early-return). Como v17 zerava tipSum antes,
            // a aplicação seguinte via o display já com caixinha como se fosse
            // base limpa: 90 -> +10 = 100 -> +10 = 110...
            // Agora preservamos a caixinha anterior até saber se o original
            // realmente tocou em #dash-faturamento.
            var fatPre = document.getElementById('dash-faturamento');
            var fatBeforeOriginal = fatPre ? parseMoneyText(fatPre.textContent) : 0;
            var tipBeforeOriginal = fatPre ? (parseFloat(fatPre.dataset.tipSum || '0') || 0) : 0;
            var fatWriteSeqBefore = window.__pagDashTipFatWriteSeq || 0;
            if (fatPre) {
              dashTipLog('loadDashboard:wrapped:pre-state', {
                source: callMeta.source,
                origin: callMeta.origin,
                fatBeforeOriginal: fatBeforeOriginal,
                tipBeforeOriginal: tipBeforeOriginal,
                fatWriteSeqBefore: fatWriteSeqBefore,
                snapshot: dashTipKpiSnapshot()
              });
            }

            var ret;
            try {
              ret = await original.apply(self, args);
              dashTipLog('loadDashboard:wrapped:after-original', {
                source: callMeta.source,
                origin: callMeta.origin,
                snapshot: dashTipKpiSnapshot()
              });
            }
            catch(e){ console.warn('[pag][dash-tip] original loadDashboard', e); throw e; }

            // Decide a base de forma segura:
            // - se o original REESCREVEU #dash-faturamento, o texto atual é a
            //   base limpa e tipSum deve voltar a 0;
            // - se o original NÃO reescreveu, o texto atual ainda contém a
            //   caixinha anterior e tipSum precisa ser preservado para que
            //   aplicarResumoCaixinhaNoDOM subtraia antes de reaplicar.
            var fatPost = document.getElementById('dash-faturamento');
            if (fatPost) {
              var fatWriteSeqAfter = window.__pagDashTipFatWriteSeq || 0;
              var fatAfterOriginal = parseMoneyText(fatPost.textContent);
              var originalTocouFaturamento = fatWriteSeqAfter !== fatWriteSeqBefore;
              if (!originalTocouFaturamento && Math.abs(fatAfterOriginal - fatBeforeOriginal) > 0.005) {
                originalTocouFaturamento = true;
              }
              if (originalTocouFaturamento) {
                fatPost.dataset.tipSum = '0';
                fatPost.dataset.baseFat = String(fatAfterOriginal);
              } else {
                fatPost.dataset.tipSum = String(tipBeforeOriginal);
                fatPost.dataset.baseFat = String(Math.max(0, round2(fatAfterOriginal - tipBeforeOriginal)));
              }
              dashTipLog('loadDashboard:wrapped:base-captured-v18', {
                source: callMeta.source,
                origin: callMeta.origin,
                originalTocouFaturamento: originalTocouFaturamento,
                fatWriteSeqBefore: fatWriteSeqBefore,
                fatWriteSeqAfter: fatWriteSeqAfter,
                fatBeforeOriginal: fatBeforeOriginal,
                fatAfterOriginal: fatAfterOriginal,
                tipBeforeOriginal: tipBeforeOriginal,
                baseFat: fatPost.dataset.baseFat,
                tipSumPreservadoParaApply: fatPost.dataset.tipSum,
                snapshot: dashTipKpiSnapshot()
              });
            }

            try { aplicarResumoCaixinhaNoDOM(resumo, false, callMeta); }
            catch(e){ console.warn('[pag][dash-tip] apply', e); }
            dashTipLog('loadDashboard:wrapped:end', {
              source: callMeta.source,
              origin: callMeta.origin,
              snapshot: dashTipKpiSnapshot()
            });
            window.__pagDashTipActiveSource = null;
            return ret;
          };
          var p = queueTail.then(run, run);
          queueTail = p.catch(function(){});
          return p;
        };
        wrapped.__pagTipWrapped = true;
        window.loadDashboard = wrapped;
        console.log('[pag] hook de caixinha no dashboard instalado (v18 — preserva tipSum quando loadDashboard não reescreve KPI)');
        dashTipLog('boot:hook-installed', { source: 'instalarHookDashboardCaixinha', snapshot: dashTipKpiSnapshot() });
      } else if (++tries > 50) {
        clearInterval(iv);
        dashTipLog('boot:hook-timeout', { tries: tries });
      }
    }, 200);
  }

  function parseMoneyText(txt){
    var s = String(txt || '').replace(/[^\d,.-]/g, '').replace(/\./g,'').replace(',', '.');
    var v = parseFloat(s);
    return isNaN(v) ? 0 : v;
  }

  async function calcularResumoCaixinhasDashboard(callMeta){
    var sb = getSb(); var tenantId = getTenantId();
    var vazio = { total: 0, porProf: {} };
    if (!sb || !tenantId) return vazio;
    if (!Array.isArray(window.appointments)) return vazio;

    // Range filtrado pelo dashboard (mesma lógica do hook de produtos)
    var range = (typeof window.getCalendarVisibleDateRange === 'function')
      ? window.getCalendarVisibleDateRange() : null;
    var fIni = (typeof window.filtrosAplicados !== 'undefined' && window.filtrosAplicados && window.filtrosAplicados.dataInicio)
      ? window.filtrosAplicados.dataInicio : (range ? range.start : null);
    var fFim = (typeof window.filtrosAplicados !== 'undefined' && window.filtrosAplicados && window.filtrosAplicados.dataFim)
      ? window.filtrosAplicados.dataFim : (range ? range.end : null);

    // Filtra agendamentos: dentro do range, NÃO cancelados, concluídos.
    // Usamos um Set para garantir unicidade (defesa contra duplicatas em
    // window.appointments que dobrariam o sum por reentrância).
    var idsSet = Object.create(null);
    window.appointments.forEach(function(a){
      if (!a || !a.id) return;
      if (typeof window.isAppointmentCancelled === 'function' && window.isAppointmentCancelled(a)) return;
      if (typeof window.isAppointmentAutoCompleted === 'function' && !window.isAppointmentAutoCompleted(a)) return;
      if (fIni && fFim && a.data) {
        if (a.data < fIni || a.data > fFim) return;
      }
      idsSet[a.id] = true;
    });
    var idsValidos = Object.keys(idsSet);
    if (!idsValidos.length) return vazio;
    dashTipLog('resumo:ids-validos', {
      source: callMeta && callMeta.source,
      origin: callMeta && callMeta.origin,
      qtdAgendamentos: idsValidos.length,
      agendamentoIds: idsValidos,
      snapshot: dashTipKpiSnapshot()
    });

    // Busca observacoes em lote — dedup por id de pagamento, defesa contra
    // qualquer eventual duplicata vinda do banco/realtime.
    var totalCaixinha = 0;
    var tipPorAgendamento = {};
    var seenPagId = Object.create(null);
    try {
      var chunk = 500;
      for (var i = 0; i < idsValidos.length; i += chunk) {
        var slice = idsValidos.slice(i, i + chunk);
        var resp = await sb.from('agendamento_pagamentos')
          .select('id, agendamento_id, observacao')
          .in('agendamento_id', slice)
          .eq('tenant_id', tenantId);
        if (resp.error) throw resp.error;
        dashTipLog('resumo:pagamentos-lote', {
          source: callMeta && callMeta.source,
          origin: callMeta && callMeta.origin,
          loteAgendamentoIds: slice,
          qtdPagamentosNoLote: (resp.data || []).length,
          pagamentoIds: (resp.data || []).map(function(r){ return r && r.id; }).filter(Boolean),
          snapshot: dashTipKpiSnapshot()
        });
        (resp.data || []).forEach(function(r){
          if (!r || r.id == null) return;
          if (seenPagId[r.id]) return;          // 🛡️ dedup por id
          seenPagId[r.id] = true;
          var m = /CAIXINHA:([\d\.]+)/i.exec(r.observacao || '');
          if (m) {
            var v = parseFloat(m[1]) || 0;
            totalCaixinha += v;
            tipPorAgendamento[r.agendamento_id] = (tipPorAgendamento[r.agendamento_id] || 0) + v;
          }
        });
      }
    } catch(e){
      console.warn('[pag][dash-tip] erro ao buscar caixinhas', e);
      return vazio;
    }

    // Caixinha por profissional (usa o profissional principal do agendamento).
    // Iteramos sobre ids únicos para nunca contar o mesmo agendamento 2x.
    var tipPorProf = {};
    var seenAgProf = Object.create(null);
    window.appointments.forEach(function(a){
      if (!a || !a.id) return;
      if (seenAgProf[a.id]) return;
      seenAgProf[a.id] = true;
      var tip = tipPorAgendamento[a.id];
      if (!tip) return;
      var profs = (typeof window.getAppointmentProfessionals === 'function')
        ? window.getAppointmentProfessionals(a) : [];
      var profNome = (profs && profs[0]) || a.profissional || a.profissional_nome || '';
      if (!profNome) return;
      tipPorProf[profNome] = (tipPorProf[profNome] || 0) + tip;
    });

    totalCaixinha = round2(totalCaixinha);
    dashTipLog('resumo:final', {
      source: callMeta && callMeta.source,
      origin: callMeta && callMeta.origin,
      totalCaixinha: totalCaixinha,
      qtdAgendamentosComCaixinha: Object.keys(tipPorAgendamento).length,
      agendamentoIdsComCaixinha: Object.keys(tipPorAgendamento),
      pagamentoIdsConsiderados: Object.keys(seenPagId),
      tipPorAgendamento: tipPorAgendamento,
      tipPorProf: tipPorProf,
      snapshot: dashTipKpiSnapshot()
    });
    return { total: totalCaixinha, porProf: tipPorProf };
  }

  function aplicarResumoCaixinhaNoDOM(resumo, apenasCard, callMeta){
    resumo = resumo || { total: 0, porProf: {} };
    var totalCaixinha = round2(Number(resumo.total) || 0);
    var fatEl = document.getElementById('dash-faturamento');
    var meta = callMeta || dashTipCaptureMeta('aplicarResumoCaixinhaNoDOM');
    window.__pagDashTipActiveSource = meta.origin;

    if (fatEl) {
      // ===== v18 (2026-06-09): CORRIGE ACUMULAÇÃO +caixinha REGRESSIVA =====
      // A versão v15 confiava em `dataset.baseFat` como verdade absoluta.
      // Se algo (polling, realtime, hook concorrente, MutationObserver de
      // outro módulo) chamava esta função SEM passar pelo wrap de
      // loadDashboard, ou se baseFat era inadvertidamente deletado mas o
      // display continuava com a caixinha aplicada, o cálculo virava:
      //    novo = display_atual + caixinha   (em vez de base + caixinha)
      // produzindo o sintoma 90 → 100 → 110 ... a cada gatilho.
      //
      // v17 — INVARIANTE IDEMPOTENTE FORTE:
      //    base   = display_atual − caixinha_previa
      //    novo   = base + caixinha_atual
      // Como `dataset.tipSum` registra EXATAMENTE quanto foi adicionado da
      // última vez, qualquer reexecução produz o mesmo resultado.
      // Repetir a função N vezes com a MESMA resumo ⇒ valor estável.
      // dataset.baseFat continua sendo gravado (debug/observabilidade)
      // mas NÃO é mais a fonte da verdade.
      var atualNum = parseMoneyText(fatEl.textContent);
      var prevTip  = parseFloat(fatEl.dataset.tipSum || '0') || 0;
      var baseFat  = round2(atualNum - prevTip);
      if (baseFat < 0) baseFat = 0;

      var novoFat = round2(baseFat + totalCaixinha);
      if (Math.abs(novoFat - atualNum) > 0.005) {
        fatEl.textContent = fmtBRL(novoFat);
      }
      fatEl.dataset.baseFat = String(baseFat);
      fatEl.dataset.tipSum  = String(totalCaixinha);

      // Ticket médio acompanha o faturamento líquido (mesmo nº de atendimentos)
      var tickEl  = document.getElementById('dash-ticket');
      var totAgEl = document.getElementById('dash-total-ag');
      if (tickEl && totAgEl) {
        var qtd = parseInt(String(totAgEl.textContent).replace(/\D/g, ''), 10) || 0;
        if (qtd > 0) {
          var novoTicket = round2(novoFat / qtd);
          if (Math.abs(novoTicket - parseMoneyText(tickEl.textContent)) > 0.005) {
            tickEl.textContent = fmtBRL(novoTicket);
          }
        }
      }

      var prodTitle = fatEl.dataset.prodSum && parseFloat(fatEl.dataset.prodSum) > 0
        ? ('Inclui ' + fmtBRL(parseFloat(fatEl.dataset.prodSum)) + ' em produtos vendidos')
        : '';
      var tipTitle = totalCaixinha > 0
        ? ('Inclui ' + fmtBRL(totalCaixinha) + ' em caixinhas (gorjetas)')
        : '';
      fatEl.title = [prodTitle, tipTitle].filter(Boolean).join(' · ');

      dashTipLog('apply:kpi-write-v17', {
        source: meta.source,
        origin: meta.origin,
        atualAntes: atualNum,
        prevTip: prevTip,
        baseFat: baseFat,
        caixinha: totalCaixinha,
        novoFat: novoFat,
        snapshot: dashTipKpiSnapshot()
      });
    }

    if (!apenasCard) {
      injetarColunasCaixinhaNaTabela(resumo.porProf || {});
    }

    console.log('[pag][dash-tip] caixinha aplicada (idempotente v18):',
      {
        timestamp: dashTipNowIso(),
        elapsed: dashTipElapsed(),
        source: meta.source,
        origin: meta.origin,
        caixinha: totalCaixinha,
        baseFat: fatEl && fatEl.dataset.baseFat,
        valorFinalCalculado: fatEl ? parseMoneyText(fatEl.textContent) : null,
        snapshot: dashTipKpiSnapshot()
      });
    window.__pagDashTipActiveSource = null;
  }

  async function aplicarCaixinhaNoDashboard(){
    var meta = dashTipCaptureMeta('aplicarCaixinhaNoDashboard');
    dashTipLog('api:aplicarCaixinhaNoDashboard:start', {
      source: meta.source,
      origin: meta.origin,
      stackTrace: meta.stackTrace,
      snapshot: dashTipKpiSnapshot()
    });
    var resumo = await calcularResumoCaixinhasDashboard(meta);
    aplicarResumoCaixinhaNoDOM(resumo, false, meta);
  }

  function limparMarcadorTip(){
    var fatEl = document.getElementById('dash-faturamento');
    if (fatEl) {
      var meta = dashTipCaptureMeta('limparMarcadorTip');
      dashTipLog('marker:clear', {
        source: meta.source,
        origin: meta.origin,
        stackTrace: meta.stackTrace,
        snapshot: dashTipKpiSnapshot()
      });
      fatEl.dataset.tipSum = '0';
      delete fatEl.dataset.baseFat;
    }
  }

  // ------------------------------------------------------------------
  // Tabela "Por Profissional" — injeta colunas Caixinha + Total a receber
  // (rodando após loadDashboard; idempotente)
  // ------------------------------------------------------------------
  function injetarColunasCaixinhaNaTabela(tipPorProf) {
    tipPorProf = tipPorProf || {};
    var tbody = document.getElementById('dash-prof-tbody');
    if (!tbody) return;
    var table = tbody.closest('table');
    var theadRow = table ? table.querySelector('thead tr') : null;

    // Garante os <th> no cabeçalho (sem duplicar)
    if (theadRow && !theadRow.querySelector('.dash-prof-col-caixinha')) {
      var thTip = document.createElement('th');
      thTip.className = 'dash-prof-col-caixinha';
      thTip.textContent = 'Caixinha';
      var thTot = document.createElement('th');
      thTot.className = 'dash-prof-col-total-receber';
      thTot.textContent = 'Total a receber';
      theadRow.appendChild(thTip);
      theadRow.appendChild(thTot);
    }

    // Para cada linha, adiciona os 2 <td> (removendo eventuais anteriores p/ idempotência)
    tbody.querySelectorAll('tr').forEach(function(tr){
      tr.querySelectorAll('td.dash-prof-cell-caixinha, td.dash-prof-cell-total-receber').forEach(function(c){ c.remove(); });
      var nomeCell = tr.querySelector('td');
      var nome = nomeCell ? (nomeCell.textContent || '').trim() : '';
      var tip = round2(Number(tipPorProf[nome]) || 0);

      // Comissão: feature pode estar desligada (coluna escondida).
      var thComissao = document.querySelector('th.dash-prof-col-comissao');
      var comissaoAtiva = thComissao && (thComissao.offsetParent !== null);
      var comissaoVal = 0;
      var tds = tr.querySelectorAll('td');
      if (comissaoAtiva && tds.length >= 5) {
        comissaoVal = parseMoneyText(tds[tds.length - 1].textContent);
      }
      var totalReceber = round2(tip + comissaoVal);

      var tdTip = document.createElement('td');
      tdTip.className = 'dash-prof-cell-caixinha';
      tdTip.textContent = fmtBRL(tip);

      var tdTot = document.createElement('td');
      tdTot.className = 'dash-prof-cell-total-receber';
      tdTot.style.fontWeight = '600';
      tdTot.style.color = 'var(--gold, #6c3aed)';
      tdTot.textContent = fmtBRL(totalReceber);

      tr.appendChild(tdTip);
      tr.appendChild(tdTot);
    });

    // ===== Cards mobile =====
    var mobile = document.getElementById('dash-prof-cards-mobile');
    if (mobile) {
      mobile.querySelectorAll('.dash-prof-card').forEach(function(card){
        card.querySelectorAll('.dash-prof-metric.caixinha-extra, .dash-prof-metric.total-receber').forEach(function(b){ b.remove(); });
        var nameEl = card.querySelector('.dash-prof-card-name');
        var nome = nameEl ? (nameEl.textContent || '').trim() : '';
        var tip = round2(Number(tipPorProf[nome]) || 0);

        var comBlock = card.querySelector('.dash-prof-metric.comissao .dash-prof-metric-value');
        var comissaoVal = comBlock ? parseMoneyText(comBlock.textContent) : 0;
        var totalReceber = round2(tip + comissaoVal);

        var html = ''
          + '<div class="dash-prof-metric caixinha-extra">'
          +   '<div class="dash-prof-metric-row">'
          +     '<span class="dash-prof-metric-label">🎁 Caixinha</span>'
          +     '<span class="dash-prof-metric-value">' + fmtBRL(tip) + '</span>'
          +   '</div>'
          + '</div>'
          + '<div class="dash-prof-metric total-receber" style="border-top:1px dashed var(--border,#e5e7eb);padding-top:8px;margin-top:6px;">'
          +   '<div class="dash-prof-metric-row">'
          +     '<span class="dash-prof-metric-label" style="font-weight:600;">Total a receber</span>'
          +     '<span class="dash-prof-metric-value" style="color:var(--gold,#6c3aed);font-weight:700;">' + fmtBRL(totalReceber) + '</span>'
          +   '</div>'
          + '</div>';
        var wrap = document.createElement('div');
        wrap.innerHTML = html;
        while (wrap.firstChild) card.appendChild(wrap.firstChild);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

