/* =====================================================================
   RESUMO-FINANCEIRO-DETALHES.JS  (v2 — 2026-08-08)
   ---------------------------------------------------------------------
   Add-on ISOLADO e SOMENTE DE EXIBIÇÃO.

   v2 — correção de re-renderização:
     • Desktop: o resumo passa a fazer parte da construção DEFINITIVA do
       tooltip (wrap síncrono de attachAppointmentTooltip). Nada de
       reinjeção posterior, observers de `title` ou debounce.
     • Mobile: o resumo é inserido UMA VEZ, de forma síncrona, logo após
       openAgendamentoBottomSheet() escrever o #appointment-sheet-body.
       Nenhum MutationObserver, nenhum setInterval, nenhum modal novo.
     • Forma de pagamento continua 100% sob responsabilidade de
       forma-pagamento-detalhes.js (não removemos nem duplicamos a linha).

   Fonte de dados (SOMENTE SELECT em `agendamentos`):
       Subtotal  = subtotal_servicos + subtotal_produtos
       Descontos = desconto_total
       Caixinha  = caixinha_total
       Total     = total   (nunca recalculado)

   Carregar em agenda.html DEPOIS de script.js, pagamentos.js e
   forma-pagamento-detalhes.js.
   ===================================================================== */
(function () {
  'use strict';
  if (window.__SLOTIFY_RESUMO_FIN_LOADED__ === 2) return;
  window.__SLOTIFY_RESUMO_FIN_LOADED__ = 2;

  var TAG = '%c🧮 resumo-financeiro-detalhes v2';
  var STY = 'background:#0f766e;color:#fff;padding:3px 7px;border-radius:4px;font-weight:700';
  console.log(TAG, STY, 'inicializando (somente exibição, sem observers/timers)');

  var CACHE   = (window.__RESFIN_CACHE__   = window.__RESFIN_CACHE__   || {}); // id -> resumo
  var LOADING = (window.__RESFIN_LOADING__ = window.__RESFIN_LOADING__ || {});
  var MISS    = (window.__RESFIN_MISS__    = window.__RESFIN_MISS__    || {});
  var MISS_TTL_MS = 30 * 1000;

  var COLS = 'id, subtotal_servicos, subtotal_produtos, desconto_total, caixinha_total, total';

  // "Valor pago" e afins não devem mais aparecer nesse bloco
  var LEGACY_LABELS     = /^(subtotal|descontos?|caixinha|gorjeta|valor\s*pago|total)$/i;
  var LEGACY_TITLE_LINE = /^(subtotal|descontos?|caixinha|gorjeta|valor\s*pago|total)\s*:/i;

  // -------------------- Helpers --------------------
  function num(v){ var n = Number(v); return isNaN(n) ? 0 : n; }
  function round2(n){ return Math.round(num(n) * 100) / 100; }
  function fmtBRL(n){ return num(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function idKey(id){ return id == null ? '' : String(id); }
  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function getSupabase(){
    if (window.supabaseClient) return window.supabaseClient;
    try { if (typeof supabaseClient !== 'undefined' && supabaseClient) return supabaseClient; } catch(_){}
    if (window.supabase && typeof window.supabase.from === 'function') return window.supabase;
    return null;
  }
  function hasCols(row){
    if (!row) return false;
    return ('total' in row) || ('subtotal_servicos' in row) || ('subtotal_produtos' in row) ||
           ('desconto_total' in row) || ('caixinha_total' in row);
  }
  function toResumo(row){
    return {
      subtotal:  round2(num(row.subtotal_servicos) + num(row.subtotal_produtos)),
      descontos: round2(num(row.desconto_total)),
      caixinha:  round2(num(row.caixinha_total)),
      total:     round2(num(row.total)) // fonte única: agendamentos.total
    };
  }
  function setCache(id, resumo){
    id = idKey(id);
    if (!id || !resumo) return;
    CACHE[id] = resumo;
    delete MISS[id];
  }
  function missStillValid(id){
    var t = MISS[id];
    if (!t) return false;
    if ((Date.now() - t) > MISS_TTL_MS) { delete MISS[id]; return false; }
    return true;
  }
  function resumoFromRow(row){
    return (row && hasCols(row)) ? toResumo(row) : null;
  }
  /** Resolve o resumo de forma síncrona: objeto do host > cache. */
  function resolveResumo(a){
    var id = idKey(a && a.id);
    var fromRow = resumoFromRow(a);
    if (fromRow) { setCache(id, fromRow); return fromRow; }
    return id ? (CACHE[id] || null) : null;
  }

  // -------------------- Busca ÚNICA no banco (SELECT) --------------------
  // Sem polling: só é chamada quando um agendamento específico precisa
  // do dado e ele ainda não está disponível. Resolve uma vez e atualiza
  // apenas os textos do card já existente.
  function fetchResumo(id){
    id = idKey(id);
    if (!id || CACHE[id] || missStillValid(id)) return Promise.resolve(CACHE[id] || null);
    if (LOADING[id]) return LOADING[id];
    var sb = getSupabase();
    if (!sb || typeof sb.from !== 'function') return Promise.resolve(null);

    var p = Promise.resolve(sb.from('agendamentos').select(COLS).eq('id', id).limit(1))
      .then(function (resp){
        if (!resp || resp.error) { MISS[id] = Date.now(); return null; }
        var row = (resp.data && resp.data[0]) || null;
        var r = resumoFromRow(row);
        if (r) setCache(id, r); else MISS[id] = Date.now();
        return r;
      })
      .catch(function(){ MISS[id] = Date.now(); return null; })
      .then(function (r){ delete LOADING[id]; return r; });

    LOADING[id] = p;
    return p;
  }

  // -------------------- Desktop: tooltip nativo --------------------
  function titleWithResumo(title, r){
    var lines = String(title || '').split('\n').filter(function (l){
      return l.trim() && !LEGACY_TITLE_LINE.test(l.trim());
    });
    lines.push('Subtotal: '  + fmtBRL(r.subtotal));
    lines.push('Descontos: ' + fmtBRL(r.descontos));
    lines.push('Caixinha: '  + fmtBRL(r.caixinha));
    lines.push('Total: '     + fmtBRL(r.total));
    return lines.join('\n');
  }

  function wrapTooltip(){
    var orig = window.attachAppointmentTooltip;
    if (typeof orig !== 'function' || orig.__resfinWrapped) return false;

    var wrapped = function (block, a, ev) {
      var out = orig.apply(this, arguments);
      try {
        if (!block || !a) return out;
        var r = resolveResumo(a);
        if (r) {
          block.title = titleWithResumo(block.title, r);
        } else if (a.id) {
          // busca única; ao chegar, escreve o title uma só vez (sem loop)
          var id = idKey(a.id);
          fetchResumo(id).then(function (res){
            if (!res || !block.isConnected) return;
            // só escreve se o bloco ainda representa o mesmo agendamento
            block.title = titleWithResumo(block.title, res);
          });
        }
      } catch(_){}
      return out;
    };
    wrapped.__resfinWrapped = true;
    window.attachAppointmentTooltip = wrapped;
    try { if (typeof attachAppointmentTooltip !== 'undefined') { /* noop */ } } catch(_){}
    return true;
  }

  // -------------------- Mobile: bottom sheet existente --------------------
  function buildSheetBlock(r){
    return '' +
      '<div class="apt-fin-card" data-resfin-block="1">' +
        '<div class="apt-fin-title">Resumo financeiro</div>' +
        '<div class="apt-fin-row"><span class="apt-fin-label">Subtotal</span>' +
          '<span class="apt-fin-value" data-resfin-field="subtotal">' + esc(fmtBRL(r.subtotal)) + '</span></div>' +
        '<div class="apt-fin-row"><span class="apt-fin-label">Descontos</span>' +
          '<span class="apt-fin-value apt-fin-neg" data-resfin-field="descontos">' + (r.descontos > 0 ? '– ' : '') + esc(fmtBRL(r.descontos)) + '</span></div>' +
        '<div class="apt-fin-row"><span class="apt-fin-label">Caixinha</span>' +
          '<span class="apt-fin-value apt-fin-pos" data-resfin-field="caixinha">' + (r.caixinha > 0 ? '+ ' : '') + esc(fmtBRL(r.caixinha)) + '</span></div>' +
        '<div class="apt-fin-row apt-fin-total"><span class="apt-fin-label">Total</span>' +
          '<span class="apt-fin-value" data-resfin-field="total">' + esc(fmtBRL(r.total)) + '</span></div>' +
      '</div>';
  }

  /** Atualiza só o texto dos campos (mutação mínima). */
  function updateCardValues(card, r){
    if (!card || !r) return;
    var map = {
      subtotal:  fmtBRL(r.subtotal),
      descontos: (r.descontos > 0 ? '– ' : '') + fmtBRL(r.descontos),
      caixinha:  (r.caixinha  > 0 ? '+ ' : '') + fmtBRL(r.caixinha),
      total:     fmtBRL(r.total)
    };
    Object.keys(map).forEach(function (k){
      var el = card.querySelector('[data-resfin-field="' + k + '"]');
      if (el && el.textContent !== map[k]) el.textContent = map[k];
    });
  }

  /** Remove apenas linhas financeiras legadas ("Valor pago" etc.).
   *  NUNCA remove a linha de forma de pagamento (data-fp-row). */
  function stripLegacyRows(body){
    var rows = body.querySelectorAll('.apt-sheet-row');
    for (var i = 0; i < rows.length; i++){
      var row = rows[i];
      if (row.getAttribute('data-fp-row') === '1') continue;
      var lbl = row.querySelector('.apt-sheet-label');
      var txt = lbl ? (lbl.textContent || '').trim() : '';
      if (LEGACY_LABELS.test(txt) && row.parentNode) row.parentNode.removeChild(row);
    }
  }

  /** Insere o card uma única vez, dentro do body já renderizado. */
  function renderSheet(a){
    var body = document.getElementById('appointment-sheet-body');
    if (!body) return;
    var id = idKey(a && a.id);

    stripLegacyRows(body);

    var r = resolveResumo(a);
    var placeholder = { subtotal: 0, descontos: 0, caixinha: 0, total: 0 };
    var card = body.querySelector('[data-resfin-block="1"]');

    if (!card) {
      var tmp = document.createElement('div');
      tmp.innerHTML = buildSheetBlock(r || placeholder);
      card = tmp.firstChild;
      card.setAttribute('data-resfin-id', id);
      if (!r) card.setAttribute('data-resfin-pending', '1');
      body.appendChild(card);
    } else {
      card.setAttribute('data-resfin-id', id);
      updateCardValues(card, r || placeholder);
    }

    if (!r && id) {
      fetchResumo(id).then(function (res){
        if (!res) return;
        var live = document.getElementById('appointment-sheet-body');
        var c = live && live.querySelector('[data-resfin-block="1"][data-resfin-id="' + id + '"]');
        if (!c) return;
        c.removeAttribute('data-resfin-pending');
        updateCardValues(c, res); // atualiza só o texto — sem recriar o card
      });
    }
  }

  function wrapSheet(){
    var orig = window.openAgendamentoBottomSheet;
    if (typeof orig !== 'function' || orig.__resfinWrapped) return false;

    var wrapped = function (a) {
      var out = orig.apply(this, arguments);
      try { renderSheet(a); } catch(e){ console.warn(TAG, STY, 'sheet', e); }
      return out;
    };
    wrapped.__resfinWrapped = true;
    window.openAgendamentoBottomSheet = wrapped;
    return true;
  }

  // -------------------- Boot (sem observers, sem polling) --------------------
  function boot(){
    var okTip   = wrapTooltip();
    var okSheet = wrapSheet();

    if (!okTip || !okSheet) {
      // única espera curta caso o script.js ainda não tenha definido as
      // funções globais; encerra assim que ambas forem envolvidas.
      var tries = 0;
      var iv = setInterval(function (){
        tries++;
        if (!okTip)   okTip   = wrapTooltip();
        if (!okSheet) okSheet = wrapSheet();
        if ((okTip && okSheet) || tries > 40) clearInterval(iv);
      }, 100);
    }

    window.__resFinDebug = function (){
      return {
        cache: CACHE,
        tooltipWrapped: !!(window.attachAppointmentTooltip || {}).__resfinWrapped,
        sheetWrapped: !!(window.openAgendamentoBottomSheet || {}).__resfinWrapped,
        sheets: document.querySelectorAll('#appointment-sheet').length,
        cards: document.querySelectorAll('[data-resfin-block="1"]').length,
        supabase: !!getSupabase()
      };
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
