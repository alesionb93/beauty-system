/* =====================================================================
   QRCODE-AGENDAMENTO.JS — Add-on isolado  (v1 — 2026-06-05)
   ---------------------------------------------------------------------
   Adicione em agenda.html, logo antes de </body>:

       <link rel="stylesheet" href="/qrcode-agendamento.css?v=1">
       <script src="/qrcode-agendamento.js?v=1" defer></script>

   O que faz:
   • Carrega localmente a lib "qrcode-generator" (cdnjs, sem APIs de QR
     externas — a geração é 100% no navegador).
   • Injeta, dentro de #link-cliente-box (Configurações > Geral >
     Agendamento pelo cliente), uma seção "Escaneie para agendar" com:
        - QR Code do link público do tenant (mesmo link ⇒ mesmo QR)
        - Botão "Baixar QR Code (PNG)" — exporta PNG 1024x1024
        - Botão "Imprimir QR Code" — abre página otimizada para impressão
   • Re-renderiza automaticamente quando o valor de #link-cliente-input
     muda (troca de tenant, recarregamento das configurações etc.).

   IMPORTANTE — Independência do toggle:
   • O QR é derivado do link público. Não persiste em nenhum lugar:
     o mesmo link sempre gera o mesmo QR (determinístico).
   • Ativar/desativar "Permitir agendamento pelo cliente" NÃO recria,
     altera ou apaga o QR Code.
   • A página pública (agendamento-cliente.html) já exibe a mensagem
     "Agendamento indisponível" quando a feature está desligada — então
     escanear o QR com o toggle off mostra a mensagem amigável, e ao
     reativar volta a funcionar com o mesmíssimo QR.

   ❗ NÃO altera nenhum outro fluxo (toggle, link, upload de imagens,
      pagamentos, comissões, dashboard, etc.).
   ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_QRCODE_LOADED__) return;
  window.__SLOTIFY_QRCODE_LOADED__ = true;

  console.log('%c📱 qrcode-agendamento.js v1 carregado',
    'background:#6c3aed;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700');

  // ------------------------------------------------------------------
  // 1) Carregamento da lib qrcode-generator (local, via cdnjs)
  //    https://cdnjs.com/libraries/qrcode-generator
  // ------------------------------------------------------------------
  var QR_LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  var qrLibPromise = null;
  function loadQrLib() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (qrLibPromise) return qrLibPromise;
    qrLibPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = QR_LIB_URL;
      s.async = true;
      s.onload = function () { resolve(window.qrcode); };
      s.onerror = function () { reject(new Error('Falha ao carregar lib QR')); };
      document.head.appendChild(s);
    });
    return qrLibPromise;
  }

  // ------------------------------------------------------------------
  // 2) Geração do QR em <canvas> com tamanho arbitrário (px)
  //    ecLevel 'H' = alta correção de erro (melhor para impressão).
  // ------------------------------------------------------------------
  function renderQrToCanvas(text, sizePx) {
    return loadQrLib().then(function (qrcode) {
      // typeNumber=0 -> auto-detect
      var qr = qrcode(0, 'H');
      qr.addData(String(text || ''));
      qr.make();
      var modules = qr.getModuleCount();
      var quiet = 4; // módulos de margem (padrão QR)
      var total = modules + quiet * 2;
      var scale = Math.max(1, Math.floor(sizePx / total));
      var canvasSize = scale * total;

      var canvas = document.createElement('canvas');
      canvas.width = canvasSize;
      canvas.height = canvasSize;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvasSize, canvasSize);
      ctx.fillStyle = '#000000';
      for (var r = 0; r < modules; r++) {
        for (var c = 0; c < modules; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
          }
        }
      }
      return canvas;
    });
  }

  // ------------------------------------------------------------------
  // 3) UI — injeta a seção dentro de #link-cliente-box
  // ------------------------------------------------------------------
  var SECTION_ID = 'qr-ag-section';
  var lastRenderedLink = '';

  function buildSection() {
    var box = document.getElementById('link-cliente-box');
    if (!box) return null;
    var existing = document.getElementById(SECTION_ID);
    if (existing) return existing;

    var section = document.createElement('div');
    section.id = SECTION_ID;
    section.className = 'qr-ag-section';
    section.innerHTML =
      '<div class="qr-ag-frame" id="qr-ag-frame">' +
        '<span class="qr-ag-corner-bl"></span><span class="qr-ag-corner-br"></span>' +
        '<div id="qr-ag-canvas-wrap" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:.85rem;">Gerando…</div>' +
      '</div>' +
      '<div class="qr-ag-info">' +
        '<h4>Escaneie para agendar</h4>' +
        '<p>Ideal para imprimir e colocar na recepção do estabelecimento.</p>' +
        '<div class="qr-ag-actions">' +
          '<button type="button" class="qr-ag-btn qr-ag-btn-primary" id="qr-ag-download" disabled>' +
            '<i class="fa-solid fa-download"></i> Baixar QR Code (PNG)' +
          '</button>' +
          '<button type="button" class="qr-ag-btn qr-ag-btn-secondary" id="qr-ag-print" disabled>' +
            '<i class="fa-solid fa-print"></i> Imprimir QR Code' +
          '</button>' +
        '</div>' +
      '</div>';

    // Inserir ANTES do bloco de imagens (.ti-images-block) se existir,
    // ou ao final do box caso contrário.
    var imagesBlock = box.querySelector('.ti-images-block');
    if (imagesBlock) {
      box.insertBefore(section, imagesBlock);
    } else {
      box.appendChild(section);
    }

    section.querySelector('#qr-ag-download').addEventListener('click', onDownload);
    section.querySelector('#qr-ag-print').addEventListener('click', onPrint);
    return section;
  }

  function getPublicLink() {
    var input = document.getElementById('link-cliente-input');
    return (input && input.value || '').trim();
  }

  function getTenantName() {
    // Tenta descobrir o nome do estabelecimento em locais comuns do app.
    var candidates = [
      'cfg-nome-fantasia', 'cfg-razao-social', 'cfg-nome-estabelecimento',
      'tenant-name', 'estabelecimento-nome'
    ];
    for (var i = 0; i < candidates.length; i++) {
      var el = document.getElementById(candidates[i]);
      if (el && (el.value || el.textContent || '').trim()) {
        return (el.value || el.textContent).trim();
      }
    }
    // Fallback: nome no header do app
    var headerBrand = document.querySelector('.sidebar .brand, .app-brand, h1.brand');
    if (headerBrand && headerBrand.textContent.trim()) return headerBrand.textContent.trim();
    return 'Agendamento';
  }

  function renderForCurrentLink(force) {
    var link = getPublicLink();
    var section = document.getElementById(SECTION_ID);
    if (!section) return;
    if (!link) {
      var wrap = section.querySelector('#qr-ag-canvas-wrap');
      if (wrap) wrap.innerHTML = '<span style="color:#9ca3af;font-size:.85rem;">Link indisponível</span>';
      section.querySelector('#qr-ag-download').disabled = true;
      section.querySelector('#qr-ag-print').disabled = true;
      lastRenderedLink = '';
      return;
    }
    if (!force && link === lastRenderedLink) return;
    lastRenderedLink = link;

    // Renderiza em ~320px para a tela; download/print regeneram em 1024.
    renderQrToCanvas(link, 320).then(function (canvas) {
      var wrap = section.querySelector('#qr-ag-canvas-wrap');
      if (!wrap) return;
      wrap.innerHTML = '';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'QR Code para ' + link);
      wrap.appendChild(canvas);
      section.querySelector('#qr-ag-download').disabled = false;
      section.querySelector('#qr-ag-print').disabled = false;
    }).catch(function (err) {
      console.error('[qrcode-agendamento] erro ao gerar QR:', err);
      var wrap = section.querySelector('#qr-ag-canvas-wrap');
      if (wrap) wrap.innerHTML = '<span style="color:#dc2626;font-size:.8rem;">Erro ao gerar QR</span>';
    });
  }

  // ------------------------------------------------------------------
  // 4) Ações: Download PNG (1024x1024) e Imprimir
  // ------------------------------------------------------------------
  function safeFilename(s) {
    return String(s || 'qrcode-agendamento')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'qrcode-agendamento';
  }

  function onDownload() {
    var link = getPublicLink();
    if (!link) return;
    renderQrToCanvas(link, 1024).then(function (canvas) {
      var dataUrl = canvas.toDataURL('image/png');
      var a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'qrcode-agendamento-' + safeFilename(getTenantName()) + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }

  function onPrint() {
    var link = getPublicLink();
    if (!link) return;
    var tenantName = getTenantName();
    renderQrToCanvas(link, 1024).then(function (canvas) {
      var dataUrl = canvas.toDataURL('image/png');
      var win = window.open('', '_blank', 'width=720,height=900');
      if (!win) {
        alert('Não foi possível abrir a janela de impressão. Verifique o bloqueador de pop-ups.');
        return;
      }
      var html =
        '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
        '<title>QR Code — ' + escapeHtml(tenantName) + '</title>' +
        '<style>' +
          '* { box-sizing: border-box; }' +
          'html, body { margin: 0; padding: 0; background: #fff; color: #1a1a2e;' +
          ' font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }' +
          '.wrap { min-height: 100vh; display: flex; flex-direction: column;' +
          ' align-items: center; justify-content: center; padding: 48px 24px; text-align: center; }' +
          'h1 { font-size: 28px; margin: 0 0 8px; font-weight: 700; }' +
          '.sub { color: #6b7280; font-size: 14px; margin-bottom: 28px; }' +
          '.qr { padding: 18px; border: 2px solid #6c3aed; border-radius: 18px; background: #fff; }' +
          '.qr img { display: block; width: 360px; height: 360px; image-rendering: pixelated; }' +
          '.cta { margin-top: 28px; font-size: 22px; font-weight: 700; }' +
          '.url { margin-top: 10px; font-size: 12px; color: #6b7280; word-break: break-all; max-width: 480px; }' +
          '@media print { @page { margin: 12mm; } .no-print { display: none !important; } }' +
        '</style></head><body><div class="wrap">' +
          '<h1>' + escapeHtml(tenantName) + '</h1>' +
          '<div class="sub">Agendamento online</div>' +
          '<div class="qr"><img src="' + dataUrl + '" alt="QR Code de agendamento"></div>' +
          '<div class="cta">Escaneie para realizar seu agendamento</div>' +
          '<div class="url">' + escapeHtml(link) + '</div>' +
        '</div><script>window.onload=function(){setTimeout(function(){window.focus();window.print();},250);};<\/script>' +
        '</body></html>';
      win.document.open();
      win.document.write(html);
      win.document.close();
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ------------------------------------------------------------------
  // 5) Observers — montar a seção quando o box existir e re-renderizar
  //    quando o valor do link mudar.
  // ------------------------------------------------------------------
  function tryMount() {
    var box = document.getElementById('link-cliente-box');
    if (!box) return false;
    buildSection();
    renderForCurrentLink(true);
    return true;
  }

  function watchLinkInput() {
    var input = document.getElementById('link-cliente-input');
    if (!input || input.__qrAgWatched) return;
    input.__qrAgWatched = true;
    // Cobertura: input mudado por código (sem evento) — observa atributo value
    var mo = new MutationObserver(function () { renderForCurrentLink(false); });
    mo.observe(input, { attributes: true, attributeFilter: ['value'] });
    // Cobertura: usuário/código que dispare eventos
    ['input', 'change'].forEach(function (ev) {
      input.addEventListener(ev, function () { renderForCurrentLink(false); });
    });
    // Polling leve (fallback definitivo): valor atribuído via .value sem evento
    setInterval(function () { renderForCurrentLink(false); }, 1500);
  }

  function init() {
    if (!tryMount()) {
      var obs = new MutationObserver(function () {
        if (tryMount()) {
          obs.disconnect();
          watchLinkInput();
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } else {
      watchLinkInput();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
