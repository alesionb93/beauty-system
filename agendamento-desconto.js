/* =====================================================================
   AGENDAMENTO-DESCONTO.JS — Add-on isolado  (v1 — 2026-06-03)
   ---------------------------------------------------------------------
   Carregue DEPOIS do pagamentos.js, em agenda.html:

       <link rel="stylesheet" href="/agendamento-desconto.css">
       <script src="/agendamento-desconto.js?v=1" defer></script>

   O que faz:
   • Injeta um botão "🏷 Aplicar desconto" dentro do modal
     "Registrar pagamento" (logo abaixo do card "Total a pagar" e
     acima das formas de pagamento).
   • Abre um modal para informar o desconto (valor fixo R$ ou %).
   • Aplica o desconto reutilizando o hook público
     window.__pagSetExtraTotal(extra) — passando o desconto como
     "extra" NEGATIVO. Assim TODA a lógica de:
        - recálculo de total a pagar
        - split das formas de pagamento
        - conferência (Total confere)
        - habilitar/desabilitar "Confirmar e concluir"
        - salvamento dos pagamentos em agendamento_pagamentos
     continua sendo a do pagamentos.js — não duplicamos regras.
   • Mostra um card "🏷 Desconto aplicado · -R$ X,XX" com botão de
     remover, e uma linha "Total final" com o valor recalculado.
   • Botão de remover abre confirmação ("Remover desconto?") e ao
     confirmar restaura o valor original automaticamente.

   ❗ NÃO altera:
     - fluxo atual de pagamentos
     - fluxo/utilização/venda de pacotes
     - dashboard
     - comissões (são calculadas a partir do valor do serviço, não
       do recebido)
     - controle de estoque
     - caixinha (mantida intacta — a soma com tip continua acontecendo
       no pagamentos.js)
     - histórico do cliente
   • Sai de cena sozinho quando o modal de pagamento fecha.
   ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_DESC_LOADED__) return;
  window.__SLOTIFY_DESC_LOADED__ = true;

  console.log('%c🏷 agendamento-desconto.js v1 carregado',
    'background:#6c3aed;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700');

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function fmtBRL(n) {
    n = Number(n) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function round2(n){ return Math.round((Number(n)||0) * 100) / 100; }

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

  // ------------------------------------------------------------------
  // Estado do desconto p/ a sessão atual do modal de pagamento
  // ------------------------------------------------------------------
  var __descAtivo = 0; // valor absoluto do desconto aplicado (R$)

  function getCtx() {
    return (typeof window.__pagGetCtx === 'function') ? window.__pagGetCtx() : null;
  }

  // Aplica/remove desconto interagindo com __pagSetExtraTotal sem
  // perder eventuais "extras" já adicionados por outros add-ons
  // (ex: agendamento-prepago). Reaplica o delta:
  //    novoExtra = extraAtual + descontoAnterior - novoDesconto
  function aplicarDescontoNoModal(novoDescAbs) {
    var ctx = getCtx();
    if (!ctx) return false;
    if (typeof window.__pagSetExtraTotal !== 'function') return false;
    var extraAtual = Number(ctx.extraTotal) || 0;
    var novoExtra = round2(extraAtual + __descAtivo - (Number(novoDescAbs) || 0));
    var ok = window.__pagSetExtraTotal(novoExtra);
    if (ok) __descAtivo = round2(Number(novoDescAbs) || 0);
    return ok;
  }

  function getValorOriginal() {
    var ctx = getCtx();
    if (!ctx) return 0;
    // baseTotal + (extraTotal atual, já com desconto subtraído) + descontoAtivo
    // = valor que seria o total a pagar sem qualquer desconto.
    var base = Number(ctx.baseTotal) || 0;
    var extra = Number(ctx.extraTotal) || 0;
    return round2(base + extra + __descAtivo);
  }

  // ------------------------------------------------------------------
  // Injeção no DOM do modal de pagamento
  // ------------------------------------------------------------------
  function getResumoEl() {
    return document.querySelector('#modal-pagamento-ag .pag-resumo');
  }
  function getFormasListEl() {
    return document.getElementById('pag-formas-list');
  }

  function injetarBotaoAplicar() {
    var modal = document.getElementById('modal-pagamento-ag');
    if (!modal) return;
    if (modal.querySelector('#desc-apply-btn')) return; // já injetado
    var resumo = getResumoEl();
    var list = getFormasListEl();
    if (!resumo || !list) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'desc-apply-btn';
    btn.className = 'desc-apply-btn';
    btn.setAttribute('data-desc-action', 'open-apply');
    btn.innerHTML = '<i class="fa-solid fa-tag"></i> <span class="desc-apply-btn-label">Aplicar desconto</span>';
    // NÃO usamos addEventListener direto aqui porque pagamentos.js pode
    // recriar/rerenderizar o entorno e perderíamos o handler. A captura
    // do clique acontece via delegação global em document (ver instalarDelegacao).

    // Wrapper unificado (botão + futura lixeira) — mesmo padrão da caixinha
    var wrap = document.createElement('div');
    wrap.className = 'pag-action-row';
    wrap.id = 'desc-row-wrap';
    wrap.appendChild(btn);

    // Inserir ANTES do wrap do botão de caixinha (ou do próprio botão),
    // para preservar a ordem: Valor pendente → Aplicar desconto →
    // Adicionar caixinha → Forma de pagamento.
    var tipWrap = document.getElementById('pag-tip-row-wrap');
    var tipBtn  = document.getElementById('pag-tip-btn');
    var anchor  = tipWrap || (tipBtn && tipBtn.parentNode === tipWrap ? tipWrap : tipBtn);
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(wrap, anchor);
    } else {
      list.parentNode.insertBefore(wrap, list);
    }
  }

  // Delegação global — sobrevive a qualquer rewrite de DOM feito pelo
  // pagamentos.js (recomputar, render, etc.).
  function instalarDelegacao() {
    if (window.__SLOTIFY_DESC_DELEG__) return;
    window.__SLOTIFY_DESC_DELEG__ = true;
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var openBtn = t.closest('[data-desc-action="open-apply"]');
      if (openBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        abrirModalAplicarDesconto();
        return;
      }
      var rmBtn = t.closest('[data-desc-action="open-remove"]');
      if (rmBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        abrirModalConfirmarRemocao();
        return;
      }
    }, true); // capture: pega antes de qualquer outro handler
  }

  function renderDescontoAplicadoUI() {
    var modal = document.getElementById('modal-pagamento-ag');
    if (!modal) return;

    // Remove blocos antigos da v1 (card separado + linha de total)
    var oldCard = modal.querySelector('#desc-applied-card');
    var oldTotal = modal.querySelector('#desc-total-final-row');
    if (oldCard) oldCard.remove();
    if (oldTotal) oldTotal.remove();

    var btn = modal.querySelector('#desc-apply-btn');
    if (!btn) return;
    var wrap = btn.parentNode;
    var trash = wrap && wrap.querySelector('#desc-remove-btn');
    var labelSpan = btn.querySelector('.desc-apply-btn-label');
    // Garante uma <span> de label dentro do botão para alternar o texto
    if (!labelSpan) {
      btn.innerHTML = '<i class="fa-solid fa-tag"></i> <span class="desc-apply-btn-label">Aplicar desconto</span>';
      labelSpan = btn.querySelector('.desc-apply-btn-label');
    }

    if (__descAtivo > 0) {
      if (labelSpan) labelSpan.textContent = 'Desconto aplicado';
      btn.classList.add('is-active');
      btn.setAttribute('data-desc-action', 'noop');
      if (!trash && wrap) {
        trash = document.createElement('button');
        trash.type = 'button';
        trash.id = 'desc-remove-btn';
        trash.className = 'pag-action-remove';
        trash.title = 'Remover desconto';
        trash.setAttribute('aria-label', 'Remover desconto');
        trash.setAttribute('data-desc-action', 'open-remove');
        trash.innerHTML = '<i class="fa-solid fa-trash"></i>';
        wrap.appendChild(trash);
      }
    } else {
      if (labelSpan) labelSpan.textContent = 'Aplicar desconto';
      btn.classList.remove('is-active');
      btn.setAttribute('data-desc-action', 'open-apply');
      if (trash) trash.remove();
    }
  }

  // ------------------------------------------------------------------
  // Modal "Aplicar desconto"
  // ------------------------------------------------------------------
  function ensureModalAplicar() {
    if (document.getElementById('modal-desconto-aplicar')) return;
    var html = ''
      + '<div class="modal-overlay" id="modal-desconto-aplicar">'
      +   '<div class="modal modal-small" style="max-width:460px">'
      +     '<div class="modal-header">'
      +       '<h3><i class="fa-solid fa-tag" style="color:var(--gold,#6c3aed);margin-right:8px;"></i>Aplicar desconto</h3>'
      +       '<button type="button" class="modal-close" data-desc-close="1">&times;</button>'
      +     '</div>'
      +     '<div class="modal-body desc-modal-body" style="padding:16px 24px 4px;">'
      +       '<label class="desc-field-label">Tipo de desconto</label>'
      +       '<div class="desc-tipo-group">'
      +         '<label class="desc-tipo-opt active" data-tipo="fixo">'
      +           '<input type="radio" name="desc-tipo" value="fixo" checked> Valor fixo (R$)'
      +         '</label>'
      +         '<label class="desc-tipo-opt" data-tipo="percent">'
      +           '<input type="radio" name="desc-tipo" value="percent"> Percentual (%)'
      +         '</label>'
      +       '</div>'
      +       '<label class="desc-field-label" id="desc-valor-label">Valor do desconto</label>'
      +       '<input type="text" inputmode="decimal" class="desc-field-input" id="desc-valor-input" placeholder="0,00">'
      +       '<div class="desc-preview" id="desc-preview">'
      +         '<div class="desc-preview-row"><span>Total original</span><strong id="desc-prev-orig">R$ 0,00</strong></div>'
      +         '<div class="desc-preview-row desc-preview-desc"><span>Desconto</span><strong id="desc-prev-desc">- R$ 0,00</strong></div>'
      +         '<div class="desc-preview-row desc-preview-final"><span>Total final</span><strong id="desc-prev-final">R$ 0,00</strong></div>'
      +       '</div>'
      +       '<div class="desc-error" id="desc-error"></div>'
      +     '</div>'
      +     '<div class="modal-actions" style="padding:14px 24px 22px;">'
      +       '<button type="button" class="btn-cancel" data-desc-close="1">Cancelar</button>'
      +       '<button type="button" class="btn-submit" id="desc-confirmar" style="background:linear-gradient(135deg,var(--gold,#6c3aed),var(--gold-dark,#5b21b6));">'
      +         '<i class="fa-solid fa-tag"></i> Aplicar desconto'
      +       '</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);

    var modal = document.getElementById('modal-desconto-aplicar');

    modal.querySelectorAll('[data-desc-close]').forEach(function(b){
      b.addEventListener('click', function(){ closeModal('modal-desconto-aplicar'); });
    });

    // Radios: toggle active + atualizar label + recompute preview
    modal.querySelectorAll('.desc-tipo-opt').forEach(function(opt){
      opt.addEventListener('click', function(){
        modal.querySelectorAll('.desc-tipo-opt').forEach(function(o){ o.classList.remove('active'); });
        opt.classList.add('active');
        var radio = opt.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
        atualizarLabelValor();
        recomputarPreview();
      });
    });

    modal.querySelector('#desc-valor-input').addEventListener('input', recomputarPreview);
    modal.querySelector('#desc-confirmar').addEventListener('click', onConfirmarAplicar);
  }

  function atualizarLabelValor() {
    var modal = document.getElementById('modal-desconto-aplicar');
    if (!modal) return;
    var tipo = modal.querySelector('input[name="desc-tipo"]:checked').value;
    var lbl = modal.querySelector('#desc-valor-label');
    var input = modal.querySelector('#desc-valor-input');
    if (tipo === 'percent') {
      lbl.textContent = 'Valor do desconto (%)';
      input.placeholder = 'Ex.: 10';
    } else {
      lbl.textContent = 'Valor do desconto (R$)';
      input.placeholder = 'Ex.: 10,00';
    }
  }

  function calcularDescontoAbsoluto() {
    var modal = document.getElementById('modal-desconto-aplicar');
    if (!modal) return 0;
    var tipo = modal.querySelector('input[name="desc-tipo"]:checked').value;
    var raw = parseValor(modal.querySelector('#desc-valor-input').value);
    var orig = getValorOriginal();
    if (raw <= 0 || isNaN(raw)) return 0;
    if (tipo === 'percent') {
      var pct = Math.min(100, raw);
      return round2(orig * (pct / 100));
    }
    return round2(raw);
  }

  function recomputarPreview() {
    var modal = document.getElementById('modal-desconto-aplicar');
    if (!modal) return;
    var orig = getValorOriginal();
    var desc = calcularDescontoAbsoluto();
    var finalAmt = round2(orig - desc);
    modal.querySelector('#desc-prev-orig').textContent = fmtBRL(orig);
    modal.querySelector('#desc-prev-desc').textContent = '- ' + fmtBRL(desc);
    modal.querySelector('#desc-prev-final').textContent = fmtBRL(finalAmt);

    var err = modal.querySelector('#desc-error');
    var btn = modal.querySelector('#desc-confirmar');
    err.classList.remove('show');
    err.textContent = '';
    btn.disabled = false;

    if (desc < 0) {
      err.textContent = 'O desconto não pode ser negativo.';
      err.classList.add('show');
      btn.disabled = true;
    } else if (desc > orig + 0.001) {
      err.textContent = 'O desconto não pode ser maior que o valor da venda.';
      err.classList.add('show');
      btn.disabled = true;
    } else if (desc <= 0) {
      btn.disabled = true;
    }
  }

  function abrirModalAplicarDesconto() {
    if (!getCtx()) return;
    ensureModalAplicar();
    var modal = document.getElementById('modal-desconto-aplicar');
    // Reset
    modal.querySelector('#desc-valor-input').value = '';
    modal.querySelectorAll('.desc-tipo-opt').forEach(function(o, i){
      o.classList.toggle('active', i === 0);
      var r = o.querySelector('input[type="radio"]');
      if (r) r.checked = (i === 0);
    });
    atualizarLabelValor();
    recomputarPreview();
    openModal('modal-desconto-aplicar');
    setTimeout(function(){
      try { modal.querySelector('#desc-valor-input').focus(); } catch(_){}
    }, 30);
  }

  function onConfirmarAplicar() {
    var desc = calcularDescontoAbsoluto();
    var orig = getValorOriginal();
    if (desc <= 0) return;
    if (desc > orig + 0.001) return;
    var ok = aplicarDescontoNoModal(desc);
    if (!ok) return;
    renderDescontoAplicadoUI();
    closeModal('modal-desconto-aplicar');
    if (typeof window.showToast === 'function') {
      window.showToast('Desconto aplicado: ' + fmtBRL(desc));
    }
  }

  // ------------------------------------------------------------------
  // Modal "Remover desconto?"
  // ------------------------------------------------------------------
  function ensureModalRemover() {
    if (document.getElementById('modal-desconto-remover')) return;
    var html = ''
      + '<div class="modal-overlay" id="modal-desconto-remover">'
      +   '<div class="modal modal-small" style="max-width:400px">'
      +     '<div class="modal-header">'
      +       '<h3>Remover desconto?</h3>'
      +       '<button type="button" class="modal-close" data-descrm-close="1">&times;</button>'
      +     '</div>'
      +     '<div class="modal-body desc-confirm-body">'
      +       '<div class="desc-confirm-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>'
      +       '<p class="desc-confirm-title">Tem certeza que deseja remover o desconto aplicado?</p>'
      +       '<p>O total voltará ao valor original.</p>'
      +     '</div>'
      +     '<div class="modal-actions" style="padding:14px 24px 22px;">'
      +       '<button type="button" class="btn-cancel" data-descrm-close="1">Cancelar</button>'
      +       '<button type="button" class="btn-submit btn-danger" id="desc-confirmar-remover">'
      +         '<i class="fa-solid fa-trash"></i> Remover desconto'
      +       '</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);

    var modal = document.getElementById('modal-desconto-remover');
    modal.querySelectorAll('[data-descrm-close]').forEach(function(b){
      b.addEventListener('click', function(){ closeModal('modal-desconto-remover'); });
    });
    modal.querySelector('#desc-confirmar-remover').addEventListener('click', onConfirmarRemover);
  }

  function abrirModalConfirmarRemocao() {
    ensureModalRemover();
    openModal('modal-desconto-remover');
  }

  function onConfirmarRemover() {
    aplicarDescontoNoModal(0); // zera o desconto, restaura total original
    renderDescontoAplicadoUI();
    closeModal('modal-desconto-remover');
    if (typeof window.showToast === 'function') {
      window.showToast('Desconto removido');
    }
  }

  // ------------------------------------------------------------------
  // Helpers de modal genéricos (fallback caso window.openModal não exista)
  // ------------------------------------------------------------------
  function openModal(id) {
    if (typeof window.openModal === 'function' && window.openModal !== openModal) {
      try { window.openModal(id); return; } catch(_){}
    }
    var m = document.getElementById(id);
    if (m) { m.classList.add('active'); m.style.display = 'flex'; }
  }
  function closeModal(id) {
    if (typeof window.closeModal === 'function' && window.closeModal !== closeModal) {
      try { window.closeModal(id); return; } catch(_){}
    }
    var m = document.getElementById(id);
    if (m) { m.classList.remove('active'); m.style.display = 'none'; }
  }

  // ------------------------------------------------------------------
  // Observer: detectar abertura/fechamento do modal de pagamento
  // ------------------------------------------------------------------
  function isPagModalAberto() {
    var m = document.getElementById('modal-pagamento-ag');
    if (!m) return false;
    if (m.classList.contains('active')) return true;
    var disp = (m.style && m.style.display) || '';
    return disp && disp !== 'none';
  }

  var __ultimoEstadoAberto = false;

  function checarEstadoModal() {
    var aberto = isPagModalAberto();
    if (aberto && !__ultimoEstadoAberto) {
      // Acabou de abrir: zera estado e injeta botão
      __descAtivo = 0;
      injetarBotaoAplicar();
      renderDescontoAplicadoUI();
    } else if (!aberto && __ultimoEstadoAberto) {
      // Fechou: limpa estado (pré-pago / outro re-abrir começa zerado)
      __descAtivo = 0;
    } else if (aberto) {
      // Continua aberto: garantir botão presente (caso DOM tenha sido
      // reescrito) sem destruir card de desconto já aplicado
      if (!document.getElementById('desc-apply-btn') &&
          !document.getElementById('desc-applied-card')) {
        injetarBotaoAplicar();
      }
    }
    __ultimoEstadoAberto = aberto;
  }

  function instalarObserver() {
    var mo = new MutationObserver(function(){ checarEstadoModal(); });
    mo.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style']
    });
    checarEstadoModal();
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  function boot() {
    instalarDelegacao();
    instalarObserver();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
