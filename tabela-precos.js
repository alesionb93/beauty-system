/* ============================================================
   CATÁLOGO (antes: TABELA DE PREÇOS) — módulo standalone
   - Injeta item no menu lateral (abaixo de Agendamentos) — rótulo "Catálogo"
   - Cria a página com 2 abas (Serviços / Produtos)
   - Carrega dados de servicos/produtos do tenant
   - Modo "Organizar" com drag-and-drop (SortableJS)
   - Persiste a ordem em order_index (escopo por tenant)
   - Barra de busca por nome
   - NOVO: botão "🛒 Nova Venda" na aba Produtos que abre o drawer de
     Venda de Balcão (implementado em venda-balcao.js).
   ============================================================ */
(function(){
  'use strict';

  console.log('[catalogo] init (renomeado de "tabela-precos")');

  // ---------- carregar SortableJS sob demanda ----------
  function loadSortable(cb){
    if (window.Sortable) return cb();
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js';
    s.onload = cb;
    s.onerror = function(){ console.error('[catalogo] falhou ao carregar SortableJS'); };
    document.head.appendChild(s);
  }

  // ---------- carregar venda-balcao.js sob demanda ----------
  // Tenta vários caminhos possíveis (raiz do site e /public/) para funcionar
  // independentemente de como o app hospeda os assets estáticos.
  function ensureVendaBalcaoLoaded(cb){
    if (typeof window.abrirDrawerVendaBalcao === 'function') return cb(true);
    if (window.__vbLoading){
      window.__vbLoading.push(cb);
      return;
    }
    window.__vbLoading = [cb];
    function done(ok){
      var list = window.__vbLoading || []; window.__vbLoading = null;
      list.forEach(function(fn){ try { fn(ok); } catch(_){} });
    }
    // CSS (não-bloqueante)
    try {
      if (!document.querySelector('link[data-vb-css]')){
        var l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = 'venda-balcao.css'; l.setAttribute('data-vb-css','1');
        l.onerror = function(){ l.href = '/venda-balcao.css'; };
        document.head.appendChild(l);
      }
    } catch(_){}
    // JS
    var candidatos = ['venda-balcao.js', '/venda-balcao.js', './venda-balcao.js', '/public/venda-balcao.js'];
    var i = 0;
    function tentar(){
      if (i >= candidatos.length){ return done(false); }
      var src = candidatos[i++];
      var s = document.createElement('script');
      s.src = src; s.defer = true;
      s.onload = function(){
        // pequeno delay para o IIFE registrar window.abrirDrawerVendaBalcao
        setTimeout(function(){
          done(typeof window.abrirDrawerVendaBalcao === 'function');
        }, 30);
      };
      s.onerror = function(){ tentar(); };
      document.head.appendChild(s);
    }
    tentar();
  }


  // ---------- helpers ----------
  function tid(){
    try { return (typeof getCurrentTenantId === 'function') ? getCurrentTenantId() : null; }
    catch(_){ return null; }
  }
  function fmtMoney(v){
    var n = parseFloat(v); if (!isFinite(n)) n = 0;
    return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  }
  function fmtDur(min){
    var n = parseInt(min,10); if (!isFinite(n) || n<=0) return '—';
    if (n < 60) return n + ' min';
    var h = Math.floor(n/60), m = n%60;
    return m ? (h+'h '+m+'min') : (h+'h');
  }
  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function normalize(s){
    return String(s==null?'':s).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  }

  // ---------- toast local ----------
  function tpToast(msg, tipo){
    var stack = document.getElementById('tp-toast-stack');
    if (!stack){
      stack = document.createElement('div');
      stack.id = 'tp-toast-stack';
      stack.className = 'tp-toast-stack';
      document.body.appendChild(stack);
    }
    var t = document.createElement('div');
    t.className = 'tp-toast' + (tipo === 'erro' ? ' is-error' : '');
    var icon = tipo === 'erro' ? 'fa-circle-xmark' : 'fa-circle-check';
    t.innerHTML = '<i class="fa-solid '+icon+'"></i><span>'+ escapeHtml(msg) +'</span>';
    stack.appendChild(t);
    setTimeout(function(){
      t.style.transition = 'opacity .3s ease, transform .3s ease';
      t.style.opacity = '0'; t.style.transform = 'translateY(-10px)';
      setTimeout(function(){ try{ t.remove(); }catch(_){} }, 320);
    }, 2600);
  }

  // ---------- injetar botão no sidebar ----------
  function injectMenuButton(){
    var nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    // Remove item antigo (compat: pode haver duplicata renderizada por versão anterior)
    var antigos = nav.querySelectorAll('[data-page="tabela-precos"]');
    if (antigos.length > 1) {
      for (var k = 1; k < antigos.length; k++) antigos[k].remove();
    }
    var existente = nav.querySelector('[data-page="tabela-precos"]');
    if (existente){
      existente.innerHTML = '<i class="fa-solid fa-tags"></i> Catálogo';
      return;
    }
    var ref = nav.querySelector('[data-page="agendamentos"]');
    var btn = document.createElement('button');
    btn.className = 'nav-btn';
    btn.setAttribute('data-page','tabela-precos'); // mantém a chave interna p/ compat
    btn.innerHTML = '<i class="fa-solid fa-tags"></i> Catálogo';
    if (ref && ref.nextSibling) nav.insertBefore(btn, ref.nextSibling);
    else nav.appendChild(btn);

    btn.addEventListener('click', function(){
      if (typeof switchPage === 'function') switchPage('tabela-precos');
    });
  }

  // ---------- injetar página no main ----------
  function injectPage(){
    if (document.getElementById('page-tabela-precos')) return;
    var main = document.querySelector('main.main-content');
    if (!main) return;
    var page = document.createElement('div');
    page.className = 'page';
    page.id = 'page-tabela-precos';
    page.innerHTML = ''
      + '<div class="page-header">'
      +   '<h2>Catálogo</h2>'
      + '</div>'
      + '<div class="tp-toolbar">'
      +   '<div class="tp-tabs" role="tablist">'
      +     '<button type="button" class="tp-tab is-active" data-tp-tab="servicos"><i class="fa-solid fa-scissors"></i> Serviços</button>'
      +     '<button type="button" class="tp-tab" data-tp-tab="produtos"><i class="fa-solid fa-box"></i> Produtos</button>'
      +   '</div>'
      +   '<div class="tp-search">'
      +     '<i class="fa-solid fa-magnifying-glass"></i>'
      +     '<input type="text" id="tp-search-input" placeholder="Buscar por nome..." autocomplete="off">'
      +     '<button type="button" class="tp-search-clear" id="tp-search-clear" aria-label="Limpar"><i class="fa-solid fa-xmark"></i></button>'
      +   '</div>'
      +   '<div class="tp-actions">'
      +     '<button type="button" class="tp-btn" id="tp-btn-organizar"><i class="fa-solid fa-arrows-up-down-left-right"></i> Organizar</button>'
      +     '<button type="button" class="tp-btn is-primary" id="tp-btn-nova-venda" style="display:none;"><i class="fa-solid fa-cart-shopping"></i> Nova Venda</button>'
      +     '<button type="button" class="tp-btn is-primary" id="tp-btn-salvar" style="display:none;"><i class="fa-solid fa-check"></i> Salvar ordem</button>'
      +     '<button type="button" class="tp-btn is-ghost" id="tp-btn-cancelar" style="display:none;"><i class="fa-solid fa-xmark"></i> Cancelar</button>'
      +   '</div>'
      + '</div>'
      + '<div class="tp-list" id="tp-list">'
      +   '<div class="tp-empty"><i class="fa-solid fa-spinner fa-spin"></i>Carregando...</div>'
      + '</div>';
    main.appendChild(page);
  }

  // ---------- estado ----------
  var state = {
    tab: 'servicos',
    sorting: false,
    snapshot: null,
    servicos: [],
    produtos: [],
    sortable: null,
    search: ''
  };

  // Expor estado dos produtos para o venda-balcao.js reaproveitar sem refazer query
  window.__catalogoState = state;

  // ---------- data ----------
  async function loadData(which){
    if (typeof supabaseClient === 'undefined' || !supabaseClient) return [];
    var t = tid();
    var table = which === 'produtos' ? 'produtos' : 'servicos';
    var sel = which === 'produtos'
      ? '*'
      : 'id, nome, preco, duracao, order_index';
    var q = supabaseClient.from(table).select(sel);
    if (t) q = q.eq('tenant_id', t);
    if (which === 'produtos') q = q.eq('ativo', true);
    var resp = await q;
    if (resp.error){
      console.error('[catalogo] load '+table, resp.error);
      if (resp.error.code === '42703'){
        var sel2 = which === 'produtos'
          ? 'id, nome, order_index, ativo'
          : 'id, nome, duracao, order_index';
        var q2 = supabaseClient.from(table).select(sel2);
        if (t) q2 = q2.eq('tenant_id', t);
        if (which === 'produtos') q2 = q2.eq('ativo', true);
        var resp2 = await q2;
        if (resp2.error){ console.error('[catalogo] fallback '+table, resp2.error); return []; }
        var rows2 = (resp2.data || []).map(function(r){ r.preco = 0; return r; });
        return sortRows(rows2);
      }
      return [];
    }
    return sortRows(resp.data || []);
  }

  function sortRows(rows){
    rows.sort(function(a,b){
      var ai = (a.order_index==null) ? 1e9 : a.order_index;
      var bi = (b.order_index==null) ? 1e9 : b.order_index;
      if (ai !== bi) return ai - bi;
      return String(a.nome||'').localeCompare(String(b.nome||''), 'pt-BR');
    });
    return rows;
  }

  // ---------- render ----------
  function getCurrentRows(){
    var rows = state.tab === 'produtos' ? state.produtos : state.servicos;
    var q = normalize(state.search).trim();
    if (!q) return rows;
    return rows.filter(function(r){ return normalize(r.nome).indexOf(q) !== -1; });
  }

  function renderList(){
    var list = document.getElementById('tp-list');
    if (!list) return;
    var page = document.getElementById('page-tabela-precos');
    if (page) page.classList.toggle('is-produtos', state.tab === 'produtos');

    // Botão "Nova Venda" só aparece na aba Produtos (e fora do modo Organizar)
    var btnNV = document.getElementById('tp-btn-nova-venda');
    if (btnNV) btnNV.style.display = (state.tab === 'produtos' && !state.sorting) ? '' : 'none';

    var rows = getCurrentRows();
    if (!rows || !rows.length){
      var msg = state.search
        ? 'Nenhum resultado para "'+ escapeHtml(state.search) +'".'
        : 'Nada cadastrado ainda.';
      var ic  = state.search ? 'fa-magnifying-glass' : 'fa-tags';
      list.innerHTML = '<div class="tp-empty"><i class="fa-solid '+ic+'"></i>'+msg+'</div>';
      return;
    }
    var html = rows.map(function(r){
      var meta = '';
      var thumb = '';
      if (state.tab === 'servicos'){
        meta = '<div class="tp-duration"><i class="fa-regular fa-clock"></i>'+ escapeHtml(fmtDur(r.duracao)) +'</div>';
      } else {
        meta = '<div class="tp-duration"></div>';
        var foto = r.foto_url || r.imagem_url || r.image_url || r.foto || r.imagem || '';
        if (foto){
          thumb = '<div class="tp-thumb"><img src="'+ escapeHtml(foto) +'" alt="" loading="lazy" onerror="this.parentNode.innerHTML=\'<i class=&quot;fa-solid fa-box&quot;></i>\'"></div>';
        } else {
          thumb = '<div class="tp-thumb tp-thumb-empty"><i class="fa-solid fa-box"></i></div>';
        }
      }
      var nomeRaw = r.nome || '(Sem nome)';
      return ''
        + '<div class="tp-row" data-id="'+ escapeHtml(r.id) +'">'
        +   '<div class="tp-handle"><i class="fa-solid fa-grip-vertical"></i></div>'
        +   thumb
        +   '<div class="tp-name-wrap"><div class="tp-name" title="'+ escapeHtml(nomeRaw) +'">'+ escapeHtml(nomeRaw) +'</div></div>'
        +   meta
        +   '<div class="tp-price">'+ escapeHtml(fmtMoney(state.tab === 'produtos' ? r.valor : r.preco)) +'</div>'
        + '</div>';
    }).join('');
    list.innerHTML = html;
    bindSortable();
  }

  function bindSortable(){
    if (state.sortable){ try{ state.sortable.destroy(); }catch(_){} state.sortable = null; }
    if (!state.sorting || !window.Sortable) return;
    var list = document.getElementById('tp-list');
    if (!list) return;
    state.sortable = new window.Sortable(list, {
      animation: 150,
      handle: '.tp-row',
      ghostClass: 'tp-ghost',
      chosenClass: 'tp-chosen',
      dragClass: 'tp-drag'
    });
  }

  // ---------- modos ----------
  function setSorting(on){
    state.sorting = !!on;
    var page = document.getElementById('page-tabela-precos');
    if (page) page.classList.toggle('is-sorting', state.sorting);
    document.getElementById('tp-btn-organizar').style.display = on ? 'none' : '';
    document.getElementById('tp-btn-salvar').style.display    = on ? '' : 'none';
    document.getElementById('tp-btn-cancelar').style.display  = on ? '' : 'none';
    var btnNV = document.getElementById('tp-btn-nova-venda');
    if (btnNV) btnNV.style.display = (!on && state.tab === 'produtos') ? '' : 'none';
    document.querySelectorAll('#page-tabela-precos .tp-tab').forEach(function(t){
      t.disabled = !!on; t.style.opacity = on ? '.5' : ''; t.style.pointerEvents = on ? 'none' : '';
    });
    var si = document.getElementById('tp-search-input');
    if (si){ si.disabled = !!on; si.style.opacity = on ? '.5' : ''; }
    if (on){
      if (state.search){ state.search = ''; if (si) si.value = ''; renderList(); }
      state.snapshot = (state.tab === 'produtos' ? state.produtos : state.servicos).map(function(r){ return r.id; });
      loadSortable(function(){ bindSortable(); });
    } else {
      if (state.sortable){ try{ state.sortable.destroy(); }catch(_){} state.sortable = null; }
    }
  }

  async function saveOrder(){
    if (typeof supabaseClient === 'undefined' || !supabaseClient) return;
    var list = document.getElementById('tp-list');
    if (!list) return;
    var ids = Array.from(list.querySelectorAll('.tp-row')).map(function(el){ return el.getAttribute('data-id'); });
    var table = state.tab === 'produtos' ? 'produtos' : 'servicos';
    var btn = document.getElementById('tp-btn-salvar');
    var oldHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    try{
      for (var i=0;i<ids.length;i++){
        var resp = await supabaseClient.from(table).update({ order_index: i+1 }).eq('id', ids[i]);
        if (resp.error) throw resp.error;
      }
      var arr = state.tab === 'produtos' ? state.produtos : state.servicos;
      var byId = {}; arr.forEach(function(r){ byId[r.id] = r; });
      var reordered = ids.map(function(id, idx){
        var r = byId[id]; if (r) r.order_index = idx+1; return r;
      }).filter(Boolean);
      if (state.tab === 'produtos') state.produtos = reordered; else state.servicos = reordered;
      btn.disabled = false; btn.innerHTML = oldHtml;
      setSorting(false);
      renderList();
      tpToast('Ordem salva com sucesso!', 'sucesso');
    } catch(e){
      console.error('[catalogo] saveOrder', e);
      tpToast('Erro ao salvar ordem', 'erro');
      btn.disabled = false; btn.innerHTML = oldHtml;
    }
  }

  function cancelOrder(){
    setSorting(false);
    renderList();
  }

  // ---------- bind UI ----------
  function bindUI(){
    document.querySelectorAll('#page-tabela-precos .tp-tab').forEach(function(tab){
      tab.addEventListener('click', function(){
        if (state.sorting) return;
        var which = tab.getAttribute('data-tp-tab');
        if (which === state.tab) return;
        state.tab = which;
        document.querySelectorAll('#page-tabela-precos .tp-tab').forEach(function(t){ t.classList.toggle('is-active', t===tab); });
        renderList();
      });
    });
    document.getElementById('tp-btn-organizar').addEventListener('click', function(){ setSorting(true); });
    document.getElementById('tp-btn-salvar').addEventListener('click', saveOrder);
    document.getElementById('tp-btn-cancelar').addEventListener('click', cancelOrder);

    var btnNV = document.getElementById('tp-btn-nova-venda');
    if (btnNV){
      btnNV.addEventListener('click', function(){
        ensureVendaBalcaoLoaded(function(ok){
          if (ok && typeof window.abrirDrawerVendaBalcao === 'function'){
            window.abrirDrawerVendaBalcao({ produtos: state.produtos });
          } else {
            console.error('[catalogo] falha ao carregar venda-balcao.js');
            tpToast('Módulo de venda de balcão indisponível', 'erro');
          }
        });
      });
    }

    var si = document.getElementById('tp-search-input');
    var sc = document.getElementById('tp-search-clear');
    if (si){
      si.addEventListener('input', function(){
        state.search = si.value || '';
        if (sc) sc.style.display = state.search ? '' : 'none';
        renderList();
      });
    }
    if (sc){
      sc.style.display = 'none';
      sc.addEventListener('click', function(){
        state.search = '';
        if (si){ si.value = ''; si.focus(); }
        sc.style.display = 'none';
        renderList();
      });
    }
  }

  // ---------- entrada da página ----------
  async function onEnterPage(){
    var list = document.getElementById('tp-list');
    if (list) list.innerHTML = '<div class="tp-empty"><i class="fa-solid fa-spinner fa-spin"></i>Carregando...</div>';
    var pair = await Promise.all([loadData('servicos'), loadData('produtos')]);
    state.servicos = pair[0];
    state.produtos = pair[1];
    renderList();
  }

  // ---------- hook switchPage ----------
  function hookSwitchPage(){
    if (typeof window.switchPage !== 'function') return false;
    var orig = window.switchPage;
    window.switchPage = function(page){
      var r = orig.apply(this, arguments);
      if (page === 'tabela-precos'){
        document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
        var el = document.getElementById('page-tabela-precos');
        if (el) el.classList.add('active');
        document.querySelectorAll('.nav-btn').forEach(function(b){ b.classList.remove('active'); });
        var nb = document.querySelector('.nav-btn[data-page="tabela-precos"]');
        if (nb) nb.classList.add('active');
        onEnterPage();
      }
      return r;
    };
    return true;
  }

  // Expor helper para o venda-balcao.js recarregar produtos do catálogo
  window.__catalogoReload = onEnterPage;

  // ---------- init ----------
  function init(){
    injectMenuButton();
    injectPage();
    bindUI();
    if (!hookSwitchPage()){
      var tries = 0;
      var iv = setInterval(function(){
        tries++;
        if (hookSwitchPage() || tries > 40) clearInterval(iv);
      }, 150);
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
