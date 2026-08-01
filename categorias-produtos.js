/* =====================================================================
   CATEGORIAS-PRODUTOS.JS — Slotify
   Etapa 2 da feature "Comissão sobre Venda de Produtos".

   O QUE ESTE ARQUIVO FAZ (add-on 100% isolado):
     1) Injeta o card "Categorias" na tela de Configurações,
        IMEDIATAMENTE ACIMA do card "Comissões".
     2) Injeta a página "Categorias de Produtos" (#page-categorias-produtos)
        dentro do <main>, seguindo o padrão visual das demais telas.
     3) Injeta os modais de cadastro/edição e de confirmação de exclusão.
     4) CRUD direto na tabela public.product_categories (RLS respeitada).

   NÃO altera nenhuma funcionalidade existente. Carregue em agenda.html:
     <link rel="stylesheet" href="/categorias-produtos.css?v=1">
     <script src="/categorias-produtos.js?v=1" defer></script>
   ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_CATEGORIAS_PRODUTOS__) return;
  window.__SLOTIFY_CATEGORIAS_PRODUTOS__ = true;

  var VERSION = 'v2-2026-08-01-etapa3';
  console.log('%c🏷️ categorias-produtos.js ' + VERSION + ' carregado',
    'background:#6c3aed;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700');

  var PAGE_ID = 'page-categorias-produtos';
  var MODAL_FORM_ID = 'modal-categoria-produto';
  var MODAL_DEL_ID = 'modal-categoria-produto-excluir';

  var state = {
    categorias: [],
    counts: {},
    loading: false,
    editingId: null,
    deletingId: null
  };

  /* ---------------------------------------------------------------
     Helpers
     --------------------------------------------------------------- */
  function sb() {
    return window.supabaseClient || null;
  }

  function getTenantId() {
    try { if (window.currentTenantId) return window.currentTenantId; } catch (_) {}
    try {
      if (window.currentUser && window.currentUser.tenantId) return window.currentUser.tenantId;
    } catch (_) {}
    try { return localStorage.getItem('currentTenantId'); } catch (_) {}
    return null;
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') return window.showToast(msg, type || 'success');
    if (type === 'error') console.error(msg); else console.log(msg);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtPct(v) {
    var n = Number(v || 0);
    return n.toFixed(2).replace('.', ',') + '%';
  }

  function openModalById(id) {
    if (typeof window.openModal === 'function') { window.openModal(id); return; }
    var el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function closeModalById(id) {
    if (typeof window.closeModal === 'function') { window.closeModal(id); return; }
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  }

  /* ---------------------------------------------------------------
     1) Card na tela de Configurações (acima de "Comissões")
     --------------------------------------------------------------- */
  function buildConfigCard() {
    var wrap = document.createElement('div');
    wrap.className = 'config-section';
    wrap.id = 'config-section-categorias-produtos';
    wrap.innerHTML =
      '<div class="config-section-left">' +
        '<h3>Categorias</h3>' +
        '<p class="config-help-text">' +
          'Organize seus produtos em categorias e defina a comissão base ' +
          'utilizada para venda de produtos.' +
        '</p>' +
      '</div>' +
      '<div class="config-section-right">' +
        '<div class="hc-trigger-card">' +
          '<button type="button" id="btn-abrir-categorias-produtos" class="hc-trigger-btn">' +
            '<i class="fa-solid fa-tags"></i>' +
            '<span>Gerenciar categorias de produtos</span>' +
          '</button>' +
          '<p class="hc-resumo">Cadastre, edite e remova categorias de produtos.</p>' +
        '</div>' +
      '</div>';
    wrap.querySelector('#btn-abrir-categorias-produtos')
      .addEventListener('click', function () { abrirTelaCategoriasProdutos(); });
    return wrap;
  }

  function injectConfigCard() {
    if (document.getElementById('config-section-categorias-produtos')) return true;
    var comissoesInput = document.getElementById('ff-comissoes');
    var alvo = comissoesInput ? comissoesInput.closest('.config-section') : null;
    if (!alvo || !alvo.parentNode) return false;
    alvo.parentNode.insertBefore(buildConfigCard(), alvo);
    return true;
  }

  /* ---------------------------------------------------------------
     2) Página de gerenciamento
     --------------------------------------------------------------- */
  function injectPage() {
    if (document.getElementById(PAGE_ID)) return true;
    var main = document.querySelector('main');
    if (!main) return false;

    var page = document.createElement('div');
    page.className = 'page';
    page.id = PAGE_ID;
    page.innerHTML =
      '<div class="page-header cat-page-header">' +
        '<button type="button" class="com-back-btn" id="cat-back-btn" aria-label="Voltar">' +
          '<i class="fa-solid fa-arrow-left"></i>' +
        '</button>' +
        '<h2>Categorias de Produtos</h2>' +
        '<button class="btn-novo" id="btn-nova-categoria">' +
          '<i class="fa-solid fa-plus"></i> Nova Categoria' +
        '</button>' +
      '</div>' +
      '<div class="cat-wrapper">' +
        '<div class="cat-table-wrap">' +
          '<table class="cat-table">' +
            '<thead>' +
              '<tr>' +
                '<th>Nome</th>' +
                '<th>Comissão (%)</th>' +
                '<th>Status</th>' +
                '<th>Qtd. de Produtos</th>' +
                '<th class="cat-col-acoes">Ações</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody id="cat-tbody"></tbody>' +
          '</table>' +
        '</div>' +
        '<div class="cat-empty" id="cat-empty" hidden>' +
          '<div class="cat-empty-icon"><i class="fa-solid fa-tags"></i></div>' +
          '<div class="cat-empty-title">Nenhuma categoria cadastrada ainda.</div>' +
        '</div>' +
      '</div>';

    main.appendChild(page);
    page.querySelector('#cat-back-btn')
      .addEventListener('click', voltarDaTelaCategoriasProdutos);
    page.querySelector('#btn-nova-categoria')
      .addEventListener('click', function () { abrirModalCategoria(null); });
    return true;
  }

  /* ---------------------------------------------------------------
     3) Modais
     --------------------------------------------------------------- */
  function injectModals() {
    if (!document.getElementById(MODAL_FORM_ID)) {
      var m = document.createElement('div');
      m.className = 'modal-overlay';
      m.id = MODAL_FORM_ID;
      m.innerHTML =
        '<div class="modal modal-small">' +
          '<div class="modal-header">' +
            '<h3 id="cat-modal-title">Nova Categoria</h3>' +
            '<button class="modal-close" type="button" id="cat-modal-close">&times;</button>' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="cat-nome">Nome *</label>' +
            '<input type="text" id="cat-nome" placeholder="Ex: Shampoos" autocomplete="off" maxlength="120">' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="cat-descricao">Descrição</label>' +
            '<textarea id="cat-descricao" rows="3" placeholder="Opcional"></textarea>' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="cat-comissao">Comissão (%) *</label>' +
            '<input type="number" id="cat-comissao" min="0" max="100" step="0.01" inputmode="decimal" value="0">' +
          '</div>' +
          '<label class="ac-toggle-row" for="cat-ativa">' +
            '<input type="checkbox" id="cat-ativa" checked>' +
            '<span class="ac-toggle-track"><span class="ac-toggle-thumb"></span></span>' +
            '<span class="ac-toggle-label">Ativa</span>' +
          '</label>' +
          '<p class="cat-feedback" id="cat-feedback" style="display:none;"></p>' +
          '<div class="modal-actions">' +
            '<button type="button" class="btn-cancel" id="cat-btn-cancelar">Cancelar</button>' +
            '<button type="button" class="btn-submit" id="cat-btn-salvar">' +
              '<i class="fa-regular fa-floppy-disk"></i> Salvar' +
            '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(m);
      m.querySelector('#cat-modal-close').addEventListener('click', fecharModalCategoria);
      m.querySelector('#cat-btn-cancelar').addEventListener('click', fecharModalCategoria);
      m.querySelector('#cat-btn-salvar').addEventListener('click', salvarCategoria);
    }

    if (!document.getElementById(MODAL_DEL_ID)) {
      var d = document.createElement('div');
      d.className = 'modal-overlay';
      d.id = MODAL_DEL_ID;
      d.innerHTML =
        '<div class="modal modal-small">' +
          '<div class="modal-header">' +
            '<h3>Excluir categoria</h3>' +
            '<button class="modal-close" type="button" id="cat-del-close">&times;</button>' +
          '</div>' +
          '<p class="cat-confirm-text" id="cat-del-text">' +
            'Tem certeza que deseja excluir esta categoria?' +
          '</p>' +
          '<div class="modal-actions">' +
            '<button type="button" class="btn-cancel" id="cat-del-cancelar">Cancelar</button>' +
            '<button type="button" class="btn-submit cat-btn-danger" id="cat-del-confirmar">' +
              '<i class="fa-regular fa-trash-can"></i> Excluir' +
            '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(d);
      d.querySelector('#cat-del-close').addEventListener('click', fecharModalExcluir);
      d.querySelector('#cat-del-cancelar').addEventListener('click', fecharModalExcluir);
      d.querySelector('#cat-del-confirmar').addEventListener('click', confirmarExclusaoCategoria);
    }
  }

  /* ---------------------------------------------------------------
     Navegação
     --------------------------------------------------------------- */
  function abrirTelaCategoriasProdutos() {
    ensureInjected();
    if (typeof window.switchPage === 'function') {
      window.switchPage('categorias-produtos');
    } else {
      document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
      var el = document.getElementById(PAGE_ID);
      if (el) el.classList.add('active');
      carregarCategorias();
    }
  }

  function voltarDaTelaCategoriasProdutos() {
    if (typeof window.switchPage === 'function') {
      window.switchPage('configuracoes');
      setTimeout(function () {
        var tab = document.querySelector('.config-tab[data-config-tab="geral"]');
        if (tab) tab.click();
      }, 30);
    }
  }

  // Hook em switchPage para carregar dados ao entrar na página.
  function hookSwitchPage() {
    if (typeof window.switchPage !== 'function') return false;
    if (window.switchPage.__catHooked) return true;
    var orig = window.switchPage;
    var wrapped = function (page) {
      if (page === 'categorias-produtos') ensureInjected();
      var r = orig.apply(this, arguments);
      if (page === 'categorias-produtos') carregarCategorias();
      return r;
    };
    wrapped.__catHooked = true;
    window.switchPage = wrapped;
    return true;
  }

  /* ---------------------------------------------------------------
     Renderização
     --------------------------------------------------------------- */
  function renderCategorias() {
    var tbody = document.getElementById('cat-tbody');
    var empty = document.getElementById('cat-empty');
    var wrap = document.querySelector('#' + PAGE_ID + ' .cat-table-wrap');
    if (!tbody) return;

    if (state.loading) {
      tbody.innerHTML = '<tr><td colspan="5" class="cat-loading">Carregando…</td></tr>';
      if (empty) empty.hidden = true;
      if (wrap) wrap.hidden = false;
      return;
    }

    if (!state.categorias.length) {
      tbody.innerHTML = '';
      if (wrap) wrap.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }

    if (wrap) wrap.hidden = false;
    if (empty) empty.hidden = true;

    tbody.innerHTML = state.categorias.map(function (c) {
      return '<tr data-id="' + esc(c.id) + '">' +
        '<td>' +
          '<div class="cat-nome">' + esc(c.name) + '</div>' +
          (c.description ? '<div class="cat-desc">' + esc(c.description) + '</div>' : '') +
        '</td>' +
        '<td>' + fmtPct(c.commission_percentage) + '</td>' +
        '<td>' +
          '<span class="cat-badge ' + (c.is_active ? 'cat-badge--on' : 'cat-badge--off') + '">' +
            (c.is_active ? 'Ativa' : 'Inativa') +
          '</span>' +
        '</td>' +
        '<td>' + (state.counts[c.id] != null ? state.counts[c.id] : '…') + '</td>' +
        '<td class="cat-col-acoes">' +
          '<button type="button" class="cat-action" data-action="edit" title="Editar" aria-label="Editar">' +
            '<i class="fa-solid fa-pen"></i>' +
          '</button>' +
          '<button type="button" class="cat-action cat-action--danger" data-action="delete" title="Excluir" aria-label="Excluir">' +
            '<i class="fa-regular fa-trash-can"></i>' +
          '</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('button[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tr = btn.closest('tr');
        var id = tr && tr.getAttribute('data-id');
        var cat = state.categorias.filter(function (c) { return c.id === id; })[0];
        if (!cat) return;
        if (btn.getAttribute('data-action') === 'edit') abrirModalCategoria(cat);
        else abrirModalExcluir(cat);
      });
    });
  }

  /* ---------------------------------------------------------------
     CRUD — public.product_categories
     --------------------------------------------------------------- */
  function carregarCategorias() {
    ensureInjected();
    var client = sb();
    if (!client) { toast('Conexão com o servidor indisponível.', 'error'); return; }
    var tenantId = getTenantId();
    if (!tenantId) { toast('Tenant não identificado.', 'error'); return; }

    state.loading = true;
    renderCategorias();

    client
      .from('product_categories')
      .select('id, name, description, commission_percentage, is_active, created_at')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
      .then(function (res) {
        state.loading = false;
        if (res.error) {
          console.error('[categorias] erro ao carregar:', res.error);
          toast('Não foi possível carregar as categorias.', 'error');
          state.categorias = [];
        } else {
          state.categorias = res.data || [];
        }
        renderCategorias();
        carregarContagemProdutos(tenantId);
      });
  }

  /* Contagem real de produtos vinculados por categoria (Etapa 3) */
  function carregarContagemProdutos(tenantId) {
    var client = sb();
    if (!client || !tenantId) return;
    client
      .from('produtos')
      .select('category_id')
      .eq('tenant_id', tenantId)
      .not('category_id', 'is', null)
      .then(function (res) {
        var counts = {};
        state.categorias.forEach(function (c) { counts[c.id] = 0; });
        if (res.error) {
          console.error('[categorias] erro ao contar produtos:', res.error);
        } else {
          (res.data || []).forEach(function (p) {
            if (p.category_id == null) return;
            counts[p.category_id] = (counts[p.category_id] || 0) + 1;
          });
        }
        state.counts = counts;
        renderCategorias();
      });
  }

  /* Retorna a quantidade de produtos vinculados (consulta ao vivo) */
  function contarProdutosDaCategoria(categoriaId, tenantId) {
    var client = sb();
    return Promise.resolve(
      client.from('produtos')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('category_id', categoriaId)
    ).then(function (res) {
      if (res && res.error) throw res.error;
      return (res && typeof res.count === 'number') ? res.count : 0;
    });
  }

  function abrirModalCategoria(cat) {
    ensureInjected();
    state.editingId = cat ? cat.id : null;

    document.getElementById('cat-modal-title').textContent =
      cat ? 'Editar Categoria' : 'Nova Categoria';
    document.getElementById('cat-nome').value = cat ? (cat.name || '') : '';
    document.getElementById('cat-descricao').value = cat ? (cat.description || '') : '';
    document.getElementById('cat-comissao').value =
      cat ? Number(cat.commission_percentage || 0) : 0;
    document.getElementById('cat-ativa').checked = cat ? !!cat.is_active : true;
    setFeedback('');

    openModalById(MODAL_FORM_ID);
    setTimeout(function () {
      var i = document.getElementById('cat-nome');
      if (i) i.focus();
    }, 60);
  }

  function fecharModalCategoria() {
    state.editingId = null;
    closeModalById(MODAL_FORM_ID);
  }

  function setFeedback(msg, type) {
    var el = document.getElementById('cat-feedback');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    el.textContent = msg;
    el.className = 'cat-feedback' + (type === 'error' ? ' is-error' : '');
    el.style.display = 'block';
  }

  function salvarCategoria() {
    var client = sb();
    if (!client) { setFeedback('Conexão com o servidor indisponível.', 'error'); return; }
    var tenantId = getTenantId();
    if (!tenantId) { setFeedback('Tenant não identificado.', 'error'); return; }

    var nome = (document.getElementById('cat-nome').value || '').trim();
    var descricao = (document.getElementById('cat-descricao').value || '').trim();
    var comissaoRaw = (document.getElementById('cat-comissao').value || '').toString().replace(',', '.');
    var ativa = !!document.getElementById('cat-ativa').checked;

    if (!nome) { setFeedback('Informe o nome da categoria.', 'error'); return; }
    if (comissaoRaw === '') { setFeedback('Informe a comissão (%).', 'error'); return; }
    var comissao = Number(comissaoRaw);
    if (!isFinite(comissao) || comissao < 0 || comissao > 100) {
      setFeedback('A comissão deve estar entre 0 e 100.', 'error');
      return;
    }

    var btn = document.getElementById('cat-btn-salvar');
    if (btn) btn.disabled = true;
    setFeedback('');

    var payload = {
      name: nome,
      description: descricao || null,
      commission_percentage: comissao,
      is_active: ativa
    };

    var op;
    if (state.editingId) {
      op = client.from('product_categories')
        .update(payload)
        .eq('id', state.editingId)
        .eq('tenant_id', tenantId);
    } else {
      payload.tenant_id = tenantId;
      op = client.from('product_categories').insert(payload);
    }

    Promise.resolve(op).then(function (res) {
      if (btn) btn.disabled = false;
      if (res && res.error) {
        console.error('[categorias] erro ao salvar:', res.error);
        var msg = (res.error.code === '23505')
          ? 'Já existe uma categoria com esse nome.'
          : 'Não foi possível salvar a categoria.';
        setFeedback(msg, 'error');
        return;
      }
      toast(state.editingId ? 'Categoria atualizada!' : 'Categoria criada!', 'success');
      fecharModalCategoria();
      carregarCategorias();
    }).catch(function (e) {
      if (btn) btn.disabled = false;
      console.error('[categorias] exceção ao salvar:', e);
      setFeedback('Não foi possível salvar a categoria.', 'error');
    });
  }

  function abrirModalExcluir(cat) {
    ensureInjected();
    state.deletingId = cat.id;
    var txt = document.getElementById('cat-del-text');
    if (txt) {
      txt.innerHTML = 'Tem certeza que deseja excluir a categoria <strong>' +
        esc(cat.name) + '</strong>? Esta ação não pode ser desfeita.';
    }
    openModalById(MODAL_DEL_ID);
  }

  function fecharModalExcluir() {
    state.deletingId = null;
    closeModalById(MODAL_DEL_ID);
  }

  function confirmarExclusaoCategoria() {
    var client = sb();
    var tenantId = getTenantId();
    if (!client || !tenantId || !state.deletingId) { fecharModalExcluir(); return; }

    var btn = document.getElementById('cat-del-confirmar');
    if (btn) btn.disabled = true;

    var categoriaId = state.deletingId;

    contarProdutosDaCategoria(categoriaId, tenantId).then(function (qtd) {
      if (qtd > 0) {
        if (btn) btn.disabled = false;
        state.counts[categoriaId] = qtd;
        renderCategorias();
        toast('Esta categoria possui produtos vinculados e não pode ser excluída. ' +
              'Remova ou altere a categoria destes produtos antes de excluí-la.', 'error');
        fecharModalExcluir();
        return null;
      }
      return Promise.resolve(
      client.from('product_categories')
        .delete()
        .eq('id', categoriaId)
        .eq('tenant_id', tenantId)
      );
    }).then(function (res) {
      if (res === null) return;
      if (btn) btn.disabled = false;
      if (res && res.error) {
        console.error('[categorias] erro ao excluir:', res.error);
        toast('Não foi possível excluir a categoria.', 'error');
        return;
      }
      toast('Categoria excluída!', 'success');
      fecharModalExcluir();
      carregarCategorias();
    }).catch(function (e) {
      if (btn) btn.disabled = false;
      console.error('[categorias] exceção ao excluir:', e);
      toast('Não foi possível excluir a categoria.', 'error');
    });
  }

  /* ---------------------------------------------------------------
     Bootstrap
     --------------------------------------------------------------- */
  function ensureInjected() {
    injectPage();
    injectModals();
    injectConfigCard();
  }

  function boot() {
    ensureInjected();
    hookSwitchPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // A aba de Configurações pode ser montada depois — reinjeta o card quando aparecer.
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    injectConfigCard();
    hookSwitchPage();
    if (tries > 40) clearInterval(timer);
  }, 500);

  // API pública (mesma convenção das demais telas do sistema)
  window.abrirTelaCategoriasProdutos = abrirTelaCategoriasProdutos;
  window.voltarDaTelaCategoriasProdutos = voltarDaTelaCategoriasProdutos;
  window.initCategoriasProdutosPage = carregarCategorias;
})();
