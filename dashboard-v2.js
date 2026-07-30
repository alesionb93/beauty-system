/* =====================================================================
   DASHBOARD-V2.JS — v6 (refinamento de UI/UX — frontend only)
   ---------------------------------------------------------------------
   O QUE MUDOU EM RELAÇÃO À v5 (apenas apresentação):
     1) Emojis 100% removidos. Todos os ícones agora são SVG inline no
        padrão Lucide (outline, 1.75px, tamanho consistente), herdando a
        cor principal do tenant via currentColor.
     2) Paleta reduzida: cor do tenant + escala de cinza. Verde/vermelho/
        âmbar apenas com significado semântico (sucesso/erro/alerta).
     3) Gráficos usam uma rampa derivada da cor principal do tenant
        (lida do CSS em runtime) — sem cores decorativas.
     4) KPIs, tabelas e estados vazios padronizados.

   O QUE NÃO MUDOU:
     • Regras de negócio, consultas, RPC, contrato da API.
     • Nomes de componentes, IDs, classes e comportamento dos filtros.

   Integração:
     <link rel="stylesheet" href="/dashboard-v2.css?v=6">
     <script src="/dashboard-v2.js?v=6" defer></script>
   ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_DASHBOARD_V2_LOADED__) return;
  window.__SLOTIFY_DASHBOARD_V2_LOADED__ = true;
  console.log('%cdashboard-v2.js v6 (backend-only / UI refinada)', 'background:#0d1117;color:#fff;padding:3px 8px;border-radius:4px;font-weight:600');

  // ========================================================
  // ICONS — biblioteca única (Lucide), outline, 24x24
  // Apenas apresentação: nenhum dado depende disto.
  // ========================================================
  const ICON_PATHS = {
    'calendar':      '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    'receipt':       '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1V2l-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/>',
    'scissors':      '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
    'circle-dollar': '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 18V6"/>',
    'credit-card':   '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    'users':         '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    'user':          '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    'package':       '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
    'trending-down': '<path d="M22 17 13.5 8.5 8.5 13.5 2 7"/><path d="M16 17h6v-6"/>',
    'trending-up':   '<path d="M22 7 13.5 15.5 8.5 10.5 2 18"/><path d="M16 7h6v6"/>',
    'bar-chart':     '<path d="M3 3v18h18M18 17V9M13 17V5M8 17v-3"/>',
    'ban':           '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    'shopping-bag':  '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    'shopping-cart': '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    'refresh':       '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    'zap':           '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
    'banknote':      '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    'tag':           '<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42Z"/><path d="M7.5 7.5h.01"/>',
    'layers':        '<path d="m12.83 2.18 8.34 4.17a1 1 0 0 1 0 1.79l-8.34 4.17a2 2 0 0 1-1.66 0L2.83 8.14a1 1 0 0 1 0-1.79l8.34-4.17a2 2 0 0 1 1.66 0Z"/><path d="m2.83 12.35 8.34 4.17a2 2 0 0 0 1.66 0l8.34-4.17"/><path d="m2.83 16.35 8.34 4.17a2 2 0 0 0 1.66 0l8.34-4.17"/>',
    'check-circle':  '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    'inbox':         '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>',
    'calculator':    '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>',
    'dashboard':     '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    'alert':         '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4M12 17h.01"/>',
    'arrow-up':      '<path d="M7 17 17 7M7 7h10v10"/>',
    'arrow-down':    '<path d="M7 7l10 10M17 7v10H7"/>',
    'chevron-up':    '<path d="m18 15-6-6-6 6"/>',
    'chevron-down':  '<path d="m6 9 6 6 6-6"/>',
    'chevrons':      '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>'
  };

  function icon(name, extraClass){
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'dv2-i' + (extraClass ? ' ' + extraClass : ''));
    svg.innerHTML = ICON_PATHS[name] || ICON_PATHS['bar-chart'];
    return svg;
  }
  function iconHTML(name, extraClass){
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="dv2-i'
      + (extraClass ? ' ' + extraClass : '') + '">' + (ICON_PATHS[name] || '') + '</svg>';
  }

  // ========================================================
  // UTILS
  // ========================================================
  const Utils = {
    fmtBRL(n){ return (Number(n)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); },
    fmtInt(n){ return (Number(n)||0).toLocaleString('pt-BR'); },
    fmtPct(n, dec=1){ if(!isFinite(n))return '0%'; return (n*100).toFixed(dec).replace('.',',')+'%'; },
    fmtDate(d){ if(!d) return '—'; return new Date(String(d).slice(0,10)+'T00:00:00').toLocaleDateString('pt-BR'); },
    fmtDayLabel(d){ if(!d) return ''; return String(d).slice(8,10); },
    todayISO(){ return new Date().toISOString().slice(0,10); },
    firstOfMonthISO(){ const d=new Date(); return new Date(d.getFullYear(),d.getMonth(),1).toISOString().slice(0,10); },
    icon,
    iconHTML,
    el(tag, attrs, children) {
      const e = document.createElement(tag);
      if (attrs) for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v);
      }
      if (children != null) (Array.isArray(children)?children:[children]).forEach(c => {
        if (c == null || c === false) return;
        e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      });
      return e;
    },
    tip(text){ return Utils.el('span',{class:'dv2-tip','data-tip':text,tabindex:'0'},'?'); },
    empty(msg, ico){
      return Utils.el('div',{class:'dv2-empty'},[
        Utils.el('div',{class:'ico'}, icon(ico || 'inbox')),
        Utils.el('span',{}, msg)
      ]);
    },
    num(v){ const n = Number(v); return isFinite(n) ? n : 0; }
  };

  // ========================================================
  // THEME — lê a cor principal do tenant para os gráficos
  // ========================================================
  const Theme = {
    _cache: null,
    read(){
      if (Theme._cache) return Theme._cache;
      let primary = '#6c3aed';
      try {
        const page = document.getElementById('page-dashboard-v2') || document.body;
        const v = getComputedStyle(page).getPropertyValue('--dv2-primary').trim()
               || getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim();
        if (v) primary = v;
      } catch(_) {}
      Theme._cache = {
        primary,
        grid: '#eef0f4',
        text: '#8b93a1',
        ink: '#0d1117',
        // rampa monocromática derivada da cor do tenant (sem cores decorativas)
        ramp: [
          primary,
          Theme._mix(primary, '#ffffff', 0.28),
          Theme._mix(primary, '#ffffff', 0.50),
          Theme._mix(primary, '#ffffff', 0.68),
          Theme._mix(primary, '#ffffff', 0.82)
        ]
      };
      return Theme._cache;
    },
    reset(){ Theme._cache = null; },
    _hex(c){
      c = String(c || '').trim();
      if (/^#([0-9a-f]{3})$/i.test(c)) c = '#' + c.slice(1).split('').map(x=>x+x).join('');
      if (/^#([0-9a-f]{6})$/i.test(c)) {
        return [parseInt(c.substr(1,2),16), parseInt(c.substr(3,2),16), parseInt(c.substr(5,2),16)];
      }
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (m) { const p = m[1].split(',').map(n=>parseFloat(n)); return [p[0]|0,p[1]|0,p[2]|0]; }
      return [108,58,237];
    },
    _mix(a, b, t){
      const A = Theme._hex(a), B = Theme._hex(b);
      const r = Math.round(A[0]+(B[0]-A[0])*t);
      const g = Math.round(A[1]+(B[1]-A[1])*t);
      const bl= Math.round(A[2]+(B[2]-A[2])*t);
      return 'rgb(' + r + ',' + g + ',' + bl + ')';
    }
  };

  // Catálogo de apresentação das formas de pagamento (rótulo/ícone/cor).
  // NÃO é dado: é apenas tradução visual dos identificadores do backend.
  const FORMAS_UI = {
    pix:               { label:'PIX',               ico:'zap',         shade:0 },
    dinheiro:          { label:'Dinheiro',          ico:'banknote',    shade:1 },
    debito:            { label:'Débito',            ico:'tag',         shade:2 },
    credito:           { label:'Crédito',           ico:'credit-card', shade:3 },
    credito_parcelado: { label:'Crédito Parcelado', ico:'layers',      shade:4 }
  };
  const formaUI = (id) => {
    const base = FORMAS_UI[id] || { label:String(id||'—'), ico:'credit-card', shade:4 };
    return Object.assign({}, base, { color: Theme.read().ramp[base.shade] || Theme.read().primary });
  };

  // ========================================================
  // SNAPSHOT VAZIO (estrutura, não dado)
  // ========================================================
  function emptySnapshot(){
    return {
      kpis: { agendamentos:0, ticketMedio:0, servicos:0, faturamento:0,
              faturamentoServicos:0, faturamentoVendas:0,
              delta:{ agendamentos:null, ticketMedio:null, servicos:null, faturamento:null } },
      pagamentos: { recebido:0, pendente:0, pendenciasQtd:0, formas:[], porDia:[], pendencias:[] },
      profissionaisTable: [],
      topServicos: [],
      pacotes: { qtd:0, receita:0, lista:[] },
      topClientes: [],
      cancelamentos: { qtd:0, taxa:0, valorPerdido:0, comVenda:0, motivos:[], porProfissional:[] },
      produtos: { faturamentoBruto:0, cmv:0, lucroBruto:0, margem:0, qtdVendida:0,
                  receitaBalcao:0, receitaAtendimento:0,
                  maisVendidos:[], maisLucrativos:[], menorMargem:[] },
      erro: null
    };
  }

  // ========================================================
  // STATE
  // ========================================================
  const State = {
    filters: {
      dataInicio: Utils.firstOfMonthISO(),
      dataFim:    Utils.todayISO(),
      profissionalId: ''
    },
    snapshot: null,
    profissionais: [],
    sort: { profissionais: { col:'faturamento', dir:'desc' } }
  };

  // ========================================================
  // API — o backend é a única fonte de verdade
  // ========================================================
  const Api = {
    _sb(){ return window.supabaseClient || window.supabase || null; },
    _tenant(){
      try { if (typeof getCurrentTenantId === 'function') { const t = getCurrentTenantId(); if (t) return t; } } catch(_) {}
      const u = window.currentUser || {};
      return u.tenantId || u.tenant_id || localStorage.getItem('currentTenantId') || null;
    },
    async fetchProfissionais(){
      const sb = Api._sb();
      const tenant = Api._tenant();
      if (!sb || !tenant) return [];
      const { data, error } = await sb
        .from('profissionais')
        .select('id, nome')
        .eq('tenant_id', tenant)
        .order('nome', { ascending: true });
      if (error) throw error;
      return (data || []).map(p => ({ id: p.id, nome: p.nome }));
    },
    async fetchSnapshot(filters){
      const snap = emptySnapshot();
      const sb = Api._sb();
      const tenant = Api._tenant();
      if (!sb || !tenant) {
        snap.erro = 'Sessão indisponível. Recarregue a página.';
        return snap;
      }
      const { data, error } = await sb.rpc('dashboard_v2_snapshot', {
        p_tenant_id:       tenant,
        p_data_inicio:     filters.dataInicio,
        p_data_fim:        filters.dataFim,
        p_profissional_id: filters.profissionalId || null
      });
      if (error) throw error;
      if (!data) return snap;

      // Mapeamento defensivo: o frontend apenas lê o que o backend enviou.
      if (data.kpis) {
        const k = data.kpis, d = k.delta || {};
        snap.kpis = {
          agendamentos: Utils.num(k.agendamentos),
          ticketMedio:  Utils.num(k.ticketMedio),
          servicos:     Utils.num(k.servicos),
          faturamento:  Utils.num(k.faturamento),
          // Faturamento Total = serviços (agendamentos) + vendas (balcão).
          // O backend já entrega o total pronto; estes dois são apenas o detalhe.
          faturamentoServicos: Utils.num(k.faturamentoServicos),
          faturamentoVendas:   Utils.num(k.faturamentoVendas),
          delta: {
            agendamentos: d.agendamentos == null ? null : Number(d.agendamentos),
            ticketMedio:  d.ticketMedio  == null ? null : Number(d.ticketMedio),
            servicos:     d.servicos     == null ? null : Number(d.servicos),
            faturamento:  d.faturamento  == null ? null : Number(d.faturamento)
          }
        };
      }
      if (data.pagamentos) {
        const p = data.pagamentos;
        // Contrato oficial do backend para pendências:
        //   data.valor_pendente_total  → card "Pendente"
        //   data.pendencias_financeiras → tabela "Pendências Financeiras"
        // (fallback para pagamentos.* apenas enquanto a RPC antiga estiver no ar)
        const pendencias = Array.isArray(data.pendencias_financeiras)
          ? data.pendencias_financeiras
          : (Array.isArray(p.pendencias) ? p.pendencias : []);
        const pendenteTotal = data.valor_pendente_total != null
          ? data.valor_pendente_total
          : p.pendente;
        snap.pagamentos = {
          recebido:      Utils.num(p.recebido),
          pendente:      Utils.num(pendenteTotal),
          pendenciasQtd: data.pendencias_financeiras != null
                           ? pendencias.length
                           : Utils.num(p.pendenciasQtd),
          formas:        Array.isArray(p.formas) ? p.formas : [],
          porDia:        Array.isArray(p.porDia) ? p.porDia : [],
          pendencias:    pendencias
        };
      }
      if (Array.isArray(data.profissionaisTable)) snap.profissionaisTable = data.profissionaisTable;
      if (Array.isArray(data.topServicos))        snap.topServicos = data.topServicos;
      if (Array.isArray(data.topClientes))        snap.topClientes = data.topClientes;
      if (data.pacotes) {
        snap.pacotes = {
          qtd:     Utils.num(data.pacotes.qtd),
          receita: Utils.num(data.pacotes.receita),
          lista:   Array.isArray(data.pacotes.lista) ? data.pacotes.lista : []
        };
      }
      if (data.cancelamentos) {
        const c = data.cancelamentos;
        snap.cancelamentos = {
          qtd:             Utils.num(c.qtd),
          taxa:            Utils.num(c.taxa),
          valorPerdido:    Utils.num(c.valorPerdido),
          comVenda:        Utils.num(c.comVenda),
          motivos:         Array.isArray(c.motivos) ? c.motivos : [],
          porProfissional: Array.isArray(c.porProfissional) ? c.porProfissional : []
        };
      }
      if (data.produtos) {
        const p = data.produtos;
        snap.produtos = {
          faturamentoBruto: Utils.num(p.faturamentoBruto),
          cmv:              Utils.num(p.cmv),
          lucroBruto:       Utils.num(p.lucroBruto),
          margem:           Utils.num(p.margem),
          qtdVendida:         Utils.num(p.qtdVendida),
          receitaBalcao:      Utils.num(p.receitaBalcao),
          receitaAtendimento: Utils.num(p.receitaAtendimento),
          maisVendidos:     Array.isArray(p.maisVendidos) ? p.maisVendidos : [],
          maisLucrativos:   Array.isArray(p.maisLucrativos) ? p.maisLucrativos : [],
          menorMargem:      Array.isArray(p.menorMargem) ? p.menorMargem : []
        };
      }
      return snap;
    }
  };

  // ========================================================
  // MENU — injeta o item no sidebar como um .nav-btn nativo
  // ------------------------------------------------------
  // IMPORTANTE (bug de navegação): usamos <button>, não <a href="#...">.
  // Sem hash, sem preventDefault, sem router paralelo.
  // ========================================================
  const Menu = {
    inject(){
      if (document.querySelector('.nav-btn[data-page="dashboard-v2"]')) return;
      const anchor = document.querySelector('.nav-btn[data-page="dashboard"]')
                  || document.querySelector('.nav-btn');
      if (!anchor || !anchor.parentElement) { setTimeout(Menu.inject, 500); return; }

      const btn = Utils.el('button', {
        type: 'button',
        class: 'nav-btn',
        'data-page': 'dashboard-v2',
        'data-dv2': '1'
      }, [
        Utils.el('span', { class:'menu-icon', html: iconHTML('dashboard') }),
        ' Dashboard V2 ',
        Utils.el('span', { class:'dv2-menu-badge' }, 'novo')
      ]);
      btn.addEventListener('click', function () { Controller.open(); });

      anchor.parentElement.insertBefore(btn, anchor.nextSibling);
    }
  };

  // ========================================================
  // VIEW — a página do V2 é uma ".page" comum do app
  // ========================================================
  const View = {
    ensurePage(){
      let page = document.getElementById('page-dashboard-v2');
      if (page) return page;
      // Mesmo container das demais páginas, para herdar o CSS de .page/.active
      const ref  = document.querySelector('.page');
      const main = (ref && ref.parentElement)
                || document.querySelector('.main-content, #main, main')
                || document.body;
      page = Utils.el('div', { id:'page-dashboard-v2', class:'page' });
      main.appendChild(page);
      return page;
    },
    show(){
      const page = View.ensurePage();
      // Usa exatamente o mesmo mecanismo do app (classe .active).
      // NÃO mexemos em style.display de nenhuma outra página — era isso
      // que travava a navegação do menu lateral.
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      page.classList.add('active');
      const btn = document.querySelector('.nav-btn[data-page="dashboard-v2"]');
      if (btn) btn.classList.add('active');
      try { if (typeof window.closeSidebar === 'function') window.closeSidebar(); } catch(_) {}
    },
    isVisible(){
      const page = document.getElementById('page-dashboard-v2');
      return !!(page && page.classList.contains('active'));
    },
    render(){
      const page = View.ensurePage();
      Charts.destroyAll();
      Theme.reset();
      page.innerHTML = '';
      page.appendChild(Utils.el('div', { class:'dv2-header' }, [
        Utils.el('div', {}, [
          Utils.el('h1', {}, [ 'Dashboard ', Utils.el('span',{class:'dv2-badge-beta'},'V2') ]),
          Utils.el('div', { class:'dv2-sub' }, 'Nova base analítica do Slotify — dados calculados no backend.')
        ]),
        Utils.el('div', {}, [
          Utils.el('button', { type:'button', class:'dv2-btn dv2-btn-ghost', onclick:()=>Controller.reload() },
            [ icon('refresh','dv2-i-sm'), 'Atualizar' ])
        ])
      ]));
      page.appendChild(Utils.el('div',{id:'dv2-alert'}));
      page.appendChild(Filters.render());
      page.appendChild(Cards.render());
      page.appendChild(Pagamentos.render());
      page.appendChild(Profissionais.render());
      page.appendChild(Servicos.render());
      page.appendChild(Clientes.render());
      page.appendChild(Cancelamentos.render());
      page.appendChild(Produtos.render());
    },
    alert(msg){
      const box = document.getElementById('dv2-alert');
      if (!box) return;
      box.innerHTML = '';
      if (!msg) return;
      box.appendChild(Utils.el('div',{class:'dv2-card',role:'alert'},[
        icon('alert','dv2-i-lg'),
        Utils.el('span',{}, msg)
      ]));
    }
  };

  // ========================================================
  // FILTERS
  // ========================================================
  const Filters = {
    render(){
      const wrap = Utils.el('form', { class:'dv2-filters', onsubmit:(e)=>{ e.preventDefault(); Controller.apply(); } });
      const dIni = Utils.el('input', { type:'date', id:'dv2-ini', value: State.filters.dataInicio });
      const dFim = Utils.el('input', { type:'date', id:'dv2-fim', value: State.filters.dataFim });
      const sel  = Utils.el('select', { id:'dv2-prof' }, [
        Utils.el('option', { value:'' }, 'Todos os profissionais'),
        ...State.profissionais.map(p => Utils.el('option', { value: p.id }, p.nome))
      ]);
      sel.value = State.filters.profissionalId || '';
      wrap.appendChild(Utils.el('div',{class:'dv2-field'},[ Utils.el('label',{for:'dv2-ini'},'Data inicial'), dIni ]));
      wrap.appendChild(Utils.el('div',{class:'dv2-field'},[ Utils.el('label',{for:'dv2-fim'},'Data final'),   dFim ]));
      wrap.appendChild(Utils.el('div',{class:'dv2-field'},[ Utils.el('label',{for:'dv2-prof'},'Profissional'), sel ]));
      wrap.appendChild(Utils.el('button', { type:'submit', class:'dv2-btn' }, 'Aplicar'));
      return wrap;
    },
    read(){
      const ini = document.getElementById('dv2-ini');
      const fim = document.getElementById('dv2-fim');
      const prf = document.getElementById('dv2-prof');
      if (ini) State.filters.dataInicio = ini.value;
      if (fim) State.filters.dataFim    = fim.value;
      if (prf) State.filters.profissionalId = prf.value;
    }
  };

  // ========================================================
  // CARDS (KPIs)
  // ========================================================
  const Cards = {
    render(){
      const row = Utils.el('div', { class:'dv2-kpi-row', id:'dv2-kpi-row' });
      row.appendChild(Cards.skeleton());
      return row;
    },
    skeleton(){
      const frag = document.createDocumentFragment();
      for (let i=0;i<4;i++){
        frag.appendChild(Utils.el('div',{class:'dv2-kpi'},[
          Utils.el('div',{class:'dv2-kpi-top'},[
            Utils.el('span',{class:'dv2-skel',style:'width:110px;height:12px;'}),
            Utils.el('span',{class:'dv2-skel',style:'width:32px;height:32px;border-radius:9px;'})
          ]),
          Utils.el('div',{class:'dv2-skel',style:'width:130px;height:26px;'}),
          Utils.el('div',{class:'dv2-skel',style:'width:80px;height:12px;'})
        ]));
      }
      return frag;
    },
    // icon = nome de um ícone Lucide do catálogo acima.
    _card(title, value, iconName, tone, tipText, delta){
      const deltaEl = (delta!=null) ? Utils.el('span', {
        class: 'dv2-kpi-delta ' + (delta >= 0 ? 'up' : 'down')
      }, [
        icon(delta >= 0 ? 'arrow-up' : 'arrow-down','dv2-i-sm'),
        Utils.fmtPct(Math.abs(delta),0)
      ]) : null;
      return Utils.el('div',{class:'dv2-kpi'},[
        Utils.el('div',{class:'dv2-kpi-top'},[
          Utils.el('span',{class:'dv2-kpi-title'},[ title, tipText ? Utils.tip(tipText) : null ]),
          Utils.el('span',{class:'dv2-kpi-icon '+(tone||'')}, icon(iconName))
        ]),
        Utils.el('div',{class:'dv2-kpi-value'}, value),
        Utils.el('div',{class:'dv2-kpi-hint'},[
          deltaEl, deltaEl ? 'vs período anterior' : 'sem comparação'
        ])
      ]);
    },
    paint(snap){
      const row = document.getElementById('dv2-kpi-row');
      if (!row) return;
      row.innerHTML = '';
      const k = snap.kpis, d = k.delta || {};
      row.appendChild(Cards._card('Total de Agendamentos', Utils.fmtInt(k.agendamentos), 'calendar', '',
        'Total de agendamentos concluídos no período filtrado.', d.agendamentos));
      row.appendChild(Cards._card('Ticket Médio', Utils.fmtBRL(k.ticketMedio), 'receipt', '',
        'Faturamento total ÷ nº de atendimentos.', d.ticketMedio));
      row.appendChild(Cards._card('Total de Serviços', Utils.fmtInt(k.servicos), 'scissors', '',
        'Serviços realizados (inclui utilizações de pacote).', d.servicos));
      row.appendChild(Cards._card('Faturamento Total', Utils.fmtBRL(k.faturamento), 'circle-dollar', 'is-info',
        'Receita de agendamentos + vendas de balcão registradas no período.', d.faturamento));
    }
  };

  /* --------------------------------------------------------------
     NOTA: os componentes "Divisão de Comissões" e "Faturamento por
     Horário" foram REMOVIDOS nesta versão (seção Financeiro inteira).
     A comissão por profissional continua disponível, com detalhe
     individual, na tabela "Performance dos Profissionais".
     -------------------------------------------------------------- */

  // ========================================================
  // PAGAMENTOS
  // ========================================================
  const Pagamentos = {
    render(){
      return Utils.el('section',{class:'dv2-section'},[
        Utils.el('div',{class:'dv2-section-head'},[
          Utils.el('h2',{},[ icon('credit-card'), 'Pagamentos' ]),
          Utils.el('span',{class:'dv2-section-sub'},'Baseado em pagamentos registrados no período filtrado.')
        ]),
        Utils.el('div',{class:'dv2-grid-2'},[
          Utils.el('div',{class:'dv2-card',id:'dv2-pay-status'},''),
          Utils.el('div',{class:'dv2-card',id:'dv2-pay-forms'},'')
        ]),
        Utils.el('div',{class:'dv2-grid-2',style:'margin-top:16px;'},[
          Utils.el('div',{class:'dv2-card',id:'dv2-pay-ticket'},''),
          Utils.el('div',{class:'dv2-card',id:'dv2-pay-perdia'},'')
        ]),
        Utils.el('div',{class:'dv2-card',id:'dv2-pay-pend',style:'margin-top:16px;'},'')
      ]);
    },
    paint(snap){
      const p = snap.pagamentos;
      const totalFormas = p.formas.reduce((a,b)=>a+Utils.num(b.valor),0);

      // Recebido vs Pendente
      const status = document.getElementById('dv2-pay-status');
      status.innerHTML = '';
      status.appendChild(Utils.el('div',{class:'dv2-card-head'},[ Utils.el('h3',{},'Recebido vs Pendente') ]));
      status.appendChild(Utils.el('div',{class:'dv2-pay-summary'},[
        Utils.el('div',{class:'dv2-mini is-success'},[
          Utils.el('div',{class:'k'},'Recebido'),
          Utils.el('div',{class:'v'}, Utils.fmtBRL(p.recebido))
        ]),
        Utils.el('div',{class:'dv2-mini is-warning'},[
          Utils.el('div',{class:'k'},'Pendente'),
          Utils.el('div',{class:'v'}, Utils.fmtBRL(p.pendente))
        ]),
        Utils.el('div',{class:'dv2-mini'},[
          Utils.el('div',{class:'k'},'Pendências'),
          Utils.el('div',{class:'v'}, Utils.fmtInt(p.pendenciasQtd))
        ])
      ]));

      // Faturamento por forma
      const forms = document.getElementById('dv2-pay-forms');
      forms.innerHTML = '';
      forms.appendChild(Utils.el('div',{class:'dv2-card-head'},[ Utils.el('h3',{},'Faturamento por Forma') ]));
      if (!p.formas.length) {
        forms.appendChild(Utils.empty('Nenhum pagamento registrado no período.','inbox'));
      } else {
        const list = Utils.el('div',{class:'dv2-pay-form-list'});
        p.formas.forEach(f => {
          const ui  = formaUI(f.forma);
          const val = Utils.num(f.valor);
          const pct = totalFormas ? val/totalFormas : 0;
          list.appendChild(Utils.el('div',{class:'dv2-pay-form-row'},[
            Utils.el('span',{class:'ico'}, icon(ui.ico,'dv2-i-sm')),
            Utils.el('span',{class:'name'}, ui.label),
            Utils.el('span',{class:'val'}, Utils.fmtBRL(val)),
            Utils.el('span',{class:'pct'}, Utils.fmtPct(pct)),
            Utils.el('div',{class:'barwrap'},[ Utils.el('div',{class:'bar',style:`width:${(pct*100).toFixed(1)}%`}) ])
          ]));
        });
        forms.appendChild(list);
      }

      // Ticket médio por forma
      const tk = document.getElementById('dv2-pay-ticket');
      tk.innerHTML = '';
      tk.appendChild(Utils.el('div',{class:'dv2-card-head'},[ Utils.el('h3',{},'Ticket Médio por Forma') ]));
      if (!p.formas.length) {
        tk.appendChild(Utils.empty('Sem transações no período.','inbox'));
      } else {
        const twrap = Utils.el('div',{class:'dv2-table-wrap'});
        const tbl = Utils.el('table',{class:'dv2-table'});
        tbl.appendChild(Utils.el('thead',{},Utils.el('tr',{},[
          Utils.el('th',{},'Forma'),
          Utils.el('th',{class:'num'},'Ticket Médio'),
          Utils.el('th',{class:'num'},'Transações')
        ])));
        const tb = Utils.el('tbody',{});
        p.formas.forEach(f => {
          const qtd = Utils.num(f.qtd);
          const med = qtd ? Utils.num(f.valor)/qtd : 0;
          tb.appendChild(Utils.el('tr',{},[
            Utils.el('td',{}, formaUI(f.forma).label),
            Utils.el('td',{class:'num'}, Utils.fmtBRL(med)),
            Utils.el('td',{class:'num'}, Utils.fmtInt(qtd))
          ]));
        });
        tbl.appendChild(tb); twrap.appendChild(tbl); tk.appendChild(twrap);
      }

      // Recebimentos por dia
      const pd = document.getElementById('dv2-pay-perdia');
      pd.innerHTML = '';
      pd.appendChild(Utils.el('div',{class:'dv2-card-head'},[
        Utils.el('h3',{},'Recebimentos por Dia'),
        Utils.el('span',{class:'dv2-card-sub'},'Barras empilhadas por forma')
      ]));
      if (!p.porDia.length) {
        pd.appendChild(Utils.empty('Sem recebimentos no período.','inbox'));
      } else {
        const cwrap = Utils.el('div',{class:'dv2-chart-wrap'});
        const cv = Utils.el('canvas',{id:'dv2-c-perdia'});
        cwrap.appendChild(cv); pd.appendChild(cwrap);
        const labels = p.porDia.map(d => Utils.fmtDayLabel(d.data));
        const ids = Object.keys(FORMAS_UI).filter(id =>
          p.porDia.some(d => Utils.num((d.formas||{})[id]) > 0));
        Charts.stackedBar(cv, labels, ids.map(id => ({
          label: formaUI(id).label,
          color: formaUI(id).color,
          data:  p.porDia.map(d => Utils.num((d.formas||{})[id]))
        })));
      }

      // Pendências financeiras
      const pend = document.getElementById('dv2-pay-pend');
      pend.innerHTML = '';
      pend.appendChild(Utils.el('div',{class:'dv2-card-head'},[
        Utils.el('h3',{},'Pendências Financeiras'),
        Utils.el('span',{class:'dv2-card-sub'}, `${p.pendencias.length} em aberto`)
      ]));
      const pwrap = Utils.el('div',{class:'dv2-table-wrap'});
      const pt = Utils.el('table',{class:'dv2-table'});
      pt.appendChild(Utils.el('thead',{},Utils.el('tr',{},[
        Utils.el('th',{},'Cliente'),
        Utils.el('th',{},'Serviço(s)'),
        Utils.el('th',{},'Profissional'),
        Utils.el('th',{class:'num'},'Valor'),
        Utils.el('th',{},'Data'),
        Utils.el('th',{},'Hora')
      ])));
      const ptb = Utils.el('tbody',{});
      if (!p.pendencias.length) {
        ptb.appendChild(Utils.el('tr',{},Utils.el('td',{colspan:6},
          Utils.empty('Sem pendências no período.','check-circle'))));
      } else {
        p.pendencias.forEach(r => {
          ptb.appendChild(Utils.el('tr',{},[
            Utils.el('td',{}, r.cliente || '—'),
            Utils.el('td',{}, r.servicos || r.servico || '—'),
            Utils.el('td',{}, r.profissional || '—'),
            Utils.el('td',{class:'num'}, Utils.fmtBRL(r.valor)),
            Utils.el('td',{}, Utils.fmtDate(r.data)),
            Utils.el('td',{}, r.hora || '—')
          ]));
        });
      }
      pt.appendChild(ptb); pwrap.appendChild(pt); pend.appendChild(pwrap);
    }
  };

  // ========================================================
  // PROFISSIONAIS
  // ========================================================
  const Profissionais = {
    render(){
      return Utils.el('section',{class:'dv2-section'},[
        Utils.el('div',{class:'dv2-section-head'},[
          Utils.el('h2',{},[ icon('users'), 'Profissionais' ]),
          Utils.el('span',{class:'dv2-section-sub'},'Performance individual — Faturamento = Serviços + Produtos. Comissão, Caixinha e Total a Receber consideram apenas serviços.')
        ]),
        Utils.el('div',{class:'dv2-card'},[
          Utils.el('div',{class:'dv2-table-wrap'},
            Utils.el('table',{class:'dv2-table',id:'dv2-tbl-prof'},''))
        ])
      ]);
    },
    paint(snap){
      const tbl = document.getElementById('dv2-tbl-prof');
      tbl.innerHTML = '';
      const cols = [
        { key:'nome',         label:'Profissional', type:'text' },
        { key:'atendimentos', label:'Atendimentos', type:'int'  },
        { key:'servicos',         label:'Serviços',         type:'int' },
        { key:'produtosVendidos', label:'Produtos Vendidos', type:'brl' },
        { key:'faturamento',      label:'Faturamento',      type:'brl' },
        { key:'comissao',     label:'Comissão',     type:'brl'  },
        { key:'caixinha',     label:'Caixinha',     type:'brl'  },
        { key:'total',        label:'Total a Receber', type:'brl' }
      ];
      const sortCol = State.sort.profissionais.col;
      const sortDir = State.sort.profissionais.dir;
      const thead = Utils.el('thead',{});
      const trh = Utils.el('tr',{});
      cols.forEach(c => {
        const isNum = c.type !== 'text';
        const isSorted = c.key === sortCol;
        const arrIcon = isSorted ? (sortDir==='asc'?'chevron-up':'chevron-down') : 'chevrons';
        trh.appendChild(Utils.el('th',{
          class:(isNum?'num sortable':'sortable') + (isSorted?' sorted':''),
          onclick: () => Profissionais.sort(c.key)
        }, [ c.label, Utils.el('span',{class:'arr'}, icon(arrIcon,'dv2-i-sm')) ]));
      });
      thead.appendChild(trh);
      tbl.appendChild(thead);

      const rows = snap.profissionaisTable.slice().sort((a,b) => {
        const av=a[sortCol], bv=b[sortCol];
        if (sortCol === 'nome') {
          return sortDir==='asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
        }
        return sortDir==='asc' ? Utils.num(av)-Utils.num(bv) : Utils.num(bv)-Utils.num(av);
      });
      const tb = Utils.el('tbody',{});
      if (!rows.length) {
        tb.appendChild(Utils.el('tr',{}, Utils.el('td',{colspan:cols.length},
          Utils.empty('Nenhum profissional com atendimentos no período.','users'))));
      } else {
        rows.forEach(r => {
          tb.appendChild(Utils.el('tr',{},[
            Utils.el('td',{}, r.nome || '—'),
            Utils.el('td',{class:'num'}, Utils.fmtInt(r.atendimentos)),
            Utils.el('td',{class:'num'}, Utils.fmtInt(r.servicos)),
            Utils.el('td',{class:'num'}, Utils.fmtBRL(r.produtosVendidos)),
            Utils.el('td',{class:'num'}, Utils.fmtBRL(r.faturamento)),
            Utils.el('td',{class:'num'}, Utils.fmtBRL(r.comissao)),
            Utils.el('td',{class:'num'}, Utils.fmtBRL(r.caixinha)),
            Utils.el('td',{class:'num strong'}, Utils.fmtBRL(r.total))
          ]));
        });
      }
      tbl.appendChild(tb);
    },
    sort(col){
      const s = State.sort.profissionais;
      if (s.col === col) s.dir = s.dir==='asc'?'desc':'asc';
      else { s.col = col; s.dir = 'desc'; }
      if (State.snapshot) Profissionais.paint(State.snapshot);
    }
  };

  // ========================================================
  // SERVIÇOS
  // ========================================================
  const Servicos = {
    render(){
      return Utils.el('section',{class:'dv2-section'},[
        Utils.el('div',{class:'dv2-section-head'},[
          Utils.el('h2',{},[ icon('scissors'), 'Serviços' ]),
          Utils.el('span',{class:'dv2-section-sub'},'Top serviços e desempenho de pacotes.')
        ]),
        Utils.el('div',{class:'dv2-grid-2-eq'},[
          Utils.el('div',{class:'dv2-card',id:'dv2-top-serv'},''),
          Utils.el('div',{class:'dv2-card',id:'dv2-pacotes'},'')
        ])
      ]);
    },
    paint(snap){
      // Top 10 serviços
      const box = document.getElementById('dv2-top-serv');
      box.innerHTML = '';
      box.appendChild(Utils.el('div',{class:'dv2-card-head'},[
        Utils.el('h3',{},'Top 10 Serviços'),
        Utils.el('span',{class:'dv2-card-sub'},'Ordenado por quantidade')
      ]));
      if (!snap.topServicos.length) {
        box.appendChild(Utils.empty('Nenhum serviço realizado no período.','scissors'));
      } else {
        const wrap = Utils.el('div',{class:'dv2-table-wrap'});
        const tbl = Utils.el('table',{class:'dv2-table'});
        tbl.appendChild(Utils.el('thead',{},Utils.el('tr',{},[
          Utils.el('th',{},'Serviço(s)'),
          Utils.el('th',{class:'num'},'Qtd'),
          Utils.el('th',{class:'num'},'Valor Total')
        ])));
        const tb = Utils.el('tbody',{});
        snap.topServicos.forEach(s => {
          tb.appendChild(Utils.el('tr',{},[
            Utils.el('td',{},[
              s.nome || '—', ' ',
              s.pkg ? Utils.el('span',{class:'pill pkg',title:'Inclui utilizações de pacote'},
                        [ icon('package','dv2-i-sm'), 'pacote' ]) : null
            ]),
            Utils.el('td',{class:'num'}, Utils.fmtInt(s.qtd)),
            Utils.el('td',{class:'num'}, Utils.fmtBRL(s.valor))
          ]));
        });
        tbl.appendChild(tb); wrap.appendChild(tbl); box.appendChild(wrap);
      }

      // Pacotes
      const pk = document.getElementById('dv2-pacotes');
      pk.innerHTML = '';
      pk.appendChild(Utils.el('div',{class:'dv2-card-head'},[ Utils.el('h3',{},'Pacotes Vendidos') ]));
      pk.appendChild(Utils.el('div',{class:'dv2-pay-summary'},[
        Utils.el('div',{class:'dv2-mini'},[
          Utils.el('div',{class:'k'},'Quantidade'),
          Utils.el('div',{class:'v'}, Utils.fmtInt(snap.pacotes.qtd))
        ]),
        Utils.el('div',{class:'dv2-mini is-success'},[
          Utils.el('div',{class:'k'},'Receita'),
          Utils.el('div',{class:'v'}, Utils.fmtBRL(snap.pacotes.receita))
        ]),
        Utils.el('div',{class:'dv2-mini'},[
          Utils.el('div',{class:'k'},'Ticket Médio'),
          Utils.el('div',{class:'v'}, Utils.fmtBRL(snap.pacotes.qtd ? snap.pacotes.receita/snap.pacotes.qtd : 0))
        ])
      ]));
      if (!snap.pacotes.lista.length) {
        pk.appendChild(Utils.empty('Nenhum pacote vendido no período.','package'));
      } else {
        const pwrap = Utils.el('div',{class:'dv2-table-wrap',style:'margin-top:16px;'});
        const pt = Utils.el('table',{class:'dv2-table'});
        pt.appendChild(Utils.el('thead',{},Utils.el('tr',{},[
          Utils.el('th',{},'Pacote'),
          Utils.el('th',{class:'num'},'Qtd'),
          Utils.el('th',{class:'num'},'Receita')
        ])));
        const ptb = Utils.el('tbody',{});
        snap.pacotes.lista.forEach(r => {
          ptb.appendChild(Utils.el('tr',{},[
            Utils.el('td',{}, r.pacote || '—'),
            Utils.el('td',{class:'num'}, Utils.fmtInt(r.qtd)),
            Utils.el('td',{class:'num'}, Utils.fmtBRL(r.receita))
          ]));
        });
        pt.appendChild(ptb); pwrap.appendChild(pt); pk.appendChild(pwrap);
      }
      pk.appendChild(Utils.el('div',{class:'dv2-card-note'},[
        'Vendas geram receita mas não contam como atendimento. Utilizações aparecem em Top Serviços identificadas pelo selo ',
        Utils.el('span',{class:'pill pkg'},[ icon('package','dv2-i-sm'), 'pacote' ]),
        '.'
      ]));
    }
  };

  // ========================================================
  // CLIENTES
  // ========================================================
  const Clientes = {
    render(){
      return Utils.el('section',{class:'dv2-section'},[
        Utils.el('div',{class:'dv2-section-head'},[
          Utils.el('h2',{},[ icon('user'), 'Clientes' ]),
          Utils.el('span',{class:'dv2-section-sub'},'Top 10 clientes por número de atendimentos.')
        ]),
        Utils.el('div',{class:'dv2-card'},[
          Utils.el('div',{class:'dv2-table-wrap'},
            Utils.el('table',{class:'dv2-table',id:'dv2-tbl-clientes'},''))
        ])
      ]);
    },
    paint(snap){
      const tbl = document.getElementById('dv2-tbl-clientes');
      tbl.innerHTML = '';
      tbl.appendChild(Utils.el('thead',{},Utils.el('tr',{},[
        Utils.el('th',{},'Cliente'),
        Utils.el('th',{class:'num'},'Atendimentos'),
        Utils.el('th',{},'')
      ])));
      const tb = Utils.el('tbody',{});
      if (!snap.topClientes.length) {
        tb.appendChild(Utils.el('tr',{}, Utils.el('td',{colspan:3},
          Utils.empty('Nenhum atendimento no período.','user'))));
      } else {
        snap.topClientes.forEach(c => {
          tb.appendChild(Utils.el('tr',{},[
            Utils.el('td',{}, c.nome || '—'),
            Utils.el('td',{class:'num'}, Utils.fmtInt(c.atendimentos)),
            Utils.el('td',{}, c.pkg ? Utils.el('span',{class:'pill pkg'},
                        [ icon('package','dv2-i-sm'), 'utilizou pacote' ]) : '')
          ]));
        });
      }
      tbl.appendChild(tb);
    }
  };

  // ========================================================
  // CANCELAMENTOS
  // ========================================================
  const Cancelamentos = {
    render(){
      return Utils.el('section',{class:'dv2-section'},[
        Utils.el('div',{class:'dv2-section-head'},[
          Utils.el('h2',{},[ icon('trending-down'), 'Analytics — Cancelamentos' ]),
          Utils.el('span',{class:'dv2-section-sub'},'Perdas e padrões de cancelamento.')
        ]),
        Utils.el('div',{class:'dv2-kpi-row',id:'dv2-canc-kpis'},''),
        Utils.el('div',{class:'dv2-grid-2-eq',style:'margin-top:16px;'},[
          Utils.el('div',{class:'dv2-card',id:'dv2-canc-motivos'},''),
          Utils.el('div',{class:'dv2-card',id:'dv2-canc-prof'},'')
        ])
      ]);
    },
    paint(snap){
      const c = snap.cancelamentos;
      const kpis = document.getElementById('dv2-canc-kpis');
      kpis.innerHTML = '';
      kpis.appendChild(Cards._card('Cancelamentos', Utils.fmtInt(c.qtd), 'ban', 'is-danger', 'Total de cancelamentos no período.'));
      kpis.appendChild(Cards._card('Taxa',          Utils.fmtPct(c.taxa), 'bar-chart', 'is-warning', 'Cancelamentos ÷ agendamentos do período.'));
      kpis.appendChild(Cards._card('Valor Perdido', Utils.fmtBRL(c.valorPerdido), 'trending-down', 'is-danger','Faturamento potencial perdido.'));
      kpis.appendChild(Cards._card('Cancelado c/ Venda', Utils.fmtInt(c.comVenda), 'shopping-bag', '','Cancelamentos com venda associada.'));

      const m = document.getElementById('dv2-canc-motivos');
      m.innerHTML = '';
      m.appendChild(Utils.el('div',{class:'dv2-card-head'},[ Utils.el('h3',{},'Motivos de Cancelamento') ]));
      if (!c.motivos.length) {
        m.appendChild(Utils.empty('Nenhum cancelamento registrado no período.','check-circle'));
      } else {
        const w1 = Utils.el('div',{class:'dv2-chart-wrap sm'});
        const cv1 = Utils.el('canvas',{id:'dv2-c-motivos'});
        w1.appendChild(cv1); m.appendChild(w1);
        Charts.hBar(cv1, c.motivos.map(x=>x.label), c.motivos.map(x=>Utils.num(x.qtd)), Theme.read().primary);
      }

      const pf = document.getElementById('dv2-canc-prof');
      pf.innerHTML = '';
      pf.appendChild(Utils.el('div',{class:'dv2-card-head'},[ Utils.el('h3',{},'Cancelamentos por Profissional') ]));
      if (!c.porProfissional.length) {
        pf.appendChild(Utils.empty('Nenhum cancelamento registrado no período.','check-circle'));
      } else {
        const w2 = Utils.el('div',{class:'dv2-chart-wrap sm'});
        const cv2 = Utils.el('canvas',{id:'dv2-c-canc-prof'});
        w2.appendChild(cv2); pf.appendChild(w2);
        Charts.hBar(cv2, c.porProfissional.map(x=>x.nome), c.porProfissional.map(x=>Utils.num(x.qtd)), Theme.read().ramp[2]);
      }
    }
  };

  // ========================================================
  // PRODUTOS
  // ========================================================
  const Produtos = {
    render(){
      return Utils.el('section',{class:'dv2-section'},[
        Utils.el('div',{class:'dv2-section-head'},[
          Utils.el('h2',{},[ icon('package'), 'Analytics — Produtos' ]),
          Utils.el('span',{class:'dv2-section-sub'},'Receita, custo e margem de produtos — inclui as vendas de balcão.')
        ]),
        Utils.el('div',{class:'dv2-kpi-row',id:'dv2-prod-kpis'},''),
        Utils.el('div',{class:'dv2-grid-3',style:'margin-top:16px;'},[
          Utils.el('div',{class:'dv2-card',id:'dv2-prod-vendidos'},''),
          Utils.el('div',{class:'dv2-card',id:'dv2-prod-lucrativos'},''),
          Utils.el('div',{class:'dv2-card',id:'dv2-prod-margem'},'')
        ])
      ]);
    },
    paint(snap){
      const p = snap.produtos;
      const kp = document.getElementById('dv2-prod-kpis');
      kp.innerHTML = '';
      kp.appendChild(Cards._card('Faturamento Bruto', Utils.fmtBRL(p.faturamentoBruto), 'circle-dollar','is-info','Receita bruta de venda de produtos.'));
      kp.appendChild(Cards._card('CMV',               Utils.fmtBRL(p.cmv), 'package','','Custo da mercadoria vendida.'));
      kp.appendChild(Cards._card('Lucro Bruto',       Utils.fmtBRL(p.lucroBruto), 'trending-up','is-success','Faturamento bruto − CMV.'));
      kp.appendChild(Cards._card('Margem Média',      Utils.fmtPct(p.margem), 'calculator','','Margem bruta média sobre vendas.'));
      kp.appendChild(Cards._card('Receita no Balcão',  Utils.fmtBRL(p.receitaBalcao), 'shopping-cart','','Parte da receita de produtos originada em vendas de balcão.'));

      const paintList = (id, title, rows, colLabel, fmt, emptyMsg) => {
        const box = document.getElementById(id);
        box.innerHTML = '';
        box.appendChild(Utils.el('div',{class:'dv2-card-head'},[ Utils.el('h3',{}, title) ]));
        if (!rows.length) { box.appendChild(Utils.empty(emptyMsg,'package')); return; }
        const w = Utils.el('div',{class:'dv2-table-wrap'});
        const t = Utils.el('table',{class:'dv2-table'});
        t.appendChild(Utils.el('thead',{},Utils.el('tr',{},[
          Utils.el('th',{},'Produto'),
          Utils.el('th',{class:'num'}, colLabel)
        ])));
        const tb = Utils.el('tbody',{});
        rows.forEach(r => {
          tb.appendChild(Utils.el('tr',{},[
            Utils.el('td',{}, r.nome || '—'),
            Utils.el('td',{class:'num'}, fmt(r))
          ]));
        });
        t.appendChild(tb); w.appendChild(t); box.appendChild(w);
      };
      paintList('dv2-prod-vendidos',  'Mais Vendidos',   p.maisVendidos,   'Qtd',    r => Utils.fmtInt(r.qtd),
        'Nenhum produto vendido no período.');
      paintList('dv2-prod-lucrativos','Mais Lucrativos', p.maisLucrativos, 'Lucro',  r => Utils.fmtBRL(r.lucro),
        'Sem produtos com custo cadastrado.');
      paintList('dv2-prod-margem',    'Menor Margem',    p.menorMargem,    'Margem', r => Utils.fmtPct(r.margem),
        'Sem produtos com custo cadastrado.');
    }
  };

  // ========================================================
  // CHARTS — wrapper leve sobre Chart.js (com fallback canvas puro)
  // ========================================================
  const Charts = {
    _instances: {},
    _destroy(id){ if (Charts._instances[id]) { try { Charts._instances[id].destroy(); } catch(_){} delete Charts._instances[id]; } },
    destroyAll(){ Object.keys(Charts._instances).forEach(Charts._destroy); },
    _has(){ return typeof window.Chart !== 'undefined'; },

    stackedBar(canvas, labels, series){
      const id = canvas.id; Charts._destroy(id);
      if (!series.length) return;
      const th = Theme.read();
      if (Charts._has()){
        Charts._instances[id] = new window.Chart(canvas.getContext('2d'), {
          type: 'bar',
          data: {
            labels,
            datasets: series.map(s => ({ label: s.label, data: s.data, backgroundColor: s.color, borderRadius: 4, borderSkipped: false, maxBarThickness: 28 }))
          },
          options: Object.assign(Charts._commonOpts(), {
            scales: {
              x: { stacked: true, grid: { display: false }, ticks: { color: th.text, font:{ size:11 } }, border:{ display:false } },
              y: { stacked: true, beginAtZero: true, grid: { color: th.grid }, border:{ display:false },
                   ticks: { color: th.text, font:{ size:11 }, callback: v => 'R$ ' + v } }
            }
          })
        });
      } else Charts._fallback(canvas, labels, series[0].data, series[0].color);
    },
    hBar(canvas, labels, data, color){
      const id = canvas.id; Charts._destroy(id);
      const th = Theme.read();
      if (Charts._has()){
        Charts._instances[id] = new window.Chart(canvas.getContext('2d'), {
          type: 'bar',
          data: { labels, datasets: [{ data, backgroundColor: color || th.primary, borderRadius: 4, borderSkipped:false, maxBarThickness: 22 }] },
          options: Object.assign(Charts._commonOpts({legend:false}), {
            indexAxis: 'y',
            scales: {
              x: { beginAtZero: true, grid: { color: th.grid }, border:{ display:false }, ticks:{ color: th.text, font:{ size:11 }, precision:0 } },
              y: { grid: { display:false }, border:{ display:false }, ticks:{ color: th.text, font:{ size:11 } } }
            }
          })
        });
      } else Charts._fallback(canvas, labels, data, color || th.primary, true);
    },
    _commonOpts(o={}){
      const th = Theme.read();
      return {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 80,
        layout: { padding: { top: 4 } },
        plugins: {
          legend: o.legend===false ? { display:false } : {
            position:'bottom',
            labels:{ boxWidth:8, boxHeight:8, usePointStyle:true, pointStyle:'circle', color: th.text, font:{ size:11 }, padding:14 }
          },
          tooltip: {
            backgroundColor: th.ink, padding:10, cornerRadius:8, displayColors:false,
            titleFont:{ size:11, weight:'600' }, bodyFont:{ size:12 }
          }
        },
        scales: {
          x: { grid:{ display:false }, border:{ display:false }, ticks:{ color: th.text, font:{ size:11 } } },
          y: { grid:{ color: th.grid }, border:{ display:false }, beginAtZero:true, ticks:{ color: th.text, font:{ size:11 } } }
        }
      };
    },
    _fallback(canvas, labels, data, color){
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 400, h = canvas.clientHeight || 200;
      canvas.width = w*dpr; canvas.height = h*dpr;
      const ctx = canvas.getContext('2d'); ctx.scale(dpr,dpr);
      ctx.clearRect(0,0,w,h);
      if (!data || !data.length) return;
      const max = Math.max(1, ...data);
      const pad = 24, bw = (w-pad*2) / data.length * 0.7, gap = (w-pad*2)/data.length * 0.3;
      ctx.fillStyle = color;
      data.forEach((v,i) => {
        const bh = (v/max)*(h-pad*2);
        ctx.fillRect(pad + i*(bw+gap), h - pad - bh, bw, bh);
      });
      ctx.fillStyle = Theme.read().text; ctx.font = '10px sans-serif';
      labels.forEach((l,i) => ctx.fillText(String(l), pad + i*(bw+gap) + bw/2 - 6, h - 8));
    }
  };

  // ========================================================
  // CONTROLLER
  // ========================================================
  const Controller = {
    _busy: false,
    async open(){
      if (Controller._busy) return;
      Controller._busy = true;
      try {
        // Mostra a página imediatamente (navegação nunca fica travada)
        View.render();
        View.show();
        try {
          State.profissionais = await Api.fetchProfissionais();
          const sel = document.getElementById('dv2-prof');
          if (sel) {
            const atual = sel.value;
            sel.innerHTML = '';
            sel.appendChild(Utils.el('option',{value:''},'Todos os profissionais'));
            State.profissionais.forEach(p => sel.appendChild(Utils.el('option',{value:p.id},p.nome)));
            sel.value = atual || '';
          }
        } catch (e) {
          console.error('[Dashboard V2] Falha ao carregar profissionais:', e);
        }
        await Controller.reload();
      } finally {
        Controller._busy = false;
      }
    },
    async apply(){ Filters.read(); await Controller.reload(); },
    async reload(){
      if (!document.getElementById('page-dashboard-v2')) return;
      const row = document.getElementById('dv2-kpi-row');
      if (row) { row.innerHTML = ''; row.appendChild(Cards.skeleton()); }
      let snap;
      try {
        snap = await Api.fetchSnapshot(State.filters);
      } catch (err) {
        console.error('[Dashboard V2] falha ao carregar snapshot:', err);
        snap = emptySnapshot();
        snap.erro = 'Não foi possível carregar os dados do período. Tente novamente.';
      }
      State.snapshot = snap;
      View.alert(snap.erro);
      Cards.paint(snap);
      Pagamentos.paint(snap);
      Profissionais.paint(snap);
      Servicos.paint(snap);
      Clientes.paint(snap);
      Cancelamentos.paint(snap);
      Produtos.paint(snap);
    }
  };

  // ========================================================
  // BOOT
  // --------------------------------------------------------
  // Sem hash routing, sem preventDefault global, sem overlay.
  // Ao sair do V2 (qualquer item do menu) o app usa switchPage(),
  // que remove a classe .active desta página automaticamente —
  // por isso nada mais fica "travado".
  // ========================================================
  function boot(){
    // Cria a página cedo: se o app anexar seu próprio listener ao nosso
    // botão e chamar switchPage('dashboard-v2'), o elemento já existe.
    try { View.ensurePage(); } catch(_) {}
    Menu.inject();
    // Reobserva o sidebar caso ele seja re-renderizado pelo app.
    try {
      const nav = document.querySelector('.nav-btn') && document.querySelector('.nav-btn').parentElement;
      if (nav && window.MutationObserver) {
        new MutationObserver(() => Menu.inject()).observe(nav, { childList: true });
      }
    } catch(_) {}
    // Ao trocar de página pelo menu, destrói os gráficos do V2 (memória).
    document.addEventListener('click', function (ev) {
      const btn = ev.target && ev.target.closest ? ev.target.closest('.nav-btn') : null;
      if (!btn || btn.dataset.page === 'dashboard-v2') return;
      Charts.destroyAll();
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // Namespace para debug
  window.DV2 = { Utils, Theme, State, Api, Menu, View, Filters, Cards, Pagamentos, Profissionais, Servicos, Clientes, Cancelamentos, Produtos, Charts, Controller };
})();
