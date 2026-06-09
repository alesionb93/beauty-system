/* =====================================================================
   DEBUG-CT013-TICKET.JS — Add-on focado na corrida do dashboard
   ---------------------------------------------------------------------
   Carregar DEPOIS de debug-ct013.js, por exemplo:
       <script src="/debug-ct013.js?v=1" defer></script>
       <script src="/debug-ct013-ticket.js?v=1" defer></script>

   Objetivo: descobrir por que #dash-ticket exibe 100 ou 110 durante a
   automação, e 90 quando o usuário aplica o filtro manualmente.

   O que loga (prefixo [CT013-TICKET]):

   1) DOM MUTATION: toda mudança de texto em #dash-ticket,
      #dash-faturamento, #dash-total-ag — com timestamp, valor anterior,
      valor novo, e qual loadDashboard# está em curso.

   2) loadDashboard(): wrap com seq#, marca início/fim, captura snapshot
      ANTES e DEPOIS dos dados em window.* que o dashboard usa
      (appointments, pagamentos, agendamentos, etc — auto-descoberto).

   3) Network: conta GET /agendamentos e GET /agendamento_pagamentos
      em curso. Loga cada resposta com count de registros, IDs, range de
      datas (data_inicio min/max). Avisa se chega resposta DEPOIS do
      loadDashboard que a disparou já ter terminado.

   4) Para CADA valor novo de #dash-ticket, faz um "forensics dump":
      - quantos agendamentos estão no estado naquele instante
      - quantos pagamentos
      - soma dos pagamentos no range do filtro (se filtro detectado)
      - IDs que dariam o valor exibido (heurística: combinações que
        somam para o valor que apareceu)
      - quais requests estavam in-flight no momento

   5) Detecta múltiplos loadDashboard em sequência rápida (<500ms) —
      candidato a debounce ausente.

   Controle:
       localStorage.setItem('CT013_TICKET_DEBUG', '0'); // desliga
   ===================================================================== */
(function () {
  'use strict';
  if (window.__CT013_TICKET__) return;
  if (localStorage.getItem('CT013_TICKET_DEBUG') === '0') return;

  var TAG = '[CT013-TICKET]';
  var t0 = performance.now();
  var ts = function () { return ((performance.now() - t0) / 1000).toFixed(3) + 's'; };

  var c = console;
  var log  = function () { c.log.apply(c, [TAG, ts()].concat([].slice.call(arguments))); };
  var warn = function () { c.warn.apply(c, [TAG, ts()].concat([].slice.call(arguments))); };
  var err  = function () { c.error.apply(c, [TAG, ts()].concat([].slice.call(arguments))); };
  var grp  = function (label) { try { c.groupCollapsed(TAG + ' ' + ts() + ' ' + label); } catch (_) {} };
  var gend = function () { try { c.groupEnd(); } catch (_) {} };

  log('boot — addon de instrumentação do ticket carregado');

  // ---------------------------------------------------------------------
  // Estado global do tracker
  // ---------------------------------------------------------------------
  var state = {
    loadSeq: 0,
    currentLoad: null,    // {seq, t0}
    lastLoadEndAt: 0,
    loadTimestamps: [],   // para detectar bursts
    inflight: {           // requests em curso por endpoint
      agendamentos: [],
      agendamento_pagamentos: [],
      other: []
    },
    lastResponses: {
      agendamentos: null,
      agendamento_pagamentos: null
    },
    lastFilter: { inicio: null, fim: null }
  };
  window.__CT013_TICKET__ = state;

  // ---------------------------------------------------------------------
  // Helpers: snapshot de dados globais que o dashboard pode usar
  // ---------------------------------------------------------------------
  var CANDIDATE_KEYS = [
    'appointments', 'agendamentos', 'allAppointments',
    'pagamentos', 'agendamentoPagamentos', 'allPagamentos',
    'dashboardData', 'dashState', 'lastDashboard'
  ];

  function pickIds(arr) {
    if (!Array.isArray(arr)) return null;
    return arr.map(function (x) { return x && (x.id || x.agendamento_id); }).filter(Boolean);
  }

  function snapshotGlobals() {
    var snap = {};
    CANDIDATE_KEYS.forEach(function (k) {
      try {
        var v = window[k];
        if (v == null) return;
        if (Array.isArray(v)) {
          snap[k] = { type: 'array', length: v.length, ids: pickIds(v).slice(0, 50) };
        } else if (typeof v === 'object') {
          snap[k] = { type: 'object', keys: Object.keys(v).slice(0, 20) };
        }
      } catch (_) {}
    });
    return snap;
  }

  function readFilter() {
    try {
      var i = document.querySelector('#dash-inicio');
      var f = document.querySelector('#dash-fim');
      return {
        inicio: i ? i.value : null,
        fim: f ? f.value : null
      };
    } catch (_) { return { inicio: null, fim: null }; }
  }

  function readTrackedDom() {
    function txt(sel) {
      var el = document.querySelector(sel);
      return el ? (el.textContent || '').trim() : null;
    }
    return {
      '#dash-ticket': txt('#dash-ticket'),
      '#dash-faturamento': txt('#dash-faturamento'),
      '#dash-total-ag': txt('#dash-total-ag'),
      '#dash-total-servicos': txt('#dash-total-servicos'),
      '#dash-pag-recebido': txt('#dash-pag-recebido'),
      '#dash-pag-pendente': txt('#dash-pag-pendente')
    };
  }

  // ---------------------------------------------------------------------
  // 1) MutationObserver nos KPIs
  // ---------------------------------------------------------------------
  var TRACKED = ['#dash-ticket', '#dash-faturamento', '#dash-total-ag'];
  var lastValues = {};

  function bindObservers() {
    TRACKED.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      lastValues[sel] = (el.textContent || '').trim();
      var mo = new MutationObserver(function () {
        var cur = (el.textContent || '').trim();
        if (cur === lastValues[sel]) return;
        var prev = lastValues[sel];
        lastValues[sel] = cur;
        onKpiChange(sel, prev, cur);
      });
      mo.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  function onKpiChange(sel, prev, cur) {
    var ctx = {
      kpi: sel,
      from: prev,
      to: cur,
      loadInFlight: state.currentLoad ? state.currentLoad.seq : null,
      lastLoadEndedMsAgo: state.lastLoadEndAt ? Math.round(performance.now() - state.lastLoadEndAt) : null,
      inflightAg: state.inflight.agendamentos.length,
      inflightPag: state.inflight.agendamento_pagamentos.length,
      filter: readFilter(),
      domNow: readTrackedDom(),
      lastAgResp: state.lastResponses.agendamentos && {
        at: state.lastResponses.agendamentos.at,
        count: state.lastResponses.agendamentos.count,
        ids: state.lastResponses.agendamentos.ids
      },
      lastPagResp: state.lastResponses.agendamento_pagamentos && {
        at: state.lastResponses.agendamento_pagamentos.at,
        count: state.lastResponses.agendamento_pagamentos.count,
        ids: state.lastResponses.agendamento_pagamentos.ids,
        sum: state.lastResponses.agendamento_pagamentos.sum
      },
      globals: snapshotGlobals()
    };

    var bad = (sel === '#dash-ticket' && /(\b100\b|\b110\b)/.test(cur));
    var fn = bad ? err : log;
    grp('KPI-CHANGE ' + sel + ': "' + prev + '" -> "' + cur + '"' + (bad ? '  ⚠️ SUSPECT' : ''));
    fn('contexto', ctx);
    try { c.trace(); } catch (_) {}
    gend();
  }

  // ---------------------------------------------------------------------
  // 2) Wrap loadDashboard
  // ---------------------------------------------------------------------
  function tryWrapLoadDashboard() {
    if (typeof window.loadDashboard !== 'function') return false;
    if (window.loadDashboard.__ct013ticket) return true;
    var orig = window.loadDashboard;
    var wrapped = function () {
      state.loadSeq += 1;
      var seq = state.loadSeq;
      var prevCurrent = state.currentLoad;
      state.currentLoad = { seq: seq, t0: performance.now() };
      state.loadTimestamps.push(performance.now());
      // detector de burst
      var recent = state.loadTimestamps.filter(function (t) { return performance.now() - t < 1000; });
      if (recent.length >= 3) warn('BURST loadDashboard: ' + recent.length + ' chamadas em <1s');

      grp('loadDashboard #' + seq + ' CALL  (filter=' + JSON.stringify(readFilter()) + ')');
      log('snapshot ANTES', { dom: readTrackedDom(), globals: snapshotGlobals() });
      gend();

      var ret;
      try { ret = orig.apply(this, arguments); } catch (e) { err('loadDashboard threw', e); throw e; }

      var finish = function (tag, val) {
        var dur = (performance.now() - state.currentLoad.t0).toFixed(1);
        grp('loadDashboard #' + seq + ' ' + tag + '  (+' + dur + 'ms)');
        log('snapshot DEPOIS', { dom: readTrackedDom(), globals: snapshotGlobals() });
        log('inflight ao terminar', {
          agendamentos: state.inflight.agendamentos.length,
          pagamentos: state.inflight.agendamento_pagamentos.length
        });
        gend();
        state.lastLoadEndAt = performance.now();
        state.currentLoad = prevCurrent;
        return val;
      };

      if (ret && typeof ret.then === 'function') {
        return ret.then(
          function (v) { return finish('DONE', v); },
          function (e) { finish('REJECTED'); throw e; }
        );
      }
      return finish('DONE-sync', ret);
    };
    wrapped.__ct013ticket = true;
    window.loadDashboard = wrapped;
    log('loadDashboard wrapped');
    return true;
  }

  // ---------------------------------------------------------------------
  // 3) Network — interceptar fetch e XHR para os 2 endpoints
  // ---------------------------------------------------------------------
  function classify(url) {
    if (!url) return null;
    if (/\/agendamento_pagamentos(\?|$)/.test(url)) return 'agendamento_pagamentos';
    if (/\/agendamentos(\?|$)/.test(url)) return 'agendamentos';
    return null;
  }

  function parseDateRangeFromUrl(url) {
    try {
      var u = new URL(url, location.origin);
      var out = {};
      u.searchParams.forEach(function (v, k) {
        if (/data|date|inicio|fim|start|end/i.test(k)) out[k] = v;
      });
      return out;
    } catch (_) { return {}; }
  }

  function summarizePagamentos(arr) {
    if (!Array.isArray(arr)) return null;
    var sum = 0, ids = [], byAg = {};
    arr.forEach(function (p) {
      var v = Number(p && (p.valor || p.valor_pago || p.amount)) || 0;
      sum += v;
      if (p && p.id) ids.push(p.id);
      var ag = p && (p.agendamento_id || p.appointment_id);
      if (ag) byAg[ag] = (byAg[ag] || 0) + v;
    });
    return { count: arr.length, sum: sum, ids: ids.slice(0, 50), byAgendamento: byAg };
  }

  function summarizeAgendamentos(arr) {
    if (!Array.isArray(arr)) return null;
    var ids = arr.map(function (a) { return a && a.id; }).filter(Boolean);
    var datas = arr.map(function (a) { return a && (a.data || a.data_inicio); }).filter(Boolean).sort();
    return {
      count: arr.length,
      ids: ids.slice(0, 50),
      minData: datas[0] || null,
      maxData: datas[datas.length - 1] || null
    };
  }

  // ---- fetch ----
  var origFetch = window.fetch;
  if (origFetch && !origFetch.__ct013ticket) {
    var wrappedFetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var kind = classify(url);
      var reqId = Math.random().toString(36).slice(2, 8);
      var startedLoad = state.currentLoad ? state.currentLoad.seq : null;
      var startTs = performance.now();

      if (kind) {
        state.inflight[kind].push(reqId);
        log('REQ→ ' + kind + ' #' + reqId + ' load=' + startedLoad + ' params=', parseDateRangeFromUrl(url));
      }

      return origFetch.apply(this, arguments).then(function (resp) {
        if (!kind) return resp;
        var clone;
        try { clone = resp.clone(); } catch (_) { clone = null; }
        var dur = (performance.now() - startTs).toFixed(1);

        // remove from inflight
        var idx = state.inflight[kind].indexOf(reqId);
        if (idx >= 0) state.inflight[kind].splice(idx, 1);

        if (clone) {
          clone.json().then(function (body) {
            var summary = kind === 'agendamento_pagamentos'
              ? summarizePagamentos(body)
              : summarizeAgendamentos(body);
            state.lastResponses[kind] = Object.assign({ at: ts(), reqId: reqId }, summary || {});

            var loadStillSame = state.currentLoad && state.currentLoad.seq === startedLoad;
            var afterLoadEnded = startedLoad != null && !loadStillSame;

            grp('RESP← ' + kind + ' #' + reqId + ' (+' + dur + 'ms) load=' + startedLoad
              + (afterLoadEnded ? '  ⚠️ chegou DEPOIS do loadDashboard terminar' : ''));
            log('summary', summary);
            if (kind === 'agendamento_pagamentos' && summary && (summary.sum === 100 || summary.sum === 110 || summary.sum === 90)) {
              log('🎯 sum=' + summary.sum + ' — comparar com #dash-ticket atual:', readTrackedDom()['#dash-ticket']);
            }
            log('dom agora', readTrackedDom());
            gend();
          }).catch(function () {});
        }
        return resp;
      });
    };
    wrappedFetch.__ct013ticket = true;
    window.fetch = wrappedFetch;
    log('fetch wrapped');
  }

  // ---- XHR ----
  var XHRopen = XMLHttpRequest.prototype.open;
  var XHRsend = XMLHttpRequest.prototype.send;
  if (!XHRopen.__ct013ticket) {
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__ct013_url = url;
      this.__ct013_kind = classify(url);
      this.__ct013_startedLoad = state.currentLoad ? state.currentLoad.seq : null;
      this.__ct013_reqId = Math.random().toString(36).slice(2, 8);
      return XHRopen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var self = this;
      var kind = this.__ct013_kind;
      if (kind) {
        state.inflight[kind].push(self.__ct013_reqId);
        log('REQ→(xhr) ' + kind + ' #' + self.__ct013_reqId + ' load=' + self.__ct013_startedLoad);
        this.addEventListener('loadend', function () {
          var idx = state.inflight[kind].indexOf(self.__ct013_reqId);
          if (idx >= 0) state.inflight[kind].splice(idx, 1);
          var body = null;
          try { body = JSON.parse(self.responseText); } catch (_) {}
          var summary = kind === 'agendamento_pagamentos'
            ? summarizePagamentos(body)
            : summarizeAgendamentos(body);
          state.lastResponses[kind] = Object.assign({ at: ts(), reqId: self.__ct013_reqId }, summary || {});
          grp('RESP←(xhr) ' + kind + ' #' + self.__ct013_reqId + ' load=' + self.__ct013_startedLoad);
          log('summary', summary);
          log('dom agora', readTrackedDom());
          gend();
        });
      }
      return XHRsend.apply(this, arguments);
    };
    XMLHttpRequest.prototype.open.__ct013ticket = true;
    log('XHR wrapped');
  }

  // ---------------------------------------------------------------------
  // Bootstrap: tenta wrap loadDashboard agora e em retries
  // ---------------------------------------------------------------------
  function boot() {
    bindObservers();
    if (!tryWrapLoadDashboard()) {
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if (tryWrapLoadDashboard() || tries > 40) clearInterval(iv);
      }, 250);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // API manual
  window.__CT013_TICKET = {
    state: state,
    dom: readTrackedDom,
    filter: readFilter,
    globals: snapshotGlobals,
    off: function () { localStorage.setItem('CT013_TICKET_DEBUG', '0'); location.reload(); }
  };
  log('pronto. window.__CT013_TICKET.dom() / .state / .globals()');
})();
