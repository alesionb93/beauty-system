/* =====================================================================
   COMISSOES-V2.JS — Módulo de Comissões V2 do Slotify
   ---------------------------------------------------------------------
   ARQUITETURA (igual ao Dashboard V2):
       Banco → Camada analítica (dashboard_v2_*) → RPC comissoes_v2_snapshot
             → este arquivo (apenas renderização)

   REGRA DE OURO: este arquivo NÃO contém nenhuma regra financeira.
   Nenhuma soma, nenhum percentual, nenhuma decisão sobre o que entra ou
   não em comissão. Tudo chega pronto de public.comissoes_v2_snapshot.

   Substitui integralmente o antigo comissoes.js.

   Carregue DEPOIS de script.js e pagamentos.js, em agenda.html:
       <link rel="stylesheet" href="/comissoes-v2.css?v=1">
       <script src="/comissoes-v2.js?v=1" defer></script>
   ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_COMISSOES_LOADED__) return;
  window.__SLOTIFY_COMISSOES_LOADED__ = true;

  console.log('%c💰 comissoes-v2.js v4 · ETAPA 6 (comissão de produtos · paridade total com Dashboard V2)',
    'background:var(--gold,#6c3aed);color:#fff;padding:3px 7px;border-radius:4px;font-weight:700');

  // ------------------------------------------------------------------
  // GLOBAL: timestamp do último toque/click em "Comissões"
  // (compartilhado entre o handler do item e o hijack do switchPage)
  // ------------------------------------------------------------------
  window.__COM_LAST_TOUCH_AT__ = window.__COM_LAST_TOUCH_AT__ || 0;
  window.__COM_CFG_TOUCH_AT__  = window.__COM_CFG_TOUCH_AT__  || 0;
  var GHOST_WINDOW_MS = 800; // janela ampla para cobrir iOS Safari lento

  // ------------------------------------------------------------------
  // HIJACK DEFINITIVO de window.switchPage
  // ------------------------------------------------------------------
  // Causa raiz do bug em mobile real: o "ghost click" (~300-500ms após
  // touchend) chega num switchPage('configuracoes') porque o navegador
  // resolveu o hit-test depois que a sidebar começou a fechar/reflowar.
  // Solução à prova de bala: se switchPage('configuracoes') for chamado
  // dentro da janela pós-toque de Comissões, REDIRECIONAMOS para
  // 'comissoes'. Funciona independente de hitbox, z-index, listener
  // delegado, ordem de carregamento de scripts, etc.
  // ------------------------------------------------------------------
  function installSwitchPageHijack(){
    if (window.__COM_SWITCHPAGE_HIJACK__) return;
    function tryInstall(){
      if (typeof window.switchPage !== 'function') return false;
      if (window.switchPage.__comHijacked) return true;
      var _orig = window.switchPage;
      var wrapped = function(page){
        try {
          var now = Date.now();
          var dtTouch = now - (window.__COM_LAST_TOUCH_AT__ || 0);

          // (A) Janela pós-toque em Comissões: ghost click vira comissoes
          if (dtTouch < GHOST_WINDOW_MS && page !== 'comissoes') {
            console.log('[comissoes] hijack(A): switchPage("' + page + '") dt=' + dtTouch + 'ms → redirecionado p/ comissoes');
            page = 'comissoes';
          }

          // (B) ANTI-REVERT: se estamos NA página de Comissões e algo tenta
          // ir para 'configuracoes' SEM que o usuário tenha tocado no item
          // Configurações nos últimos 1500ms, é uma chamada espúria
          // (listener delegado, cleanup interno, observer, etc.). Bloqueia.
          if (page === 'configuracoes') {
            var pgC = document.getElementById('page-comissoes');
            var onCom = !!(pgC && pgC.classList.contains('active'));
            var dtCfg = now - (window.__COM_CFG_TOUCH_AT__ || 0);
            if (onCom && dtCfg > 1500) {
              console.log('[comissoes] hijack(B): switchPage("configuracoes") BLOQUEADO (estamos em Comissões, sem toque real em Configurações; dtCfg=' + dtCfg + 'ms)');
              return; // descarta a navegação espúria
            }
          }
        } catch(_){}
        return _orig.apply(this, [page].concat([].slice.call(arguments, 1)));
      };
      wrapped.__comHijacked = true;
      window.switchPage = wrapped;
      window.__COM_SWITCHPAGE_HIJACK__ = true;
      return true;
    }
    if (tryInstall()) return;
    // switchPage pode não existir ainda no momento do init — re-tenta
    var tries = 0;
    var iv = setInterval(function(){
      tries++;
      if (tryInstall() || tries > 40) clearInterval(iv);
    }, 100);
    // Também reinstala se algum addon (pacotes, prepago) sobrescrever depois
    setInterval(function(){
      if (typeof window.switchPage === 'function' && !window.switchPage.__comHijacked) {
        tryInstall();
      }
    }, 1500);
  }
  installSwitchPageHijack();

  // ------------------------------------------------------------------
  // TRACKER: marca timestamp de toque/click REAL em "Configurações"
  // Permite que o guard (B) do hijack distinga navegação legítima de
  // chamadas espúrias enquanto estamos em Comissões.
  // ------------------------------------------------------------------
  if (!window.__COM_CFG_TRACKER__) {
    window.__COM_CFG_TRACKER__ = true;
    function isCfg(t){
      return !!(t && t.closest && t.closest('[data-page="configuracoes"], [data-nav="configuracoes"]'));
    }
    ['pointerdown','touchstart','mousedown','click'].forEach(function(evt){
      document.addEventListener(evt, function(ev){
        if (isCfg(ev.target)) {
          window.__COM_CFG_TOUCH_AT__ = Date.now();
        }
      }, true); // capture, antes de qualquer outro listener
    });
  }



  // ---------- Helpers ----------
  function getSb(){ return window.supabaseClient || window.supabase || null; }

  function fmtBRL(n){
    return (Number(n)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  }
  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function parseYmd(s){ var p = String(s).split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
  function diffDays(a,b){ return Math.round((b-a)/86400000); }

  function periodForKey(key, customIni, customFim){
    var now = new Date(); now.setHours(0,0,0,0);
    var ini, fim;
    if (key === 'hoje') { ini = new Date(now); fim = new Date(now); }
    else if (key === 'ontem') { ini = new Date(now); ini.setDate(ini.getDate()-1); fim = new Date(ini); }
    else if (key === 'semana') {
      // semana = segunda → domingo
      var dow = now.getDay(); // 0 dom .. 6 sab
      var back = (dow === 0 ? 6 : dow - 1);
      ini = new Date(now); ini.setDate(now.getDate()-back);
      fim = new Date(ini); fim.setDate(ini.getDate()+6);
    }
    else if (key === 'mes') {
      ini = new Date(now.getFullYear(), now.getMonth(), 1);
      fim = new Date(now.getFullYear(), now.getMonth()+1, 0);
    }
    else if (key === 'personalizado') {
      ini = parseYmd(customIni); fim = parseYmd(customFim);
    }
    return { ini: ini, fim: fim };
  }

  // Período anterior equivalente (para a dica de desempenho)
  function previousEquivalent(p){
    var days = diffDays(p.ini, p.fim) + 1;
    var fim = new Date(p.ini); fim.setDate(fim.getDate()-1);
    var ini = new Date(fim);   ini.setDate(ini.getDate()-(days-1));
    return { ini: ini, fim: fim };
  }

  function labelForKey(key, p){
    var fmt = function(d){ return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'long'}); };
    if (key === 'hoje')          return 'Hoje, ' + fmt(p.ini);
    if (key === 'ontem')         return 'Ontem, ' + fmt(p.ini);
    if (key === 'semana')        return 'Esta semana';
    if (key === 'mes')           return 'Este mês';
    return fmt(p.ini) + ' — ' + fmt(p.fim);
  }
  function agendaTitleForKey(key){
    if (key === 'hoje')   return 'Agenda de hoje';
    if (key === 'ontem')  return 'Agenda de ontem';
    if (key === 'semana') return 'Agenda desta semana';
    if (key === 'mes')    return 'Agenda do mês';
    return 'Agenda do período';
  }

  // ---------- Visibilidade (front-side gate) ----------
  // Considera visível se: role do usuário = colaborador E usuarios.profissional_id NOT NULL.
  async function userCanSeeComissoes(){
    var sb = getSb(); if (!sb) return false;
    try {
      var u = await sb.auth.getUser();
      var uid = u && u.data && u.data.user && u.data.user.id;
      if (!uid) return false;

      var r1 = await sb.from('usuarios').select('profissional_id, tenant_id, ativo').eq('id', uid).maybeSingle();
      if (!r1.data || !r1.data.ativo || !r1.data.profissional_id) return false;

      var r2 = await sb.from('user_roles').select('role').eq('user_id', uid);
      if (r2.error || !r2.data) return false;
      return r2.data.some(function(x){ return String(x.role) === 'colaborador'; });
    } catch (e) {
      console.warn('[comissoes] gate error', e);
      return false;
    }
  }

  // ---------- Menu lateral ----------
  // IMPORTANTE: o roteador nativo do Slotify usa .nav-btn[data-page]. Para que
  // a página seja exibida corretamente (sem ficar branca), injetamos o item
  // SEGUINDO ESSE PADRÃO e deixamos o handler nativo ativar #page-comissoes.
  function ensureMenuItem(){
    var sidebarNav = document.querySelector('.sidebar-nav, .sidebar .menu, .sidebar nav, .sidebar ul');
    if (!sidebarNav) return;
    if (document.querySelector('.nav-btn[data-page="comissoes"], [data-nav="comissoes"]')) return;

    var refItem = sidebarNav.querySelector('.nav-btn') || sidebarNav.querySelector('a, button, li');
    var node;

    if (refItem && refItem.classList.contains('nav-btn')) {
      // Padrão Slotify: <button class="nav-btn" data-page="...">
      node = document.createElement('button');
      node.className = 'nav-btn';
      node.setAttribute('type', 'button');
      node.setAttribute('data-page', 'comissoes');
      node.setAttribute('data-nav', 'comissoes');
      node.innerHTML = '<i class="fa-solid fa-percent"></i> Comissões';
    } else if (refItem && refItem.tagName.toLowerCase() === 'li') {
      node = document.createElement('li');
      node.innerHTML = '<a href="javascript:void(0)" role="button" data-page="comissoes" data-nav="comissoes">'
                     + '<i class="fa-solid fa-percent"></i> <span>Comissões</span></a>';
    } else {
      var tag = refItem ? refItem.tagName.toLowerCase() : 'a';
      node = document.createElement(tag);
      if (tag === 'a') node.setAttribute('href', 'javascript:void(0)');
      node.setAttribute('data-page', 'comissoes');
      node.setAttribute('data-nav', 'comissoes');
      if (refItem && refItem.className) node.className = refItem.className.replace(/active/g,'').trim();
      node.innerHTML = '<i class="fa-solid fa-percent"></i> <span>Comissões</span>';
    }

    // Isolar hitbox em mobile real (evita ghost click capturado pelo item de baixo)
    node.style.touchAction = 'manipulation';
    node.style.position = 'relative';
    node.style.zIndex = '2';
    node.classList.add('com-nav-item');

    // Inserir SEMPRE acima do item "Configurações" (se existir);
    // fallback: append ao final do nav.
    var cfgItem = sidebarNav.querySelector('.nav-btn[data-page="configuracoes"], [data-page="configuracoes"], [data-nav="configuracoes"]');
    if (cfgItem && cfgItem.parentNode === sidebarNav) {
      sidebarNav.insertBefore(node, cfgItem);
    } else {
      sidebarNav.appendChild(node);
    }

    // ------------------------------------------------------------------
    // FIX MOBILE REAL (ghost click / synthetic click → item de baixo)
    // ------------------------------------------------------------------
    // Em iOS/Android reais, após o touchend o navegador dispara um click
    // sintético ~300ms depois. Nesse intervalo a barra de URL pode recolher,
    // a sidebar pode reflowar, e o click acaba caindo no item "Configurações"
    // logo abaixo. Para blindar:
    //  1) Marcamos o toque como tratado em pointerdown/touchstart.
    //  2) preventDefault suprime o click sintético do touch.
    //  3) Disparamos a navegação imediatamente (sem esperar o click).
    //  4) Fechamos a sidebar nós mesmos, deterministicamente.
    //  5) Bloqueamos qualquer click subsequente nos próximos 500ms para
    //     impedir que escape para qualquer outro listener delegado.
    // ------------------------------------------------------------------
    var handlingTouch = false;
    function markTouch(){
      handlingTouch = true;
      window.__COM_LAST_TOUCH_AT__ = Date.now(); // GLOBAL — lido pelo hijack do switchPage
    }

    function doNavigate(ev){
      try { if (ev) { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation && ev.stopImmediatePropagation(); } } catch(_){}
      ensurePageContainer();
      try { if (typeof window.closeSidebar === 'function') window.closeSidebar(); } catch(_){}
      if (typeof window.switchPage === 'function') {
        try { window.switchPage('comissoes'); } catch(_){}
      }
      showComissoesPage();
    }

    // 1) Pointer/touch — caminho primário em mobile
    node.addEventListener('pointerdown', function(ev){
      if (ev.pointerType === 'mouse') return; // desktop usa o click
      markTouch();
      doNavigate(ev);
    }, { passive: false });

    node.addEventListener('touchstart', function(ev){
      markTouch();
      doNavigate(ev);
    }, { passive: false });

    // 2) touchend — preventDefault suprime o click sintético (ghost click)
    node.addEventListener('touchend', function(ev){
      try { ev.preventDefault(); ev.stopPropagation(); } catch(_){}
    }, { passive: false });

    // 3) click — desktop. Em mobile, se chegar mesmo assim, ignora.
    node.addEventListener('click', function(ev){
      var dt = Date.now() - (window.__COM_LAST_TOUCH_AT__ || 0);
      if (handlingTouch || dt < GHOST_WINDOW_MS) {
        try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation && ev.stopImmediatePropagation(); } catch(_){}
        handlingTouch = false;
        return;
      }
      markTouch(); // click "real" do desktop também marca, para defesa em profundidade
      doNavigate(ev);
    });

    // 4) Escudo global em CAPTURE para mousedown/mouseup/click:
    //    se um desses eventos chegar fora do item Comissões dentro da janela
    //    pós-toque, é o ghost click — descartamos antes de chegar nos
    //    listeners nativos (incluindo o de Configurações).
    if (!window.__COM_GHOSTCLICK_SHIELD__) {
      window.__COM_GHOSTCLICK_SHIELD__ = true;
      var KILL = ['mousedown', 'mouseup', 'click'];
      KILL.forEach(function(evtName){
        document.addEventListener(evtName, function(ev){
          var dt = Date.now() - (window.__COM_LAST_TOUCH_AT__ || 0);
          if (dt >= GHOST_WINDOW_MS) return;
          var t = ev.target;
          if (t && t.closest && t.closest('[data-nav="comissoes"], [data-page="comissoes"]')) return;
          // Só barramos cliques que cairiam em itens da SIDEBAR (preserva o resto)
          if (!t || !t.closest || !t.closest('.sidebar, .sidebar-nav, .sidebar .menu, .sidebar nav, .sidebar ul')) return;
          try {
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation && ev.stopImmediatePropagation();
          } catch(_){}
          console.log('[comissoes] shield: ' + evtName + ' fora de Comissões barrado (dt=' + dt + 'ms target=' + (t.tagName||'') + ')');
        }, true); // capture
      });
    }
  }


  // Esconde o item "Dashboard" do menu para
  // colaboradores vinculados a um profissional. Reaplicado via MutationObserver
  // porque o sidebar pode ser re-renderizado por outros scripts.
  function hideDashboardForColaborador(){
    function apply(){
      var dash = document.querySelectorAll('.nav-btn[data-page="dashboard"], [data-page="dashboard"], [data-nav="dashboard"]');
      dash.forEach(function(el){
        if (el.closest && el.closest('.sidebar, .sidebar-nav')) {
          el.style.display = 'none';
          el.setAttribute('aria-hidden', 'true');
        }
      });
      // se o usuário estiver na página dashboard, manda pra agendamentos
      var pgDash = document.getElementById('page-dashboard');
      if (pgDash && pgDash.classList.contains('active')) {
        pgDash.classList.remove('active');
        var pgAg = document.getElementById('page-agendamentos');
        if (pgAg) pgAg.classList.add('active');
      }
    }
    apply();
    var sb = document.querySelector('.sidebar-nav, .sidebar');
    if (sb && window.MutationObserver) {
      try {
        var obs = new MutationObserver(function(){ apply(); });
        obs.observe(sb, { childList: true, subtree: true });
      } catch(_) {}
    }
  }

  // ---------- Página ----------
  function ensurePageContainer(){
    var pg = document.getElementById('page-comissoes');
    if (pg) return pg;
    pg = document.createElement('div');
    pg.id = 'page-comissoes';
    pg.className = 'page com-page';
    var main = document.querySelector('.main-content') || document.body;
    main.appendChild(pg);
    return pg;
  }

  var STATE = {
    key: 'hoje',
    custom: null, // {ini, fim} ymd strings
    profNome: null,
  };

  // Saudação dinâmica baseada na hora local
  function greetingParts(){
    var h = new Date().getHours();
    if (h >= 5 && h < 12)  return { txt: 'Bom dia',   emoji: '👋' };
    if (h >= 12 && h < 18) return { txt: 'Boa tarde', emoji: '☀️' };
    return { txt: 'Boa noite', emoji: '🌙' };
  }

  // Busca SOMENTE o nome do profissional vinculado ao usuário autenticado.
  async function loadProfissionalNome(){
    if (STATE.profNome) return STATE.profNome;
    var sb = getSb(); if (!sb) return '';
    try {
      var u = await sb.auth.getUser();
      var uid = u && u.data && u.data.user && u.data.user.id;
      if (!uid) return '';
      var r1 = await sb.from('usuarios').select('profissional_id').eq('id', uid).maybeSingle();
      var pid = r1 && r1.data && r1.data.profissional_id;
      if (!pid) return '';
      var r2 = await sb.from('profissionais').select('nome').eq('id', pid).maybeSingle();
      var nome = r2 && r2.data && r2.data.nome ? String(r2.data.nome).trim() : '';
      // primeiro nome
      STATE.profNome = nome ? nome.split(/\s+/)[0] : '';
      return STATE.profNome;
    } catch(_) { return ''; }
  }

  function renderGreeting(){
    var elT = document.getElementById('com-greet-title');
    var elS = document.getElementById('com-greet-sub');
    if (!elT) return;
    var g = greetingParts();
    var nome = STATE.profNome || '';
    elT.innerHTML = g.txt + (nome ? ', <span class="com-greet-name">' + escapeHtml(nome) + '</span>' : '') + ' ' + g.emoji;
    if (elS) elS.textContent = 'Aqui está o resumo das suas comissões';
  }

  function showComissoesPage(){
    // esconde outras pages
    document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
    var pg = ensurePageContainer();
    // Para colaborador, o conteúdo legado de "split admin" não se aplica:
    // garantimos que nosso shell substitua o conteúdo existente.
    pg.classList.add('active', 'com-page');
    // marca menu ativo
    document.querySelectorAll('.sidebar [data-nav], .sidebar .nav-btn').forEach(function(n){ n.classList.remove('active'); });
    var item = document.querySelector('.nav-btn[data-page="comissoes"], [data-nav="comissoes"]');
    if (item) item.classList.add('active');
    render();
  }

  // Observa quando #page-comissoes ficar .active pelo roteador nativo,
  // renderizando nosso dashboard.
  function watchPageActivation(){
    var pg = document.getElementById('page-comissoes');
    if (!pg) return;
    var obs = new MutationObserver(function(){
      if (pg.classList.contains('active')) {
        // Detecta se o conteúdo atual NÃO é nosso (legado admin) e renderiza
        if (!pg.dataset.shell) {
          pg.classList.add('com-page');
          render();
        }
      }
    });
    obs.observe(pg, { attributes: true, attributeFilter: ['class'] });
  }

  function periodMenu(){
    var opts = [
      {k:'hoje',          l:'Hoje'},
      {k:'ontem',         l:'Ontem'},
      {k:'semana',        l:'Esta semana'},
      {k:'mes',           l:'Este mês'},
      {k:'personalizado', l:'Personalizado'}
    ];
    return '<div class="com-period-menu" id="com-period-menu" style="display:none;">'
      + opts.map(function(o){
          return '<button type="button" data-pk="'+o.k+'" class="'+(STATE.key===o.k?'active':'')+'">'
               + o.l + (STATE.key===o.k?' <i class="fa-solid fa-check"></i>':'') + '</button>';
        }).join('')
      + '</div>';
  }

  function shellHTML(){
    return ''
      + '<div class="com-greet">'
      +   '<h2 class="com-greet-title" id="com-greet-title">Olá 👋</h2>'
      +   '<p class="com-greet-sub" id="com-greet-sub">Aqui está o resumo das suas comissões</p>'
      + '</div>'

      + '<div class="com-period" style="position:relative;">'
      +   '<div class="com-period-icon"><i class="fa-regular fa-calendar"></i></div>'
      +   '<div class="com-period-info">'
      +     '<span class="com-period-label">Período</span>'
      +     '<button class="com-period-value" id="com-period-btn">'
      +       '<span id="com-period-text">Hoje</span> <i class="fa-solid fa-chevron-down"></i>'
      +     '</button>'
      +   '</div>'
      +   periodMenu()
      + '</div>'

      + '<div class="com-hero">'
      +   '<div class="com-hero-label">Total a receber <i class="fa-solid fa-circle-info" style="opacity:.7;font-size:12px;"></i></div>'
      +   '<div class="com-hero-value" id="com-total">R$ 0,00</div>'
      +   '<div class="com-hero-sub">Comissão Serviços + Comissão Produtos + Caixinha</div>'
      +   '<i class="fa-solid fa-wallet com-hero-icon"></i>'
      + '</div>'

      + '<div class="com-stats">'
      +   '<div class="com-stat"><div class="com-stat-ic"><i class="fa-solid fa-scissors"></i></div>'
      +     '<div class="com-stat-label">Atendimentos</div>'
      +     '<div class="com-stat-value" id="com-atend">0</div>'
      +     '<div class="com-stat-sub" id="com-atend-sub">Hoje</div></div>'
      +   '<div class="com-stat"><div class="com-stat-ic"><i class="fa-solid fa-percent"></i></div>'
      +     '<div class="com-stat-label">Comissão</div>'
      +     '<div class="com-stat-value" id="com-comissao">R$ 0,00</div>'
      +     '<div class="com-stat-sub">Serviços + Produtos</div></div>'
      +   '<div class="com-stat com-stat-tip"><div class="com-stat-ic"><i class="fa-solid fa-gift"></i></div>'
      +     '<div class="com-stat-label">Caixinha</div>'
      +     '<div class="com-stat-value" id="com-caixinha">R$ 0,00</div>'
      +     '<div class="com-stat-sub">Gorjetas recebidas</div></div>'
      +   '<div class="com-stat com-stat-prod"><div class="com-stat-ic"><i class="fa-solid fa-box"></i></div>'
      +     '<div class="com-stat-label">Comissão Produtos</div>'
      +     '<div class="com-stat-value" id="com-produtos">R$ 0,00</div>'
      +     '<div class="com-stat-sub">Total de comissão por vendas</div></div>'
      + '</div>'

      + '<div class="com-agenda-card">'
      +   '<h3 id="com-agenda-title">Agenda de hoje</h3>'
      +   '<div class="com-timeline" id="com-timeline"></div>'
      + '</div>'

      + '<div class="com-tip" id="com-tip" style="display:none;">'
      +   '<div class="com-tip-ic"><i class="fa-solid fa-chart-line"></i></div>'
      +   '<div class="com-tip-text" id="com-tip-text"></div>'
      + '</div>'

      // modal personalizado
      + '<div class="com-modal-overlay" id="com-modal-custom">'
      +   '<div class="com-modal">'
      +     '<h3>Período personalizado</h3>'
      +     '<label>Início</label><input type="date" id="com-cust-ini">'
      +     '<label>Fim</label><input type="date" id="com-cust-fim">'
      +     '<div class="com-modal-actions">'
      +       '<button class="com-btn-cancel" id="com-cust-cancel">Cancelar</button>'
      +       '<button class="com-btn-ok" id="com-cust-ok">Aplicar</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  function wireUI(){
    var pg = document.getElementById('page-comissoes');
    var btn = pg.querySelector('#com-period-btn');
    var menu = pg.querySelector('#com-period-menu');

    btn.addEventListener('click', function(e){
      e.stopPropagation();
      menu.style.display = (menu.style.display === 'none' ? 'block' : 'none');
      // posiciona logo abaixo do botão
      var rect = btn.getBoundingClientRect();
      menu.style.left = '70px'; menu.style.top = '62px';
    });
    document.addEventListener('click', function(){ menu.style.display = 'none'; });

    menu.querySelectorAll('button[data-pk]').forEach(function(b){
      b.addEventListener('click', function(){
        var k = b.getAttribute('data-pk');
        if (k === 'personalizado') { openCustomModal(); return; }
        STATE.key = k; STATE.custom = null;
        refreshMenu(); render();
      });
    });

    pg.querySelector('#com-cust-cancel').addEventListener('click', closeCustomModal);
    pg.querySelector('#com-cust-ok').addEventListener('click', function(){
      var i = pg.querySelector('#com-cust-ini').value;
      var f = pg.querySelector('#com-cust-fim').value;
      if (!i || !f) return;
      if (i > f) { var t = i; i = f; f = t; }
      STATE.key = 'personalizado'; STATE.custom = { ini: i, fim: f };
      closeCustomModal(); refreshMenu(); render();
    });
  }

  function refreshMenu(){
    var menu = document.getElementById('com-period-menu');
    if (!menu) return;
    menu.querySelectorAll('button[data-pk]').forEach(function(b){
      var k = b.getAttribute('data-pk');
      b.classList.toggle('active', k === STATE.key);
    });
  }

  function openCustomModal(){
    var m = document.getElementById('com-modal-custom'); if (!m) return;
    var today = ymd(new Date());
    m.querySelector('#com-cust-ini').value = (STATE.custom && STATE.custom.ini) || today;
    m.querySelector('#com-cust-fim').value = (STATE.custom && STATE.custom.fim) || today;
    m.classList.add('active');
  }
  function closeCustomModal(){
    var m = document.getElementById('com-modal-custom'); if (m) m.classList.remove('active');
  }

  // ---------- Render ----------
  // Única porta de entrada de dados. Um snapshot -> tudo pronto.
  async function fetchSnapshot(p){
    var sb = getSb(); if (!sb) throw new Error('Supabase indisponível');
    var r = await sb.rpc('comissoes_v2_snapshot', {
      p_inicio: ymd(p.ini),
      p_fim:    ymd(p.fim),
      p_profissional_id: null
    });
    if (r.error) throw r.error;
    return r.data || {};
  }

  // ------------------------------------------------------------------
  // Histórico (timeline)
  // ------------------------------------------------------------------
  // Este módulo NÃO é relatório financeiro: cada linha mostra o que o
  // profissional efetivamente recebeu naquele evento. Faturamento (ex.:
  // preço cheio do pacote) nunca aparece aqui.
  var TIPO_META = {
    pacote_venda: { icon: '📦', label: 'Venda de pacote', cls: 'com-badge-pkg-sale' },
    pacote_uso:   { icon: '🎁', label: 'Uso de pacote',   cls: 'com-badge-pkg-use'  },
    produto:      { icon: '🛍', label: 'Produto',         cls: 'com-badge-prod'     },
    servico:      { icon: '✂️', label: 'Serviço',         cls: 'com-badge-serv'     }
  };

  function ensureBadgeStyles(){
    if (document.getElementById('com-badge-styles')) return;
    var st = document.createElement('style');
    st.id = 'com-badge-styles';
    st.textContent = [
      '.com-ev-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;',
      ' line-height:1;padding:4px 8px;border-radius:999px;margin-bottom:4px;white-space:nowrap;}',
      '.com-badge-pkg-sale{background:rgba(180,83,9,.12);color:#B45309;}',
      '.com-badge-pkg-use{background:rgba(108,58,237,.12);color:#6C3AED;}',
      '.com-badge-prod{background:rgba(37,99,235,.12);color:#2563EB;}',
      '.com-badge-serv{background:rgba(22,163,74,.12);color:#16A34A;}',
      '.com-val-zero{color:#6b7280 !important;font-weight:600;}'
    ].join('');
    document.head.appendChild(st);
  }

  // Lê o tipo do evento EXATAMENTE como o backend classificou.
  // A RPC comissoes_v2_snapshot já retorna um evento por linha:
  //   'pacote_venda' | 'pacote_uso' | 'produto' | 'servico'
  // Nenhuma inferência financeira acontece aqui.
  function tipoDoEvento(it){
    var t = String(it && it.event_type || '').toLowerCase();
    if (TIPO_META[t]) return t;
    // Tolerância a nomenclaturas antigas da camada analítica.
    if (t.indexOf('pacote_venda') >= 0 || t.indexOf('venda_pacote') >= 0) return 'pacote_venda';
    if (t.indexOf('pacote') >= 0) return 'pacote_uso';
    if (t.indexOf('produto') >= 0) return 'produto';
    return 'servico';
  }

  function renderAgenda(items){
    ensureBadgeStyles();
    var box = document.getElementById('com-timeline');
    if (!items || !items.length) {
      box.innerHTML = '<div class="com-empty">Nenhum evento no período.</div>';
      return;
    }
    box.innerHTML = items.map(function(it){
      var tipo = tipoDoEvento(it);
      var meta = TIPO_META[tipo] || TIPO_META.servico;
      var hora = it.hora || '';
      var serv = it.servico_nome || 'Atendimento';
      var cli  = it.cliente_nome ? ('Cliente: ' + it.cliente_nome) : '';
      var com  = Number(it.comissao || 0);
      var cx   = Number(it.caixinha || 0);
      var val, breakHtml;

      if (tipo === 'pacote_uso') {
        // Uso de crédito: registro operacional. A comissão já foi paga na venda.
        val = '<span class="com-val-zero">Sem comissão</span>';
        breakHtml = subtxt('Pago na venda do pacote');
      } else if (tipo === 'produto') {
        // ETAPA 6: exibe o snapshot de comissão do produto (backend).
        // Nada é calculado aqui — o valor vem pronto de comissao_produto.
        var comProd = Number(it.comissao_produto || 0);
        val = fmtBRL(comProd);
        breakHtml = subtxt('Comissão Produto');
      } else if ((com + cx) <= 0) {
        val = '<span class="com-val-zero">Sem comissão</span>';
        breakHtml = subtxt('R$ 0,00');
      } else {
        // Sempre o valor RECEBIDO pelo profissional — nunca o faturamento.
        val = fmtBRL(com + cx);
        breakHtml = cx > 0
          ? subtxt('Comissão ' + fmtBRL(com) + '<br>+ Caixinha ' + fmtBRL(cx), true)
          : subtxt('Comissão');
      }

      var badge = '<span class="com-ev-badge '+meta.cls+'">'+meta.icon+' '+meta.label+'</span>';

      return ''
        + '<div class="com-timeline-row" data-ev-tipo="'+tipo+'" data-ev-id="'+escapeHtml(it.event_id||'')+'">'
        +   '<div class="com-time">'+escapeHtml(hora)+'</div>'
        +   '<div class="com-dot-col"><span class="com-dot"></span></div>'
        +   '<div class="com-info-col" style="min-width:0;">'
        +        '<div>'+badge+'</div>'
        +        '<div class="com-serv-name">'+escapeHtml(serv)+'</div>'
        +        '<div class="com-cli-name">'+escapeHtml(cli)+'</div></div>'
        +   '<div class="com-val" style="display:flex;flex-direction:column;align-items:flex-end;line-height:1.15;max-width:120px;">'
        +     '<span style="white-space:nowrap;">'+val+'</span>'
        +     breakHtml
        +   '</div>'
        +   '<div class="com-chev"><i class="fa-solid fa-chevron-right"></i></div>'
        + '</div>';
    }).join('');
  }

  function subtxt(html, wrap){
    return '<div class="com-val-break" style="font-size:11px;font-weight:500;color:#6b7280;'
      + (wrap ? 'white-space:normal;' : 'white-space:nowrap;')
      + 'line-height:1.2;margin-top:2px;">' + html + '</div>';
  }

  function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  function setSkeleton(on){
    ['com-total','com-atend','com-comissao','com-caixinha','com-produtos'].forEach(function(id){
      var el = document.getElementById(id);
      if (!el) return;
      if (on) el.classList.add('com-skeleton'); else el.classList.remove('com-skeleton');
    });
  }

  // A comparação com o período anterior também vem pronta do backend.
  function renderTip(periodKey, snap){
    var tipEl = document.getElementById('com-tip');
    var txt   = document.getElementById('com-tip-text');
    if (!tipEl || !txt) return;
    var k = (snap && snap.kpis) || {};
    var a = (snap && snap.anterior) || {};
    var curT = Number(k.totalReceber || 0);
    var preT = Number(a.totalReceber || 0);
    if (!curT && !preT) { tipEl.style.display = 'none'; return; }
    var labelAtual = ({hoje:'hoje', ontem:'ontem', semana:'nessa semana', mes:'nesse mês'})[periodKey] || 'nesse período';
    var labelComp  = ({hoje:'ontem', ontem:'no dia anterior', semana:'na semana passada', mes:'no mês anterior'})[periodKey] || 'no período anterior';

    if (preT <= 0) {
      txt.innerHTML = 'Você recebeu <strong>'+fmtBRL(curT)+'</strong> '+labelAtual+'. Bora superar '+labelComp+'! ✂️';
    } else {
      var pct = Math.round(((curT - preT) / preT) * 100);
      if (pct >= 0) {
        txt.innerHTML = 'Você está <strong>'+pct+'% acima</strong> do que recebeu '+labelComp+'. Parabéns! 🎉';
      } else {
        txt.innerHTML = 'Você está <strong>'+Math.abs(pct)+'% abaixo</strong> do que recebeu '+labelComp+'. Vamos virar o jogo! 🚀';
      }
    }
    tipEl.style.display = 'flex';
  }

  async function render(){
    var pg = document.getElementById('page-comissoes');
    if (!pg.dataset.shell) {
      pg.innerHTML = shellHTML();
      pg.dataset.shell = '1';
      wireUI();
    }

    // Saudação: pinta imediatamente (sem nome) e atualiza quando carregar
    renderGreeting();
    loadProfissionalNome().then(renderGreeting);

    var p = periodForKey(STATE.key, STATE.custom && STATE.custom.ini, STATE.custom && STATE.custom.fim);
    document.getElementById('com-period-text').textContent = labelForKey(STATE.key, p);
    document.getElementById('com-agenda-title').textContent = agendaTitleForKey(STATE.key);
    var subMap = {hoje:'Hoje', ontem:'Ontem', semana:'Esta semana', mes:'Este mês', personalizado:'Período'};
    document.getElementById('com-atend-sub').textContent = subMap[STATE.key] || 'Período';

    setSkeleton(true);
    try {
      var snap = await fetchSnapshot(p);
      var k = snap.kpis || {};

      if (snap.ok === false) {
        setSkeleton(false);
        document.getElementById('com-timeline').innerHTML =
          '<div class="com-empty">Seu usuário não está vinculado a um profissional deste estabelecimento.</div>';
        return;
      }

      // O front apenas exibe os números já calculados pelo backend.
      document.getElementById('com-total').textContent    = fmtBRL(k.totalReceber);
      document.getElementById('com-atend').textContent    = (k.atendimentos || 0);
      // Card "Comissão" = Serviços + Produtos (já consolidado pelo backend).
      document.getElementById('com-comissao').textContent =
        fmtBRL(k.comissaoTotal != null ? k.comissaoTotal : k.comissao);
      document.getElementById('com-caixinha').textContent = fmtBRL(k.caixinha);
      // Card "Comissão Produtos" = SUM(commission_amount) (snapshot).
      var elProd = document.getElementById('com-produtos');
      if (elProd) elProd.textContent = fmtBRL(k.comissaoProdutos || 0);

      if (snap.profissional && snap.profissional.nome && !STATE.profNome) {
        STATE.profNome = String(snap.profissional.nome).trim().split(/\s+/)[0];
        renderGreeting();
      }

      renderAgenda(snap.agenda || []);
      setSkeleton(false);
      renderTip(STATE.key, snap);
    } catch (e) {
      setSkeleton(false);
      console.error('[comissoes] erro', e);
      document.getElementById('com-timeline').innerHTML =
        '<div class="com-empty">Não foi possível carregar suas comissões. '
        + (e && e.message ? escapeHtml(e.message) : '') + '</div>';
    }
  }

  // ---------- Bootstrap ----------
  async function init(){
    var ok = await userCanSeeComissoes();
    if (!ok) {
      // garante remoção (caso já tenha sido injetado)
      var n = document.querySelector('[data-nav="comissoes"]');
      if (n && n.parentNode) n.parentNode.removeChild(n);
      return;
    }
    ensureMenuItem();
    // Pré-cria o container ANTES de qualquer navegação para evitar null
    // reference no switchPage nativo (que abortaria closeSidebar em mobile).
    ensurePageContainer();
    hideDashboardForColaborador();
    watchPageActivation();
    // se a página já estiver ativa no boot (ex.: usuário recarregou em /Comissões)
    var pg0 = document.getElementById('page-comissoes');
    if (pg0 && pg0.classList.contains('active')) showComissoesPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
