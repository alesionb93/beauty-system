import { test, expect } from '@playwright/test';
const { loginSlotify } = require('../../../helpers/auth');
const { log } = require('../../../helpers/logger');

test('CT013 - Concluir agendamento com caixinha', async ({ page }) => {
  let dataFormatada;
  log.start('CT013');

  await test.step('✅ Login realizado', async () => {
    await loginSlotify(page);
  });

  await test.step('✅ Dia do agendamento aberto', async () => {
    const data = new Date();
    data.setDate(data.getDate() + 9);
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const diaMes = String(data.getDate()).padStart(2, '0');
    dataFormatada = `${ano}-${mes}-${diaMes}`;

    await page.getByRole('button', { name: String(data.getDate()) }).click();
    await expect(page.getByText('20:00 – 21:00')).toBeVisible();
  });

  await test.step('✅ Agendamento aberto', async () => {
    await page.getByText('20:00 – 21:00').click();
    await expect(page.getByText('cliente automação')).toBeVisible();
  });

  await test.step('🎁 Caixinha adicionada e atendimento concluído', async () => {
    await page.getByRole('button', { name: /Concluir atendimento/i }).click();
    await page.locator('#btn-confirmar-concluir-atendimento').click();

    await page.locator('#pag-tip-btn').click();
    await page.locator('button[data-tip="10"]').click();
    log.tip('10,00');

    await expect(page.locator('#tip-sum-atend')).toContainText('80');
    await expect(page.locator('#tip-sum-tip')).toContainText('10');
    await expect(page.locator('#tip-sum-total')).toContainText('90');

    await page.locator('#tip-confirm').click();

    await expect(page.locator('#pag-subtotal')).toContainText('80');
    await expect(page.locator('.pag-tip-row')).toContainText('10');
    await expect(page.locator('#pag-total')).toContainText('90');

    await page.getByRole('spinbutton').fill('90');
    await page.getByRole('button', { name: /Confirmar e concluir/i }).click();
    await page.waitForTimeout(3000);
    log.payment('90,00');
  });

  await test.step('📊 Dashboard acessado', async () => {
    await page.evaluate(() => {
      try { localStorage.setItem('ff_comissoes_ativo', '1'); } catch (_) {}
    });
    await page.locator('button[data-page="dashboard"]').click();
    await page.waitForTimeout(1500);
  });

  await test.step('✅ Filtro de data aplicado e render estabilizado', async () => {
    await page.locator('#dash-inicio').fill(dataFormatada);
    await page.locator('#dash-fim').fill(dataFormatada);
    await page.locator('.btn-dash-apply').click();

    const totalReceberCell = page.locator('#dash-prof-tbody tr:first-child td.dash-prof-cell-total-receber');
    await expect(totalReceberCell).toBeVisible({ timeout: 15000 });

    const colsCount = await page.locator('#dash-prof-tbody tr:first-child td').count();
    if (colsCount < 7) {
      await page.locator('.btn-dash-apply').click();
      await page.waitForTimeout(800);
    }

    await expect(totalReceberCell).toContainText('50');
    await page.waitForTimeout(2000);
  });

  await test.step('📊 Indicadores principais validados', async () => {
    await expect(page.locator('#dash-total-ag')).toHaveText('1');
    await expect(page.locator('#dash-total-servicos')).toHaveText('1');
    await expect(page.locator('#dash-ticket')).toContainText('90');
    await expect(page.locator('#dash-faturamento')).toContainText('90');
  });

  await test.step('📊 Recebido e pendente validados', async () => {
    await expect(page.locator('#dash-pag-recebido')).toContainText('90');
    await expect(page.locator('#dash-pag-pendente')).toContainText('0');
  });

  await test.step('📊 Profissional Daryl validado', async () => {
    const linhaDaryl = page.locator('#dash-prof-tbody tr').first();
    await expect(linhaDaryl.locator('td:nth-child(1)')).toHaveText('Daryl');
    await expect(linhaDaryl.locator('td:nth-child(2)')).toHaveText('1');
    await expect(linhaDaryl.locator('td:nth-child(3)')).toHaveText('1');
    await expect(linhaDaryl.locator('td:nth-child(4)')).toContainText('80');
    await expect(linhaDaryl.locator('td:nth-child(5)')).toContainText('40');
    await expect(linhaDaryl.locator('td.dash-prof-cell-caixinha')).toContainText('10');
    await expect(linhaDaryl.locator('td.dash-prof-cell-total-receber')).toContainText('50');
  });

  log.finish('CT013');
});
