/* ============================================================
 * bloqueio-colaborador-concluido.js  (v8 — reset completo do readonly ao fechar / novo agendamento)
 *
 * FIX v8:
 *   aplicarReadonly() definia el.style.display='none' e el.disabled=true
 *   nos botões (Salvar, Adicionar serviço, Registrar pagamento, Concluir,
 *   etc.) e setava readonly/disabled nos inputs do form. removerReadonly()
 *   só removia o atributo data-readonly-colab e o aviso — nunca revertia
 *   os estilos/propriedades aplicados. Como o modal #modal-agendamento é
 *   o MESMO DOM reutilizado para "Novo Agendamento", o botão Salvar ficava
 *   permanentemente com display:none até um F5. Agora removerReadonly()
 *   restaura tudo que aplicarReadonly() alterou.
 *
 * v7 — status persistido, não status efetivo
 * --------------------------------------------------------------
 * Impede que usuários com role "colaborador" alterem informações
 * de agendamentos que JÁ ESTAVAM concluídos no momento da abertura
 * do modal.
 *
 * CORREÇÃO v7 (comparação com produção):
 *   A produção usa getEffectiveStatus()/isAppointmentAutoCompleted() para
 *   tratar visualmente atendimentos passados como concluídos. Essa regra é
 *   correta para dashboard/UI, mas NÃO pode ser usada no bloqueio.
 *
 *   A regra solicitada é literalmente: role=colaborador E status persistido
 *   do agendamento = concluído. Portanto, um atendimento vencido/auto
 *   concluído visualmente, mas ainda com status salvo como agendado ou
 *   em_andamento, continua editável e pode ser concluído pelo colaborador.
 *
 *   Depois que o PATCH salva status='concluido', reabrir o agendamento entra
 *   em modo somente leitura.
 *
 * Histórico v6:
 *   O pagamentos.js fecha o sub-modal de pagamento antes de chamar a
 *   conclusão original. Nessa transição pode existir um intervalo em que
 *   o #modal-agendamento parece fechado para o MutationObserver. Na v5,
 *   isso podia limpar snapshot/concluindoIds cedo demais, então o PATCH
 *   final de status='concluido' voltava a cair no bloqueio.
 *
 *   v6 mantém a intenção de conclusão por TTL curto e só limpa snapshot
 *   após fechamento ESTÁVEL de todos os modais do fluxo. Também expõe
 *   window.__bloqColabConcluidoMarcarConclusao(id) para integrações como
 *   pagamentos.js reforçarem a intenção antes de chamar a conclusão original.
 *
 * Histórico v5:
 *   A v4 introduziu snapshot-on-open, mas durante o fluxo de
 *   conclusão o MutationObserver ainda dispara avaliarModal() várias
 *   vezes — quando o sub-modal "Registrar pagamento" abre/fecha e
 *   quando o diálogo de confirmação "Ao concluir este atendimento..."
 *   aparece, o #modal-agendamento perde momentaneamente o estado
 *   "aberto" (class/style mudam). Nessa janela:
 *      1. limparSnapshot() é executado
 *      2. avaliarModal() roda de novo
 *      3. tirarSnapshot() recria o snapshot — mas agora o script.js
 *         JÁ mutou appointments[i].status = 'concluido' em memória,
 *         então o novo snapshot nasce com concluido=true
 *      4. A camada Fetch bloqueia o próprio PATCH de conclusão →
 *         pagamento é salvo mas o status nunca atualiza no servidor
 *
 *   Duas defesas adicionais (sem alterar a regra de negócio):
 *     A) Cache "first-seen" por id de agendamento. A primeira leitura
 *        de status para um id fica memorizada pela vida da página.
 *        Re-snapshots posteriores para o mesmo id reusam o valor
 *        original e ignoram mutações em memória feitas pelo fluxo de
 *        conclusão.
 *     B) Flag de "intenção de conclusão". Quando o colaborador clica
 *        em "Concluir atendimento" / "Confirmar e concluir", marcamos
 *        o id como "em conclusão" — deveBloquear() retorna false para
 *        esse id até o modal principal fechar.
 *
 * Camadas (inalteradas):
 *   1) Visual  → desabilita inputs/selects/botões dentro do modal.
 *   2) Submit  → cancela onsubmit do #form-agendamento.
 *   3) Rede    → intercepta fetch() para PATCH/POST em rotas
 *                Supabase das tabelas sensíveis.
 *
 * Camada server-side definitiva: sql-bloqueio-colaborador-concluido.sql
 * ============================================================ */
(function () {
  'use strict';

  var TAG = '[bloq-colab-concluido]';
  var MODAL_ID = 'modal-agendamento';
  var FORM_ID  = 'form-agendamento';

  var TABELAS_BLOQUEADAS = [
    'agendamentos',
    'agendamento_servicos',
    'agendamento_servico_cores',
    'agendamento_pagamentos',
    'agendamento_produtos',
    'cliente_pacotes',
    'cliente_pacotes_creditos',
    'movimentacoes_estoque'
  ];

  // Snapshot atual (apontando para um id).
  // Estrutura: { id: string, concluido: boolean } | null
  var snapshot = null;

  // [v5-A] Cache "first-seen" por id de agendamento.
  // Garante que, mesmo se snapshot for limpo e recriado durante o
  // fluxo de conclusão, o valor original (capturado da PRIMEIRA vez
  // que vimos esse id na página) seja sempre reutilizado — evitando
  // que mutações em memória feitas pelo fluxo "Concluir atendimento"
  // contaminem decisões de bloqueio.
  var firstSeenStatus = Object.create(null); // { [id]: boolean }

  // [v6] Conjunto de ids em "fluxo de conclusão" com expiração.
  // Enquanto o id estiver dentro do TTL, deveBloquear() retorna false.
  // Isso cobre a janela em que pagamentos.js fecha o modal de pagamento
  // antes de chamar a conclusão original.
  var concluindoIds = Object.create(null); // { [id]: expiresAtMs }
  var CONCLUSAO_TTL_MS = 120000;
  var cleanupTimer = null;

  function log() {
    try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch(_){}
  }

  function getRole() {
    try { return (window.currentUser && window.currentUser.role) || null; }
    catch (_) { return null; }
  }
  function isColaborador() { return getRole() === 'colaborador'; }

  function getEditingId() {
    try {
      var id = window.editingAppointmentId;
      if (id === null || id === undefined) return null;
      var s = String(id).trim();
      if (!s || s === 'null' || s === 'undefined' || s === '0') return null;
      return id;
    } catch (_) { return null; }
  }

  function getAppointmentById(id) {
    if (!id) return null;
    try {
      var list = window.appointments || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) return list[i];
      }
    } catch(_){}
    return null;
  }

  function isConcluidoStatus(a) {
    if (!a) return false;

    // [v7] IMPORTANTE: para a regra de bloqueio, usar SOMENTE o status
    // persistido no banco (a.status). Não usar getEffectiveStatus() nem
    // isAppointmentAutoCompleted(), porque na produção essas funções marcam
    // atendimentos passados como "concluídos" para UI/dashboard antes do
    // colaborador finalizar manualmente. Isso bloqueava o próprio fluxo de
    // conclusão.
    var raw = String(a.status || '').trim().toLowerCase();
    return raw === 'concluido' || raw === 'concluído' || raw === 'finalizado';
  }

  function isNovoAgendamento(modal) {
    if (getEditingId()) return false;
    try {
      var titulo = modal && modal.querySelector('.modal-header h2, .modal-header h3, .modal-title');
      if (titulo) {
        var t = (titulo.textContent || '').toLowerCase();
        if (t.indexOf('novo') !== -1) return true;
      }
    } catch(_){}
    return true;
  }

  // Cria/atualiza o snapshot do id atual.
  // [v5-A] Sempre consulta firstSeenStatus primeiro. Só lê de
  // appointments[] na PRIMEIRA vez que vemos o id; depois disso,
  // o valor original é congelado para a vida da página.
  function tirarSnapshot(modal) {
    var id = getEditingId();
    if (!id) { snapshot = null; return; }
    if (snapshot && snapshot.id === id) return;

    var concluido;
    if (Object.prototype.hasOwnProperty.call(firstSeenStatus, id)) {
      concluido = firstSeenStatus[id];
      log('snapshot (first-seen cache):', id, concluido);
    } else {
      var ag = getAppointmentById(id);
      concluido = !!(ag && isConcluidoStatus(ag));
      firstSeenStatus[id] = concluido;
      log('snapshot (fresh):', id, concluido);
    }
    snapshot = { id: id, concluido: concluido };
  }

  function limparSnapshot() {
    if (snapshot) log('snapshot limpo (id:', snapshot.id, ')');
    snapshot = null;
  }

  function idEmConclusao(id) {
    if (!id) return false;
    var expiraEm = concluindoIds[id];
    if (!expiraEm) return false;
    if (Date.now() <= expiraEm) return true;
    delete concluindoIds[id];
    return false;
  }

  function marcarConclusao(id) {
    id = id || getEditingId();
    if (!id) return;
    concluindoIds[id] = Date.now() + CONCLUSAO_TTL_MS;
    log('intenção de conclusão marcada para id:', id);
  }

  function limparFluxoConclusao(id) {
    if (id) delete concluindoIds[id];
    else concluindoIds = Object.create(null);
  }

  // API para add-ons (ex.: pagamentos.js) reforçarem a intenção antes
  // de chamar a conclusão original após salvar pagamento.
  try {
    window.__bloqColabConcluidoMarcarConclusao = marcarConclusao;
    window.__bloqColabConcluidoLimparConclusao = limparFluxoConclusao;
  } catch(_) {}

  // Helper para as 3 camadas decidirem se devem bloquear.
  function deveBloquear() {
    if (!isColaborador()) return false;
    if (!snapshot) return false;
    // [v6] id em fluxo de conclusão → liberar, mesmo se o status local
    // já tiver sido mutado para concluído antes do PATCH final.
    if (snapshot.id && idEmConclusao(snapshot.id)) return false;
    return snapshot.concluido === true;
  }


  // Marca que o readonly mexeu neste elemento, guardando os valores

  // originais para que removerReadonly() possa restaurá-los.
  function marcarTocado(el, opts) {
    if (!el || el.__bloqColabTocado) return;
    el.__bloqColabTocado = true;
    el.__bloqColabOrig = {
      display: el.style.display,
      disabled: ('disabled' in el) ? el.disabled : null,
      readOnlyAttr: el.hasAttribute('readonly')
    };
    if (opts && opts.hide) el.style.display = 'none';
    if (opts && opts.disable && ('disabled' in el)) el.disabled = true;
    if (opts && opts.readonly) {
      try { el.setAttribute('readonly', 'readonly'); } catch(_){}
      if ('disabled' in el) el.disabled = true;
    }
  }

  function restaurarTocado(el) {
    if (!el || !el.__bloqColabTocado) return;
    var orig = el.__bloqColabOrig || {};
    try { el.style.display = orig.display || ''; } catch(_){}
    if ('disabled' in el) {
      el.disabled = (orig.disabled === true);
    }
    if (!orig.readOnlyAttr) {
      try { el.removeAttribute('readonly'); } catch(_){}
    }
    try { delete el.__bloqColabTocado; } catch(_) { el.__bloqColabTocado = false; }
    try { delete el.__bloqColabOrig; } catch(_) { el.__bloqColabOrig = null; }
  }

  /* -------- Camada Visual -------- */
  function aplicarReadonly(modal) {
    if (!modal) return;
    modal.setAttribute('data-readonly-colab', '1');

    var form = modal.querySelector('#' + FORM_ID);
    if (form) {
      var fields = form.querySelectorAll('input, select, textarea, button');
      for (var i = 0; i < fields.length; i++) {
        var el = fields[i];
        if (el.id === 'btn-excluir-agendamento') continue;
        if (el.classList && el.classList.contains('modal-close')) continue;

        if (el.tagName === 'BUTTON') {
          if (el.classList.contains('btn-submit') ||
              el.classList.contains('btn-add-servico') ||
              el.classList.contains('btn-add-produto-ag') ||
              el.classList.contains('btn-concluir-atendimento') ||
              el.id === 'btn-add-servico' ||
              el.id === 'btn-add-produto-ag' ||
              el.id === 'btn-concluir-atendimento') {
            marcarTocado(el, { hide: true, disable: true });
          }
        } else {
          if (el.type === 'checkbox' || el.type === 'radio') {
            marcarTocado(el, { disable: true });
          } else {
            marcarTocado(el, { readonly: true });
          }
        }
      }
    }

    var extras = modal.querySelectorAll(
      '#btn-registrar-pagamento, .btn-registrar-pagamento, ' +
      '[data-desc-action="open-apply"], #btn-aplicar-desconto, ' +
      '.btn-aplicar-desconto'
    );
    for (var j = 0; j < extras.length; j++) {
      marcarTocado(extras[j], { hide: true, disable: true });
    }

    inserirAvisoTopo(modal);
  }

  function removerReadonly(modal) {
    if (!modal) return;
    modal.removeAttribute('data-readonly-colab');
    var aviso = modal.querySelector('.colab-readonly-aviso');
    if (aviso) aviso.remove();

    // [v8] Restaura TODOS os elementos que aplicarReadonly() tocou.
    // Sem isso, abrir "Novo Agendamento" após visualizar um concluído
    // mantém o botão Salvar com display:none até um F5.
    try {
      var tocados = modal.querySelectorAll('*');
      for (var i = 0; i < tocados.length; i++) {
        if (tocados[i].__bloqColabTocado) restaurarTocado(tocados[i]);
      }
    } catch(_){}
  }

  function inserirAvisoTopo(modal) {
    if (modal.querySelector('.colab-readonly-aviso')) return;
    var header = modal.querySelector('.modal-header');
    if (!header) return;
    var aviso = document.createElement('div');
    aviso.className = 'colab-readonly-aviso';
    aviso.innerHTML =
      '<i class="fa-solid fa-lock"></i> ' +
      '<span>Agendamento concluído — somente leitura. ' +
      'Solicite a um administrador para realizar alterações retroativas.</span>';
    header.parentNode.insertBefore(aviso, header.nextSibling);
  }


  /* -------- Observador do modal -------- */
  function modalAberto(modal) {
    if (!modal) return false;
    return modal.classList.contains('active') ||
           modal.style.display === 'flex' ||
           modal.style.display === 'block';
  }

  function algumModalDoFluxoAberto() {
    return modalAberto(document.getElementById(MODAL_ID)) ||
           modalAberto(document.getElementById('modal-pagamento-ag')) ||
           modalAberto(document.getElementById('modal-concluir-atendimento'));
  }

  function cancelarLimpezaEstavel() {
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
  }

  function agendarLimpezaEstavel() {
    cancelarLimpezaEstavel();
    cleanupTimer = setTimeout(function () {
      cleanupTimer = null;
      if (algumModalDoFluxoAberto()) return;
      removerReadonly(document.getElementById(MODAL_ID));
      limparSnapshot();
      firstSeenStatus = Object.create(null);
      limparFluxoConclusao();
      log('estado do fluxo limpo após fechamento estável');
    }, 1200);
  }

  function avaliarModal() {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    if (!modalAberto(modal)) {
      removerReadonly(modal);
      // [v6] Não limpar imediatamente: pagamentos.js pode estar entre
      // fechar o sub-modal e chamar a conclusão original. A limpeza só
      // ocorre depois que nenhum modal do fluxo permanece aberto.
      agendarLimpezaEstavel();
      return;
    }
    cancelarLimpezaEstavel();
    if (!isColaborador()) { removerReadonly(modal); return; }
    if (isNovoAgendamento(modal)) { removerReadonly(modal); limparSnapshot(); return; }

    tirarSnapshot(modal);

    if (deveBloquear()) {
      aplicarReadonly(modal);
    } else {
      removerReadonly(modal);
    }
  }

  function instalarObserver() {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) { setTimeout(instalarObserver, 400); return; }
    try {
      var mo = new MutationObserver(function () {
        setTimeout(avaliarModal, 30);
        setTimeout(avaliarModal, 350);
      });
      mo.observe(modal, { attributes: true, attributeFilter: ['class', 'style'], childList: true, subtree: true });
      log('observer instalado');
    } catch (e) { log('falha observer', e); }
  }

  /* -------- [v5-B] Detecção da intenção "Concluir atendimento" -------- */
  // Captura cliques em qualquer botão envolvido no fluxo de conclusão.
  // Marca o id atual como "em conclusão" — desativa o bloqueio para esse
  // id até o modal principal fechar. Cobre tanto o clique inicial
  // "Concluir atendimento" quanto o "Confirmar e concluir" do sub-modal
  // de pagamento e o "Concluir atendimento" do diálogo de confirmação.
  document.addEventListener('click', function (ev) {
    try {
      if (!isColaborador()) return;
      var t = ev.target;
      if (!t || !t.closest) return;
      var btn = t.closest(
        '#btn-concluir-atendimento, .btn-concluir-atendimento, ' +
        '[data-action="concluir-atendimento"], ' +
        '[data-action="confirmar-concluir"], ' +
        '#btn-confirmar-concluir, .btn-confirmar-concluir, ' +
        '#btn-confirmar-pagamento, .btn-confirmar-pagamento'
      );
      if (!btn) {
        // Fallback por texto visível
        var maybe = t.closest('button');
        if (!maybe) return;
        var txt = (maybe.textContent || '').trim().toLowerCase();
        if (txt.indexOf('concluir atendimento') === -1 &&
            txt.indexOf('confirmar e concluir') === -1) return;
      }
      marcarConclusao(getEditingId());
    } catch (_) {}
  }, true);

  /* -------- Camada Submit -------- */
  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    if (!form || form.id !== FORM_ID) return;
    if (!deveBloquear()) return;

    ev.preventDefault();
    ev.stopImmediatePropagation();
    alert('Você não tem permissão para alterar um agendamento já concluído.\nSolicite a um administrador.');
    return false;
  }, true);

  /* -------- Camada Rede (defesa em profundidade) -------- */
  (function patchFetch() {
    if (!window.fetch) return;
    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        if (deveBloquear()) {
          var url    = typeof input === 'string' ? input : (input && input.url) || '';
          var method = ((init && init.method) ||
                        (input && input.method) || 'GET').toUpperCase();
          if (/\/rest\/v1\//.test(url) &&
              (method === 'PATCH' || method === 'POST' || method === 'PUT' || method === 'DELETE')) {
            // DELETE de agendamento continua permitido (regra de negócio).
            var allowDelete = (method === 'DELETE') &&
                              /\/rest\/v1\/agendamentos(\?|$)/.test(url);
            if (!allowDelete) {
              for (var i = 0; i < TABELAS_BLOQUEADAS.length; i++) {
                var tb = TABELAS_BLOQUEADAS[i];
                if (new RegExp('/rest/v1/' + tb + '(\\?|$|/)').test(url)) {
                  log('bloqueado por regra colab+concluido:', method, url);
                  return Promise.resolve(new Response(
                    JSON.stringify({
                      code: 'FORBIDDEN_COLAB_CONCLUIDO',
                      message: 'Colaboradores não podem alterar agendamentos concluídos.'
                    }),
                    { status: 403, headers: { 'Content-Type': 'application/json' } }
                  ));
                }
              }
            }
          }
        }
      } catch (e) { log('erro no interceptor:', e); }
      return origFetch(input, init);
    };
  })();

  /* -------- Boot -------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', instalarObserver);
  } else {
    instalarObserver();
  }
})();
