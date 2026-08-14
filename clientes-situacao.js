/* ============================================================
   CLIENTES — Situação de atendimento, último atendimento,
   data de cadastro, filtros e ordenação.  (add-on isolado)

   Carregar SEMPRE depois de script.js (defer mantém a ordem).

   Regras:
     - "Já atendido"     = existe agendamento status='concluido'
                           no MESMO tenant do cliente.
     - "Último atendimento" = MAX(agendamentos.data) desses concluídos.
     - Nada é persistido: tudo é derivado (view vw_clientes_atendimento).
     - Agendamento futuro/cancelado NÃO conta como atendimento.

   Este arquivo apenas SOBRESCREVE loadClients()/renderClients().
   Criar/editar/excluir cliente, importação, histórico, badge de
   inativo e busca continuam usando as funções originais.
   ============================================================ */
(function () {
  'use strict';

  var VIEW = 'vw_clientes_atendimento';

  window.clientsFiltros = window.clientsFiltros || {
    cadastroDe: '',
    cadastroAte: '',
    situacao: 'todos' // todos | ja_atendido | nunca_atendido
  };
  // null = ordenação padrão (nome ASC, igual ao comportamento atual)
  window.clientsSort = window.clientsSort || null;

  /* ---------- helpers ---------- */
  function fmtDateBR(v) {
    if (!v) return '';
    var s = String(v).slice(0, 10);
    var p = s.split('-');
    if (p.length !== 3) return s;
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  function norm(str) {
    if (typeof window.normalizeSearch === 'function') return window.normalizeSearch(str);
    return String(str == null ? '' : str)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
  function onlyDigits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

  /* ---------- carregamento (1 única query, sem N+1) ---------- */
  window.loadClients = async function loadClients() {
    var tenantId = (typeof getCurrentTenantId === 'function') ? getCurrentTenantId() : null;
    if (!window.supabaseClient) { window.clients = window.clients || []; return; }

    var f = window.clientsFiltros;
    var q = window.supabaseClient
      .from(VIEW)
      .select('id, nome, telefone, nascimento, created_at, tenant_id, ultimo_atendimento, situacao_atendimento')
      .order('nome');

    if (tenantId) q = q.eq('tenant_id', tenantId);            // multi-tenant
    if (f.cadastroDe) q = q.gte('created_at', f.cadastroDe + 'T00:00:00');
    if (f.cadastroAte) q = q.lte('created_at', f.cadastroAte + 'T23:59:59.999');
    if (f.situacao === 'ja_atendido') q = q.not('ultimo_atendimento', 'is', null);
    if (f.situacao === 'nunca_atendido') q = q.is('ultimo_atendimento', null);

    var resp = await q;

    if (resp.error) {
      console.warn('[clientes-situacao] view indisponível, usando fallback:', resp.error.message);
      return await fallbackLoadClients(tenantId, f);
    }

    window.clients = (resp.data || []).map(mapRow);
  };

  function mapRow(c) {
    return {
      id: c.id,
      nome: c.nome,
      telefone: c.telefone,
      nascimento: c.nascimento || '',
      created_at: c.created_at || null,
      ultimo_atendimento: c.ultimo_atendimento || null,
      situacao_atendimento: c.ultimo_atendimento ? 'ja_atendido' : 'nunca_atendido'
    };
  }

  /* Fallback (view ainda não aplicada): 2 queries no total, nunca N+1. */
  async function fallbackLoadClients(tenantId, f) {
    var q1 = window.supabaseClient.from('clientes')
      .select('id, nome, telefone, nascimento, created_at, tenant_id').order('nome');
    if (tenantId) q1 = q1.eq('tenant_id', tenantId);
    if (f.cadastroDe) q1 = q1.gte('created_at', f.cadastroDe + 'T00:00:00');
    if (f.cadastroAte) q1 = q1.lte('created_at', f.cadastroAte + 'T23:59:59.999');
    var r1 = await q1;
    if (r1.error) { console.error('Erro clientes:', r1.error); return; }

    var q2 = window.supabaseClient.from('agendamentos')
      .select('cliente_id, data').eq('status', 'concluido');
    if (tenantId) q2 = q2.eq('tenant_id', tenantId);
    var r2 = await q2;
    var ultimos = {};
    if (!r2.error) {
      (r2.data || []).forEach(function (a) {
        if (!a || !a.cliente_id || !a.data) return;
        if (!ultimos[a.cliente_id] || a.data > ultimos[a.cliente_id]) ultimos[a.cliente_id] = a.data;
      });
    }

    var lista = (r1.data || []).map(function (c) {
      c.ultimo_atendimento = ultimos[c.id] || null;
      return mapRow(c);
    });
    if (f.situacao === 'ja_atendido') lista = lista.filter(function (c) { return !!c.ultimo_atendimento; });
    if (f.situacao === 'nunca_atendido') lista = lista.filter(function (c) { return !c.ultimo_atendimento; });
    window.clients = lista;
  }

  /* ---------- ordenação ---------- */
  function aplicarOrdenacao(lista) {
    var s = window.clientsSort;
    var arr = lista.slice();
    if (!s || !s.key) {
      return arr.sort(function (a, b) {
        return norm(a.nome).localeCompare(norm(b.nome), 'pt-BR');
      });
    }
    var mult = s.dir === 'desc' ? -1 : 1;
    return arr.sort(function (a, b) {
      if (s.key === 'nome') {
        return norm(a.nome).localeCompare(norm(b.nome), 'pt-BR') * mult;
      }
      var va = a[s.key] ? String(a[s.key]) : '';
      var vb = b[s.key] ? String(b[s.key]) : '';
      // "Nunca atendido" (null) sempre agrupado no final, em ASC e DESC.
      if (!va && !vb) return norm(a.nome).localeCompare(norm(b.nome), 'pt-BR');
      if (!va) return 1;
      if (!vb) return -1;
      if (va === vb) return norm(a.nome).localeCompare(norm(b.nome), 'pt-BR');
      return (va < vb ? -1 : 1) * mult;
    });
  }

  function pintarCabecalho() {
    document.querySelectorAll('#page-clientes th.cf-sortable').forEach(function (th) {
      var s = window.clientsSort;
      var ativo = s && s.key === th.getAttribute('data-sort');
      th.classList.toggle('is-sorted', !!ativo);
      th.classList.toggle('is-asc', !!(ativo && s.dir === 'asc'));
      th.classList.toggle('is-desc', !!(ativo && s.dir === 'desc'));
    });
  }

  /* ---------- render ---------- */
  var renderOriginal = window.renderClients;

  window.renderClients = function renderClients() {
    if (typeof window.setupClientsSearch === 'function') window.setupClientsSearch();
    setupFiltrosUI();

    var tbody = document.getElementById('clients-tbody');
    if (!tbody) return;

    // Se a tabela ainda não tem as novas colunas, usa o render original.
    var head = document.querySelector('#page-clientes th.cf-sortable');
    if (!head && typeof renderOriginal === 'function') return renderOriginal();

    tbody.innerHTML = '';
    var hoje = new Date();
    var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var todayStr = pad2(hoje.getDate()) + '/' + pad2(hoje.getMonth() + 1);
    var birthdayNames = [];

    var termo = norm(window.clientsSearchTerm || '');
    var termoDigits = onlyDigits(window.clientsSearchTerm || '');
    var lista = (window.clients || []).filter(function (c) {
      if (!termo) return true;
      if (norm(c && c.nome).indexOf(termo) !== -1) return true;
      return !!(termoDigits && onlyDigits(c && c.telefone).indexOf(termoDigits) !== -1);
    });
    lista = aplicarOrdenacao(lista);
    pintarCabecalho();

    lista.forEach(function (c) {
      var tr = document.createElement('tr');
      tr.onclick = function () { if (typeof openHistorico === 'function') openHistorico(c); };

      var birthFormatted = c.nascimento ? String(c.nascimento).split('-').reverse().join('/') : '-';
      var isBirthday = false;
      if (c.nascimento) {
        var parts = String(c.nascimento).split('-');
        isBirthday = (pad2(parseInt(parts[2], 10)) + '/' + pad2(parseInt(parts[1], 10))) === todayStr;
        if (isBirthday) birthdayNames.push(c.nome);
      }
      var bIcon = isBirthday ? ' <i class="fa-solid fa-cake-candles birthday-icon"></i>' : '';
      var safeName = String(c.nome || '').replace(/"/g, '&quot;');

      var svgUser = '<svg class="cell-svg" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
      var svgPhone = '<svg class="cell-svg" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
      var svgCake = '<svg class="cell-svg" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3"/><path d="M12 8v3"/><path d="M17 8v3"/><path d="M7 4h.01"/><path d="M12 4h.01"/><path d="M17 4h.01"/></svg>';
      var svgCal = '<svg class="cell-svg" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
      var svgCheck = '<svg class="cell-svg" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

      // Badge de cliente inativo (comportamento existente preservado)
      var inativoBadge = '';
      try {
        if (window.INATIVO_CFG && window.INATIVO_CFG.ativo && typeof getDiasSemAgendamentoCliente === 'function') {
          var diasCfg = parseInt(window.INATIVO_CFG.dias, 10) || 0;
          if (diasCfg > 0) {
            var diasSem = getDiasSemAgendamentoCliente(c.id);
            if (diasSem !== null && diasSem >= diasCfg) {
              inativoBadge =
                ' <span class="client-inactive-badge" title="Cliente sem agendamentos há ' + diasSem + ' dias">' +
                  '<span class="cib-icon" aria-hidden="true">⚠️</span>' +
                  '<span class="cib-text">Sem vir há ' + diasSem + ' dias</span>' +
                '</span>';
            }
          }
        }
      } catch (_) { /* silencioso */ }

      var atendido = !!c.ultimo_atendimento;
      var ultimoHtml = atendido
        ? fmtDateBR(c.ultimo_atendimento)
        : '<span class="client-status-badge is-never">Nunca atendido</span>';
      var situacaoHtml = atendido
        ? '<span class="client-status-badge is-done">Já atendido</span>'
        : '';

      var telefoneFmt = (typeof formatTelefoneDisplay === 'function')
        ? formatTelefoneDisplay(c.telefone) : (c.telefone || '');

      tr.innerHTML =
        '<td class="cell-icon-name" data-label="Nome">' +
          '<span class="cell-icon-svg">' + svgUser + '</span>' +
          '<span class="cell-label">Nome</span>' +
          '<span class="cell-value cell-value-name">' + c.nome + bIcon + inativoBadge + '</span>' +
        '</td>' +
        '<td class="cell-icon-phone" data-label="Telefone">' +
          '<span class="cell-icon-svg">' + svgPhone + '</span>' +
          '<span class="cell-label">Telefone</span>' +
          '<span class="cell-value cell-value-phone">' + telefoneFmt + '</span>' +
        '</td>' +
        '<td class="cell-icon-birth" data-label="Nascimento">' +
          '<span class="cell-icon-svg">' + svgCake + '</span>' +
          '<span class="cell-label">Nascimento</span>' +
          '<span class="cell-value">' + birthFormatted + '</span>' +
        '</td>' +
        '<td class="cell-icon-created" data-label="Data de cadastro">' +
          '<span class="cell-icon-svg">' + svgCal + '</span>' +
          '<span class="cell-label">Data de cadastro</span>' +
          '<span class="cell-value">' + (fmtDateBR(c.created_at) || '-') + '</span>' +
        '</td>' +
        '<td class="cell-icon-last" data-label="Último atendimento">' +
          '<span class="cell-icon-svg">' + svgCheck + '</span>' +
          '<span class="cell-label">Último atendimento</span>' +
          '<span class="cell-value">' + ultimoHtml + ' ' + situacaoHtml + '</span>' +
        '</td>' +
        '<td class="col-acoes" data-label="Ações">' +
          '<button type="button" class="btn-edit-client" data-client-id="' + c.id + '" ' +
            'title="Editar cliente" aria-label="Editar ' + safeName + '">' +
            '<i class="fa-solid fa-pen"></i>' +
            '<span class="btn-edit-client-label">Editar</span>' +
          '</button>' +
        '</td>';

      var editBtn = tr.querySelector('.btn-edit-client');
      if (editBtn) {
        editBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (typeof openEditClienteModal === 'function') openEditClienteModal(c.id);
        });
      }
      tbody.appendChild(tr);
    });

    var banner = document.getElementById('birthday-banner');
    if (banner) {
      if (birthdayNames.length > 0) {
        banner.style.display = 'flex';
        banner.innerHTML = '<i class="fa-solid fa-cake-candles"></i> Aniversariante(s) de hoje: <span class="names">' + birthdayNames.join(', ') + '</span>';
      } else {
        banner.style.display = 'none';
      }
    }

    var count = document.getElementById('clients-count');
    if (count) {
      count.textContent = lista.length === 1
        ? 'Mostrando 1 cliente'
        : 'Mostrando ' + lista.length + ' clientes';
    }
  };

  /* ---------- UI de filtros / ordenação ---------- */
  var uiBound = false;
  function setupFiltrosUI() {
    if (uiBound) return;
    var painel = document.getElementById('clients-filtros');
    var btn = document.getElementById('btn-clients-filtros');
    if (!painel || !btn) return;
    uiBound = true;

    btn.addEventListener('click', function () {
      var aberto = !painel.hidden;
      painel.hidden = aberto;
      btn.setAttribute('aria-expanded', String(!aberto));
      btn.classList.toggle('is-open', !aberto);
    });

    var de = document.getElementById('cf-cadastro-de');
    var ate = document.getElementById('cf-cadastro-ate');
    var sit = document.getElementById('cf-situacao');

    async function aplicar() {
      window.clientsFiltros = {
        cadastroDe: de && de.value ? de.value : '',
        cadastroAte: ate && ate.value ? ate.value : '',
        situacao: sit && sit.value ? sit.value : 'todos'
      };
      await window.loadClients();
      window.renderClients();
      atualizarChip();
    }

    var aplicarBtn = document.getElementById('cf-aplicar');
    if (aplicarBtn) aplicarBtn.addEventListener('click', function () { aplicar(); });

    var limparBtn = document.getElementById('cf-limpar');
    if (limparBtn) limparBtn.addEventListener('click', function () {
      if (de) de.value = ''; if (ate) ate.value = ''; if (sit) sit.value = 'todos';
      aplicar();
    });

    if (sit) sit.addEventListener('change', function () { aplicar(); });

    function atualizarChip() {
      var f = window.clientsFiltros;
      var ativos = (f.cadastroDe ? 1 : 0) + (f.cadastroAte ? 1 : 0) + (f.situacao !== 'todos' ? 1 : 0);
      btn.classList.toggle('has-filters', ativos > 0);
    }

    // Ordenação: 1º clique ASC, 2º DESC, 3º volta ao padrão.
    document.querySelectorAll('#page-clientes th.cf-sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        var s = window.clientsSort;
        if (!s || s.key !== key) window.clientsSort = { key: key, dir: 'asc' };
        else if (s.dir === 'asc') window.clientsSort = { key: key, dir: 'desc' };
        else window.clientsSort = null;
        window.renderClients();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupFiltrosUI);
  } else {
    setupFiltrosUI();
  }
})();
