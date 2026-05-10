/* ============================================================
   PACOTE-BADGE-PATCH v2 (2026-05-07)
   Patch RUNTIME standalone, INCONDICIONAL — funciona sem depender
   de window.appointments. Estratégia: localizar qualquer badge
   antigo `<span class="tb-pkg-badge">…Pacote</span>` dentro de
   `.timeline-block` e RESCREVÊ-LO para refletir Venda/Uso de pacote.

   Como diferenciar venda × uso sem dados estruturados?
   - Se window.appointments existe e o bloco bate por hora+cliente,
     usa a flag _hasVendaPacote para venda; servicos[].origem para uso.
   - Caso contrário, assume "Uso de pacote" (default mais comum) e
     marca o bloco com a classe .is-package para indicação visual.

   USO (em ordem):
     <script src="script.js"></script>
     <script src="pacote-badge-patch.js?v=2"></script>
   ============================================================ */
(function () {
  'use strict';
  var VERSION = 'pacote-badge-patch-v2-2026-05-07';
  function log() {
    try { console.log.apply(console, arguments); } catch (_) {}
  }
  log(
    '%c✅ ' + VERSION + ' ATIVO',
    'background:#16a34a;color:#fff;padding:4px 8px;border-radius:4px;font-weight:700'
  );
  try { document.documentElement.setAttribute('data-pkg-patch-version', VERSION); } catch (_) {}

  // ===== CSS injetado (sobrepõe estilos.css antigo se cache) =====
  try {
    var css =
      '.tb-pkg-badge{display:inline-flex !important;align-items:center;gap:4px;font-size:.7em;font-weight:600;padding:1px 6px;margin-left:6px;border-radius:999px;color:#fff !important;vertical-align:middle;white-space:nowrap;}' +
      '.tb-pkg-badge.tb-pkg-badge-uso{background:#6C3AED !important;}' +
      '.tb-pkg-badge.tb-pkg-badge-venda{background:linear-gradient(135deg,#B45309,#D97706) !important;}' +
      '.timeline-block.is-package-sale{border-left:4px solid #B45309 !important;box-shadow:inset 0 0 0 1px rgba(180,83,9,0.30) !important;}';
    var st = document.createElement('style');
    st.id = 'pacote-badge-patch-style';
    st.textContent = css;
    document.head.appendChild(st);
  } catch (_) {}

  // ===== Helpers =====
  function findAppointmentForBlock(block) {
    var apps = (typeof window !== 'undefined' && window.appointments) || [];
    if (!apps.length) return null;
    var clientEl = block.querySelector('.tb-client');
    var timeEl = block.querySelector('.tb-time');
    if (!clientEl || !timeEl) return null;
    var clientName = (clientEl.textContent || '').trim();
    var hhmm = ((timeEl.textContent || '').match(/\d{1,2}:\d{2}/) || [''])[0];
    if (!clientName || !hhmm) return null;
    for (var i = 0; i < apps.length; i++) {
      var a = apps[i];
      var aHora = (a.hora || '').substring(0, 5);
      if (aHora !== hhmm) continue;
      if ((a.cliente || '').trim() !== clientName) continue;
      return a;
    }
    return null;
  }

  function isUsoPacote(a) {
    if (!a || !a.servicos) return false;
    return a.servicos.some(function (s) {
      return s && (s.origem === 'pacote_uso' || !!s.cliente_pacote_id);
    });
  }
  function isVendaPacote(a) { return !!(a && a._hasVendaPacote); }

  function renderBadges(block, venda, uso) {
    // Remove TODOS os badges atuais (antigos ou patches anteriores)
    block.querySelectorAll('.tb-pkg-badge').forEach(function (b) { b.remove(); });

    var host = block.querySelector('.tb-time') || block.querySelector('.tb-row-compact') || block;

    if (venda) {
      var bv = document.createElement('span');
      bv.className = 'tb-pkg-badge tb-pkg-badge-venda';
      bv.setAttribute('data-pkg-kind', 'venda');
      bv.setAttribute('data-pkg-patched', '1');
      bv.title = 'Venda de pacote (origem dos créditos)';
      bv.textContent = '💰 Venda de pacote';
      host.appendChild(document.createTextNode(' '));
      host.appendChild(bv);
      block.classList.add('is-package-sale');
    }
    if (uso) {
      var bu = document.createElement('span');
      bu.className = 'tb-pkg-badge tb-pkg-badge-uso';
      bu.setAttribute('data-pkg-kind', 'uso');
      bu.setAttribute('data-pkg-patched', '1');
      bu.title = 'Uso de pacote (consome 1 crédito)';
      bu.textContent = '🎟️ Uso de pacote';
      host.appendChild(document.createTextNode(' '));
      host.appendChild(bu);
      block.classList.add('is-package');
    }
    block.dataset.pkgPatched = '1';
  }

  function patchBlock(block) {
    if (!block || !block.classList || !block.classList.contains('timeline-block')) return;

    // Detecta se o bloco TEM badge de pacote (antigo ou novo)
    var existingBadges = block.querySelectorAll('.tb-pkg-badge');
    var hasOldBadge = false;
    existingBadges.forEach(function (b) {
      if (b.getAttribute('data-pkg-patched') !== '1') hasOldBadge = true;
    });

    // Se já está patchado e não há badge antigo, nada a fazer
    if (block.dataset.pkgPatched === '1' && !hasOldBadge) return;

    // Estratégia 1: tentar via window.appointments
    var a = findAppointmentForBlock(block);
    var venda = false, uso = false;

    if (a) {
      venda = isVendaPacote(a);
      uso = isUsoPacote(a);
    } else if (existingBadges.length > 0) {
      // Estratégia 2: bloco tem badge antigo de "Pacote" mas não casamos
      // com appointments. Assumimos USO (caso mais comum) — melhor que
      // texto genérico "Pacote" sem distinção.
      uso = true;
    } else {
      // Bloco sem badge antigo e sem dados — não mexer
      return;
    }

    if (!venda && !uso) {
      // Não é pacote — limpa badges órfãos e marca processado
      existingBadges.forEach(function (b) { b.remove(); });
      block.dataset.pkgPatched = '1';
      return;
    }

    renderBadges(block, venda, uso);
  }

  function patchAll() {
    var blocks = document.querySelectorAll('.timeline-block');
    var patched = 0, hadOld = 0;
    blocks.forEach(function (b) {
      var hadOldBadge = !!b.querySelector('.tb-pkg-badge:not([data-pkg-patched="1"])');
      if (hadOldBadge) hadOld++;
      patchBlock(b);
      if (b.dataset.pkgPatched === '1') patched++;
    });
    if (hadOld > 0) log('[' + VERSION + '] Re-renderizou ' + hadOld + ' badge(s) antigo(s) Pacote → Venda/Uso');
  }

  // Re-roda quando appointments mudam
  function rerunAll() {
    document.querySelectorAll('.timeline-block').forEach(function (b) {
      delete b.dataset.pkgPatched;
    });
    patchAll();
  }

  try {
    ['loadAppointments', 'renderTimeline', 'renderCalendar', 'renderAppointments'].forEach(function (fnName) {
      var orig = window[fnName];
      if (typeof orig === 'function') {
        window[fnName] = function () {
          var ret = orig.apply(this, arguments);
          if (ret && typeof ret.then === 'function') {
            ret.then(function () { setTimeout(rerunAll, 60); }).catch(function () {});
          } else {
            setTimeout(rerunAll, 60);
          }
          return ret;
        };
      }
    });
  } catch (_) {}

  var pending = false;
  function schedulePatch() {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; try { patchAll(); } catch (_) {} }, 30);
  }

  function startObserver() {
    try {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.addedNodes && m.addedNodes.length) {
            for (var j = 0; j < m.addedNodes.length; j++) {
              var n = m.addedNodes[j];
              if (n && n.nodeType === 1) {
                if ((n.classList && n.classList.contains('timeline-block')) ||
                    (n.querySelector && n.querySelector('.timeline-block, .tb-pkg-badge'))) {
                  schedulePatch();
                  return;
                }
              }
            }
          }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
      log('[' + VERSION + '] MutationObserver ativo no body');
    } catch (_) {}
  }

  function init() {
    startObserver();
    setTimeout(patchAll, 100);
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      patchAll();
      if (tries > 30) clearInterval(iv);
    }, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
