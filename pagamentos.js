/* =====================================================================
   PAGAMENTOS.JS — Add-on isolado  (v2 — fix conclusão manual)
   ---------------------------------------------------------------------
   Carregue DEPOIS do script.js, em agenda.html:
       <link rel="stylesheet" href="/pagamentos.css">
       <script src="/pagamentos.js?v=2" defer></script>

   v2 (2026-05-08) — fixes:
   • calcula preço usando window.servicePrices[s.servico].preco
   • lê produtos via window.__produtosVendaState.porAgendamento
   • modal usa .modal-overlay (mesma convenção do projeto) e openModal/closeModal
   • esconde "Concluir atendimento" também em auto-concluídos (sem pagamento integral)
   ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_PAG_LOADED__) return;
  window.__SLOTIFY_PAG_LOADED__ = true;

  console.log('%c💳 pagamentos.js v2 carregado', 'background:#6c3aed;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700');

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
    var restante = round2(__ctx.total - somado);
    var box = document.getElementById('pag-restante');
    var btn = document.getElementById('pag-confirmar');
    if (Math.abs(restante) < 0.01) {
      box.className = 'pag-restante ok';
      box.innerHTML = '<span><i class="fa-solid fa-check"></i> Total confere</span><strong>'+fmtBRL(somado)+'</strong>';
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
  // Persistência
  // ------------------------------------------------------------------
  async function salvarPagamentos(agId, pagamentos) {
    var sb = getSb(); var tenantId = getTenantId();
    if (!sb || !tenantId) throw new Error('Supabase/tenant indisponível');
    var rows = pagamentos.map(function(p){
      return {
        tenant_id: tenantId,
        agendamento_id: agId,
        forma_pagamento: p.forma_pagamento,
        valor: p.valor,
        parcelas: p.parcelas || 1
      };
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
  }

  // ------------------------------------------------------------------
  // Confirmar
  // ------------------------------------------------------------------
  async function onConfirmar() {
    if (!__ctx) return;
    var pags = lerPagamentos();
    var somado = pags.reduce(function(s,p){ return s + p.valor; }, 0);
    if (Math.abs(somado - __ctx.total) >= 0.01) return;

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
      mode: opts.mode || 'concluir',
      onSuccess: opts.onSuccess || null
    };

    document.getElementById('pag-cliente').textContent = ag.cliente_nome || '—';
    document.getElementById('pag-data').textContent =
      (ag.data ? ag.data.split('-').reverse().join('/') : '') + ' · ' + (ag.hora || '').slice(0,5);
    document.getElementById('pag-total').textContent = fmtBRL(total);
    document.getElementById('pag-confirmar-label').textContent =
      __ctx.mode === 'concluir' ? 'Confirmar e concluir' : 'Salvar pagamento';

    var list = document.getElementById('pag-formas-list');
    list.innerHTML = '';

    if (__ctx.mode === 'registrar') {
      var existentes = await carregarPagamentos(opts.agendamentoId);
      if (existentes.length > 0) {
        existentes.forEach(function(p){
          addLinhaPagamento({ forma: p.forma_pagamento, valor: p.valor, parcelas: p.parcelas });
        });
      } else {
        addLinhaPagamento({ forma: 'pix', valor: total });
      }
    } else {
      addLinhaPagamento({ forma: 'pix', valor: total });
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

            var total = calcularValorTotalAgendamento(ag);
            console.log('[pag] conclusão manual — total calculado:', total, ag);

            // Sem valor a cobrar (ex.: só pacote_uso) → segue direto
            if (!total || total <= 0) return original.apply(this, arguments);

            // Já tem pagamentos integrais? Segue direto
            var jaPagos = await carregarPagamentos(agId);
            var somado = jaPagos.reduce(function(s,p){ return s + Number(p.valor); }, 0);
            if (Math.abs(somado - total) < 0.01) return original.apply(this, arguments);

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
      var falta = total > 0 && (Math.abs(pago - total) >= 0.01);

      // FIX: esconde "Concluir atendimento" também em auto-concluídos
      if (btnConcluir && concluido) {
        btnConcluir.style.display = 'none';
      }

      var label = (pago > 0) ? 'Editar pagamento' : 'Registrar pagamento';
      btn.querySelector('span').textContent = label;
      btn.style.display = (concluido && falta) ? 'inline-flex' : 'none';
    });
    mo.observe(modalAg, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  // ------------------------------------------------------------------
  // Badge de status de pagamento nos cards do dia
  // ------------------------------------------------------------------
  function injetarBadgesNosCards() {
    if (!Array.isArray(window.appointments)) return;
    var cards = document.querySelectorAll('#day-appointments [data-appointment-id], #day-appointments .appointment-card');
    cards.forEach(function(card){
      var agId = card.getAttribute('data-appointment-id') || (card.dataset && card.dataset.id);
      if (!agId) return;
      var ag = window.appointments.find(function(x){ return x.id === agId; });
      if (!ag) return;
      if (!isConcluido(ag)) return;
      var total = calcularValorTotalAgendamento(ag);
      if (total <= 0) return;
      card.querySelectorAll('.pag-badge-pendente,.pag-badge-pago,.pag-badge-parcial').forEach(function(b){ b.remove(); });
      var sp = String(ag.status_pagamento || 'pendente');
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
      var anchor = card.querySelector('.appointment-status, .status-badge, .appointment-header, .card-header') || card;
      anchor.appendChild(badge);
    });
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

  // Boot
  function boot() {
    instalarInterceptorConclusao();
    injetarBotaoRegistrarPagamento();
    instalarObserverDayDetail();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
