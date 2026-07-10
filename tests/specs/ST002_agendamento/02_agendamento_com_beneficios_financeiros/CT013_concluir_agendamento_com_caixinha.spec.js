import { test, expect } from '@playwright/test';
const { loginSlotify } = require('../../../helpers/auth');
const { log } = require('../../../helpers/logger');
const { aguardarDashboard, aguardarValorEstavel } = require('../../../helpers/dashboard');

/**
 * CT013 — v3 (2026-06-09)
 *
 * Mesma filosofia do CT009 v3:
 *   - Sem gates artificiais.
 *   - Após click no card, espera apenas o botão "Concluir atendimento"
 *     (elemento funcional da próxima ação).
 *   - Retry único do click no card.
 *   - Mantém aguardarTbodyEstavel para o dashboard (estabilidade real).
 */
async function aguardarTbodyEstavel(page, selector = '#dash-prof-tbody', min = 1, stableMs = 600, timeout = 15000) {
  await page.waitForFunction(
    ({ selector, min, stableMs }) => {
      const tbody = document.querySelector(selector);
      if (!tbody) return false;
      const count = tbody.querySelectorAll('tr').length;
      if (count < min) { window.__tbodyStableSince = 0; return false; }
      const now = Date.now();
      if (!window.__tbodyLastCount || window.__tbodyLastCount !== count) {
        window.__tbodyLastCount = count;
        window.__tbodyStableSince = now;
        return false;
      }
      return now - window.__tbodyStableSince >= stableMs;
    },
    { selector, min, stableMs },
    { timeout, polling: 100 }
  );
}

test('CT013 - Concluir agendamento com caixinha', async ({ page }) => {
  let dataFormatada;
  log.start('CT013');

  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('[CT013]') || t.includes('[CT013-TICKET]')) {
      console.log('BROWSER>', msg.type().toUpperCase(), t);
    }
  });
  page.on('pageerror', (err) => {
    console.log('BROWSER> PAGEERROR', err.message);
  });

  await test.step('✅ Login realizado', async () => {
    await loginSlotify(page);
  });

  await test.step('✅ Dia do agendamento aberto', async () => {
    const data = new Date();
    data.setDate(data.getDate() + 3);
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

    const respPag = page.waitForResponse(
      (r) => /agendamento_pagamentos/.test(r.url()) && r.request().method() !== 'GET',
      { timeout: 15000 }
    ).catch(() => null);

    await page.getByRole('spinbutton').fill('90');
    await page.getByRole('button', { name: /Confirmar e concluir/i }).click();
    await respPag;
    log.payment('90,00');
  });

  await test.step('📊 Dashboard acessado', async () => {
    await page.evaluate(() => {
      try { localStorage.setItem('ff_comissoes_ativo', '1'); } catch (_) { }
    });
    await page.locator('button[data-page="dashboard"]').click();
    await aguardarDashboard(page);
  });

  await test.step('✅ Filtro de data aplicado e render estabilizado', async () => {
    await page.locator('#dash-inicio').fill(dataFormatada);
    await page.locator('#dash-fim').fill(dataFormatada);
    await page.locator('.btn-dash-apply').click();

    await aguardarDashboard(page);
    await aguardarValorEstavel(page, '#dash-faturamento', 90);

    await aguardarTbodyEstavel(page, '#dash-prof-tbody', 1, 600, 20000);

    const linha = page.locator('#dash-prof-tbody tr').first();
    const totalReceberCell = linha.locator('td.dash-prof-cell-total-receber');

    await expect(totalReceberCell).toContainText('50', { timeout: 15000 });

    console.log('================ DEBUG CT013 ================');
    console.log('Data filtro:', dataFormatada);
    console.log('Faturamento:', await page.locator('#dash-faturamento').textContent());
    console.log('Profissional:', await linha.locator('td:nth-child(1)').textContent());
    console.log('Atendimentos:', await linha.locator('td:nth-child(2)').textContent());
    console.log('Serviços:', await linha.locator('td:nth-child(4)').textContent());
    console.log('Comissão:', await linha.locator('td:nth-child(5)').textContent());
    console.log('Caixinha:', await linha.locator('td.dash-prof-cell-caixinha').textContent());
    console.log('Total Receber:', await totalReceberCell.textContent());
    console.log('=============================================');
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
    await aguardarTbodyEstavel(page, '#dash-prof-tbody', 1, 600, 15000);
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
