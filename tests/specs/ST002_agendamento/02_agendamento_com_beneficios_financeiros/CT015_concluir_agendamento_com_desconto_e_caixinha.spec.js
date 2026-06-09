import { test, expect } from '@playwright/test';
const { loginSlotify } = require('../../../helpers/auth');
const { log } = require('../../../helpers/logger');
const { aguardarDashboard, aguardarValorEstavel } = require('../../../helpers/dashboard');

/**
 * CT015 — v3 (2026-06-09)
 *
 * Mesma filosofia do CT009 v3 (concluir agendamento).
 */
test('CT015 - Concluir agendamento com desconto e caixinha', async ({ page }) => {
  let dataFormatada;
  log.start('CT015');

  await test.step('✅ Login realizado', async () => {
    await loginSlotify(page);
  });

  await test.step('✅ Dia do agendamento aberto', async () => {
    const data = new Date();
    data.setDate(data.getDate() + 10);

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

  await test.step('💰🎁 Desconto e caixinha aplicados', async () => {
    await page.getByRole('button', { name: /Concluir atendimento/i }).click();
    await page.locator('#btn-confirmar-concluir-atendimento').click();

    // ===== DESCONTO =====
    await page.locator('#desc-apply-btn').click();
    await page.locator('input[name="identifier"]').fill('automacao');
    await page.locator('input[name="password"]').fill('Aranjiex22@@');
    await page.locator('button[data-action="confirm"]').click();
    await page.locator('#desc-valor-input').fill('10');
    log.discount('10,00');

    await expect(page.locator('#desc-prev-orig')).toContainText('80');
    await expect(page.locator('#desc-prev-desc')).toContainText('10');
    await expect(page.locator('#desc-prev-final')).toContainText('70');

    await page.locator('#desc-confirmar').click();

    // ===== CAIXINHA =====
    await page.locator('#pag-tip-btn').click();
    await page.locator('button[data-tip="10"]').click();
    log.tip('10,00');

    await expect(page.locator('#tip-sum-atend')).toContainText('70');
    await expect(page.locator('#tip-sum-tip')).toContainText('10');
    await expect(page.locator('#tip-sum-total')).toContainText('80');

    await page.locator('#tip-confirm').click();

    // ===== RESUMO =====
    await expect(page.locator('#pag-subtotal')).toContainText('80');
    await expect(page.locator('#pag-desc-val')).toContainText('10');
    await expect(page.locator('.pag-tip-row')).toContainText('10');
    await expect(page.locator('#pag-total')).toContainText('80');

    // ===== PAGAMENTO (sincroniza com persistência real) =====
    const respPag = page.waitForResponse(
      (r) => /agendamento_pagamentos/.test(r.url()) && r.request().method() !== 'GET',
      { timeout: 15000 }
    ).catch(() => null);

    await page.getByRole('spinbutton').fill('80');
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

  await test.step('✅ Filtro aplicado e render estabilizado', async () => {
    await page.locator('#dash-inicio').fill(dataFormatada);
    await page.locator('#dash-fim').fill(dataFormatada);
    await page.locator('.btn-dash-apply').click();
    await aguardarDashboard(page);

    await aguardarValorEstavel(page, '#dash-faturamento', 80);

    const totalReceberCell = page.locator(
      '#dash-prof-tbody tr:first-child td.dash-prof-cell-total-receber'
    );
    await expect(totalReceberCell).toContainText('45', { timeout: 15000 });
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
    await expect(linhaDaryl.locator('td:nth-child(4)')).toContainText('70');
    await expect(linhaDaryl.locator('td:nth-child(5)')).toContainText('35');
    await expect(linhaDaryl.locator('td.dash-prof-cell-caixinha')).toContainText('10');
    await expect(linhaDaryl.locator('td.dash-prof-cell-total-receber')).toContainText('45');
  });

  log.finish('CT015');
});
