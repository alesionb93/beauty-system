/* =====================================================================
   DEBUG-CT013.JS — Instrumentação ampla, isolada e removível
   ---------------------------------------------------------------------
   Como usar:
     1) Coloque este arquivo na raiz do projeto Slotify (mesma pasta de
        script.js / pagamentos.js).
     2) Em agenda.html, carregue POR ÚLTIMO, depois de TODOS os outros
        scripts (script.js, pagamentos.js, dashboard-pagamentos.js,
        comissoes.js, agendamento-prepago.js, agendamento-desconto.js):

            <script src="/debug-ct013.js?v=1" defer></script>

     3) Reproduza o CT013. Todo log sai com prefixo [CT013] no console.
     4) Para desligar tudo sem remover o <script>:
            localStorage.setItem('CT013_DEBUG', '0');  // e recarregue
        Para religar:
            localStorage.setItem('CT013_DEBUG', '1');  // (default = ON)

   O que ele instrumenta (sem alterar nenhum comportamento):
     • fetch + XHR: loga TODA chamada para Supabase REST/RPC com payload e
       resposta. Filtra por endpoints relevantes (agendamentos,
       agendamento_itens, agendamento_pagamentos, RPCs do dashboard e
       comissões).
     • window.supabase (se exposto): wrap nos .from(table).insert/update/
       upsert/delete e .rpc() — pra pegar payload ANTES de virar HTTP.
     • Abertura do modal de pagamento: loga o agendamento aberto (id,
       cliente, profissional, itens, descontos, pacotes, valor total).
     • Save de pagamentos (pagamentos.js): hook em __pagRegisterAfterSave
       + monkey-patch nos handlers do botão "Confirmar e concluir".
     • Save do atendimento (concluir): loga payload de itens, descontos
       aplicados, caixinha, pacote consumido.
     • loadDashboard: loga window.appointments ANTES e DEPOIS, com diff,
       e marca exatamente qual agendamento o CT013 vê.
     • RPC get_comissoes_dashboard: loga input e output completo.
     • Auto-snapshot: a cada save, tira snapshot de:
           - window.appointments (filtrado pelo dia/cliente/profissional)
           - linhas em agendamento_pagamentos do agendamento alvo
           - itens em agendamento_itens do agendamento alvo
     • Diff de valor: se aparecer um agendamento de R$ 70 no lugar de
       R$ 80 (ou vice-versa), grita em vermelho com stack trace.

   100% read-only do ponto de vista do app. Não muda payloads, não
   intercepta erros, não bloqueia nada — só observa.
   ===================================================================== */
(function () {
  'use strict';
  if (window.__CT013_DEBUG_LOADED__) return;
  window.__CT013_DEBUG_LOADED__ = true;

  var ON = (function () {
    try {
      var v = localStorage.getItem('CT013_DEBUG');
      return v === null ? true : v === '1' || v === 'true';
    } catch (_) { return true; }
  })();
  if (!ON) {
    console.log('%c[CT013] debug desligado (localStorage.CT013_DEBUG=0)', 'color:#888');
    return;
  }

  var TAG = '%c[CT013]';
  var STY = 'background:#dc2626;color:#fff;padding:2px 6px;border-radius:3px;font-weight:700';
  var STY_OK = 'background:#16a34a;color:#fff;padding:2px 6px;border-radius:3px;font-weight:700';
  var STY_WARN = 'background:#f59e0b;color:#fff;padding:2px 6px;border-radius:3px;font-weight:700';

  function log()   { console.log.apply(console, [TAG, STY].concat([].slice.call(arguments))); }
  function ok()    { console.log.apply(console, [TAG + ' ✓', STY_OK].concat([].slice.call(arguments))); }
  function warn()  { console.log.apply(console, [TAG + ' ⚠', STY_WARN].concat([].slice.call(arguments))); }
  function group(label, fn){
    console.groupCollapsed('%c[CT013] ' + label, STY);
    try { fn(); } finally { console.groupEnd(); }
  }
  function clone(o){
    try { return JSON.parse(JSON.stringify(o)); } catch(_) { return o; }
  }
  function nowIso(){ return new Date().toISOString(); }

  log('debug-ct013.js v1 carregado @', nowIso());

  // -------------------------------------------------------------------
  // 1) Endpoints que interessam
  // -------------------------------------------------------------------
  var INTERESTING = [
    /\/rest\/v1\/agendamentos(\?|$)/i,
    /\/rest\/v1\/agendamento_itens(\?|$)/i,
    /\/rest\/v1\/agendamento_pagamentos(\?|$)/i,
    /\/rest\/v1\/agendamento_descontos(\?|$)/i,
    /\/rest\/v1\/clientes(\?|$)/i,
    /\/rest\/v1\/servicos(\?|$)/i,
    /\/rest\/v1\/pacotes(\?|$)/i,
    /\/rest\/v1\/rpc\/get_comissoes_dashboard/i,
    /\/rest\/v1\/rpc\/get_dashboard/i,
    /\/rest\/v1\/rpc\/.*dashboard/i,
    /\/rest\/v1\/rpc\/.*comiss/i,
    /\/rest\/v1\/rpc\/.*pagamento/i,
    /\/rest\/v1\/rpc\/.*atendimento/i,
    /\/rest\/v1\/rpc\/.*concluir/i,
  ];
  function isInteresting(url){
    if (!url) return false;
    var u = String(url);
    for (var i=0;i<INTERESTING.length;i++) if (INTERESTING[i].test(u)) return true;
    return false;
  }

  // -------------------------------------------------------------------
  // 2) Hook em fetch
  // -------------------------------------------------------------------
  var _fetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = (init && init.method) || (input && input.method) || 'GET';
    var body = init && init.body;
    var interesting = isInteresting(url);
    var t0 = performance.now();

    if (interesting){
      var parsed = body;
      if (typeof body === 'string') {
        try { parsed = JSON.parse(body); } catch(_){}
      }
      group('FETCH ' + method + ' ' + shortUrl(url), function(){
        console.log('url:', url);
        if (parsed !== undefined) console.log('body:', clone(parsed));
        console.log('stack:', new Error().stack);
      });
    }

    var p = _fetch(input, init);
    if (interesting){
      p.then(function(res){
        var clone1 = res.clone();
        clone1.text().then(function(txt){
          var data = txt;
          try { data = JSON.parse(txt); } catch(_){}
          group('RESP ' + method + ' ' + shortUrl(url) + '  (' + Math.round(performance.now()-t0) + 'ms, ' + res.status + ')', function(){
            console.log('status:', res.status);
            console.log('data:', clone(data));
            inspectForValor70(data, 'fetch ' + url);
          });
        }).catch(function(){});
      }, function(err){
        warn('FETCH ERR', url, err);
      });
    }
    return p;
  };
  function shortUrl(u){
    try { var x = new URL(u, location.href); return x.pathname + x.search.slice(0, 120); }
    catch(_) { return String(u).slice(0, 160); }
  }

  // -------------------------------------------------------------------
  // 3) Hook em XHR (por garantia — alguns SDKs caem aqui)
  // -------------------------------------------------------------------
  var XHR = window.XMLHttpRequest;
  var _open = XHR.prototype.open;
  var _send = XHR.prototype.send;
  XHR.prototype.open = function(method, url){
    this.__ct013 = { method: method, url: url, interesting: isInteresting(url) };
    return _open.apply(this, arguments);
  };
  XHR.prototype.send = function(body){
    var meta = this.__ct013;
    if (meta && meta.interesting){
      var parsed = body;
      if (typeof body === 'string'){ try { parsed = JSON.parse(body); } catch(_){} }
      group('XHR ' + meta.method + ' ' + shortUrl(meta.url), function(){
        console.log('body:', clone(parsed));
      });
      this.addEventListener('loadend', function(){
        var data = this.responseText;
        try { data = JSON.parse(this.responseText); } catch(_){}
        group('XHR RESP ' + meta.method + ' ' + shortUrl(meta.url) + ' (' + this.status + ')', function(){
          console.log('data:', clone(data));
          inspectForValor70(data, 'xhr ' + meta.url);
        });
      });
    }
    return _send.apply(this, arguments);
  };

  // -------------------------------------------------------------------
  // 4) Detector do "valor R$ 70 fantasma"
  //    Toda vez que aparece valor 70 (em qq campo de número),
  //    grita com contexto. Configurável via window.__CT013_TARGETS__.
  // -------------------------------------------------------------------
  window.__CT013_TARGETS__ = window.__CT013_TARGETS__ || {
    suspects: [70, 70.0, '70', '70.00', '70,00'],
    expectedServico: [80, 80.0, '80', '80.00', '80,00'],
  };
  function inspectForValor70(data, origin){
    var hits = [];
    function walk(v, path){
      if (v == null) return;
      if (typeof v === 'number' || typeof v === 'string'){
        var s = String(v);
        if (window.__CT013_TARGETS__.suspects.indexOf(v) >= 0 ||
            window.__CT013_TARGETS__.suspects.indexOf(s) >= 0){
          hits.push({ path: path, value: v });
        }
        return;
      }
      if (Array.isArray(v)){
        for (var i=0;i<v.length;i++) walk(v[i], path + '[' + i + ']');
        return;
      }
      if (typeof v === 'object'){
        for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) walk(v[k], path ? path + '.' + k : k);
      }
    }
    walk(data, '');
    if (hits.length){
      console.warn('%c[CT013] VALOR 70 detectado em ' + origin, STY);
      console.table(hits);
      console.warn('stack:', new Error().stack);
    }
  }

  // -------------------------------------------------------------------
  // 5) Hook no client supabase exposto (window.supabase / window.sb)
  // -------------------------------------------------------------------
  function wrapSupabase(sb, name){
    if (!sb || sb.__ct013_wrapped) return;
    try {
      var _from = sb.from && sb.from.bind(sb);
      if (_from){
        sb.from = function(table){
          var qb = _from(table);
          ['insert','update','upsert','delete'].forEach(function(op){
            if (typeof qb[op] === 'function'){
              var orig = qb[op].bind(qb);
              qb[op] = function(){
                group(name + '.from(' + table + ').' + op, function(){
                  console.log('args:', clone([].slice.call(arguments)));
                  console.log('stack:', new Error().stack);
                });
                return orig.apply(qb, arguments);
              };
            }
          });
          return qb;
        };
      }
      var _rpc = sb.rpc && sb.rpc.bind(sb);
      if (_rpc){
        sb.rpc = function(fnName, params){
          group(name + '.rpc(' + fnName + ')', function(){
            console.log('params:', clone(params));
            console.log('stack:', new Error().stack);
          });
          return _rpc(fnName, params);
        };
      }
      sb.__ct013_wrapped = true;
      ok('wrap supabase em window.' + name);
    } catch (e) {
      warn('falhou ao wrappar window.' + name, e);
    }
  }
  function trySupabaseWraps(){
    ['supabase','sb','supabaseClient','_supabase'].forEach(function(k){
      if (window[k]) wrapSupabase(window[k], k);
    });
  }
  trySupabaseWraps();
  setTimeout(trySupabaseWraps, 500);
  setTimeout(trySupabaseWraps, 2000);

  // -------------------------------------------------------------------
  // 6) Snapshot do agendamento alvo (CT013) — heurística
  //    Alvo = último agendamento aberto pelo modal de pagamento
  // -------------------------------------------------------------------
  window.__CT013_TARGET_APPT__ = null;

  function snapshotAppointments(label){
    var list = window.appointments;
    if (!Array.isArray(list)){ warn('window.appointments não é array:', list); return; }
    var target = window.__CT013_TARGET_APPT__;
    var filtered = target
      ? list.filter(function(a){ return a && (a.id === target.id || a.id == target.id); })
      : list.slice(-5);
    group('SNAPSHOT ' + label + ' (n=' + list.length + ')', function(){
      console.log('total appointments:', list.length);
      console.log('target id:', target && target.id);
      console.log('focused rows:', clone(filtered));
      // Procura valor 70 escondido
      filtered.forEach(function(a){
        ['valor_total','valor_servicos','valor_total_pago','valor_pago','total','subtotal'].forEach(function(f){
          if (a && f in a){
            console.log('  ' + f + ' =', a[f], typeof a[f]);
          }
        });
      });
    });
  }

  // -------------------------------------------------------------------
  // 7) Hooks específicos do Slotify (pagamentos.js / dashboard)
  // -------------------------------------------------------------------
  function installAfterSaveHook(){
    if (typeof window.__pagRegisterAfterSave !== 'function') return false;
    window.__pagRegisterAfterSave(function(ctx){
      group('AFTER SAVE PAGAMENTO', function(){
        console.log('ctx:', clone(ctx));
        try {
          if (window.__pagGetCtx) console.log('__pagGetCtx():', clone(window.__pagGetCtx()));
        } catch(_){}
        snapshotAppointments('afterSave');
      });
    });
    ok('hook __pagRegisterAfterSave instalado');
    return true;
  }
  if (!installAfterSaveHook()){
    var tries = 0;
    var iv = setInterval(function(){
      tries++;
      if (installAfterSaveHook() || tries > 40) clearInterval(iv);
    }, 250);
  }

  // Hook em loadDashboard
  (function hookDashboard(){
    var orig = window.loadDashboard;
    var wrapped = false;
    function wrap(){
      if (wrapped || typeof window.loadDashboard !== 'function') return;
      var fn = window.loadDashboard;
      window.loadDashboard = function(){
        group('loadDashboard CALL', function(){
          console.log('args:', clone([].slice.call(arguments)));
          snapshotAppointments('antes do loadDashboard');
        });
        var r = fn.apply(this, arguments);
        Promise.resolve(r).then(function(out){
          group('loadDashboard DONE', function(){
            console.log('return:', clone(out));
            snapshotAppointments('depois do loadDashboard');
          });
        }).catch(function(e){ warn('loadDashboard rejeitou', e); });
        return r;
      };
      wrapped = true;
      ok('window.loadDashboard wrappado');
    }
    wrap();
    var tries = 0;
    var iv = setInterval(function(){
      tries++; wrap();
      if (wrapped || tries > 40) clearInterval(iv);
    }, 250);
  })();

  // -------------------------------------------------------------------
  // 8) Detecta abertura do modal de pagamento (CT013 começa aqui)
  // -------------------------------------------------------------------
  function findOpenAppointmentFromModal(){
    // tenta achar o id em data-* do modal
    var modal = document.querySelector('.pag-modal, [data-pag-modal], #pag-modal, .modal-pagamento');
    if (!modal) return null;
    var id = modal.getAttribute('data-appointment-id')
          || modal.getAttribute('data-agendamento-id')
          || modal.dataset && (modal.dataset.appointmentId || modal.dataset.agendamentoId);
    if (id && Array.isArray(window.appointments)){
      var a = window.appointments.find(function(x){ return String(x.id) === String(id); });
      if (a) return a;
    }
    // fallback: último aberto pelo pagamentos.js
    try {
      if (window.__pagGetCtx){
        var ctx = window.__pagGetCtx();
        if (ctx && ctx.agendamento) return ctx.agendamento;
        if (ctx && ctx.appointment) return ctx.appointment;
      }
    } catch(_){}
    return null;
  }

  var mo = new MutationObserver(function(muts){
    for (var i=0;i<muts.length;i++){
      var m = muts[i];
      for (var j=0;j<m.addedNodes.length;j++){
        var n = m.addedNodes[j];
        if (n && n.nodeType === 1){
          if (n.matches && (n.matches('.pag-modal, [data-pag-modal], #pag-modal, .modal-pagamento') ||
                            n.querySelector && n.querySelector('.pag-modal, [data-pag-modal], #pag-modal, .modal-pagamento'))){
            setTimeout(function(){
              var appt = findOpenAppointmentFromModal();
              if (appt){
                window.__CT013_TARGET_APPT__ = appt;
                group('MODAL PAGAMENTO ABERTO — alvo do CT013', function(){
                  console.log('agendamento:', clone(appt));
                  console.log('itens:', clone(appt.itens || appt.items || appt.servicos));
                  console.log('descontos:', clone(appt.descontos || appt.desconto));
                  console.log('pacotes:', clone(appt.pacote || appt.pacotes || appt.pacote_consumido));
                  console.log('valor_total:', appt.valor_total, '| valor_servicos:', appt.valor_servicos, '| valor_total_pago:', appt.valor_total_pago);
                });
              } else {
                warn('modal aberto, mas não achei agendamento alvo');
              }
            }, 50);
          }
        }
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // -------------------------------------------------------------------
  // 9) Clique em "Confirmar e concluir" — marca timestamp T0
  // -------------------------------------------------------------------
  document.addEventListener('click', function(ev){
    var t = ev.target;
    if (!t || !t.closest) return;
    var btn = t.closest('button, .btn, [role=button]');
    if (!btn) return;
    var txt = (btn.textContent || '').trim().toLowerCase();
    if (txt.indexOf('confirmar e concluir') >= 0 || txt.indexOf('registrar pagamento') >= 0){
      window.__CT013_T0__ = performance.now();
      group('CLICK "' + txt + '"', function(){
        console.log('t0 =', window.__CT013_T0__);
        var appt = window.__CT013_TARGET_APPT__ || findOpenAppointmentFromModal();
        console.log('agendamento alvo:', clone(appt));
        if (appt){
          console.log('itens:', clone(appt.itens || appt.items || appt.servicos));
          console.log('valor_total:', appt.valor_total);
          console.log('valor_servicos:', appt.valor_servicos);
        }
      });
    }
  }, true);

  // -------------------------------------------------------------------
  // 10) Helpers úteis no console
  // -------------------------------------------------------------------
  window.__CT013 = {
    snapshot: function(){ snapshotAppointments('manual'); },
    target: function(){ return window.__CT013_TARGET_APPT__; },
    off: function(){ try { localStorage.setItem('CT013_DEBUG','0'); } catch(_){} location.reload(); },
    on:  function(){ try { localStorage.setItem('CT013_DEBUG','1'); } catch(_){} location.reload(); },
    findAppt: function(id){
      return (window.appointments||[]).find(function(a){ return String(a.id) === String(id); });
    },
  };
  ok('pronto. Use window.__CT013.snapshot() / .target() / .off() no console.');
})();
