// tests/specs/.../CT020_criar_agendamento_com_uso_de_pacote_existente.spec.js
// =============================================================================
// CT020 — VERSÃO INSTRUMENTADA (2026-06-18)
// -----------------------------------------------------------------------------
// Objetivo desta versão: NÃO corrigir nada. Apenas EXPOR onde o teste trava.
//
// O que foi adicionado (zero mudança no fluxo funcional):
//
//   1) `step()` wrapper que loga início/fim/duração de cada etapa em stdout
//      e como anexo do Playwright report. Se uma etapa estourar, o log
//      anterior mostra exatamente onde parou.
//
//   2) Watchdog: a 3 s do timeout global do teste, faz screenshot + dump
//      do estado da página (overlays abertos, modais ativos, requests em
//      voo, console errors acumulados, valor de #ag-data, classes do
//      #modal-identificacao, presença do #dashboard-loading-overlay, etc.)
//      e anexa tudo ao report. Assim você descobre o estado real no
//      momento do travamento, ANTES do Playwright matar a página.
//
//   3) Captura de rede filtrada por endpoints relevantes (agendamentos,
//      dashboard, pacotes, cliente, units, tenant) com método, status,
//      duração e tamanho de payload.
//
//   4) Listeners de `console` e `pageerror` da app — qualquer erro JS
//      durante o teste aparece no report com timestamp.
//
//   5) Timeout do test elevado para 90 s SÓ para esta execução
//      diagnóstica. Isto NÃO é a correção definitiva — é para o teste
//      conseguir terminar e o watchdog conseguir coletar evidência caso
//      a falha esteja em uma etapa tardia (dashboard / cliente / pacotes).
//      Quando a causa raiz for identificada e corrigida, REMOVA esta
//      linha e volte aos 30 s padrão.
// =============================================================================

import { test, expect } from '@playwright/test';
const { loginSlotify } = require('../../../helpers/auth');
const { abrirNovoAgendamento, locTabNome } = require('../../../helpers/agendamento');
const { log } = require('../../../helpers/logger');
const { aguardarDashboard, aguardarValorEstavel } = require('../../../helpers/dashboard');

// --- Timeout estendido APENAS para esta execução diagnóstica. -----------------
test.setTimeout(90_000);

// --- Util: timestamp curto para os logs ---------------------------------------
const ts = () => new Date().toISOString().slice(11, 23);

// --- Wrapper de step com timing + log estruturado -----------------------------
async function stepLog(testCtx, name, fn) {
  const t0 = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[CT020 ${ts()}] ▶ INÍCIO  : ${name}`);
  try {
    const result = await testCtx.step(name, fn);
    const dur = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[CT020 ${ts()}] ✅ FIM     : ${name} (${dur}ms)`);
    return result;
  } catch (err) {
    const dur = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.error(`[CT020 ${ts()}] ❌ FALHA   : ${name} após ${dur}ms — ${err && err.message}`);
    throw err;
  }
}

// --- Captura de rede / console / erros ----------------------------------------
function attachDiagnostics(page, state) {
  const REL = /(agendament|dashboard|pacote|cliente|unit|tenant|saldo|faturamento)/i;

  page.on('request', (req) => {
    if (!REL.test(req.url())) return;
    state.inflight.set(req, { url: req.url(), method: req.method(), t0: Date.now() });
    // eslint-disable-next-line no-console
    console.log(`[CT020 ${ts()}] →  ${req.method().padEnd(6)} ${req.url()}`);
  });
  page.on('response', async (res) => {
    const req = res.request();
    const meta = state.inflight.get(req);
    if (!meta) return;
    state.inflight.delete(req);
    const dur = Date.now() - meta.t0;
    let sz = '?';
    try { sz = (await res.body()).length; } catch (_) { /* navegação/redirect */ }
    state.network.push({ method: meta.method, url: meta.url, status: res.status(), durMs: dur, bytes: sz });
    // eslint-disable-next-line no-console
    console.log(`[CT020 ${ts()}] ←  ${res.status()} ${meta.method} ${meta.url} (${dur}ms, ${sz}B)`);
  });
  page.on('requestfailed', (req) => {
    if (!REL.test(req.url())) return;
    state.inflight.delete(req);
    state.failed.push({ url: req.url(), method: req.method(), failure: req.failure()?.errorText });
    // eslint-disable-next-line no-console
    console.warn(`[CT020 ${ts()}] ✖  FAIL   ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      state.consoleMsgs.push({ ts: ts(), type, text: msg.text() });
    }
  });
  page.on('pageerror', (err) => {
    state.pageErrors.push({ ts: ts(), message: err.message, stack: err.stack });
    // eslint-disable-next-line no-console
    console.error(`[CT020 ${ts()}] 💥 pageerror: ${err.message}`);
  });
}

// --- Watchdog: captura estado pouco antes do timeout do teste -----------------
async function armWatchdog(page, testInfo, state, msAntesDoFim = 3000) {
  const total = testInfo.timeout || 30_000;
  const delay = Math.max(1000, total - msAntesDoFim);
  return setTimeout(async () => {
    try {
      const snapshot = await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const overlay = q('#dashboard-loading-overlay');
        const modalId = q('#modal-identificacao');
        const ag = q('#ag-data');
        const spinners = Array.from(document.querySelectorAll(
          '.spinner, .loader, .loading, [class*="loading"], [class*="spinner"]'
        )).filter((el) => el.offsetParent !== null).map((el) => ({
          tag: el.tagName, cls: el.className, id: el.id,
        }));
        return {
          url: location.href,
          scriptVersion: document.documentElement.getAttribute('data-script-version'),
          dashboardOverlayVisible: !!(overlay && overlay.offsetParent !== null),
          modalIdentificacaoClasses: modalId?.className ?? null,
          agDataValue: ag?.value ?? null,
          activeElement: document.activeElement?.outerHTML?.slice(0, 200) ?? null,
          spinnersVisiveis: spinners,
          dashFaturamentoText: q('#dash-faturamento')?.textContent ?? null,
          dashPagPendenteText: q('#dash-pag-pendente')?.textContent ?? null,
        };
      }).catch((e) => ({ evaluateError: String(e) }));

      const inflight = Array.from(state.inflight.values()).map((m) => ({
        method: m.method, url: m.url, ageMs: Date.now() - m.t0,
      }));

      const dump = {
        watchdogFiredAt: ts(),
        snapshot,
        inflightRequests: inflight,
        networkRecent: state.network.slice(-15),
        networkFailed: state.failed,
        pageErrors: state.pageErrors,
        consoleErrorsTail: state.consoleMsgs.slice(-25),
      };
      // eslint-disable-next-line no-console
      console.error(`[CT020 ${ts()}] 🐶 WATCHDOG dump:\n` + JSON.stringify(dump, null, 2));

      await testInfo.attach('ct020-watchdog.json', {
        body: Buffer.from(JSON.stringify(dump, null, 2)),
        contentType: 'application/json',
      });
      const png = await page.screenshot({ fullPage: true }).catch(() => null);
      if (png) {
        await testInfo.attach('ct020-watchdog.png', { body: png, contentType: 'image/png' });
      }
      const html = await page.content().catch(() => null);
      if (html) {
        await testInfo.attach('ct020-watchdog.html', {
          body: Buffer.from(html), contentType: 'text/html',
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[CT020] watchdog falhou:', e);
    }
  }, delay);
}

// =============================================================================
// SPEC
// =============================================================================
test('CT020 - Criar agendamento com uso de pacote existente', async ({ page }, testInfo) => {
  let dataFormatada;
  let dataExpiracao;
  log.start('CT020');

  const state = {
    inflight: new Map(),
    network: [],
    failed: [],
    consoleMsgs: [],
    pageErrors: [],
  };
  attachDiagnostics(page, state);
  const watchdogHandle = await armWatchdog(page, testInfo, state, 3000);

  try {
    await stepLog(test, '✅ Login realizado', async () => {
      await loginSlotify(page);
    });

    await stepLog(test, '✅ Novo agendamento aberto', async () => {
      await abrirNovoAgendamento(page);
    });

    await stepLog(test, '✅ Cliente automação selecionado', async () => {
      await locTabNome(page).click();
      await expect(page.locator('#id-panel-nome')).toBeVisible();
      await page.locator('#id-nome').fill('cliente');
      const btnSelecionar = page.getByRole('button', { name: 'Selecionar' }).first();
      await expect(btnSelecionar).toBeVisible({ timeout: 10000 });
      await btnSelecionar.click();
    });

    await stepLog(test, '✅ Profissional selecionado: Daryl', async () => {
      await page.locator('.svc-prof-trigger').click();
      await page.locator('.svc-prof-option[data-value="Daryl"]').click();
    });

    await stepLog(test, '✅ Serviço selecionado: Barba Completa', async () => {
      await page.locator('.svc-servico').selectOption({ label: 'Barba Completa' });
      await expect(page.locator('.svc-servico')).toHaveValue('Barba Completa');
    });

    await stepLog(test, '📦 Pacote disponível validado e selecionado', async () => {
      const pacoteUso = page.locator('.pacote-checkbox[data-pacote-acao="usar"]');
      const cardPacote = pacoteUso.locator('xpath=ancestor::label');
      await expect(cardPacote).toContainText('3 restantes', { timeout: 10000 });
      await pacoteUso.check();
      log.info('Pacote barba x4 utilizado (saldo atual 3)');
    });

    await stepLog(test, '✅ Data e horário definidos', async () => {
      const data = new Date();
      data.setDate(data.getDate() + 7);
      const ano = data.getFullYear();
      const mes = String(data.getMonth() + 1).padStart(2, '0');
      const dia = String(data.getDate()).padStart(2, '0');
      dataFormatada = `${ano}-${mes}-${dia}`;

      const expiracao = new Date();
      expiracao.setDate(expiracao.getDate() + 42);
      dataExpiracao =
        `${String(expiracao.getDate()).padStart(2, '0')}/` +
        `${String(expiracao.getMonth() + 1).padStart(2, '0')}/` +
        `${expiracao.getFullYear()}`;

      await page.locator('#ag-data').fill(dataFormatada);
      await page.locator('#ag-hora-h').selectOption('20');
      await page.locator('#ag-minuto').selectOption('00');
      console.log(`[CT020 ${ts()}]    dataFormatada=${dataFormatada} dataExpiracao=${dataExpiracao}`);
    });

    await stepLog(test, '✅ Agendamento salvo', async () => {
      // INSTRUMENTAÇÃO: capturamos QUALQUER POST/PATCH/PUT que contenha
      // "agendament" (cobre /agendamentos, /units/X/agendamentos,
      // /tenant-groups/Y/agendamentos, etc., introduzidos por Multi-Unit).
      const respAgPromise = page.waitForResponse(
        (r) => /agendament/i.test(r.url()) &&
               ['POST', 'PATCH', 'PUT'].includes(r.request().method()),
        { timeout: 15000 }
      ).then((r) => {
        console.log(`[CT020 ${ts()}]    waitForResponse RESOLVEU: ${r.request().method()} ${r.url()} → ${r.status()}`);
        return r;
      }).catch((e) => {
        console.error(`[CT020 ${ts()}]    waitForResponse NÃO resolveu em 15s: ${e.message}`);
        throw e;
      });

      console.log(`[CT020 ${ts()}]    clicando Salvar...`);
      await page.getByRole('button', { name: 'Salvar' }).click();
      console.log(`[CT020 ${ts()}]    Salvar clicado, aguardando resposta de backend...`);

      const response = await respAgPromise;
      expect(response.ok()).toBeTruthy();
    });

    await stepLog(test, '📊 Dashboard acessado', async () => {
      await page.locator('button[data-page="dashboard"]').click();
      console.log(`[CT020 ${ts()}]    aguardarDashboard()...`);
      await aguardarDashboard(page);
    });

    await stepLog(test, '✅ Filtro aplicado', async () => {
      await page.locator('#dash-inicio').fill(dataFormatada);
      await page.locator('#dash-fim').fill(dataFormatada);
      console.log(`[CT020 ${ts()}]    clicando Aplicar filtro...`);
      await page.locator('.btn-dash-apply').click();
      await aguardarDashboard(page);
      console.log(`[CT020 ${ts()}]    aguardando #dash-faturamento estabilizar em 0...`);
      await aguardarValorEstavel(page, '#dash-faturamento', 0, { timeout: 15000 });
      console.log(`[CT020 ${ts()}]    aguardando #dash-pag-pendente estabilizar em 0...`);
      await aguardarValorEstavel(page, '#dash-pag-pendente', 0, { timeout: 15000 });
    });

    await stepLog(test, '📊 Dashboard zerado validado', async () => {
      await expect(page.locator('#dash-total-ag')).toHaveText('0');
      await expect(page.locator('#dash-total-servicos')).toHaveText('0');
      await expect(page.locator('#dash-ticket')).toContainText('0');
      await expect(page.locator('#dash-faturamento')).toContainText('0');
      await expect(page.locator('#dash-pag-recebido')).toContainText('0');
      await expect(page.locator('#dash-pag-pendente')).toContainText('0');
    });

    await stepLog(test, '👤 Módulo clientes acessado', async () => {
      await page.locator('button[data-page="clientes"]').click();
      await expect(page.locator('#clients-search-input')).toBeVisible();
    });

    await stepLog(test, '👤 Cliente automação localizado', async () => {
      await page.locator('#clients-search-input').fill('cliente automação');
      const linhaCliente = page
        .locator('.cell-value-name')
        .filter({ hasText: 'cliente automação' })
        .first();
      await linhaCliente.click();
    });

    await stepLog(test, '📦 Aba pacotes acessada', async () => {
      await page.locator('button[data-hist-tab="pacotes"]').click();
    });

    await stepLog(test, '📦 Saldo do pacote preservado', async () => {
      const listaPacotes = page.locator('[data-hist-pane="pacotes"] ul.historico-lista');
      const itemPacote = listaPacotes.locator('li').first();
      await expect(itemPacote).toContainText('Pacote barba x4', { timeout: 15000 });
      await expect(itemPacote).toContainText('Barba Completa');
      await expect(itemPacote).toContainText('1/4');
      await expect(itemPacote).toContainText('restam 3');
      await expect(itemPacote.locator('.hist-status-badge')).toContainText(/ATIVO/i);
      log.info('Saldo mantido em 1/4 utilizado e 3 restantes');
    });

    log.finish('CT020');
  } finally {
    clearTimeout(watchdogHandle);
    // Anexa o resumo de rede mesmo em caso de sucesso, ajuda a calibrar.
    try {
      await testInfo.attach('ct020-network-summary.json', {
        body: Buffer.from(JSON.stringify({
          totalRequests: state.network.length,
          inflightAoFim: Array.from(state.inflight.values()).map((m) => ({
            method: m.method, url: m.url, ageMs: Date.now() - m.t0,
          })),
          falhas: state.failed,
          pageErrors: state.pageErrors,
          consoleErrosTail: state.consoleMsgs.slice(-25),
          network: state.network,
        }, null, 2)),
        contentType: 'application/json',
      });
    } catch (_) { /* ignore */ }
  }
});
