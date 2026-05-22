/* ============================================================
   SKELETON LOADING — Slotify (Agendamentos) v7
   THEME-AWARE: usa exclusivamente tokens CSS do tenant.
   - Nenhuma cor fixa (#000/#fff/cinza hardcoded).
   - Overlay absoluto sobre os cards (não troca layout).
   - Funciona em tema claro, escuro e qualquer cor primária.
   - Shimmer adapta automaticamente ao background do card.
   Carrega APÓS script.js em agenda.html:
       <script src="skeleton-loading.js?v=6"></script>
   ============================================================ */
(function () {
  'use strict';

  const SEL = {
    calCard:  '.calendar-card',
    calDays:  '#calendar-days',
    monthEl:  '#month-year',
    dayCard:  '.day-detail-card',
    dayHead:  '#day-detail-header',
    dayList:  '#day-appointments',
    weekdays: '.calendar-weekdays',
  };

  const MIN_VISIBLE_MS = 250;
  const FAILSAFE_MS    = 4000;
  const FADE_MS        = 200;

  const EMPTY_TEXT_RE = /(nenhum agendamento|sem agendamentos|nada por aqui|no appointments)/i;

  /* ---------- CSS injetado (100% via tokens do tema) ---------- */
  function injectCSS() {
    if (document.getElementById('sk-overlay-style')) return;
    const css = `
      /* === Tokens locais derivados do tema do tenant ===
         Caem em ordem: token semântico → token do app → fallback neutro.
         currentColor é usado como base do shimmer pra herdar contraste do texto. */
      .sk-overlay {
        /* superfície do card (mesma do componente real) */
        --sk-surface: var(--surface-card, var(--bg-card, var(--card, var(--background, #fff))));
        /* borda no mesmo tom da UI */
        --sk-border:  var(--border, color-mix(in srgb, currentColor 12%, transparent));
        /* base do bloco skeleton — leve tinta sobre a superfície */
        --sk-base:    color-mix(in srgb, currentColor 8%,  transparent);
        /* highlight do shimmer — um pouco mais intenso */
        --sk-hi:      color-mix(in srgb, currentColor 16%, transparent);
        /* tinta sutil pra cards internos do skeleton (usa primary do tenant) */
        --sk-tint:    color-mix(in srgb, var(--gold, var(--primary, currentColor)) 6%, transparent);
        --sk-tint-bd: color-mix(in srgb, var(--gold, var(--primary, currentColor)) 14%, transparent);
      }

      .sk-host { position: relative; }
      .sk-overlay {
        position: absolute; inset: 0;
        z-index: 50;
        background: var(--sk-surface);
        color: var(--text, var(--foreground, inherit));
        border-radius: inherit;
        padding: inherit;
        overflow: hidden;
        opacity: 1;
        transition: opacity ${FADE_MS}ms ease;
        pointer-events: none;
      }
      .sk-overlay.sk-leaving { opacity: 0; }

      .sk-overlay-inner {
        position: absolute; inset: 0;
        padding: 18px;
        display: flex; flex-direction: column;
        gap: 14px;
      }

      /* Shimmer base — usa variáveis derivadas do tema */
      .sk-bar {
        background-color: var(--sk-base);
        background-image: linear-gradient(90deg,
          var(--sk-base) 0%,
          var(--sk-hi)   50%,
          var(--sk-base) 100%);
        background-size: 200% 100%;
        background-repeat: no-repeat;
        animation: sk-shimmer 1.4s ease-in-out infinite;
        border-radius: 8px;
      }
      @keyframes sk-shimmer {
        0%   { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .sk-bar { animation: none; }
      }

      /* ===== Calendar overlay ===== */
      .sk-cal-head {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; height: 24px;
      }
      .sk-cal-head .sk-arrow { width: 18px; height: 18px; border-radius: 6px; }
      .sk-cal-head .sk-month { width: 140px; height: 16px; border-radius: 6px; }

      .sk-cal-week {
        display: grid; grid-template-columns: repeat(7, 1fr);
        gap: 6px; margin-top: 4px;
      }
      .sk-cal-week .sk-wd { height: 12px; border-radius: 6px; }

      .sk-cal-grid {
        display: grid; grid-template-columns: repeat(7, 1fr);
        grid-auto-rows: 1fr;
        gap: 6px; flex: 1; min-height: 0;
      }
      .sk-cal-grid .sk-cell { border-radius: 8px; }

      /* ===== Day list overlay ===== */
      .sk-day-head { height: 18px; width: 60%; border-radius: 6px; }
      .sk-day-list {
        display: flex; flex-direction: column; gap: 12px;
        flex: 1; min-height: 0;
      }
      .sk-appt {
        display: flex; gap: 12px; align-items: center;
        padding: 12px;
        border-radius: 12px;
        background: var(--sk-tint);
        border: 1px solid var(--sk-tint-bd);
        min-height: 72px;
      }
      .sk-appt .sk-icon { width: 44px; height: 44px; border-radius: 10px; flex: 0 0 auto; }
      .sk-appt .sk-lines { flex: 1; display: flex; flex-direction: column; gap: 8px; }
      .sk-appt .sk-l1 { height: 12px; width: 70%; border-radius: 6px; }
      .sk-appt .sk-l2 { height: 10px; width: 45%; border-radius: 6px; }
    `;
    const tag = document.createElement('style');
    tag.id = 'sk-overlay-style';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  /* ---------- Markup ---------- */
  function calendarOverlayHTML() {
    const weekdays = Array.from({ length: 7 },
      () => '<span class="sk-bar sk-wd"></span>').join('');
    const cells = Array.from({ length: 42 },
      () => '<span class="sk-bar sk-cell"></span>').join('');
    return `
      <div class="sk-overlay-inner">
        <div class="sk-cal-head">
          <span class="sk-bar sk-arrow"></span>
          <span class="sk-bar sk-month"></span>
          <span class="sk-bar sk-arrow"></span>
        </div>
        <div class="sk-cal-week">${weekdays}</div>
        <div class="sk-cal-grid">${cells}</div>
      </div>`;
  }

  function dayOverlayHTML(n = 4) {
    const items = Array.from({ length: n }, () => `
      <div class="sk-appt">
        <span class="sk-bar sk-icon"></span>
        <div class="sk-lines">
          <span class="sk-bar sk-l1"></span>
          <span class="sk-bar sk-l2"></span>
        </div>
      </div>`).join('');
    return `
      <div class="sk-overlay-inner">
        <span class="sk-bar sk-day-head"></span>
        <div class="sk-day-list">${items}</div>
      </div>`;
  }

  /* ---------- Helpers ---------- */
  function isEmptyStateNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const cls = (node.className && typeof node.className === 'string') ? node.className : '';
    if (/\b(empty-state|no-data|empty|placeholder-empty)\b/.test(cls)) return true;
    const txt = (node.textContent || '').trim();
    if (txt && EMPTY_TEXT_RE.test(txt) && node.children.length <= 1) return true;
    return false;
  }

  function hasRealChildren(el) {
    if (!el) return false;
    for (const k of el.children) {
      if (k.classList && (k.classList.contains('sk-overlay') ||
          k.hasAttribute('data-skeleton'))) continue;
      if (isEmptyStateNode(k)) continue;
      return true;
    }
    return false;
  }

  function dayListHasEmptyState(el) {
    if (!el) return false;
    for (const k of el.children) {
      if (k.classList && k.classList.contains('sk-overlay')) continue;
      if (isEmptyStateNode(k)) return true;
    }
    // texto do próprio container
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.sk-overlay,[data-skeleton]').forEach(n => n.remove());
    const txt = (clone.textContent || '').trim();
    if (txt && EMPTY_TEXT_RE.test(txt)) return true;
    return false;
  }

  function calendarHasRealDays() {
    const grid = document.querySelector(SEL.calDays);
    if (!grid) return false;
    for (const k of grid.children) {
      if (k.classList && k.classList.contains('sk-overlay')) continue;
      const t = (k.textContent || '').trim();
      if (t && /\d/.test(t)) return true;
    }
    return false;
  }

  function monthHasText() {
    const m = document.querySelector(SEL.monthEl);
    if (!m) return false;
    const clone = m.cloneNode(true);
    clone.querySelectorAll('.sk-overlay,[data-skeleton]').forEach(n => n.remove());
    return (clone.textContent || '').trim().length > 0;
  }

  /* ---------- Sinais explícitos da API ----------
     A página pode marcar fim do request setando uma destas flags
     (qualquer uma já libera o skeleton imediatamente):
       window.__appointmentsLoaded = true
       window.__agendaLoaded       = true
       document.body.dataset.appointmentsLoaded = "true"
       document.body.dataset.agendaLoaded       = "true"
     Ou disparando o evento:
       document.dispatchEvent(new CustomEvent('agenda:loaded'))
       document.dispatchEvent(new CustomEvent('appointments:loaded'))
  */
  let _apiDone = { calendar: false, day: false };

  function apiSignalsDay() {
    return _apiDone.day === true ||
      window.__appointmentsLoaded === true ||
      window.__agendaLoaded === true ||
      document.body?.dataset?.appointmentsLoaded === 'true' ||
      document.body?.dataset?.agendaLoaded === 'true';
  }
  function apiSignalsCalendar() {
    return _apiDone.calendar === true ||
      window.__calendarLoaded === true ||
      document.body?.dataset?.calendarLoaded === 'true';
  }

  document.addEventListener('agenda:loaded',        () => { _apiDone.day = true; checkAll(); });
  document.addEventListener('appointments:loaded',  () => { _apiDone.day = true; checkAll(); });
  document.addEventListener('calendar:loaded',      () => { _apiDone.calendar = true; checkAll(); });

  /* ---------- Sections ---------- */
  const sections = {
    calendar: {
      hostSel: SEL.calCard,
      shownAt: 0, ready: false, _overlay: null,
      makeHTML: calendarOverlayHTML,
      // Calendário: pronto se já há dias reais OU sinal explícito da API
      isReady: () => (calendarHasRealDays() && monthHasText()) || apiSignalsCalendar(),
    },
    day: {
      hostSel: SEL.dayCard,
      shownAt: 0, ready: false, _overlay: null,
      makeHTML: () => dayOverlayHTML(4),
      // Lista do dia: pronto se há itens reais, OU empty-state já renderizado,
      // OU sinal explícito da API (response vazia válida).
      isReady: () => {
        const list = document.querySelector(SEL.dayList);
        if (hasRealChildren(list)) return true;
        if (dayListHasEmptyState(list)) return true;
        if (apiSignalsDay()) return true;
        return false;
      },
    },
  };

  function ensureOverlay(name) {
    const s = sections[name];
    if (!s || s.ready) return;
    const host = document.querySelector(s.hostSel);
    if (!host) return;
    host.classList.add('sk-host');
    let ov = host.querySelector(':scope > .sk-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'sk-overlay';
      ov.setAttribute('data-skeleton', name);
      ov.innerHTML = s.makeHTML();
      host.appendChild(ov);
      if (!s.shownAt) s.shownAt = performance.now();
    }
    s._overlay = ov;
  }

  function ensureAll() { Object.keys(sections).forEach(ensureOverlay); }

  function tryHide(name) {
    const s = sections[name];
    if (!s || s.ready) return;
    if (!s.isReady()) return;
    const elapsed = performance.now() - (s.shownAt || 0);
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
    setTimeout(() => {
      const host = document.querySelector(s.hostSel);
      if (!host) return;
      const ov = host.querySelector(':scope > .sk-overlay');
      if (!ov) { s.ready = true; return; }
      ov.classList.add('sk-leaving');
      setTimeout(() => {
        try { ov.remove(); } catch (_) {}
        s.ready = true;
      }, FADE_MS + 30);
    }, wait);
  }

  function checkAll() { Object.keys(sections).forEach(tryHide); }

  function attachObservers() {
    Object.entries(sections).forEach(([name, s]) => {
      const host = document.querySelector(s.hostSel);
      if (!host || s._observed) return;
      s._observed = true;
      const mo = new MutationObserver(() => {
        if (!s.ready) ensureOverlay(name);
        tryHide(name);
      });
      mo.observe(host, { childList: true, characterData: true, subtree: true });
    });
  }

  function init() {
    injectCSS();
    ensureAll();
    attachObservers();
    let tries = 0;
    const iv = setInterval(() => {
      injectCSS();
      ensureAll();
      attachObservers();
      checkAll();
      if (++tries > 60) clearInterval(iv);
    }, 150);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  setTimeout(() => {
    Object.keys(sections).forEach(name => {
      const s = sections[name];
      s.ready = true;
      const host = document.querySelector(s.hostSel);
      const ov = host && host.querySelector(':scope > .sk-overlay');
      if (ov) ov.remove();
    });
  }, FAILSAFE_MS);

  window.__slotifySkeleton = {
    show: ensureAll,
    hide: checkAll,
    sections,
    // Sinalize fim do request — esvazia o skeleton imediatamente,
    // mesmo quando a resposta vem vazia.
    markLoaded(scope) {
      if (!scope || scope === 'all' || scope === 'day' || scope === 'appointments') _apiDone.day = true;
      if (!scope || scope === 'all' || scope === 'calendar') _apiDone.calendar = true;
      checkAll();
    },
  };

  console.log('%c✅ Skeleton Loading v7 (api-aware, empty-state instant)',
    'background:var(--gold,#6C3AED);color:#fff;padding:3px 8px;border-radius:4px;font-weight:700');
})();
