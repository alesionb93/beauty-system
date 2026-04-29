/* ============================================================
 * js/utils/format.js
 * --------------------------------------------------
 * Helpers puros de formatação de data.
 * Extraído de script.js (linhas 4163-4165) — Onda 1, PR #1.
 *
 * REGRAS DESTE MÓDULO:
 * - Funções 100% puras (sem DOM, sem Supabase, sem estado global).
 * - Mantém compatibilidade global (window.pad, window.formatDateInput).
 * - Também expõe via namespace BS.utils.*
 * - As MESMAS funções continuam existindo em script.js durante
 *   esta extração. A remoção das duplicatas só acontece num PR
 *   futuro, depois do SMOKE-TEST validar este PR em STG.
 * ============================================================ */
(function (root) {
  'use strict';

  root.BS = root.BS || {};
  root.BS.utils = root.BS.utils || {};

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function formatDateInput(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* 1) Namespace organizado */
  root.BS.utils.pad = pad;
  root.BS.utils.formatDateInput = formatDateInput;

  /* 2) Compatibilidade global — mantém TODOS os call-sites antigos */
  root.pad = pad;
  root.formatDateInput = formatDateInput;
})(window);
