/* =====================================================================
   AGENDAMENTO-COMPARTILHADO.JS  (v4 — 2026-06-11)
   Add-on isolado — Recurso "Agendamento Compartilhado (Grupo de Unidades)"
   v4:
     • Modal de crop do banner com PRÉ-VISUALIZAÇÃO AO VIVO (coluna lateral
       que replica em tempo real como o banner ficará no topo da página de
       seleção de unidades — banner curvo + logo + nome + cards).
     • Bloco "Dicas para um bom resultado".
     • Cropper já abre com proporção fixa 16:5 e enquadramento central
       automático (autoCropArea:1, viewMode:1, dragMode:'move').
     • Mantém todo o comportamento da v3 (página pública premium,
       config + QR, detecção de tenantId).
   ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_SHAREDBOOKING_LOADED__) return;
  window.__SLOTIFY_SHAREDBOOKING_LOADED__ = true;

  var TAG = '[sg]';
  console.log('%c🏢 agendamento-compartilhado.js v4 carregado',
    'background:#6c3aed;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700');

  var BANNER_BUCKET = 'group-banners';
  var BANNER_ASPECT = 16 / 5;        // proporção do banner
  var BANNER_MAX_MB = 8;

  /* ------------------------------------------------------------------ */
  /* Utilitários                                                        */
  /* ------------------------------------------------------------------ */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function getQueryParam(name) {
    try { return new URL(window.location.href).searchParams.get(name); }
    catch (e) { return null; }
  }
  function waitFor(predicate, timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      (function loop() {
        var v; try { v = predicate(); } catch (e) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
        setTimeout(loop, 120);
      })();
    });
  }
  function getSupabase() {
    if (window.supabaseClient) return window.supabaseClient;
    if (window.__supabaseClient) return window.__supabaseClient;
    if (window.sb) return window.sb;
    if (window._supabase) return window._supabase;
    return null;
  }

  /* ==================================================================
     CONTEXTO A — Página pública (agendamento-cliente.html)
     ================================================================== */
  function isClientBookingPage() {
    return !!document.getElementById('ac-app') || !!document.getElementById('ac-boot-loader');
  }

  async function runGroupPicker() {
    var groupSlug = getQueryParam('groupSlug') || getQueryParam('group');
    var groupId   = getQueryParam('groupId');
    var tenantId  = getQueryParam('tenantId') || getQueryParam('tenant');
    if (tenantId) return;
    if (!groupSlug && !groupId) return;

    ['ac-boot-loader','ac-disabled','ac-app'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.hidden = true;
    });
    try {
      var keepHidden = function () {
        ['ac-boot-loader','ac-disabled','ac-app'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el && !el.hidden) el.hidden = true;
        });
      };
      var mo = new MutationObserver(keepHidden);
      mo.observe(document.body, { attributes:true, subtree:true, attributeFilter:['hidden','style','class'] });
      window.__sgGroupPickerObserver = mo;
    } catch (e) {}

    var screen = document.createElement('div');
    screen.className = 'gp-screen';
    screen.id = 'sg-group-picker';
    screen.innerHTML =
      '<div class="gp-hero-wrap">' +
        '<span class="gp-eyebrow-fixed"><i class="fa-regular fa-building"></i> Rede de Unidades</span>' +
        '<div class="gp-hero" id="gp-hero">' +
          '<div class="gp-hero-fallback">Carregando…</div>' +
        '</div>' +
        '<div class="gp-logo-wrap" id="gp-logo">' +
          '<span class="gp-logo-fb"><i class="fa-solid fa-store"></i></span>' +
        '</div>' +
      '</div>' +
      '<div class="gp-headline">' +
        '<h1 id="gp-title">Carregando…</h1>' +
        '<p id="gp-subtitle">Buscando unidades disponíveis…</p>' +
        '<span class="gp-underline"></span>' +
      '</div>' +
      '<div class="gp-list" id="gp-list" aria-live="polite"></div>' +
      '<div class="gp-info" id="gp-info" hidden>' +
        '<div class="gp-info-inner">' +
          '<i class="fa-solid fa-users"></i>' +
          '<p>Você está acessando a rede de unidades da <b id="gp-info-name">…</b>.<br>' +
          'Escolha a unidade para visualizar profissionais, serviços e horários disponíveis.</p>' +
        '</div>' +
      '</div>' +
      '<div class="gp-footer" id="gp-footer" hidden>' +
        '<i class="fa-solid fa-store"></i>' +
        '<div class="gp-footer-meta">' +
          '<span><b id="gp-footer-count">0</b> unidades disponíveis</span>' +
          '<small id="gp-footer-where"></small>' +
        '</div>' +
      '</div>';
    document.body.appendChild(screen);

    var sb;
    try { sb = await waitFor(getSupabase, 6000); }
    catch (e) { return renderError('Não foi possível conectar ao servidor.'); }

    var rows = null, errMsg = null;
    try {
      if (groupSlug) {
        var r1 = await sb.rpc('get_public_group_units', { _slug: groupSlug });
        if (r1.error) throw r1.error;
        rows = r1.data || [];
      } else if (groupId) {
        var r2 = await sb
          .from('tenant_group_tenants')
          .select('tenant_id, tenant_groups!inner(id,name,slug,active,banner_image_url), tenants!inner(id,nome,nome_fantasia,cidade,estado,logo_url)')
          .eq('group_id', groupId)
          .eq('tenant_groups.active', true);
        if (r2.error) throw r2.error;
        rows = (r2.data || []).map(function (row) {
          return {
            group_id:         row.tenant_groups.id,
            group_name:       row.tenant_groups.name,
            group_banner_url: row.tenant_groups.banner_image_url,
            tenant_id:        row.tenants.id,
            nome:             row.tenants.nome_fantasia || row.tenants.nome,
            cidade:           row.tenants.cidade,
            estado:           row.tenants.estado,
            logo_url:         row.tenants.logo_url,
            cover_image_url:  null
          };
        });
      }
    } catch (e) {
      console.error(TAG,'erro carregando grupo:', e);
      errMsg = 'Não conseguimos carregar as unidades desse grupo.';
    }

    if (errMsg) return renderError(errMsg);
    if (!rows || rows.length === 0) return renderEmpty();

    var groupName   = rows[0].group_name || 'Rede';
    var groupBanner = rows[0].group_banner_url || null;

    var fallbackCover = null;
    for (var i = 0; i < rows.length && !fallbackCover; i++) {
      if (rows[i].cover_image_url) fallbackCover = rows[i].cover_image_url;
    }
    var heroUrl = groupBanner || fallbackCover;

    var heroLogo = null;
    for (var j = 0; j < rows.length && !heroLogo; j++) {
      if (rows[j].logo_url) heroLogo = rows[j].logo_url;
    }

    var heroEl = document.getElementById('gp-hero');
    if (heroUrl) {
      heroEl.innerHTML = '<img src="' + escapeAttr(heroUrl) + '" alt="">';
    } else {
      heroEl.innerHTML = '<div class="gp-hero-fallback">' + escapeHtml(groupName) + '</div>';
    }
    if (heroLogo) {
      document.getElementById('gp-logo').innerHTML =
        '<img src="' + escapeAttr(heroLogo) + '" alt="">';
    }

    document.getElementById('gp-title').textContent    = groupName;
    document.getElementById('gp-subtitle').textContent = 'Selecione abaixo onde você deseja ser atendido.';

    var list = document.getElementById('gp-list');
    list.innerHTML = '';
    rows.forEach(function (u) {
      var cover = u.cover_image_url || heroUrl;
      var local = [u.cidade, u.estado].filter(Boolean).join(' / ');
      var card  = document.createElement('div');
      card.className = 'gp-card';
      card.innerHTML =
        '<div class="gp-card-cover">' +
          (cover
            ? '<img src="' + escapeAttr(cover) + '" alt="">'
            : '<div class="gp-hero-fallback">' + escapeHtml(u.nome) + '</div>') +
        '</div>' +
        '<div class="gp-card-head">' +
          '<div class="gp-card-logo">' +
            (u.logo_url
              ? '<img src="' + escapeAttr(u.logo_url) + '" alt="">'
              : '<i class="fa-solid fa-store"></i>') +
          '</div>' +
          '<div class="gp-card-titles">' +
            '<span class="gp-card-brand">' + escapeHtml(groupName) + '</span>' +
            '<span class="gp-card-unit">' + escapeHtml(u.nome) + '</span>' +
          '</div>' +
        '</div>' +
        (local ?
          '<div class="gp-card-meta"><i class="fa-solid fa-location-dot"></i> ' + escapeHtml(local) + '</div>'
          : '') +
        '<div class="gp-card-divider"></div>' +
        '<div class="gp-card-extra">' +
          '<span class="gp-extra-item"><i class="fa-regular fa-circle-check"></i> Disponível para agendamento</span>' +
        '</div>' +
        '<button type="button" class="gp-card-cta">' +
          '<i class="fa-regular fa-calendar"></i> Selecionar unidade ' +
          '<i class="fa-solid fa-arrow-right gp-cta-arrow"></i>' +
        '</button>';
      card.querySelector('.gp-card-cta').addEventListener('click', function () {
        goToTenant(u.tenant_id);
      });
      card.addEventListener('click', function (ev) {
        if (ev.target.closest('.gp-card-cta')) return;
        goToTenant(u.tenant_id);
      });
      list.appendChild(card);
    });

    document.getElementById('gp-info-name').textContent = groupName;
    document.getElementById('gp-info').hidden = false;

    var citiesSet = {};
    rows.forEach(function (u) {
      var c = [u.cidade, u.estado].filter(Boolean).join(' / ');
      if (c) citiesSet[c] = true;
    });
    var cities = Object.keys(citiesSet).slice(0, 2).join(' • ');
    document.getElementById('gp-footer-count').textContent = rows.length;
    document.getElementById('gp-footer-where').textContent = cities;
    document.getElementById('gp-footer').hidden = false;

    function goToTenant(tid) {
      var url = new URL(window.location.href);
      url.searchParams.delete('groupSlug');
      url.searchParams.delete('group');
      url.searchParams.delete('groupId');
      url.searchParams.set('tenantId', tid);
      window.location.replace(url.toString());
    }

    function renderError(msg) {
      var s = document.getElementById('gp-subtitle');
      if (s) s.textContent = 'Algo deu errado.';
      var l = document.getElementById('gp-list');
      if (l) l.innerHTML = '<div class="gp-error"><i class="fa-regular fa-circle-xmark"></i><p>'+escapeHtml(msg)+'</p></div>';
    }
    function renderEmpty() {
      var s = document.getElementById('gp-subtitle');
      if (s) s.textContent = 'Nenhuma unidade encontrada.';
      var l = document.getElementById('gp-list');
      if (l) l.innerHTML = '<div class="gp-empty"><i class="fa-regular fa-circle-question"></i><p>Não há unidades ativas neste grupo no momento.</p></div>';
    }
  }

  /* ==================================================================
     CONTEXTO B — Tela de Configurações (agenda.html)
     ================================================================== */
  function isSettingsPage() {
    return !!document.getElementById('link-cliente-box');
  }

  var TENANT_LS_KEYS = [
    'current_tenant_id','currentTenantId','tenant_id','tenantId',
    'tenant','selected_tenant_id','selectedTenantId','active_tenant_id',
    'slotify.tenantId','slotify_tenant_id','slotify_current_tenant'
  ];
  var UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  function tryParseTenantFromUrl(str) {
    if (!str) return null;
    try {
      var m = String(str).match(/[?&](?:tenantId|tenant)=([^&#]+)/i);
      if (m && UUID_RE.test(m[1])) return m[1].match(UUID_RE)[0];
      var m3 = String(str).match(UUID_RE);
      if (m3) return m3[0];
    } catch (e) {}
    return null;
  }
  function getCurrentTenantIdSafe() {
    try {
      if (typeof window.getCurrentTenantId === 'function') {
        var v = window.getCurrentTenantId(); if (v) return v;
      }
    } catch (e) {}
    var globals = ['currentTenantId','CURRENT_TENANT_ID','tenantId','TENANT_ID'];
    for (var i = 0; i < globals.length; i++) {
      try { if (window[globals[i]] && UUID_RE.test(String(window[globals[i]]))) return String(window[globals[i]]); }
      catch (e) {}
    }
    try {
      for (var k = 0; k < TENANT_LS_KEYS.length; k++) {
        var key = TENANT_LS_KEYS[k];
        var v1 = localStorage.getItem(key); if (v1 && UUID_RE.test(v1)) return v1.match(UUID_RE)[0];
        var v2 = sessionStorage.getItem(key); if (v2 && UUID_RE.test(v2)) return v2.match(UUID_RE)[0];
      }
    } catch (e) {}
    try {
      for (var n = 0; n < localStorage.length; n++) {
        var kk = localStorage.key(n);
        if (!kk || !/tenant/i.test(kk)) continue;
        var val = localStorage.getItem(kk); if (!val) continue;
        var direct = val.match(UUID_RE); if (direct) return direct[0];
      }
    } catch (e) {}
    try {
      var inp = document.getElementById('link-cliente-input');
      if (inp && inp.value) {
        var t = tryParseTenantFromUrl(inp.value); if (t) return t;
      }
    } catch (e) {}
    return null;
  }
  async function fetchTenantIdViaAuth(sb) {
    try {
      var sess = await sb.auth.getSession();
      var user = sess && sess.data && sess.data.session && sess.data.session.user;
      if (!user) return null;
      var r = await sb.from('tenants').select('id').eq('user_id', user.id).limit(1);
      if (!r.error && r.data && r.data[0]) return r.data[0].id;
    } catch (e) { console.warn(TAG,'auth fallback:', e); }
    return null;
  }

  var lastTenantInjected = null;
  var diagLogged = false;
  var currentGroupRef = null;

  async function syncSettingsBlock() {
    var box = document.getElementById('link-cliente-box');
    if (!box) return;

    var sb = getSupabase(); if (!sb) return;

    var tenantId = getCurrentTenantIdSafe();
    if (!tenantId) tenantId = await fetchTenantIdViaAuth(sb);
    if (!tenantId) {
      if (!diagLogged) {
        diagLogged = true;
        console.warn(TAG,'tenantId não encontrado. Use __sgDebug() para diagnóstico.');
      }
      return;
    }
    if (lastTenantInjected === tenantId && document.getElementById('sg-section')) return;

    var group = null;
    try {
      var r = await sb.rpc('get_tenant_group', { _tenant_id: tenantId });
      if (!r.error && r.data && r.data.length) group = r.data[0];
      else if (r.error) console.warn(TAG,'get_tenant_group erro:', r.error);
    } catch (e) { console.warn(TAG,'get_tenant_group falhou:', e); }

    var existing = document.getElementById('sg-section');
    if (existing) existing.parentNode.removeChild(existing);

    lastTenantInjected = tenantId;
    if (!group) { currentGroupRef = null; return; }

    currentGroupRef = group;

    console.log(TAG,'✅ injetando bloco para grupo:', group.group_name);
    var section = buildSharedSection(group);
    var parentSection = box.closest('.config-section');
    if (parentSection && parentSection.parentNode) {
      parentSection.parentNode.insertBefore(section, parentSection.nextSibling);
    } else {
      box.parentNode.appendChild(section);
    }
    renderSharedQr(section, group);
    refreshBannerPreview(group.banner_image_url);
  }

  function buildSharedSection(group) {
    var base = window.location.origin;
    var publicLink = base + '/agendamento-cliente.html?groupSlug=' + encodeURIComponent(group.slug);

    var section = document.createElement('div');
    section.id = 'sg-section';
    section.className = 'config-section sg-config-section';
    section.innerHTML =
      '<div class="config-section-left">' +
        '<h3>Agendamento compartilhado <span class="sg-badge-novo">NOVO</span></h3>' +
        '<p class="config-help-text">Este estabelecimento participa do grupo ' +
          '<span class="sg-group-link">' + escapeHtml(group.group_name) + '</span>.</p>' +
        '<p class="config-help-text">Use o link, QR Code e o banner para que o cliente escolha a unidade antes de agendar.</p>' +
      '</div>' +
      '<div class="config-section-right">' +
        '<div class="sg-link-box">' +
          '<div class="sg-group-chip"><i class="fa-regular fa-building"></i> Grupo: <b>' + escapeHtml(group.group_name) + '</b></div>' +
          '<label class="sg-link-label">Link de agendamento compartilhado</label>' +
          '<div class="sg-link-row">' +
            '<input type="text" id="sg-link-input" readonly value="' + escapeAttr(publicLink) + '">' +
            '<button type="button" class="sg-copy-btn" id="sg-copy-btn"><i class="fa-regular fa-copy"></i> Copiar link</button>' +
          '</div>' +
          '<p class="sg-help">Compartilhe esse link. Seus clientes escolhem a unidade antes de continuar o agendamento.</p>' +

          /* QR */
          '<div class="qr-ag-section" id="sg-qr-section">' +
            '<div class="qr-ag-frame" id="sg-qr-frame">' +
              '<span class="qr-ag-corner-bl"></span><span class="qr-ag-corner-br"></span>' +
              '<div id="sg-qr-canvas-wrap" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:.85rem;">Gerando…</div>' +
            '</div>' +
            '<div class="qr-ag-info">' +
              '<h4>Escaneie para escolher a unidade e agendar</h4>' +
              '<p>Ideal para redes sociais, WhatsApp e campanhas.</p>' +
              '<div class="qr-ag-actions">' +
                '<button type="button" class="qr-ag-btn qr-ag-btn-primary" id="sg-qr-download" disabled><i class="fa-solid fa-download"></i> Baixar QR Code (PNG)</button>' +
                '<button type="button" class="qr-ag-btn qr-ag-btn-secondary" id="sg-qr-print" disabled><i class="fa-solid fa-print"></i> Imprimir QR Code</button>' +
              '</div>' +
            '</div>' +
          '</div>' +

          /* BANNER DA REDE */
          '<div class="sgb-block">' +
            '<h4><i class="fa-regular fa-image"></i> Imagem de capa da rede</h4>' +
            '<p class="sgb-help">Esta imagem será exibida no topo da tela de seleção de unidades da rede. Proporção recomendada: <b>1600 × 500</b> (16:5).</p>' +
            '<div class="sgb-preview" id="sgb-preview">' +
              '<div class="sgb-empty"><i class="fa-regular fa-image"></i><span>Nenhuma imagem cadastrada</span></div>' +
            '</div>' +
            '<div class="sgb-actions">' +
              '<button type="button" class="sgb-btn sgb-btn-primary" id="sgb-add-btn">' +
                '<i class="fa-solid fa-cloud-arrow-up"></i> <span>Adicionar imagem de capa da rede</span>' +
              '</button>' +
              '<button type="button" class="sgb-btn sgb-btn-ghost" id="sgb-remove-btn" hidden>' +
                '<i class="fa-regular fa-trash-can"></i> Remover' +
              '</button>' +
              '<input type="file" id="sgb-file-input" accept="image/jpeg,image/png,image/webp" hidden>' +
            '</div>' +
            '<p class="sgb-feedback" id="sgb-feedback" style="display:none;"></p>' +
          '</div>' +
        '</div>' +
      '</div>';

    section.querySelector('#sg-copy-btn').addEventListener('click', function () {
      var input = section.querySelector('#sg-link-input');
      input.select();
      try { navigator.clipboard.writeText(input.value); } catch (e) { document.execCommand('copy'); }
      var btn = section.querySelector('#sg-copy-btn');
      var html = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> Link copiado';
      setTimeout(function () { btn.innerHTML = html; }, 1800);
    });

    section.querySelector('#sgb-add-btn').addEventListener('click', function () {
      section.querySelector('#sgb-file-input').click();
    });
    section.querySelector('#sgb-file-input').addEventListener('change', onBannerFilePicked);
    section.querySelector('#sgb-remove-btn').addEventListener('click', onBannerRemove);

    return section;
  }

  /* -------------------- QR -------------------- */
  var QR_LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  var qrLibPromise = null;
  function ensureQrLib() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (qrLibPromise) return qrLibPromise;
    qrLibPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = QR_LIB_URL; s.async = true;
      s.onload = function () { resolve(window.qrcode); };
      s.onerror = function () { reject(new Error('lib qr fail')); };
      document.head.appendChild(s);
    });
    return qrLibPromise;
  }
  function makeQrCanvas(text, sizePx) {
    return ensureQrLib().then(function (qrcode) {
      var qr = qrcode(0, 'H'); qr.addData(String(text || '')); qr.make();
      var modules = qr.getModuleCount();
      var quiet = 4, total = modules + quiet * 2;
      var scale = Math.max(1, Math.floor(sizePx / total));
      var canvasSize = scale * total;
      var canvas = document.createElement('canvas');
      canvas.width = canvasSize; canvas.height = canvasSize;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvasSize,canvasSize); ctx.fillStyle = '#000';
      for (var r = 0; r < modules; r++)
        for (var c = 0; c < modules; c++)
          if (qr.isDark(r, c)) ctx.fillRect((c+quiet)*scale,(r+quiet)*scale,scale,scale);
      return canvas;
    });
  }
  function safeFilename(s) {
    return String(s || 'qr').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase() || 'qr';
  }
  function renderSharedQr(section, group) {
    var link = section.querySelector('#sg-link-input').value;
    var wrap = section.querySelector('#sg-qr-canvas-wrap');
    var dl   = section.querySelector('#sg-qr-download');
    var pr   = section.querySelector('#sg-qr-print');
    makeQrCanvas(link, 320).then(function (canvas) {
      wrap.innerHTML = ''; canvas.setAttribute('role','img');
      canvas.setAttribute('aria-label','QR Code para ' + link);
      wrap.appendChild(canvas); dl.disabled = false; pr.disabled = false;
    }).catch(function (e) {
      wrap.innerHTML = '<span style="color:#dc2626;font-size:.8rem;">Erro ao gerar QR</span>';
    });
    dl.addEventListener('click', function () {
      makeQrCanvas(link, 1024).then(function (canvas) {
        var a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = 'qrcode-grupo-' + safeFilename(group.slug) + '.png';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      });
    });
    pr.addEventListener('click', function () {
      makeQrCanvas(link, 1024).then(function (canvas) {
        var dataUrl = canvas.toDataURL('image/png');
        var win = window.open('', '_blank', 'width=720,height=900'); if (!win) return;
        win.document.open();
        win.document.write(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><title>QR — ' + escapeHtml(group.group_name) + '</title>' +
          '<style>body{font-family:Inter,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:30px;color:#1a1a2e}h1{font-size:1.3rem;margin:0 0 6px}p{color:#6b7280;margin:0 0 18px;font-size:.95rem;text-align:center}img{width:380px;height:380px;image-rendering:pixelated}@media print{p.no-print{display:none}}</style></head>' +
          '<body><h1>' + escapeHtml(group.group_name) + '</h1><p>Escaneie para escolher a unidade e agendar</p>' +
          '<img src="' + dataUrl + '" alt="QR"><p class="no-print" style="margin-top:24px;font-size:.85rem">' + escapeHtml(link) + '</p>' +
          '<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script></body></html>'
        );
        win.document.close();
      });
    });
  }

  /* ==================================================================
     BANNER DA REDE — Upload + Cropper (16:5) + Pré-visualização ao vivo
     ================================================================== */
  function fb(msg, kind) {
    var el = document.getElementById('sgb-feedback'); if (!el) return;
    el.style.display = '';
    el.className = 'sgb-feedback ' + (kind === 'err' ? 'err' : 'ok');
    el.textContent = msg;
    if (kind !== 'err') setTimeout(function () { el.style.display = 'none'; }, 3500);
  }

  function refreshBannerPreview(url) {
    var prev = document.getElementById('sgb-preview');
    var rem  = document.getElementById('sgb-remove-btn');
    if (!prev) return;
    if (url) {
      prev.innerHTML = '<img src="' + escapeAttr(url) + '" alt="Banner da rede">';
      if (rem) rem.hidden = false;
    } else {
      prev.innerHTML = '<div class="sgb-empty"><i class="fa-regular fa-image"></i><span>Nenhuma imagem cadastrada</span></div>';
      if (rem) rem.hidden = true;
    }
  }

  var sgbCropper = null;

  function onBannerFilePicked(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) {
      return fb('Formato inválido. Use JPG, PNG ou WEBP.', 'err');
    }
    if (file.size > BANNER_MAX_MB * 1024 * 1024) {
      return fb('Imagem muito grande (máx. ' + BANNER_MAX_MB + 'MB).', 'err');
    }
    var reader = new FileReader();
    reader.onload = function () { openBannerCropper(reader.result); };
    reader.readAsDataURL(file);
  }

  function ensureBannerModal() {
    var m = document.getElementById('sgb-crop-modal');
    if (m) return m;

    var logoFb = '<i class="fa-solid fa-store"></i>';
    var groupName = (currentGroupRef && currentGroupRef.group_name) || 'Sua Rede';

    m = document.createElement('div');
    m.className = 'sgb-modal-overlay';
    m.id = 'sgb-crop-modal';
    m.innerHTML =
      '<div class="sgb-modal">' +
        '<div class="sgb-modal-head">' +
          '<h3>Ajustar imagem de capa da rede</h3>' +
          '<button type="button" id="sgb-crop-close" aria-label="Fechar">&times;</button>' +
        '</div>' +
        '<div class="sgb-modal-body">' +

          /* Coluna 1 — cropper */
          '<div>' +
            '<p class="sgb-help" style="margin-bottom:10px">' +
              'Arraste a imagem e use o zoom para enquadrar. A proporção é fixa em <b>16:5</b> ' +
              '(banner horizontal). A imagem já é centralizada automaticamente.' +
            '</p>' +
            '<div class="sgb-cropper-wrap"><img id="sgb-cropper-img" alt=""></div>' +
            '<div class="sgb-cropper-tools">' +
              '<button type="button" class="sgb-tool-btn" id="sgb-zin"><i class="fa-solid fa-magnifying-glass-plus"></i> Zoom +</button>' +
              '<button type="button" class="sgb-tool-btn" id="sgb-zout"><i class="fa-solid fa-magnifying-glass-minus"></i> Zoom -</button>' +
              '<button type="button" class="sgb-tool-btn" id="sgb-reset"><i class="fa-solid fa-rotate"></i> Centralizar</button>' +
            '</div>' +
          '</div>' +

          /* Coluna 2 — pré-visualização ao vivo + dicas */
          '<aside class="sgb-side">' +
            '<h4><i class="fa-regular fa-eye"></i> Pré-visualização</h4>' +
            '<p class="sgb-side-help">Assim será exibido no topo da página de seleção de unidades.</p>' +

            '<div class="sgb-mockup">' +
              '<div class="sgb-mockup-hero">' +
                '<span class="sgb-mockup-badge"><i class="fa-regular fa-building"></i> Rede</span>' +
                '<div class="sgb-preview-target" id="sgb-live-preview"></div>' +
              '</div>' +
              '<div class="sgb-mockup-logo">' + logoFb + '</div>' +
              '<div class="sgb-mockup-name">' + escapeHtml(groupName) + '</div>' +
              '<p class="sgb-mockup-sub">Selecione abaixo onde você deseja ser atendido.</p>' +
              '<div class="sgb-mockup-cards">' +
                '<div class="sgb-mockup-card"></div>' +
                '<div class="sgb-mockup-card"></div>' +
              '</div>' +
            '</div>' +

            '<div class="sgb-tips">' +
              '<h5><i class="fa-solid fa-lightbulb"></i> Dicas para um bom resultado</h5>' +
              '<ul>' +
                '<li>Use imagens horizontais de alta qualidade (mín. 1600px de largura).</li>' +
                '<li>Mantenha logotipos e elementos importantes dentro da área de corte.</li>' +
                '<li>Tudo que estiver fora da área selecionada não será exibido.</li>' +
                '<li>O banner será exibido no topo da página da rede.</li>' +
              '</ul>' +
            '</div>' +
          '</aside>' +

        '</div>' +
        '<div class="sgb-modal-foot">' +
          '<button type="button" class="sgb-btn sgb-btn-ghost" id="sgb-crop-cancel" style="color:#1a1a2e;border-color:#e5e7eb;background:#fff;"><i class="fa-solid fa-xmark"></i> Cancelar</button>' +
          '<button type="button" class="sgb-btn sgb-btn-primary" id="sgb-crop-confirm"><i class="fa-solid fa-check"></i> Usar este recorte</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);
    m.querySelector('#sgb-crop-close').addEventListener('click', closeBannerCropper);
    m.querySelector('#sgb-crop-cancel').addEventListener('click', closeBannerCropper);
    m.querySelector('#sgb-zin').addEventListener('click', function(){ if(sgbCropper) sgbCropper.zoom(0.1); });
    m.querySelector('#sgb-zout').addEventListener('click', function(){ if(sgbCropper) sgbCropper.zoom(-0.1); });
    m.querySelector('#sgb-reset').addEventListener('click', function(){ if(sgbCropper) sgbCropper.reset(); });
    m.querySelector('#sgb-crop-confirm').addEventListener('click', confirmBannerCropper);
    return m;
  }

  function openBannerCropper(dataUrl) {
    if (typeof Cropper === 'undefined') {
      return fb('Editor de imagem não carregado. Recarregue a página.', 'err');
    }
    // Reseta o modal para refletir o grupo atual no mockup
    var existing = document.getElementById('sgb-crop-modal');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var m = ensureBannerModal();
    var img = m.querySelector('#sgb-cropper-img');
    img.src = dataUrl;
    m.classList.add('active');

    setTimeout(function () {
      if (sgbCropper) { try { sgbCropper.destroy(); } catch (e) {} sgbCropper = null; }
      sgbCropper = new Cropper(img, {
        aspectRatio: BANNER_ASPECT,        // FIXO 16:5
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 1,                   // crop box ocupa o máximo
        background: false,
        movable: true,
        zoomable: true,
        rotatable: false,
        scalable: false,
        responsive: true,
        modal: true,
        cropBoxMovable: false,
        cropBoxResizable: false,
        toggleDragModeOnDblclick: false,
        guides: false,
        center: true,
        preview: '#sgb-live-preview',      // <<< pré-visualização ao vivo
        ready: function () {
          // Centralização automática: garante crop box centrado na imagem
          try {
            var data = sgbCropper.getImageData();
            var size = Math.min(data.width, data.height * BANNER_ASPECT);
            sgbCropper.setCropBoxData({
              width: size,
              height: size / BANNER_ASPECT
            });
          } catch (e) {}
        }
      });
    }, 60);
  }
  function closeBannerCropper() {
    var m = document.getElementById('sgb-crop-modal');
    if (m) m.classList.remove('active');
    if (sgbCropper) { try { sgbCropper.destroy(); } catch (e) {} sgbCropper = null; }
  }

  async function confirmBannerCropper() {
    if (!sgbCropper) return closeBannerCropper();
    var canvas = sgbCropper.getCroppedCanvas({
      width: 1600, height: Math.round(1600 / BANNER_ASPECT),
      imageSmoothingEnabled: true, imageSmoothingQuality: 'high', fillColor: '#000'
    });
    if (!canvas) return fb('Não foi possível recortar a imagem.', 'err');
    canvas.toBlob(async function (blob) {
      if (!blob) return fb('Falha ao gerar imagem.', 'err');
      closeBannerCropper();
      await uploadBanner(blob);
    }, 'image/jpeg', 0.9);
  }

  async function uploadBanner(blob) {
    var sb = getSupabase();
    if (!sb || !currentGroupRef) return fb('Conexão indisponível.', 'err');
    var addBtn = document.getElementById('sgb-add-btn');
    if (addBtn) { addBtn.disabled = true; addBtn.querySelector('span').textContent = 'Enviando…'; }
    try {
      var path = currentGroupRef.group_id + '/banner-' + Date.now() + '.jpg';
      var up = await sb.storage.from(BANNER_BUCKET).upload(path, blob, {
        cacheControl: '3600', upsert: false, contentType: 'image/jpeg'
      });
      if (up.error) throw up.error;
      var pub = sb.storage.from(BANNER_BUCKET).getPublicUrl(path);
      var publicUrl = pub.data && pub.data.publicUrl;
      if (!publicUrl) throw new Error('URL pública indisponível');

      var rr = await sb.rpc('update_group_banner', {
        _group_id: currentGroupRef.group_id, _banner_url: publicUrl
      });
      if (rr.error) throw rr.error;

      currentGroupRef.banner_image_url = publicUrl;
      refreshBannerPreview(publicUrl);
      fb('✓ Banner atualizado com sucesso.', 'ok');
    } catch (e) {
      console.error(TAG,'upload banner:', e);
      fb('Erro ao salvar o banner: ' + (e.message || e), 'err');
    } finally {
      if (addBtn) { addBtn.disabled = false; addBtn.querySelector('span').textContent = 'Adicionar imagem de capa da rede'; }
    }
  }

  async function onBannerRemove() {
    if (!currentGroupRef) return;
    if (!confirm('Remover a imagem de capa da rede?')) return;
    var sb = getSupabase(); if (!sb) return;
    try {
      var rr = await sb.rpc('update_group_banner', {
        _group_id: currentGroupRef.group_id, _banner_url: null
      });
      if (rr.error) throw rr.error;
      currentGroupRef.banner_image_url = null;
      refreshBannerPreview(null);
      fb('Banner removido.', 'ok');
    } catch (e) {
      console.error(TAG,'remove banner:', e);
      fb('Erro ao remover: ' + (e.message || e), 'err');
    }
  }

  /* ================================================================== */
  function boot() {
    if (isClientBookingPage()) {
      runGroupPicker().catch(function (e) { console.error(TAG,'picker:', e); });
      return;
    }
    if (isSettingsPage()) {
      var attempts = 0;
      var iv = setInterval(function () {
        attempts++;
        try { syncSettingsBlock(); } catch (e) { console.warn(TAG,'sync:', e); }
        if (attempts > 120) clearInterval(iv);
      }, 500);

      window.addEventListener('storage', function (ev) {
        if (ev.key && /tenant/i.test(ev.key)) { lastTenantInjected = null; syncSettingsBlock(); }
      });
      try {
        document.addEventListener('tenant-changed', function () {
          lastTenantInjected = null; syncSettingsBlock();
        });
      } catch (e) {}

      window.__sgDebug = function () {
        console.log(TAG,'debug → tenantId detectado:', getCurrentTenantIdSafe());
        console.log(TAG,'debug → supabase client:', !!getSupabase());
        console.log(TAG,'debug → grupo atual:', currentGroupRef);
        console.log(TAG,'debug → #link-cliente-input.value:',
          (document.getElementById('link-cliente-input')||{}).value);
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
