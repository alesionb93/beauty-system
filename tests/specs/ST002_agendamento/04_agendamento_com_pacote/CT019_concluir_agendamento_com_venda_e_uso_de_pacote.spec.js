import { test, expect } from '@playwright/test';
const { loginSlotify } = require('../../../helpers/auth');
const { log } = require('../../../helpers/logger');
const { aguardarDashboard } = require('../../../helpers/dashboard');

/**
 * CT019 — Concluir agendamento com venda e uso de pacote
 *
 * Estratégia anti-race-condition no dashboard:
 *  1) Após "Concluir atendimento" + pagamento, sincronizamos via waitForResponse
 *     no endpoint de pagamentos (sem gate de modal).
 *  2) Ao abrir o dashboard e clicar em Aplicar, usamos `aguardarDashboard`.
 *  3) Validamos faturamento com `aguardarValorEstavel` (re-click "Aplicar"
 *     se não estabilizar dentro do prazo).
 */

const VALOR_VENDA = 150;

async function lerValorBRL(locator) {
  const texto = (await locator.textContent()) || '';
  const limpo = texto.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}

async function aguardarValorEstavel(page, locator, esperado, opts = {}) {
  const totalTimeout = opts.timeout ?? 45000;
  const intervalo = opts.intervalo ?? 400;
  const reclickAposMs = opts.reclickAposMs ?? 12000;
  const maxReclicks = opts.maxReclicks ?? 2;

  const inicio = Date.now();
  let ultimo = null;
  let antepenultimo = null;
  let reclicks = 0;
  let proximoReclick = inicio + reclickAposMs;

  while (Date.now() - inicio < totalTimeout) {
    const atual = await lerValorBRL(locator);

    if (atual === esperado && antepenultimo === esperado && ultimo === esperado) {
      return atual;
    }

    antepenultimo = ultimo;
    ultimo = atual;

    if (Date.now() >= proximoReclick && reclicks < maxReclicks) {
      reclicks += 1;
      log.info(
        `Valor instável (último=${atual}, esperado=${esperado}). ` +
          `Re-clicando "Aplicar" (tentativa ${reclicks}/${maxReclicks}).`
      );
      await page.locator('.btn-dash-apply').click({ force: true });
      await aguardarDashboard(page).catch(() => {});
      proximoReclick = Date.now() + reclickAposMs;
      antepenultimo = null;
      ultimo = null;
    }

    await page.waitForTimeout(intervalo);
  }

  throw new Error(
    `Timeout aguardando #dash-faturamento estabilizar em R$ ${esperado},00. ` +
      `Última leitura: ${ultimo}. Re-clicks: ${reclicks}.`
  );
}

test('CT019 - Concluir agendamento com venda e uso de pacote', async ({ page }) => {
  let dataFormatada;
  let dataExpiracao;

  log.start('CT019');

  await test.step('✅ Login realizado', async () => {
    await loginSlotify(page);
  });

  await test.step('✅ Dia do agendamento aberto', async () => {
    const data = new Date();
    data.setDate(data.getDate() + 12);

    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const diaMes = String(data.getDate()).padStart(2, '0');
    dataFormatada = `${ano}-${mes}-${diaMes}`;

    const expiracao = new Date(data);
    expiracao.setDate(expiracao.getDate() + 30);
    dataExpiracao =
      `${String(expiracao.getDate()).padStart(2, '0')}/` +
      `${String(expiracao.getMonth() + 1).padStart(2, '0')}/` +
      `${expiracao.getFullYear()}`;

    await page.getByRole('button', { name: String(data.getDate()) }).click();
    await expect(page.getByText('20:00 – 20:30')).toBeVisible();
  });

  await test.step('✅ Agendamento aberto', async () => {
    const card = page.getByText('20:00 – 20:30');
    const pacoteUso = page.locator('.pacote-checkbox[data-pacote-acao="usar"]');
    await card.click();
    try {
      await expect(pacoteUso).toBeVisible({ timeout: 4000 });
    } catch {
      await card.click();
      await expect(pacoteUso).toBeVisible({ timeout: 4000 });
    }
  });

  await test.step('📦 Pacote disponível validado e utilizado', async () => {
    const pacoteUso = page.locator('.pacote-checkbox[data-pacote-acao="usar"]');
    const cardPacote = pacoteUso.locator('xpath=ancestor::label');
    await expect(cardPacote).toContainText('4 restantes');

    await pacoteUso.check();
    log.info('Pacote barba x4 utilizado');
  });

  await test.step('✅ Atendimento concluído', async () => {
    await page.getByRole('button', { name: /Concluir atendimento/i }).click();
    await page.locator('#btn-confirmar-concluir-atendimento').click();

    // Espera direta no input do modal (sem gate de visibilidade do modal).
    const campoValor = page.locator('#modal-pagamento-ag #pag-formas-list input.pag-valor').first();
    await expect(campoValor).toBeVisible({ timeout: 10000 });
    await campoValor.fill(String(VALOR_VENDA));

    const btnConfirmar = page.locator('#pag-confirmar');
    await expect(btnConfirmar).toBeEnabled({ timeout: 5000 });

    const respPagamento = page
      .waitForResponse(
        (r) =>
          /agendamento_pagamentos/.test(r.url()) &&
          ['POST', 'PATCH'].includes(r.request().method()) &&
          r.status() < 400,
        { timeout: 15000 }
      )
      .catch(() => null);

    await btnConfirmar.click();
    await respPagamento;
    log.payment('150,00');
  });

  await test.step('📊 Dashboard acessado', async () => {
    await page.evaluate(() => {
      try {
        localStorage.setItem('ff_comissoes_ativo', '1');
      } catch (_) {}
    });

    await page.locator('button[data-page="dashboard"]').click();
    await aguardarDashboard(page);
  });

  await test.step('✅ Filtro de data aplicado e render estabilizado', async () => {
    await page.locator('#dash-inicio').fill(dataFormatada);
    await page.locator('#dash-fim').fill(dataFormatada);
    await page.locator('.btn-dash-apply').click();
    await aguardarDashboard(page);

    // Garante que a tabela de profissionais renderizou o valor.
    const totalReceber = page.locator(
      '#dash-prof-tbody tr:first-child td.dash-prof-cell-total-receber'
    );
    await expect(totalReceber).not.toBeEmpty({ timeout: 15000 });

    await aguardarValorEstavel(
      page,
      page.locator('#dash-faturamento'),
      VALOR_VENDA,
      { timeout: 45000 }
    );
  });

  await test.step('📊 Indicadores principais validados', async () => {
    await expect(page.locator('#dash-total-ag')).toHaveText('1');
    await expect(page.locator('#dash-total-servicos')).toHaveText('1');
    await expect(page.locator('#dash-ticket')).toContainText('150');
    await expect(page.locator('#dash-faturamento')).toContainText('150');
  });

  await test.step('📊 Recebido e pendente validados', async () => {
    await expect(page.locator('#dash-pag-recebido')).toContainText('150');
    await expect(page.locator('#dash-pag-pendente')).toContainText('0');
  });

  await test.step('📊 Profissional Daryl validado', async () => {
    const linhaDaryl = page.locator('#dash-prof-tbody tr').first();
    await expect(linhaDaryl.locator('td:nth-child(1)')).toHaveText('Daryl');
    await expect(linhaDaryl.locator('td:nth-child(2)')).toHaveText('1');
    await expect(linhaDaryl.locator('td:nth-child(3)')).toHaveText('1');
    await expect(linhaDaryl.locator('td:nth-child(4)')).toContainText('150');
  });

  await test.step('👤 Módulo clientes acessado', async () => {
    await page.locator('button[data-page="clientes"]').click();
    await expect(page.locator('#clients-search-input')).toBeVisible();
  });

  await test.step('👤 Cliente automação localizado', async () => {
    await page.locator('#clients-search-input').fill('cliente automação');

    const linhaCliente = page
      .locator('.cell-value-name')
      .filter({ hasText: 'cliente automação' })
      .first();

    await linhaCliente.click();
  });

  await test.step('📦 Aba pacotes acessada', async () => {
    await page.locator('button[data-hist-tab="pacotes"]').click();
  });

  await test.step('📦 Pacote atualizado validado', async () => {
    const listaPacotes = page.locator('[data-hist-pane="pacotes"] #pacotes-cliente-conteudo ul.historico-lista');
    const itemPacote = listaPacotes.locator('li').first();

    await expect(
      itemPacote.locator('.hist-item-body strong').first()
    ).toHaveText('Pacote barba x4', { timeout: 15000 });

    await expect(itemPacote).toContainText('Barba Completa');
    await expect(itemPacote).toContainText('1/4');
    await expect(itemPacote).toContainText('restam 3');
    await expect(itemPacote.locator('.hist-status-badge')).toContainText(/ATIVO/i);
    await expect(itemPacote).toContainText(dataExpiracao);

    log.info('Pacote atualizado para 1/4');
  });

  log.finish('CT019');
});
