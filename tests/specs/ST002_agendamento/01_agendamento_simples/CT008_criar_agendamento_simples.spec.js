import { test, expect } from '@playwright/test';
const { loginSlotify } = require('../../../helpers/auth');
const { log } = require('../../../helpers/logger');
const { aguardarDashboard, aguardarValorEstavel } = require('../../../helpers/dashboard');
const { diasAFrente } = require('../../../helpers/datas');

/**
 * CT008 — v3.1 (2026-06-09) — hardening de TZ/locale
 *
 * Mudanças vs v3:
 *   - Removido bloco manual `new Date() / padStart` para calcular a data.
 *     Substituído por `diasAFrente(7)` do helper centralizado, que
 *     retorna `YYYY-MM-DD` em America/Sao_Paulo independente do TZ
 *     do runner (UTC no GitHub Actions).
 *   - Nenhuma mudança em selectors, esperas funcionais ou regra.
 */
test('CT008 - Criar agendamento simples', async ({ page }) => {
  log.start('CT008');
  const dataFormatada = diasAFrente(7);

  await test.step('✅ Login realizado', async () => {
    await loginSlotify(page);
  });

  await test.step('✅ Novo agendamento aberto', async () => {
    const btnNovo = page.getByRole('button', { name: '+ Novo' });
    const abaNome = page.getByRole('tab', { name: /Nome/i });

    await btnNovo.click();
    try {
      await expect(abaNome).toBeVisible({ timeout: 4000 });
    } catch {
      await btnNovo.click();
      await expect(abaNome).toBeVisible({ timeout: 4000 });
    }
  });

  await test.step('✅ Cliente selecionado', async () => {
    await page.getByRole('tab', { name: ' Nome' }).click();
    await page.getByRole('textbox', { name: 'Digite o nome (ex: Maria)' }).fill('cliente');
    await page.getByRole('button', { name: 'Selecionar' }).first().click();
  });

  await test.step('✅ Profissional selecionado: Daryl', async () => {
    await page.locator('.svc-prof-trigger').click();
    await page.locator('.svc-prof-option[data-value="Daryl"]').click();
  });

  await test.step('✅ Serviço selecionado: Barba Terapia', async () => {
    await page.locator('.svc-servico').selectOption({ label: 'Barba Terapia' });
    await expect(page.locator('.svc-servico')).toHaveValue('Barba Terapia');
  });

  await test.step('✅ Data e horário definidos', async () => {
    await page.locator('#ag-data').fill(dataFormatada);
    await page.locator('#ag-hora-h').selectOption('20');
    await page.locator('#ag-minuto').selectOption('00');
  });

  await test.step('✅ Agendamento salvo', async () => {
    const respCriacao = page.waitForResponse(
      (r) => /agendamentos?($|\?|\/)/.test(r.url())
        && ['POST', 'PATCH', 'PUT'].includes(r.request().method()),
      { timeout: 15000 }
    ).catch(() => null);

    await page.getByRole('button', { name: 'Salvar' }).click();
    await respCriacao;
    await expect(page.getByText('Alesio Barreiro').first()).toBeVisible();
  });

  await test.step('📊 Dashboard acessado', async () => {
    await page.locator('button[data-page="dashboard"]').click();
    await aguardarDashboard(page);
  });

  await test.step('✅ Filtro de data aplicado', async () => {
    await page.locator('#dash-inicio').fill(dataFormatada);
    await page.locator('#dash-fim').fill(dataFormatada);
    await page.locator('.btn-dash-apply').click();
    await aguardarDashboard(page);
    await aguardarValorEstavel(page, '#dash-faturamento', 0);
    await aguardarValorEstavel(page, '#dash-pag-pendente', 80);
  });

  await test.step('📊 Indicadores principais validados', async () => {
    await expect(page.locator('#dash-total-ag')).toHaveText('0');
    await expect(page.locator('#dash-ticket')).toContainText('0');
    await expect(page.locator('#dash-total-servicos')).toHaveText('0');
    await expect(page.locator('#dash-faturamento')).toContainText('0');
  });

  await test.step('📊 Recebido e pendente validados', async () => {
    await expect(page.locator('#dash-pag-recebido')).toContainText('0');
    await expect(page.locator('#dash-pag-pendente')).toContainText('80');
  });

  await test.step('📊 Ausência de dados por profissional validada', async () => {
    await expect(page.locator('#dash-prof-cards-mobile')).toContainText('Sem dados');
  });

  log.finish('CT008');
});
