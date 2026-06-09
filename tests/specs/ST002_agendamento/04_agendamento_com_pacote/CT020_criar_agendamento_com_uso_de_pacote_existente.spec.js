import { test, expect } from '@playwright/test';
const { loginSlotify } = require('../../../helpers/auth');
const { log } = require('../../../helpers/logger');
const { aguardarDashboard, aguardarValorEstavel } = require('../../../helpers/dashboard');

test('CT020 - Criar agendamento com uso de pacote existente', async ({ page }) => {
  let dataFormatada;
  let dataExpiracao;
  log.start('CT020');

  await test.step('✅ Login realizado', async () => {
    await loginSlotify(page);
  });

  await test.step('✅ Novo agendamento aberto', async () => {
    await page.getByRole('button', { name: '+ Novo' }).click();
  });

  await test.step('✅ Cliente automação selecionado', async () => {
    await page.getByRole('tab', { name: ' Nome' }).click();
    await page.getByRole('textbox', { name: 'Digite o nome (ex: Maria)' }).fill('cliente');
    await page.getByRole('button', { name: 'Selecionar' }).first().click();
  });

  await test.step('✅ Profissional selecionado: Daryl', async () => {
    await page.locator('.svc-prof-trigger').click();
    await page.locator('.svc-prof-option[data-value="Daryl"]').click();
  });

  await test.step('✅ Serviço selecionado: Barba Completa', async () => {
    await page.locator('.svc-servico').selectOption({ label: 'Barba Completa' });
    await expect(page.locator('.svc-servico')).toHaveValue('Barba Completa');
  });

  await test.step('📦 Pacote disponível validado e selecionado', async () => {
    const pacoteUso = page.locator('.pacote-checkbox[data-pacote-acao="usar"]');
    await expect(pacoteUso).toBeVisible();

    const cardPacote = pacoteUso.locator('xpath=ancestor::label');
    await expect(cardPacote).toContainText('3 restantes');

    await pacoteUso.check();
    log.info('Pacote barba x4 utilizado (saldo atual 3)');
  });

  await test.step('✅ Data e horário definidos', async () => {
    const data = new Date();
    data.setDate(data.getDate() + 13);

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
  });

  await test.step('✅ Agendamento salvo', async () => {
    await page.getByRole('button', { name: 'Salvar' }).click();
    await page.waitForTimeout(3000);
  });

  await test.step('📊 Dashboard acessado', async () => {
    await page.locator('button[data-page="dashboard"]').click();
    await aguardarDashboard(page);
  });

  await test.step('✅ Filtro aplicado', async () => {
    await page.locator('#dash-inicio').fill(dataFormatada);
    await page.locator('#dash-fim').fill(dataFormatada);
    await page.locator('.btn-dash-apply').click();
    await aguardarDashboard(page);
    await aguardarValorEstavel(page, '#dash-faturamento', 0);
    await aguardarValorEstavel(page, '#dash-pag-pendente', 0);
  });

  await test.step('📊 Dashboard zerado validado', async () => {
    await expect(page.locator('#dash-total-ag')).toHaveText('0');
    await expect(page.locator('#dash-total-servicos')).toHaveText('0');
    await expect(page.locator('#dash-ticket')).toContainText('0');
    await expect(page.locator('#dash-faturamento')).toContainText('0');
    await expect(page.locator('#dash-pag-recebido')).toContainText('0');
    await expect(page.locator('#dash-pag-pendente')).toContainText('0');
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

    await expect(linhaCliente).toBeVisible();
    await linhaCliente.click();

    await expect(
      page.getByRole('heading', { name: /Histórico do Cliente/i })
    ).toBeVisible();
  });

  await test.step('📦 Aba pacotes acessada', async () => {
    await page.locator('button[data-hist-tab="pacotes"]').click();
    await expect(page.locator('button[data-hist-tab="pacotes"]')).toHaveClass(/active/);
  });

  await test.step('📦 Saldo do pacote preservado', async () => {
    const panePacotes = page.locator('[data-hist-pane="pacotes"]');
    const listaPacotes = panePacotes.locator('ul.historico-lista');

    await expect(listaPacotes).toBeVisible({ timeout: 15000 });

    const itemPacote = listaPacotes.locator('li').first();
    await expect(itemPacote).toContainText('Pacote barba x4');
    await expect(itemPacote).toContainText('Barba Completa');
    await expect(itemPacote).toContainText('1/4');
    await expect(itemPacote).toContainText('restam 3');
    await expect(itemPacote.locator('.hist-status-badge')).toContainText(/ATIVO/i);

    log.info('Saldo mantido em 1/4 utilizado e 3 restantes');
  });

  log.finish('CT020');
});
