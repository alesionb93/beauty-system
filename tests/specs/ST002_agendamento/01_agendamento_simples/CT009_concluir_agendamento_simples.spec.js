import { test, expect } from '@playwright/test';
const { loginSlotify } = require('../../../helpers/auth');
const { log } = require('../../../helpers/logger');
const { aguardarDashboard, aguardarValorEstavel } = require('../../../helpers/dashboard');

/**
 * CT009 — v3 (2026-06-09)
 *
 * Mesmo princípio do CT008 v3:
 *   - Sem heading "Agendamentos".
 *   - Sem expect de #modal-detalhe-agendamento.
 *   - Esperamos apenas o elemento real que será usado a seguir
 *     (botão "Concluir atendimento").
 *   - Retry único do click no card caso o botão não apareça em 4s.
 */
test('CT009 - Concluir agendamento simples', async ({ page }) => {
  let dataFormatada;
  log.start('CT009');

  await test.step('✅ Login realizado', async () => {
    await loginSlotify(page);
  });

  await test.step('✅ Dia do agendamento aberto', async () => {
    const data = new Date();
    data.setDate(data.getDate() + 1);
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const diaMes = String(data.getDate()).padStart(2, '0');
    dataFormatada = `${ano}-${mes}-${diaMes}`;

    await page.getByRole('button', { name: String(data.getDate()) }).click();
    await expect(page.getByText('20:00 – 21:00')).toBeVisible();
  });

  await test.step('✅ Agendamento aberto', async () => {
    const card = page.getByText('20:00 – 21:00').first();
    const btnConcluir = page.getByRole('button', { name: /Concluir atendimento/i });

    await card.click();
    try {
      await expect(btnConcluir).toBeVisible({ timeout: 4000 });
    } catch {
      await card.click();
      await expect(btnConcluir).toBeVisible({ timeout: 4000 });
    }
  });

  await test.step('✅ Atendimento concluído', async () => {
    await page.getByRole('button', { name: /Concluir atendimento/i }).click();

    const btnConfirmar = page.locator('#btn-confirmar-concluir-atendimento');
    await expect(btnConfirmar).toBeVisible({ timeout: 10000 });
    await btnConfirmar.click();

    const respPag = page.waitForResponse(
      (r) => /agendamento_pagamentos/.test(r.url()) && r.request().method() !== 'GET',
      { timeout: 15000 }
    ).catch(() => null);

    const valorInput = page.getByRole('spinbutton');
    await expect(valorInput).toBeVisible({ timeout: 10000 });
    await valorInput.fill('80');
    await page.getByRole('button', { name: /Confirmar e concluir/i }).click();
    await respPag;
    log.payment('80,00');
  });

  await test.step('📊 Dashboard acessado', async () => {
    await page.evaluate(() => {
      try { localStorage.setItem('ff_comissoes_ativo', '1'); } catch (_) {}
    });
    await page.locator('button[data-page="dashboard"]').click();
    await aguardarDashboard(page);
  });

  await test.step('✅ Filtro de data aplicado e render estabilizado', async () => {
    await page.locator('#dash-inicio').fill(dataFormatada);
    await page.locator('#dash-fim').fill(dataFormatada);
    await page.locator('.btn-dash-apply').click();
    await aguardarDashboard(page);

    await aguardarValorEstavel(page, '#dash-faturamento', 80);

    const totalReceberCell = page.locator('#dash-prof-tbody tr:first-child td.dash-prof-cell-total-receber');
    await expect(totalReceberCell).toBeVisible({ timeout: 15000 });
    await expect(totalReceberCell).toContainText('40,00');
  });

  await test.step('📊 Indicadores principais validados', async () => {
    await expect(page.locator('#dash-total-ag')).toHaveText('1');
    await expect(page.locator('#dash-total-servicos')).toHaveText('1');
    await expect(page.locator('#dash-ticket')).toContainText('80');
    await expect(page.locator('#dash-faturamento')).toContainText('80');
  });

  await test.step('📊 Recebido e pendente validados', async () => {
    await expect(page.locator('#dash-pag-recebido')).toContainText('80');
    await expect(page.locator('#dash-pag-pendente')).toContainText('0');
  });

  await test.step('📊 Profissional Daryl validado', async () => {
    const linhaDaryl = page.locator('#dash-prof-tbody tr').first();
    await expect(linhaDaryl.locator('td:nth-child(1)')).toHaveText('Daryl');
    await expect(linhaDaryl.locator('td:nth-child(2)')).toHaveText('1');
    await expect(linhaDaryl.locator('td:nth-child(3)')).toHaveText('1');
    await expect(linhaDaryl.locator('td:nth-child(4)')).toContainText('80');
    await expect(linhaDaryl.locator('td:nth-child(5)')).toContainText('40');
    await expect(linhaDaryl.locator('td.dash-prof-cell-caixinha')).toContainText('0');
    await expect(linhaDaryl.locator('td.dash-prof-cell-total-receber')).toContainText('40');
  });

  log.finish('CT009');
});
