/* =====================================================================
   VENDA-BALCAO.JS — Drawer lateral de "Nova Venda" (Catálogo → Produtos)
   v2 — domínio VENDA próprio. Nenhum agendamento é criado.
   ---------------------------------------------------------------------
   • Carregue DEPOIS de script.js, pagamentos.js e tabela-precos.js:
       <link rel="stylesheet" href="/venda-balcao.css?v=2">
       <script src="/venda-balcao.js?v=2" defer></script>

   Fluxo:
     1) "🛒 Nova Venda" → window.abrirDrawerVendaBalcao({ produtos }).
     2) O usuário monta o carrinho (cliente opcional + produtos).
     3) "Continuar para pagamento" → abre o MESMO modal de pagamento,
        com scope 'venda'. Nada é gravado no banco nesse momento.
     4) Ao confirmar, o target 'venda' do pagamentos.js chama a RPC
        transacional `registrar_venda`, que cria venda + itens +
        pagamentos e dá baixa no estoque numa única transação.
     5) Falha em qualquer etapa → rollback completo, carrinho intacto.

   PRINCÍPIO: zero duplicação de UI e zero acoplamento com agendamentos.
   Não existe rascunho, registro órfão nem job de limpeza.
   ===================================================================== */
(function(){
  'use strict';
  if (window.__SLOTIFY_VENDA_BALCAO_LOADED__) return;
  window.__SLOTIFY_VENDA_BALCAO_LOADED__ = true;

  console.log('%c🛒 venda-balcao.js v1', 'background:#6c3aed;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700', 'carregado');

  // ---------------- Helpers ----------------
  function getSb(){ return window.supabaseClient || window.supabase || null; }
  function tid(){
    try { return (typeof getCurrentTenantId === 'function') ? getCurrentTenantId() : (window.currentTenantId || null); }
    catch(_){ return window.currentTenantId || null; }
  }
  function round2(n){ return Math.round((Number(n)||0)*100)/100; }
  function fmtBRL(n){ n=Number(n)||0; return n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function normalize(s){
    return String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  }
  function todayStr(){
    var d = new Date();
    var mm = String(d.getMonth()+1).padStart(2,'0');
    var dd = String(d.getDate()).padStart(2,'0');
    return d.getFullYear()+'-'+mm+'-'+dd;
  }
  function nowHHMM(){
    var d = new Date();
    return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+':00';
  }
  function fotoDoProduto(p){
    return p && (p.foto_url || p.imagem_url || p.image_url || p.foto || p.imagem) || '';
  }
  function precoDoProduto(p){
    var v = p && (p.valor != null ? p.valor : (p.preco != null ? p.preco : 0));
    var n = Number(v); return isFinite(n) ? n : 0;
  }

  // ---------------- Estado do drawer ----------------
  var state = {
    open: false,
    produtos: [],           // catálogo (fonte)
    clientes: [],           // cache local
    cliente: null,          // { id, nome } ou null → Consumidor Final
    profissionais: [],      // cache local
    profissional: null,     // { id, nome } — OBRIGATÓRIO
    cart: [],               // [{produto_id, nome, foto, preco, qtd}]
    busyProd: false,
    savingSale: false,
    saleConcluida: false,
    saleId: null            // id da venda (só existe DEPOIS da RPC)
  };

  // ---------------- DOM do drawer ----------------
  function ensureDrawer(){
    if (document.getElementById('vb-drawer')) return;

    var overlay = document.createElement('div');
    overlay.id = 'vb-overlay';
    overlay.className = 'vb-overlay';
    overlay.addEventListener('click', function(){ fecharDrawer(); });

    var drawer = document.createElement('aside');
    drawer.id = 'vb-drawer';
    drawer.className = 'vb-drawer';
    drawer.setAttribute('role','dialog');
    drawer.setAttribute('aria-label','Nova Venda');
    drawer.innerHTML = ''
      + '<header class="vb-header">'
      +   '<div class="vb-title"><i class="fa-solid fa-cart-shopping"></i> Nova Venda</div>'
      +   '<button type="button" class="vb-close" id="vb-close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>'
      + '</header>'
      + '<div class="vb-body">'
      +   '<section class="vb-section">'
      +     '<label class="vb-label">Cliente <span class="vb-optional">(opcional)</span></label>'
      +     '<div class="vb-cliente-row">'
      +       '<div class="vb-search-wrap">'
      +         '<i class="fa-solid fa-magnifying-glass"></i>'
      +         '<input type="text" id="vb-cliente-input" placeholder="Buscar cliente por nome ou telefone..." autocomplete="off">'
      +         '<div class="vb-suggest" id="vb-cliente-suggest"></div>'
      +       '</div>'
      +       '<button type="button" class="vb-btn-ghost" id="vb-consumidor-final">Consumidor Final</button>'
      +     '</div>'
      +     '<div class="vb-cliente-selected" id="vb-cliente-selected" style="display:none;"></div>'
      +   '</section>'

      +   '<section class="vb-section">'
      +     '<label class="vb-label">Profissional que vendeu <span class="vb-required">*</span></label>'
      +     '<select id="vb-profissional-select" class="vb-select" required>'
      +       '<option value="">Selecione um profissional...</option>'
      +     '</select>'
      +   '</section>'

      +   '<section class="vb-section">'
      +     '<label class="vb-label">Adicionar produtos</label>'
      +     '<div class="vb-search-wrap">'
      +       '<i class="fa-solid fa-magnifying-glass"></i>'
      +       '<input type="text" id="vb-produto-input" placeholder="Buscar produto..." autocomplete="off">'
      +     '</div>'
      +     '<div class="vb-produtos-list" id="vb-produtos-list"></div>'
      +   '</section>'

      +   '<section class="vb-section vb-cart-section">'
      +     '<div class="vb-cart-head">'
      +       '<span class="vb-label vb-label-inline">Carrinho</span>'
      +       '<button type="button" class="vb-link-danger" id="vb-limpar-carrinho">Limpar</button>'
      +     '</div>'
      +     '<div class="vb-cart" id="vb-cart"></div>'
      +   '</section>'
      + '</div>'
      + '<footer class="vb-footer">'
      +   '<div class="vb-footer-row"><span>Total de itens:</span><strong id="vb-total-itens">0</strong></div>'
      +   '<div class="vb-footer-row vb-footer-total"><span>Total:</span><strong id="vb-total-valor">R$ 0,00</strong></div>'
      +   '<button type="button" class="vb-btn-primary" id="vb-continuar" disabled>'
      +     '<span>Continuar para pagamento</span> <i class="fa-solid fa-arrow-right"></i>'
      +   '</button>'
      + '</footer>';

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    // Listeners
    drawer.querySelector('#vb-close').addEventListener('click', fecharDrawer);
    drawer.querySelector('#vb-consumidor-final').addEventListener('click', function(){
      state.cliente = null;
      renderClienteSelecionado();
      var i = drawer.querySelector('#vb-cliente-input'); if (i){ i.value = ''; }
      hideClienteSuggest();
      toast('Cliente: Consumidor Final');
    });
    drawer.querySelector('#vb-cliente-input').addEventListener('input', onClienteInput);
    drawer.querySelector('#vb-produto-input').addEventListener('input', renderProdutos);
    drawer.querySelector('#vb-profissional-select').addEventListener('change', function(ev){
      var id = ev.target.value || '';
      if (!id){ state.profissional = null; renderCart(); return; }
      var p = (state.profissionais || []).find(function(x){ return x.id === id; });
      state.profissional = p ? { id: p.id, nome: p.nome } : null;
      renderCart();
    });
    drawer.querySelector('#vb-limpar-carrinho').addEventListener('click', function(){
      state.cart = [];
      renderCart();
    });
    drawer.querySelector('#vb-continuar').addEventListener('click', continuarPagamento);

    document.addEventListener('keydown', function(ev){
      if (ev.key === 'Escape' && state.open) fecharDrawer();
    });
  }

  function abrirDrawer(){
    ensureDrawer();
    document.getElementById('vb-overlay').classList.add('is-open');
    document.getElementById('vb-drawer').classList.add('is-open');
    state.open = true;
  }
  function fecharDrawer(){
    if (!document.getElementById('vb-drawer')) return;
    document.getElementById('vb-overlay').classList.remove('is-open');
    document.getElementById('vb-drawer').classList.remove('is-open');
    state.open = false;
  }

  // ---------------- Cliente ----------------
  async function carregarClientes(){
    if (state.clientes.length) return state.clientes;
    var sb = getSb(); if (!sb) return [];
    var t = tid();
    var q = sb.from('clientes').select('id, nome, telefone').order('nome');
    if (t) q = q.eq('tenant_id', t);
    var r = await q;
    if (r.error){ console.error('[venda-balcao] clientes', r.error); return []; }
    state.clientes = r.data || [];
    return state.clientes;
  }

  async function onClienteInput(ev){
    var q = normalize(ev.target.value || '').trim();
    if (!q){ hideClienteSuggest(); return; }
    var arr = await carregarClientes();
    var res = arr.filter(function(c){
      return normalize(c.nome).indexOf(q) !== -1
          || normalize(c.telefone || '').indexOf(q) !== -1;
    }).slice(0, 8);
    var box = document.getElementById('vb-cliente-suggest');
    if (!res.length){
      box.innerHTML = '<div class="vb-suggest-empty">Nenhum cliente encontrado.</div>';
    } else {
      box.innerHTML = res.map(function(c){
        return '<button type="button" class="vb-suggest-item" data-id="'+ escapeHtml(c.id) +'">'
          + '<div class="vb-suggest-name">'+ escapeHtml(c.nome || '(sem nome)') +'</div>'
          + (c.telefone ? '<div class="vb-suggest-sub">'+ escapeHtml(c.telefone) +'</div>' : '')
          + '</button>';
      }).join('');
      box.querySelectorAll('.vb-suggest-item').forEach(function(btn){
        btn.addEventListener('click', function(){
          var id = btn.getAttribute('data-id');
          var c = arr.find(function(x){ return x.id === id; });
          if (!c) return;
          state.cliente = { id: c.id, nome: c.nome, telefone: c.telefone || '' };
          document.getElementById('vb-cliente-input').value = '';
          hideClienteSuggest();
          renderClienteSelecionado();
        });
      });
    }
    box.classList.add('is-open');
  }
  function hideClienteSuggest(){
    var box = document.getElementById('vb-cliente-suggest');
    if (box){ box.classList.remove('is-open'); box.innerHTML = ''; }
  }
  function renderClienteSelecionado(){
    var el = document.getElementById('vb-cliente-selected');
    if (!el) return;
    if (state.cliente && state.cliente.id){
      el.style.display = '';
      el.innerHTML = '<i class="fa-solid fa-user"></i> <strong>'+ escapeHtml(state.cliente.nome) +'</strong>'
        + (state.cliente.telefone ? ' <span class="vb-muted">'+ escapeHtml(state.cliente.telefone) +'</span>' : '')
        + '<button type="button" class="vb-chip-remove" id="vb-cliente-clear" aria-label="Remover"><i class="fa-solid fa-xmark"></i></button>';
      el.querySelector('#vb-cliente-clear').addEventListener('click', function(){
        state.cliente = null;
        renderClienteSelecionado();
      });
    } else {
      el.style.display = 'none';
      el.innerHTML = '';
    }
  }

  // ---------------- Profissional ----------------
  // ✅ REGRA (igual às demais telas do app, ex.: novo agendamento):
  //    - só profissionais com `ativo !== false`
  //    - e, se houver usuário vinculado, ao menos 1 usuário ATIVO
  //    A fonte preferencial é o cache global `allProfissionais`, que o
  //    script.js já monta aplicando exatamente essa regra em loadProfissionais().
  function profissionaisDoCacheGlobal(){
    var g = (typeof window.allProfissionais !== 'undefined' && Array.isArray(window.allProfissionais))
      ? window.allProfissionais
      : (typeof allProfissionais !== 'undefined' && Array.isArray(allProfissionais) ? allProfissionais : null);
    if (!g || !g.length) return null;
    return g.filter(function(p){ return p && p.ativo !== false; })
            .map(function(p){ return { id: p.id, nome: p.nome }; });
  }

  async function carregarProfissionais(force){
    if (!force && state.profissionais.length) return state.profissionais;

    // 1) cache global do script.js (já filtrado por usuários ativos)
    var cache = profissionaisDoCacheGlobal();
    if (cache){
      state.profissionais = cache;
      return state.profissionais;
    }

    // 2) fallback: replica a mesma regra direto no banco
    var sb = getSb(); if (!sb) return [];
    var t = tid();
    var q = sb.from('profissionais').select('id, nome, ativo').order('nome');
    if (t) q = q.eq('tenant_id', t);
    var r = await q;
    var lista;
    if (r.error){
      var q2 = sb.from('profissionais').select('id, nome').order('nome');
      if (t) q2 = q2.eq('tenant_id', t);
      var r2 = await q2;
      if (r2.error){ console.error('[venda-balcao] profissionais', r2.error); return []; }
      lista = r2.data || [];
    } else {
      lista = (r.data || []).filter(function(p){ return p.ativo !== false; });
    }

    // usuários vinculados inativos → esconde o profissional
    try {
      var qu = sb.from('usuarios').select('id, profissional_id, ativo');
      if (t) qu = qu.eq('tenant_id', t);
      var ru = await qu;
      if (!ru.error){
        var temQualquer = {}, temAtivo = {};
        (ru.data || []).forEach(function(u){
          if (!u.profissional_id) return;
          temQualquer[u.profissional_id] = true;
          if (u.ativo === true) temAtivo[u.profissional_id] = true;
        });
        lista = lista.filter(function(p){
          if (!temQualquer[p.id]) return true;
          return !!temAtivo[p.id];
        });
      }
    } catch(e){ console.warn('[venda-balcao] filtro usuarios ativos falhou', e); }

    state.profissionais = lista.map(function(p){ return { id: p.id, nome: p.nome }; });
    return state.profissionais;
  }
  function renderProfissionaisSelect(){
    var sel = document.getElementById('vb-profissional-select');
    if (!sel) return;
    var currentId = state.profissional && state.profissional.id || '';
    var opts = ['<option value="">Selecione um profissional...</option>'];
    (state.profissionais || []).forEach(function(p){
      opts.push('<option value="'+ escapeHtml(p.id) +'"'+ (p.id === currentId ? ' selected' : '') +'>'+ escapeHtml(p.nome || '(sem nome)') +'</option>');
    });
    sel.innerHTML = opts.join('');
  }


  // ---------------- Produtos ----------------
  function renderProdutos(){
    var listEl = document.getElementById('vb-produtos-list');
    if (!listEl) return;
    var q = normalize((document.getElementById('vb-produto-input').value || '')).trim();
    var arr = (state.produtos || []).filter(function(p){
      if (!q) return true;
      return normalize(p.nome).indexOf(q) !== -1;
    }).slice(0, 60);
    if (!arr.length){
      listEl.innerHTML = '<div class="vb-empty-mini">Nenhum produto encontrado.</div>';
      return;
    }
    listEl.innerHTML = arr.map(function(p){
      var foto = fotoDoProduto(p);
      var thumb = foto
        ? '<div class="vb-thumb"><img src="'+ escapeHtml(foto) +'" alt="" loading="lazy"></div>'
        : '<div class="vb-thumb vb-thumb-empty"><i class="fa-solid fa-box"></i></div>';
      return '<div class="vb-produto-row" data-id="'+ escapeHtml(p.id) +'">'
        + thumb
        + '<div class="vb-produto-info">'
        +   '<div class="vb-produto-nome">'+ escapeHtml(p.nome || '(sem nome)') +'</div>'
        +   '<div class="vb-produto-preco">'+ escapeHtml(fmtBRL(precoDoProduto(p))) +'</div>'
        + '</div>'
        + '<button type="button" class="vb-btn-add" aria-label="Adicionar"><i class="fa-solid fa-plus"></i></button>'
        + '</div>';
    }).join('');
    listEl.querySelectorAll('.vb-produto-row').forEach(function(row){
      row.querySelector('.vb-btn-add').addEventListener('click', function(){
        var id = row.getAttribute('data-id');
        var p = (state.produtos || []).find(function(x){ return x.id === id; });
        if (!p) return;
        addToCart(p);
      });
    });
  }

  // ---------------- Carrinho ----------------
  function addToCart(p){
    var found = state.cart.find(function(i){ return i.produto_id === p.id; });
    if (found){
      found.qtd = (found.qtd || 1) + 1;
    } else {
      state.cart.push({
        produto_id: p.id,
        nome: p.nome || '(sem nome)',
        foto: fotoDoProduto(p),
        preco: precoDoProduto(p),
        qtd: 1
      });
    }
    renderCart();
  }
  function inc(id){
    var it = state.cart.find(function(i){ return i.produto_id === id; });
    if (!it) return; it.qtd = (it.qtd||1) + 1; renderCart();
  }
  function dec(id){
    var it = state.cart.find(function(i){ return i.produto_id === id; });
    if (!it) return;
    it.qtd = Math.max(1, (it.qtd||1) - 1);
    renderCart();
  }
  function rmv(id){
    state.cart = state.cart.filter(function(i){ return i.produto_id !== id; });
    renderCart();
  }
  function totalItens(){ return state.cart.reduce(function(s,i){ return s + (i.qtd||0); }, 0); }
  function totalValor(){ return round2(state.cart.reduce(function(s,i){ return s + (Number(i.preco)||0) * (Number(i.qtd)||0); }, 0)); }

  function renderCart(){
    var el = document.getElementById('vb-cart');
    if (!el) return;
    if (!state.cart.length){
      el.innerHTML = '<div class="vb-empty-mini">Nenhum item no carrinho.</div>';
    } else {
      el.innerHTML = state.cart.map(function(i){
        var foto = i.foto
          ? '<div class="vb-thumb vb-thumb-sm"><img src="'+ escapeHtml(i.foto) +'" alt="" loading="lazy"></div>'
          : '<div class="vb-thumb vb-thumb-sm vb-thumb-empty"><i class="fa-solid fa-box"></i></div>';
        var subtotal = round2((Number(i.preco)||0) * (Number(i.qtd)||0));
        return '<div class="vb-cart-row" data-id="'+ escapeHtml(i.produto_id) +'">'
          + foto
          + '<div class="vb-cart-info">'
          +   '<div class="vb-cart-nome">'+ escapeHtml(i.nome) +'</div>'
          +   '<div class="vb-cart-unit">'+ escapeHtml(fmtBRL(i.preco)) +' un.</div>'
          + '</div>'
          + '<div class="vb-qty">'
          +   '<button type="button" class="vb-qty-btn" data-act="dec" aria-label="Diminuir"><i class="fa-solid fa-minus"></i></button>'
          +   '<span class="vb-qty-num">'+ (i.qtd||1) +'</span>'
          +   '<button type="button" class="vb-qty-btn" data-act="inc" aria-label="Aumentar"><i class="fa-solid fa-plus"></i></button>'
          + '</div>'
          + '<div class="vb-cart-sub">'+ escapeHtml(fmtBRL(subtotal)) +'</div>'
          + '<button type="button" class="vb-cart-rm" aria-label="Remover"><i class="fa-solid fa-trash"></i></button>'
          + '</div>';
      }).join('');
      el.querySelectorAll('.vb-cart-row').forEach(function(row){
        var id = row.getAttribute('data-id');
        row.querySelector('[data-act="inc"]').addEventListener('click', function(){ inc(id); });
        row.querySelector('[data-act="dec"]').addEventListener('click', function(){ dec(id); });
        row.querySelector('.vb-cart-rm').addEventListener('click', function(){ rmv(id); });
      });
    }
    document.getElementById('vb-total-itens').textContent = totalItens();
    document.getElementById('vb-total-valor').textContent = fmtBRL(totalValor());
    document.getElementById('vb-continuar').disabled = state.cart.length === 0 || state.savingSale || !state.profissional;
  }

  // ---------------- Toast ----------------
  function toast(msg, tipo){
    if (typeof window.showToast === 'function'){
      try { window.showToast(msg, tipo || 'sucesso'); return; } catch(_){}
    }
    console.log('[venda-balcao]', msg);
  }


  // ---------------- Persistência ----------------
  // Não há persistência aqui: a única porta de escrita é a RPC
  // `registrar_venda`, chamada pelo target 'venda' do pagamentos.js.
  // Este módulo só monta o payload do carrinho.
  function montarContextoVenda(){
    return {
      profissional_id:  state.profissional && state.profissional.id,
      cliente_id:       state.cliente ? state.cliente.id : null,
      cliente_nome:     state.cliente ? state.cliente.nome : 'Consumidor Final',
      cliente_telefone: state.cliente ? (state.cliente.telefone || null) : null,
      observacoes:      null,
      subtitulo:        todayStr().split('-').reverse().join('/') + ' · ' + nowHHMM().slice(0,5)
                        + ' · ' + (state.profissional ? state.profissional.nome : ''),
      itens: state.cart.map(function(i){
        return {
          produto_id:     i.produto_id,
          descricao:      i.nome,           // snapshot do nome no momento da venda
          quantidade:     Number(i.qtd) || 1,
          valor_unitario: round2(i.preco),
          desconto_valor: 0
        };
      })
    };
  }

  function restaurarBotaoContinuar(){
    state.savingSale = false;
    var btn = document.getElementById('vb-continuar');
    if (btn){
      btn.innerHTML = 'Continuar para pagamento <i class="fa-solid fa-arrow-right"></i>';
      btn.disabled = state.cart.length === 0 || !state.profissional;
    }
  }

  function limparAposVenda(){
    state.cart = [];
    state.cliente = null;
    state.profissional = null;
    state.saleId = null;
    restaurarBotaoContinuar();
    renderCart();
    renderClienteSelecionado();
    renderProfissionaisSelect();
  }

  // ---------------- Continuar → Pagamento ----------------
  async function continuarPagamento(){
    if (state.savingSale) return;
    if (!state.cart.length) return;
    if (!state.profissional || !state.profissional.id){
      toast('Selecione o profissional que realizou a venda', 'erro');
      try { document.getElementById('vb-profissional-select').focus(); } catch(_){}
      return;
    }
    if (typeof window.abrirModalPagamento !== 'function'){
      toast('Módulo de pagamento indisponível', 'erro');
      return;
    }

    state.savingSale = true;
    var btn = document.getElementById('vb-continuar');
    btn.disabled = true;

    try{
      // Abre o modal existente no escopo 'venda'.
      // mode 'concluir': não há pagamentos anteriores para carregar,
      // porque a venda ainda não existe no banco.
      await window.abrirModalPagamento({
        scope: 'venda',
        mode: 'concluir',
        total: totalValor(),
        contexto: montarContextoVenda(),
        onSuccess: async function(vendaId){
          state.saleId = vendaId || null;
          // Estoque já foi baixado dentro da transação da RPC.
          try {
            if (typeof window.loadProdutosVendaCache === 'function'){
              await window.loadProdutosVendaCache(true);
            }
          } catch(_){}
          limparAposVenda();
          fecharDrawer();
          try { if (typeof window.__catalogoReload === 'function') window.__catalogoReload(); } catch(_){}
          try { if (typeof window.__rodarDashboardVendas === 'function') await window.__rodarDashboardVendas(); } catch(_){}
        }
      });
      // Modal aberto: o botão volta ao normal. Se o usuário fechar sem
      // confirmar, o carrinho continua intacto e nada foi gravado.
      restaurarBotaoContinuar();
    } catch(e){
      console.error('[venda-balcao] continuar', e);
      toast('Não foi possível abrir o pagamento', 'erro');
      restaurarBotaoContinuar();
    }
  }

  // ---------------- API pública ----------------
  window.abrirDrawerVendaBalcao = function(opts){
    opts = opts || {};
    ensureDrawer();
    // fonte de produtos: 1) opts.produtos  2) __catalogoState.produtos  3) fetch direto
    if (Array.isArray(opts.produtos) && opts.produtos.length){
      state.produtos = opts.produtos.slice();
    } else if (window.__catalogoState && Array.isArray(window.__catalogoState.produtos) && window.__catalogoState.produtos.length){
      state.produtos = window.__catalogoState.produtos.slice();
    } else {
      state.produtos = [];
      carregarProdutosDoBanco().then(function(list){
        state.produtos = list; renderProdutos();
      });
    }
    state.cart = [];
    state.cliente = null;
    state.profissional = null;
    state.saleId = null;
    renderProdutos();
    renderCart();
    renderClienteSelecionado();
    abrirDrawer();
    carregarClientes().catch(function(){});
    // recarrega sempre: garante que profissionais desativados sumam do select
    carregarProfissionais(true).then(function(){ renderProfissionaisSelect(); }).catch(function(){});
  };

  async function carregarProdutosDoBanco(){
    var sb = getSb(); if (!sb) return [];
    var t = tid();
    var q = sb.from('produtos').select('*').eq('ativo', true);
    if (t) q = q.eq('tenant_id', t);
    var r = await q;
    if (r.error){ console.error('[venda-balcao] produtos', r.error); return []; }
    return r.data || [];
  }

  // =====================================================================
  // Dashboard
  // ---------------------------------------------------------------------
  // Nenhum patch, nenhum filtro, nenhum `if (origem === 'BALCAO')`.
  // Vendas vivem em `vendas` e agendamentos em `agendamentos`: a separação
  // é estrutural. Quem quiser faturamento de produtos lê `vendas`.
  // =====================================================================

})();
