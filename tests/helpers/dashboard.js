/* =====================================================================
   helpers/dashboard.js — VERSÃO INSTRUMENTADA (temporária)
   ---------------------------------------------------------------------
   Substitua o seu helpers/dashboard.js por este arquivo enquanto
   investiga CT011/CT015. A instrumentação imprime, ANTES de lançar
   timeout:

       [aguardarValorEstavel]
         test     = <nome do teste>
         selector = #dash-faturamento
         esperado = 70
         leituras = [80,80,80,80,80,80,80,80,80,80]
         ultima   = 80
         recoveries = 0
         elapsedMs  = 30000

   Não muda nenhum comportamento — apenas decora o erro com contexto.
   Remova depois que o bug for resolvido.
   ===================================================================== */

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_INTERVAL = 250;
const DEFAULT_STABLE_HITS = 3;

function parseMoney(text) {
  if (text == null) return NaN;
  const s = String(text).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

async function aguardarDashboard(page) {
  // Espera o overlay/loader do dashboard sumir.
  // Se o seu projeto tiver outro contrato, ajuste aqui.
  await page.waitForFunction(() => {
    const el = document.getElementById('dashboard-loading-overlay');
    if (el && el.offsetParent !== null) return false;
    return !!document.getElementById('dash-faturamento');
  }, null, { timeout: 30000 });
}

/**
 * Aguarda o conteúdo de `selector` convergir para `valorEsperado` (numérico)
 * e permanecer estável por N leituras consecutivas.
 *
 * INSTRUMENTAÇÃO: ao expirar, lança um Error com payload diagnóstico
 * detalhado (selector, esperado, leituras, ultima, recoveries, elapsedMs).
 */
async function aguardarValorEstavel(page, selector, valorEsperado, opts = {}) {
  const timeout    = opts.timeout    ?? DEFAULT_TIMEOUT;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL;
  const stableHits = opts.stableHits ?? DEFAULT_STABLE_HITS;

  const inicio = Date.now();
  const leituras = [];         // ring buffer das últimas 12 leituras
  let recoveries = 0;
  let hits = 0;
  let ultima = null;

  while (Date.now() - inicio < timeout) {
    let raw = null;
    try {
      raw = await page.locator(selector).first().textContent({ timeout: 1000 });
    } catch (_) {
      raw = null;
      recoveries++;
    }
    const val = parseMoney(raw);
    ultima = val;
    leituras.push(val);
    if (leituras.length > 12) leituras.shift();

    if (Number.isFinite(val) && Math.abs(val - Number(valorEsperado)) < 0.005) {
      hits++;
      if (hits >= stableHits) return val; // estabilizou
    } else {
      hits = 0;
    }
    await page.waitForTimeout(intervalMs);
  }

  // -------- INSTRUMENTAÇÃO: falha enriquecida --------
  const testInfo = (() => {
    try { return require('@playwright/test').test.info().title; } catch (_) { return '?'; }
  })();
  const diag = {
    test:       testInfo,
    selector,
    esperado:   valorEsperado,
    leituras,
    ultima,
    recoveries,
    elapsedMs:  Date.now() - inicio,
  };
  // Log estruturado (aparece no relatório do Playwright e no stdout)
  console.error('\n[aguardarValorEstavel] TIMEOUT diagnóstico:\n' +
    JSON.stringify(diag, null, 2) + '\n');

  // Anexa também ao Playwright report
  try {
    const { test } = require('@playwright/test');
    await test.info().attach('aguardarValorEstavel-timeout.json', {
      body: Buffer.from(JSON.stringify(diag, null, 2)),
      contentType: 'application/json',
    });
  } catch (_) {}

  throw new Error(
    `[aguardarValorEstavel] TIMEOUT após ${diag.elapsedMs}ms\n` +
    `  selector=${selector}\n` +
    `  esperado=${valorEsperado}\n` +
    `  ultima=${ultima}\n` +
    `  leituras=[${leituras.join(',')}]\n` +
    `  recoveries=${recoveries}`
  );
}

module.exports = { aguardarDashboard, aguardarValorEstavel };
