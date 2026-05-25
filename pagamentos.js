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

  console.log('%c💳 pagamentos.js v8 (caixinha) carregado', 'background:#6c3aed;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700');



  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  var FORMAS = [
    { id: 'pix',                label: 'PIX' },
    { id: 'dinheiro',           label: 'Dinheiro' },
    { id: 'debito',             label: 'Débito' },
    { id: 'credito',            label: 'Crédito' },
    { id: 'credito_parcelado',  label: 'Crédito Parcelado' }
  ];

  function fmtBRL(n) {
    n = Number(n) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function round2(n){ return Math.round((Number(n)||0) * 100) / 100; }

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

  function calcularValorTotalAgendamento(ag) {
    if (!ag) return 0;
    var total = 0;
    var sp = window.servicePrices || {};
    getServicos(ag).forEach(function(s){
      if (!s) return;
      // Ignora pacote_venda (já faturado) e pacote_uso (sem cobrança extra)
      if (s.origem === 'pacote_venda') return;
      if (s.origem === 'pacote_uso')   return;
      // 1º) preço explícito; 2º) servicePrices[nome]; 3º) 0
      var preco = Number(s.preco);
      if (!preco && s.servico && sp[s.servico]) preco = Number(sp[s.servico].preco) || 0;
      total += preco || 0;
    });
    var prods = getProdutosDoAgendamento(ag.id);
    prods.forEach(function(p){
      total += (Number(p.quantidade)||0) * (Number(p.preco_unitario)||0);
    });
    return round2(total);
  }

  // ------------------------------------------------------------------
  // Modal: injeção de markup (1 só vez) — usa convenção .modal-overlay
  // ------------------------------------------------------------------
  function ensureModal() {
    if (document.getElementById('modal-pagamento-ag')) return;
    var html = ''
      + '<div class="modal-overlay" id="modal-pagamento-ag">'
      +   '<div class="modal modal-small" style="max-width:560px">'
      +     '<div class="modal-header">'
      +       '<h3><i class="fa-solid fa-money-bill-wave" style="color:var(--gold,#6c3aed);margin-right:8px;"></i>Registrar pagamento</h3>'
      +       '<button type="button" class="modal-close" data-pag-close="1">&times;</button>'
      +     '</div>'
      +     '<div class="modal-body pag-modal-body" style="padding:12px 24px 4px;">'
      +       '<div class="pag-resumo">'
      +         '<div class="pag-resumo-row"><span>Cliente</span><strong id="pag-cliente">—</strong></div>'
      +         '<div class="pag-resumo-row"><span>Atendimento</span><strong id="pag-data">—</strong></div>'
      +         '<div class="pag-resumo-row" style="margin-top:6px">'
      +           '<span>Total a pagar</span><span class="pag-total" id="pag-total">R$ 0,00</span>'
      +         '</div>'
      +       '</div>'
      +       '<div class="pag-formas-list" id="pag-formas-list"></div>'
      +       '<button type="button" class="pag-add-btn" id="pag-add-btn">'
      +         '<i class="fa-solid fa-plus"></i> Adicionar forma de pagamento'
      +       '</button>'
      +       '<button type="button" class="pag-tip-btn" id="pag-tip-btn">'
      +         '<span class="pag-tip-emoji">🎁</span> <span id="pag-tip-btn-label">Adicionar caixinha</span>'
      +       '</button>'
      +       '<div class="pag-restante" id="pag-restante"></div>'
      +     '</div>'
      +     '<div class="modal-actions" style="padding:14px 24px 22px;">'
      +       '<button type="button" class="btn-cancel" data-pag-close="1">Cancelar</button>'
      +       '<button type="button" class="btn-submit" id="pag-confirmar" disabled style="background:linear-gradient(135deg,#10b981,#059669);">'
      +         '<i class="fa-solid fa-circle-check"></i> <span id="pag-confirmar-label">Confirmar pagamento</span>'
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
    var formaSel = '<select class="pag-forma">'
      + FORMAS.map(function(f){ return '<option value="'+f.id+'">'+f.label+'</option>'; }).join('')
      + '</select>';
    row.innerHTML = formaSel
      + '<input type="number" step="0.01" min="0.01" class="pag-valor" placeholder="0,00">'
      + '<button type="button" class="pag-remove" title="Remover"><i class="fa-solid fa-trash"></i></button>';
    list.appendChild(row);

    var sel    = row.querySelector('.pag-forma');
    var valEl  = row.querySelector('.pag-valor');
    var rmBtn  = row.querySelector('.pag-remove');

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

    if (prefill) {
      sel.value = prefill.forma || 'pix';
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
    // Atualiza display do total no resumo do modal
    var totalDisp = document.getElementById('pag-total');
    if (totalDisp) totalDisp.textContent = fmtBRL(totalAlvo);
    renderTipRow();
    var box = document.getElementById('pag-restante');
    var btn = document.getElementById('pag-confirmar');
    if (Math.abs(restante) < 0.01) {
      box.className = 'pag-restante ok';
      var okLabel = (__ctx.tipAmount > 0) ? 'Total confere (serviços + caixinha)' : 'Total confere';
      box.innerHTML = '<span><i class="fa-solid fa-check"></i> '+okLabel+'</span><strong>'+fmtBRL(somado)+'</strong>';
      btn.disabled = pags.length === 0;
    } else if (restante > 0) {
      box.className = 'pag-restante faltando';
      box.innerHTML = '<span>Faltam</span><strong>'+fmtBRL(restante)+'</strong>';
      btn.disabled = true;
    } else {
      box.className = 'pag-restante excedido';
      box.innerHTML = '<span>Excedeu em</span><strong>'+fmtBRL(Math.abs(restante))+'</strong>';
      btn.disabled = true;
    }
  }

  // ------------------------------------------------------------------
  // CAIXINHA / GORJETA — render da linha no resumo + modal
  // ------------------------------------------------------------------
  function renderTipRow() {
    var resumoEl = document.querySelector('#modal-pagamento-ag .pag-resumo');
    if (!resumoEl) return;
    var existing = resumoEl.querySelector('.pag-tip-row');
    var tip = Number(__ctx && __ctx.tipAmount) || 0;
    if (tip <= 0) { if (existing) existing.remove(); return; }
    if (!existing) {
      existing = document.createElement('div');
      existing.className = 'pag-resumo-row pag-tip-row';
      // Inserir antes da linha de total (última)
      var totalRow = resumoEl.querySelector('.pag-resumo-row:last-child');
      resumoEl.insertBefore(existing, totalRow);
    }
    existing.innerHTML = '<span>🎁 Caixinha (gorjeta)</span><strong>'+fmtBRL(tip)+' <button type="button" class="pag-tip-edit" title="Editar caixinha" style="border:0;background:transparent;color:var(--gold,#6c3aed);cursor:pointer;font-size:12px;margin-left:6px;">editar</button> <button type="button" class="pag-tip-remove" title="Remover caixinha" style="border:0;background:transparent;color:#ef4444;cursor:pointer;font-size:12px;">remover</button></strong>';
    var ed = existing.querySelector('.pag-tip-edit');
    var rm = existing.querySelector('.pag-tip-remove');
    if (ed) ed.onclick = function(){ abrirModalCaixinha(); };
    if (rm) rm.onclick = function(){
      __ctx.tipAmount = 0;
      // Reajustar 1ª linha de pagamento para novo total
      var first = document.querySelector('#pag-formas-list .pag-forma-item .pag-valor');
      if (first) first.value = round2(__ctx.total).toFixed(2);
      recomputar();
    };
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
      +       '<h3 id="tip-title">🎁 Adicionar caixinha</h3>'
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
    var rows = pagamentos.map(function(p, idx){
      var row = {
        tenant_id: tenantId,
        agendamento_id: agId,
        forma_pagamento: p.forma_pagamento,
        valor: p.valor,
        parcelas: p.parcelas || 1
      };
      // Marca metadado de caixinha na 1ª linha (sem alterar schema)
      if (idx === 0 && tip > 0) {
        row.observacao = 'CAIXINHA:' + tip.toFixed(2);
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

    document.getElementById('pag-cliente').textContent = ag.cliente_nome || '—';
    document.getElementById('pag-data').textContent =
      (ag.data ? ag.data.split('-').reverse().join('/') : '') + ' · ' + (ag.hora || '').slice(0,5);
    document.getElementById('pag-total').textContent = fmtBRL(total);
    // Label da linha base: "Total a pagar (serviços)"
    var lbl = document.querySelector('#modal-pagamento-ag .pag-resumo .pag-resumo-row:last-child span');
    if (lbl) lbl.textContent = 'Total a pagar (serviços)';
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
        addLinhaPagamento({ forma: 'pix', valor: round2(total + (__ctx.tipAmount||0)) });
      }
    } else {
      addLinhaPagamento({ forma: 'pix', valor: round2(total + (__ctx.tipAmount||0)) });
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
            console.log('[pag] conclusão manual — total calculado:', total, ag);

            // Sem valor a cobrar (ex.: só pacote_uso) → segue direto
            if (!total || total <= 0) return original.apply(this, arguments);


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
  function instalarHookDashboardCaixinha() {
    var tries = 0;
    var iv = setInterval(function(){
      if (typeof window.loadDashboard === 'function' && !window.loadDashboard.__pagTipWrapped) {
        clearInterval(iv);
        var original = window.loadDashboard;
        var wrapped = async function(){
          var ret = await original.apply(this, arguments);
          try { await aplicarCaixinhaNoDashboard(); } catch(e){ console.warn('[pag][dash-tip]', e); }
          return ret;
        };
        wrapped.__pagTipWrapped = true;
        window.loadDashboard = wrapped;
        console.log('[pag] hook de caixinha no dashboard instalado');
      } else if (++tries > 50) {
        clearInterval(iv);
      }
    }, 200);
  }

  function parseMoneyText(txt){
    var s = String(txt || '').replace(/[^\d,.-]/g, '').replace(/\./g,'').replace(',', '.');
    var v = parseFloat(s);
    return isNaN(v) ? 0 : v;
  }

  async function aplicarCaixinhaNoDashboard(){
    var sb = getSb(); var tenantId = getTenantId();
    if (!sb || !tenantId) return;
    if (!Array.isArray(window.appointments)) return;

    // Range filtrado pelo dashboard (mesma lógica do hook de produtos)
    var range = (typeof window.getCalendarVisibleDateRange === 'function')
      ? window.getCalendarVisibleDateRange() : null;
    var fIni = (typeof window.filtrosAplicados !== 'undefined' && window.filtrosAplicados && window.filtrosAplicados.dataInicio)
      ? window.filtrosAplicados.dataInicio : (range ? range.start : null);
    var fFim = (typeof window.filtrosAplicados !== 'undefined' && window.filtrosAplicados && window.filtrosAplicados.dataFim)
      ? window.filtrosAplicados.dataFim : (range ? range.end : null);

    // Filtra agendamentos: dentro do range, NÃO cancelados, concluídos
    var idsValidos = [];
    window.appointments.forEach(function(a){
      if (!a || !a.id) return;
      if (typeof window.isAppointmentCancelled === 'function' && window.isAppointmentCancelled(a)) return;
      if (typeof window.isAppointmentAutoCompleted === 'function' && !window.isAppointmentAutoCompleted(a)) return;
      if (fIni && fFim && a.data) {
        if (a.data < fIni || a.data > fFim) return;
      }
      idsValidos.push(a.id);
    });
    if (!idsValidos.length) {
      limparMarcadorTip();
      injetarColunasCaixinhaNaTabela({});
      return;
    }

    // Busca observacoes em lote
    var totalCaixinha = 0;
    var tipPorAgendamento = {};
    try {
      // Supabase aceita .in() com até ~1000 ids; quebrar em chunks por segurança
      var chunk = 500;
      for (var i = 0; i < idsValidos.length; i += chunk) {
        var slice = idsValidos.slice(i, i + chunk);
        var resp = await sb.from('agendamento_pagamentos')
          .select('agendamento_id, observacao')
          .in('agendamento_id', slice)
          .eq('tenant_id', tenantId);
        if (resp.error) throw resp.error;
        (resp.data || []).forEach(function(r){
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
      return;
    }

    // Caixinha por profissional (usa o profissional principal do agendamento)
    var tipPorProf = {};
    window.appointments.forEach(function(a){
      if (!a || !a.id) return;
      var tip = tipPorAgendamento[a.id];
      if (!tip) return;
      var profs = (typeof window.getAppointmentProfessionals === 'function')
        ? window.getAppointmentProfessionals(a) : [];
      var profNome = (profs && profs[0]) || a.profissional || a.profissional_nome || '';
      if (!profNome) return;
      tipPorProf[profNome] = (tipPorProf[profNome] || 0) + tip;
    });

    totalCaixinha = round2(totalCaixinha);
    var fatEl = document.getElementById('dash-faturamento');
    if (fatEl) {
      var atual = parseMoneyText(fatEl.textContent);
      var novo = round2(atual + totalCaixinha);
      fatEl.textContent = fmtBRL(novo);
      fatEl.dataset.tipSum = String(totalCaixinha);
      var prodTitle = fatEl.dataset.prodSum && parseFloat(fatEl.dataset.prodSum) > 0
        ? ('Inclui ' + fmtBRL(parseFloat(fatEl.dataset.prodSum)) + ' em produtos vendidos')
        : '';
      var tipTitle = totalCaixinha > 0
        ? ('Inclui ' + fmtBRL(totalCaixinha) + ' em caixinhas (gorjetas)')
        : '';
      fatEl.title = [prodTitle, tipTitle].filter(Boolean).join(' · ');
      var tickEl = document.getElementById('dash-ticket');
      var totAgEl = document.getElementById('dash-total-ag');
      if (tickEl && totAgEl) {
        var qtd = parseInt(String(totAgEl.textContent).replace(/\D/g,''), 10) || 0;
        if (qtd > 0) tickEl.textContent = fmtBRL(round2(novo / qtd));
      }
    }

    // Injeta colunas "Caixinha" e "Total a receber" na tabela "Por Profissional"
    injetarColunasCaixinhaNaTabela(tipPorProf);

    console.log('[pag][dash-tip] caixinha somada ao faturamento:', totalCaixinha);
  }

  function limparMarcadorTip(){
    var fatEl = document.getElementById('dash-faturamento');
    if (fatEl) { fatEl.dataset.tipSum = '0'; }
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

