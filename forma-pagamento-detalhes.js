/* =====================================================================
   FORMA-PAGAMENTO-DETALHES.JS  (v4 — 2026-06-19)
   ---------------------------------------------------------------------
   Add-on isolado: exibe "Forma de pagamento" nos detalhes do
   agendamento (tooltip desktop + bottom-sheet mobile).

   Correção v4 (retroativos):
   • Agendamentos antigos não tinham registro em `agendamento_pagamentos`
     — a forma de pagamento ficava em colunas legadas direto na tabela
     `agendamentos` (forma_pagamento / metodo_pagamento / payment_method
     / forma).
   • Agora lemos AMBAS as fontes:
       1) row.pagamentos / row.agendamento_pagamentos (modelo novo)
       2) row.forma_pagamento / row.metodo_pagamento / ... (legado)
   • O fallback em lote agora consulta as duas tabelas:
       - agendamento_pagamentos (modelo novo)
       - agendamentos (legado, colunas diretas)
     SEM filtrar por tenant_id (a RLS já cuida disso; o filtro extra
     estava zerando o resultado quando a coluna não existia no schema).
   • `__FP_EMPTY__` agora expira em 30s — assim agendamentos retroativos
     que entrarem por outra rota acabam sendo preenchidos.

   Em agenda.html, DEPOIS de script.js e pagamentos.js:
       <script src="/forma-pagamento-detalhes.js?v=4" defer></script>
   ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_FP_DETALHES_LOADED__ === 4) return;
  window.__SLOTIFY_FP_DETALHES_LOADED__ = 4;

  var TAG = '%c💠 forma-pagamento-detalhes v4';
  var STY = 'background:#0ea5e9;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700';
  console.log(TAG, STY, 'inicializando...');

  window.__FP_CACHE__ = window.__FP_CACHE__ || {};
  window.__FP_EMPTY__ = window.__FP_EMPTY__ || {};
  window.__FP_LOADING__ = window.__FP_LOADING__ || {};
  window.__FP_LAST_APT_ID__ = window.__FP_LAST_APT_ID__ || null;

  var EMPTY_TTL_MS = 30 * 1000;

  var FORMA_LABELS = {
    pix: 'PIX',
    dinheiro: 'Dinheiro',
    debito: 'Débito',
    debito_cartao: 'Débito',
    cartao_debito: 'Débito',
    credito: 'Crédito',
    credito_cartao: 'Crédito',
    cartao_credito: 'Crédito',
    cartao: 'Crédito',
    credito_parcelado: 'Crédito Parcelado',
    boleto: 'Boleto',
    transferencia: 'Transferência'
  };

  // campos legados que podem estar direto no row de agendamento
  var LEGACY_FIELDS = [
    'forma_pagamento',
    'forma_de_pagamento',
    'forma',
    'metodo_pagamento',
    'método_pagamento',
    'metodo_de_pagamento',
    'payment_method',
    'tipo_pagamento'
  ];

  function idKey(id) { return id == null ? '' : String(id); }

  function labelForma(id) {
    if (!id) return '';
    var k = String(id).trim().toLowerCase().replace(/\s+/g, '_');
    return FORMA_LABELS[k] || String(id);
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function cacheSize() {
    try { return Object.keys(window.__FP_CACHE__ || {}).length; } catch (_) { return 0; }
  }
  function sameList(a, b) { return String(a || '') === String(b || ''); }

  function formsFromPayments(pags) {
    if (!Array.isArray(pags) || !pags.length) return '';
    var seen = {}, out = [];
    for (var i = 0; i < pags.length; i++) {
      var p = pags[i];
      if (!p) continue;
      var raw = p.forma_pagamento || p.forma || p.payment_method || p.metodo_pagamento || p.tipo_pagamento;
      if (!raw) continue;
      var label = labelForma(raw);
      if (label && !seen[label]) { seen[label] = 1; out.push(label); }
    }
    return out.join(' + ');
  }

  function formaFromLegacy(row) {
    if (!row) return '';
    for (var i = 0; i < LEGACY_FIELDS.length; i++) {
      var v = row[LEGACY_FIELDS[i]];
      if (v) {
        var lbl = labelForma(v);
        if (lbl) return lbl;
      }
    }
    return '';
  }

  function formaFromAppointment(row) {
    if (!row) return '';
    return formsFromPayments(row.pagamentos)
        || formsFromPayments(row.agendamento_pagamentos)
        || formaFromLegacy(row);
  }

  function afterCacheChanged() {
    syncVisibleTitlesSoon();
    injectIntoCurrentSheetSoon();
  }

  function setCache(id, forma) {
    id = idKey(id);
    if (!id || !forma) return false;
    if (sameList(window.__FP_CACHE__[id], forma)) return false;
    window.__FP_CACHE__[id] = forma;
    delete window.__FP_EMPTY__[id];
    return true;
  }

  function markEmpty(id) {
    id = idKey(id);
    if (!id) return;
    if (window.__FP_CACHE__[id]) return;
    window.__FP_EMPTY__[id] = Date.now();
  }

  function emptyStillValid(id) {
    var t = window.__FP_EMPTY__[id];
    if (!t) return false;
    if ((Date.now() - t) > EMPTY_TTL_MS) { delete window.__FP_EMPTY__[id]; return false; }
    return true;
  }

  function indexAppointmentRows(rows, source) {
    if (!Array.isArray(rows)) return 0;
    var changed = 0, withPayment = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r.id) continue;
      var forma = formaFromAppointment(r);
      if (!forma) continue;
      withPayment++;
      if (setCache(r.id, forma)) changed++;
    }
    if (changed) {
      console.log(TAG, STY, 'cache via ' + (source || 'agendamentos') + ': +' + changed + ' (total=' + cacheSize() + ')');
      afterCacheChanged();
    }
    return withPayment;
  }

  function indexPaymentRows(rows, source) {
    if (!Array.isArray(rows)) rows = rows ? [rows] : [];
    if (!rows.length) return 0;
    var grouped = {};
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i];
      if (!p || !p.agendamento_id) continue;
      var id = idKey(p.agendamento_id);
      (grouped[id] = grouped[id] || []).push(p);
    }
    var changed = 0;
    var ids = Object.keys(grouped);
    for (var j = 0; j < ids.length; j++) {
      var forma = formsFromPayments(grouped[ids[j]]);
      if (forma && setCache(ids[j], forma)) changed++;
    }
    if (changed) {
      console.log(TAG, STY, 'cache via ' + (source || 'pagamentos') + ': +' + changed + ' (total=' + cacheSize() + ')');
      afterCacheChanged();
    }
    return ids.length;
  }

  function indexFromGlobalAppointments() {
    var list = window.appointments;
    if (!Array.isArray(list) || !list.length) return 0;
    return indexAppointmentRows(list, 'window.appointments');
  }

  function getSupabase() {
    if (window.supabaseClient) return window.supabaseClient;
    try { if (typeof supabaseClient !== 'undefined' && supabaseClient) return supabaseClient; } catch (_) {}
    return null;
  }

  function indexResponse(table, resp) {
    try {
      if (!resp || resp.error) return;
      var data = resp.data;
      if (!data) return;
      if (table === 'agendamentos') {
        indexAppointmentRows(Array.isArray(data) ? data : [data], 'supabase.agendamentos');
      } else if (table === 'agendamento_pagamentos') {
        indexPaymentRows(Array.isArray(data) ? data : [data], 'supabase.agendamento_pagamentos');
      }
    } catch (_) {}
  }

  function wrapBuilder(builder, table) {
    if (!builder || builder.__fpWrappedDetalhesV4) return builder;
    try {
      var origThen = builder.then;
      if (typeof origThen === 'function') {
        builder.then = function (onFulfilled, onRejected) {
          return origThen.call(builder, function (resp) {
            indexResponse(table, resp);
            return typeof onFulfilled === 'function' ? onFulfilled(resp) : resp;
          }, onRejected);
        };
      }
      var chain = ['eq','neq','gt','gte','lt','lte','like','ilike','in','is','not','or','and','match','order','limit','range','single','maybeSingle','returns','filter','contains','overlaps','textSearch','select'];
      chain.forEach(function (m) {
        if (typeof builder[m] !== 'function' || builder[m].__fpWrappedMethodV4) return;
        var orig = builder[m];
        var wrapped = function () { return wrapBuilder(orig.apply(builder, arguments), table); };
        wrapped.__fpWrappedMethodV4 = true;
        builder[m] = wrapped;
      });
      builder.__fpWrappedDetalhesV4 = true;
    } catch (_) {}
    return builder;
  }

  function patchSupabase() {
    var sb = getSupabase();
    if (!sb) return false;
    if (sb.__fpFromPatchedDetalhesV4) return true;
    try {
      var origFrom = sb.from.bind(sb);
      sb.from = function (table) {
        var q = origFrom(table);
        if (!q) return q;
        if ((table === 'agendamentos' || table === 'agendamento_pagamentos') && typeof q.select === 'function' && !q.select.__fpSelectWrappedDetalhesV4) {
          var origSelect = q.select;
          var wrappedSelect = function () { return wrapBuilder(origSelect.apply(q, arguments), table); };
          wrappedSelect.__fpSelectWrappedDetalhesV4 = true;
          q.select = wrappedSelect;
        }
        if (table === 'agendamento_pagamentos' && typeof q.insert === 'function' && !q.insert.__fpInsertWrappedDetalhesV4) {
          var origInsert = q.insert;
          var wrappedInsert = function (rows) {
            try { indexPaymentRows(Array.isArray(rows) ? rows : [rows], 'insert local'); } catch (_) {}
            return wrapBuilder(origInsert.apply(q, arguments), table);
          };
          wrappedInsert.__fpInsertWrappedDetalhesV4 = true;
          q.insert = wrappedInsert;
        }
        return q;
      };
      sb.__fpFromPatchedDetalhesV4 = true;
      console.log(TAG, STY, 'supabaseClient.from() interceptado');
      return true;
    } catch (e) {
      console.warn(TAG, STY, 'falha ao interceptar supabase:', e);
      return false;
    }
  }

  function getAppointmentIdFromEl(el) {
    if (!el) return '';
    var ds = el.dataset || {};
    return idKey(ds.appointmentId || ds.agendamentoId || ds.id || el.getAttribute('data-appointment-id') || el.getAttribute('data-agendamento-id'));
  }

  function findAppointmentElement(target) {
    if (!target || !target.closest) return null;
    return target.closest('[data-appointment-id], .timeline-block[data-id], .appointment-card[data-id]');
  }

  function trackLastAppointment() {
    function onAny(ev) {
      try {
        var el = findAppointmentElement(ev.target);
        var id = getAppointmentIdFromEl(el);
        if (id) window.__FP_LAST_APT_ID__ = id;
      } catch (_) {}
    }
    ['pointerdown','click','touchstart','mouseover','mouseenter','focusin'].forEach(function (evt) {
      document.addEventListener(evt, onAny, true);
    });
  }

  var syncTitleTimer = null;
  function syncVisibleTitlesSoon() { clearTimeout(syncTitleTimer); syncTitleTimer = setTimeout(syncVisibleTitles, 60); }

  function appendOrUpdateTitle(el) {
    if (!el) return false;
    var id = getAppointmentIdFromEl(el);
    if (!id) return false;
    var forma = window.__FP_CACHE__[id];
    if (!forma) return false;
    var title = el.getAttribute('title') || '';
    if (!title) return false;
    var linha = 'Forma de pagamento: ' + forma;
    var lines = title.split('\n');
    var changed = false, fpIdx = -1, profIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (/^Forma de pagamento:/i.test(lines[i])) fpIdx = i;
      if (/^Profissional:/i.test(lines[i])) profIdx = i;
    }
    if (fpIdx >= 0) {
      if (lines[fpIdx] !== linha) { lines[fpIdx] = linha; changed = true; }
    } else {
      if (profIdx >= 0) lines.splice(profIdx, 0, linha); else lines.push(linha);
      changed = true;
    }
    if (changed) { el.__fpSkipTitleDetalhesV4 = true; el.setAttribute('title', lines.join('\n')); }
    return changed;
  }

  function collectVisibleAppointmentIds() {
    var out = [], seen = {};
    var els = document.querySelectorAll('[data-appointment-id], .timeline-block[data-id], .appointment-card[data-id]');
    for (var i = 0; i < els.length; i++) {
      var id = getAppointmentIdFromEl(els[i]);
      if (id && !seen[id]) { seen[id] = 1; out.push(id); }
    }
    var sheetId = getCurrentSheetAppointmentId();
    if (sheetId && !seen[sheetId]) out.push(sheetId);
    return out;
  }

  function syncVisibleTitles() {
    indexFromGlobalAppointments();
    var blocks = document.querySelectorAll('[data-appointment-id][title], .timeline-block[data-id][title], .appointment-card[data-id][title]');
    for (var i = 0; i < blocks.length; i++) appendOrUpdateTitle(blocks[i]);
    ensurePaymentMethodsFor(collectVisibleAppointmentIds());
  }

  var titleObserver = null, domObserver = null;
  function startDomObservers() {
    if (titleObserver || !document.body) return;
    try {
      titleObserver = new MutationObserver(function (muts) {
        var needsSync = false;
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'attributes' && m.attributeName === 'title') {
            var el = m.target;
            if (el && el.__fpSkipTitleDetalhesV4) { el.__fpSkipTitleDetalhesV4 = false; continue; }
            appendOrUpdateTitle(el);
          } else if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) {
            needsSync = true;
          }
        }
        if (needsSync) syncVisibleTitlesSoon();
      });
      titleObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });

      domObserver = new MutationObserver(function () { injectIntoCurrentSheetSoon(); });
      var sheetBody = document.getElementById('appointment-sheet-body');
      if (sheetBody) domObserver.observe(sheetBody, { childList: true, subtree: false });

      syncVisibleTitlesSoon();
    } catch (_) {}
  }

  function getCurrentSheetAppointmentId() {
    try {
      if (window.__currentSheetAppointment && window.__currentSheetAppointment.id) return idKey(window.__currentSheetAppointment.id);
    } catch (_) {}
    return idKey(window.__FP_LAST_APT_ID__ || '');
  }

  var injectSheetTimer = null;
  function injectIntoCurrentSheetSoon() {
    clearTimeout(injectSheetTimer);
    injectSheetTimer = setTimeout(function () { injectIntoSheet(document.getElementById('appointment-sheet-body')); }, 40);
  }

  function injectIntoSheet(body) {
    if (!body) return false;
    var id = getCurrentSheetAppointmentId();
    if (!id) return false;
    var forma = window.__FP_CACHE__[id];
    if (!forma) { ensurePaymentMethodsFor([id]); return false; }

    var existing = body.querySelector('[data-fp-row="1"]');
    if (existing) {
      var val = existing.querySelector('.apt-sheet-value');
      if (val && val.textContent !== forma) val.textContent = forma;
      return true;
    }
    var tmp = document.createElement('div');
    tmp.innerHTML =
      '<div class="apt-sheet-row" data-fp-row="1">' +
        '<span class="apt-sheet-label">Forma de pagamento</span>' +
        '<span class="apt-sheet-value">' + escHtml(forma) + '</span>' +
      '</div>';
    var newRow = tmp.firstChild;
    var rows = body.querySelectorAll('.apt-sheet-row');
    var statusRow = null;
    for (var i = 0; i < rows.length; i++) {
      var lbl = rows[i].querySelector('.apt-sheet-label');
      if (lbl && /status/i.test((lbl.textContent || '').trim())) { statusRow = rows[i]; break; }
    }
    if (statusRow && statusRow.parentNode) statusRow.parentNode.insertBefore(newRow, statusRow.nextSibling);
    else body.appendChild(newRow);
    return true;
  }

  // ---- Fallback em lote: tenta agendamento_pagamentos E depois agendamentos legado ----
  var ensureTimer = null;
  function ensurePaymentMethodsFor(ids) {
    ids = ids || [];
    if (!ids.length) return;
    clearTimeout(ensureTimer);
    ensureTimer = setTimeout(function () {
      var sb = getSupabase();
      if (!sb || typeof sb.from !== 'function') return;

      var missing = [], seen = {};
      for (var i = 0; i < ids.length; i++) {
        var id = idKey(ids[i]);
        if (!id || seen[id] || window.__FP_CACHE__[id] || window.__FP_LOADING__[id] || emptyStillValid(id)) continue;
        seen[id] = 1;
        missing.push(id);
      }
      if (!missing.length) return;
      for (var j = 0; j < missing.length; j++) window.__FP_LOADING__[missing[j]] = true;

      // 1) tabela nova
      var p1 = Promise.resolve(
        sb.from('agendamento_pagamentos')
          .select('agendamento_id, forma_pagamento, valor, parcelas, created_at')
          .in('agendamento_id', missing)
      ).then(function (resp) {
        if (resp && resp.error) return [];
        var data = (resp && resp.data) || [];
        indexPaymentRows(data, 'batch agendamento_pagamentos');
        var found = {};
        for (var k = 0; k < data.length; k++) if (data[k] && data[k].agendamento_id) found[idKey(data[k].agendamento_id)] = 1;
        return missing.filter(function (id) { return !found[id]; });
      }).catch(function () { return missing.slice(); });

      // 2) tabela agendamentos com colunas legadas
      p1.then(function (stillMissing) {
        if (!stillMissing || !stillMissing.length) return null;
        var cols = 'id,' + LEGACY_FIELDS.join(',');
        return Promise.resolve(
          sb.from('agendamentos').select(cols).in('id', stillMissing)
        ).then(function (resp) {
          if (resp && resp.error) {
            // schema sem essas colunas — tenta apenas o mais comum
            return Promise.resolve(
              sb.from('agendamentos').select('id, forma_pagamento').in('id', stillMissing)
            ).then(function (r2) {
              if (r2 && !r2.error && r2.data) indexAppointmentRows(r2.data, 'batch agendamentos legado');
              return stillMissing;
            }).catch(function () { return stillMissing; });
          }
          if (resp && resp.data) indexAppointmentRows(resp.data, 'batch agendamentos legado');
          return stillMissing;
        }).catch(function () { return stillMissing; });
      }).then(function (stillMissing) {
        if (Array.isArray(stillMissing)) {
          for (var x = 0; x < stillMissing.length; x++) {
            if (!window.__FP_CACHE__[stillMissing[x]]) markEmpty(stillMissing[x]);
          }
        }
      }).finally(function () {
        for (var y = 0; y < missing.length; y++) delete window.__FP_LOADING__[missing[y]];
        afterCacheChanged();
      });
    }, 120);
  }

  function exposeDebug() {
    window.__fpDetalhesDebug = function () {
      indexFromGlobalAppointments();
      syncVisibleTitles();
      injectIntoCurrentSheetSoon();
      return {
        supabase: !!getSupabase(),
        appointments: Array.isArray(window.appointments) ? window.appointments.length : null,
        cache: window.__FP_CACHE__,
        empty: window.__FP_EMPTY__,
        lastId: window.__FP_LAST_APT_ID__
      };
    };
  }

  function boot() {
    trackLastAppointment();
    exposeDebug();

    var tries = 0, sbOk = false, observersOk = false, globalSeen = 0;
    var iv = setInterval(function () {
      tries++;
      if (!sbOk) sbOk = patchSupabase();
      if (!observersOk && document.body) { startDomObservers(); observersOk = true; }
      globalSeen = indexFromGlobalAppointments() || globalSeen;
      syncVisibleTitlesSoon();
      injectIntoCurrentSheetSoon();
      if ((tries % 8) === 0) ensurePaymentMethodsFor(collectVisibleAppointmentIds());
      if (tries === 1 || tries === 20 || tries > 120) {
        console.log(TAG, STY, 'boot status', {
          supabase: sbOk, observers: observersOk,
          appointments: Array.isArray(window.appointments) ? window.appointments.length : null,
          appointmentsComPagamento: globalSeen, cache: cacheSize()
        });
      }
      if (tries > 120) {
        clearInterval(iv);
        console.log(TAG, STY, 'boot finalizado', {
          supabase: sbOk, observers: observersOk,
          appointments: Array.isArray(window.appointments) ? window.appointments.length : null,
          cache: cacheSize()
        });
      }
    }, 250);

    setInterval(function () {
      patchSupabase();
      indexFromGlobalAppointments();
      ensurePaymentMethodsFor(collectVisibleAppointmentIds());
      syncVisibleTitlesSoon();
    }, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
