/* =====================================================================
   helpers/dashboard.js — VERSÃO INSTRUMENTADA++ (2026-06-18)
   ---------------------------------------------------------------------
   Compatível com a versão anterior. Adiciona:

   1) `aguardarDashboard` agora loga a cada 1s o estado real
      (overlay visível? #dash-faturamento existe? texto atual?),
      e ao expirar dispara Error com snapshot completo do DOM
      relevante (overlay, classes, spinners visíveis, gate do
      dashboard-loading.js, último loadDashboard call etc.).

   2) `aguardarValorEstavel` ganhou:
        - log periódico (a cada 2s) do que está lendo, para o caso
          do teste travar SEM estourar o timeout interno (ex.: quando
          o test.timeout global do Playwright mata o teste antes).
        - dump de network pendente relacionado a dashboard se o
          contexto Playwright fornecer page._client (best-effort).
   ===================================================================== */

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_INTERVAL = 250;
const DEFAULT_STABLE_HITS = 3;

function ts() { return new Date().toISOString().slice(11, 23); }

function parseMoney(text) {
  if (text == null) return NaN;
  const s = String(text).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

async function _snapshotDashboard(page) {
  try {
    return await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const overlay = q('#dashboard-loading-overlay');
      const fat = q('#dash-faturamento');
      const pend = q('#dash-pag-pendente');
      const spinners = Array.from(document.querySelectorAll(
        '.spinner, .loader, .loading, [class*="loading"], [class*="spinner"]'
      )).filter((el) => el.offsetParent !== null).map((el) => ({
        tag: el.tagName, cls: el.className, id: el.id,
      }));
      return {
        url: location.href,
        overlayVisivel: !!(overlay && overlay.offsetParent !== null),
        overlayHTML: overlay ? overlay.outerHTML.slice(0, 300) : null,
        dashFaturamentoExiste: !!fat,
        dashFaturamentoTxt: fat?.textContent ?? null,
        dashPagPendenteTxt: pend?.textContent ?? null,
        spinnersVisiveis: spinners,
        slotifyDashLoadingLoaded: !!window.__SLOTIFY_DASH_LOADING_LOADED__,
        scriptVersion: document.documentElement.getAttribute('data-script-version'),
      };
    });
  } catch (e) {
    return { snapshotError: String(e) };
  }
}

async function aguardarDashboard(page) {
  const t0 = Date.now();
  let lastLog = 0;
  console.log(`[dashboard ${ts()}] aguardarDashboard() iniciou`);
  try {
    await page.waitForFunction(() => {
      const el = document.getElementById('dashboard-loading-overlay');
      if (el && el.offsetParent !== null) return false;
      return !!document.getElementById('dash-faturamento');
    }, null, { timeout: 30000, polling: 250 });
    console.log(`[dashboard ${ts()}] aguardarDashboard() OK em ${Date.now() - t0}ms`);
  } catch (err) {
    const snap = await _snapshotDashboard(page);
    console.error(`[dashboard ${ts()}] aguardarDashboard() TIMEOUT após ${Date.now() - t0}ms\n` +
      JSON.stringify(snap, null, 2));
    throw new Error(`[aguardarDashboard] TIMEOUT: ${JSON.stringify(snap)}`);
  } finally {
    // log progressivo (não atrapalha, só ajuda se você ler stdout em tempo real)
    void lastLog;
  }
}

async function aguardarValorEstavel(page, selector, valorEsperado, opts = {}) {
  const timeout    = opts.timeout    ?? DEFAULT_TIMEOUT;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL;
  const stableHits = opts.stableHits ?? DEFAULT_STABLE_HITS;

  const inicio = Date.now();
  const leituras = [];
  let recoveries = 0;
  let hits = 0;
  let ultima = null;
  let ultimoLog = 0;

  console.log(`[aguardarValorEstavel ${ts()}] início selector=${selector} esperado=${valorEsperado} timeout=${timeout}`);

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
      if (hits >= stableHits) {
        console.log(`[aguardarValorEstavel ${ts()}] OK ${selector}=${val} em ${Date.now() - inicio}ms`);
        return val;
      }
    } else {
      hits = 0;
    }

    if (Date.now() - ultimoLog > 2000) {
      ultimoLog = Date.now();
      console.log(`[aguardarValorEstavel ${ts()}] ${selector} ultima=${ultima} hits=${hits} leituras=[${leituras.join(',')}]`);
    }

    await page.waitForTimeout(intervalMs);
  }

  // Falha enriquecida
  let testInfoTitle = '?';
  try { testInfoTitle = require('@playwright/test').test.info().title; } catch (_) {}
  const snap = await _snapshotDashboard(page);
  const diag = {
    test: testInfoTitle,
    selector,
    esperado: valorEsperado,
    leituras,
    ultima,
    recoveries,
    elapsedMs: Date.now() - inicio,
    snapshot: snap,
  };
  console.error(`\n[aguardarValorEstavel ${ts()}] TIMEOUT diagnóstico:\n` +
    JSON.stringify(diag, null, 2) + '\n');
  try {
    const { test } = require('@playwright/test');
    await test.info().attach('aguardarValorEstavel-timeout.json', {
      body: Buffer.from(JSON.stringify(diag, null, 2)),
      contentType: 'application/json',
    });
    const png = await page.screenshot({ fullPage: true }).catch(() => null);
    if (png) await test.info().attach('aguardarValorEstavel-timeout.png', { body: png, contentType: 'image/png' });
  } catch (_) {}

  throw new Error(
    `[aguardarValorEstavel] TIMEOUT após ${diag.elapsedMs}ms\n` +
    `  selector=${selector}\n` +
    `  esperado=${valorEsperado}\n` +
    `  ultima=${ultima}\n` +
    `  leituras=[${leituras.join(',')}]\n` +
    `  recoveries=${recoveries}\n` +
    `  snapshot=${JSON.stringify(snap)}`
  );
}

module.exports = { aguardarDashboard, aguardarValorEstavel };
