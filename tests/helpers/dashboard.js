/**
 * helpers/dashboard.js  (v3 — 2026-06-08)
 *
 * Sincronização robusta do Dashboard do Slotify para Playwright.
 *
 * Causa raiz corrigida:
 *   - `.dash-loading-card` fica permanentemente no DOM e continua com
 *     display:flex / opacity:1 mesmo quando o loader está oculto.
 *   - Quem fica invisível é o pai `#dash-loading-overlay` via opacity:0.
 *   - Portanto esperar `.dash-loading-card` ficar hidden/visível é uma
 *     condição incorreta e pode prender o waitForFunction até timeout.
 *
 * Regra funcional:
 *   - Se o Dashboard estiver processando, aguarda terminar.
 *   - Se o Dashboard já estiver pronto, segue sem esperar o loader aparecer.
 *
 * Uso:
 *   const { aguardarDashboard } = require('../../../helpers/dashboard');
 *   await page.locator('button[data-page="dashboard"]').click();
 *   await aguardarDashboard(page);
 *
 *   await page.locator('.btn-dash-apply').click();
 *   await aguardarDashboard(page);
 */

async function aguardarDashboard(page, opts = {}) {
  const timeout = opts.timeout ?? opts.hiddenTimeout ?? 20000;
  const polling = opts.polling ?? 50;
  const stableMs = opts.stableMs ?? 120;

  await page.waitForFunction(
    () => {
      const el = document.getElementById('page-dashboard');
      if (!el) return false;

      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      );
    },
    null,
    { timeout, polling }
  );

  await page.evaluate(() => {
    window.__slotifyDashReadySince = 0;
  });

  try {
    await page.waitForFunction(
      ({ stableMs }) => {
        function isVisibleBox(el) {
          if (!el) return false;

          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const opacity = Number.parseFloat(style.opacity || '1');

          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            opacity > 0.01 &&
            rect.width > 0 &&
            rect.height > 0
          );
        }

        function overlayIsVisible() {
          const overlay = document.getElementById('dash-loading-overlay');
          if (overlay) return isVisibleBox(overlay);

          // Fallback para versões antigas: o card existe sempre, então
          // a visibilidade precisa considerar também os ancestrais.
          const card = document.querySelector('.dash-loading-card');
          if (!card) return false;

          let el = card;
          while (el && el.nodeType === 1) {
            if (!isVisibleBox(el)) return false;
            el = el.parentElement;
          }

          return true;
        }

        function dashboardIsBusy() {
          const dash = document.getElementById('page-dashboard');
          if (!dash) return true;
          if (dash.classList.contains('is-recalculating')) return true;
          if (overlayIsVisible()) return true;
          return false;
        }

        const busy = dashboardIsBusy();
        const now = performance.now();

        if (busy) {
          window.__slotifyDashReadySince = 0;
          return false;
        }

        if (!window.__slotifyDashReadySince) {
          window.__slotifyDashReadySince = now;
        }

        return now - window.__slotifyDashReadySince >= stableMs;
      },
      { stableMs },
      { timeout, polling }
    );
  } catch (err) {
    const state = await obterEstadoDashboard(page);
    throw new Error(
      'Timeout ao aguardar o Dashboard ficar pronto. Estado observado: ' +
        JSON.stringify(state)
    );
  }

  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
}

async function obterEstadoDashboard(page) {
  return page.evaluate(() => {
    function snapshot(el) {
      if (!el) return null;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        exists: true,
        className: el.className || '',
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }

    const dash = document.getElementById('page-dashboard');
    const overlay = document.getElementById('dash-loading-overlay');
    const card = document.querySelector('.dash-loading-card');

    return {
      dashboard: snapshot(dash),
      overlay: snapshot(overlay),
      card: snapshot(card),
      isRecalculating: Boolean(dash && dash.classList.contains('is-recalculating')),
      readySince: window.__slotifyDashReadySince || 0,
    };
  });
}

module.exports = { aguardarDashboard, obterEstadoDashboard };