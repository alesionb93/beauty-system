import { test, expect } from '@playwright/test';
const { loginSlotify } = require('../../../helpers/auth');
const { log } = require('../../../helpers/logger');

test('CT018 - Criar agendamento com venda de pacote', async ({ page }) => {

  let dataFormatada;
  let dataExpiracao;

  log.start('CT018');

  await test.step('✅ Login realizado', async () => {
    await loginSlotify(page);
  });

  await test.step('✅ Novo agendamento aberto', async () => {
    await page.getByRole('button', { name: '+ Novo' }).click();
  });

  await test.step('✅ Cliente automação selecionado', async () => {
    await page.getByRole('tab', { name: ' Nome' }).click();
    await page
      .getByRole('textbox', { name: 'Digite o nome (ex: Maria)' })
      .fill('cliente');
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

  await test.step('✅ Pacote barba x4 selecionado', async () => {
    const pacoteCheckbox = page.locator(
      '.pacote-checkbox[data-pacote-acao="vender"]'
    );
    await expect(pacoteCheckbox).toBeVisible();
    await pacoteCheckbox.check();
    log.info('Pacote barba x4 vendido');
  });

  await test.step('✅ Data e horário definidos', async () => {
    const data = new Date();
    data.setDate(data.getDate() + 12);

    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');

    dataFormatada = `${ano}-${mes}-${dia}`;

    const expiracao = new Date(data);
    expiracao.setDate(expiracao.getDate() + 30);

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
    await page.waitForTimeout(2000);
  });

  await test.step('✅ Filtro de data aplicado', async () => {
    await page.locator('#dash-inicio').fill(dataFormatada);
    await page.locator('#dash-fim').fill(dataFormatada);
    await page.locator('.btn-dash-apply').click();
    await page.waitForTimeout(3000);
  });

  await test.step('📊 Indicadores principais validados', async () => {
    await expect(page.locator('#dash-total-ag')).toHaveText('0');
    await expect(page.locator('#dash-ticket')).toContainText('0');
    await expect(page.locator('#dash-total-servicos')).toHaveText('0');
    await expect(page.locator('#dash-faturamento')).toContainText('0');
  });

  await test.step('📊 Recebido e pendente validados', async () => {
    await expect(page.locator('#dash-pag-recebido')).toContainText('0');
    await expect(page.locator('#dash-pag-pendente')).toContainText('150');
  });

  await test.step('👤 Módulo clientes acessado', async () => {
    await page.locator('button[data-page="clientes"]').click();
    // Espera a tabela de clientes ficar pronta (sem timeout fixo).
    await expect(page.locator('#clients-search-input')).toBeVisible();
  });

  await test.step('👤 Cliente automação localizado', async () => {
    await page.locator('#clients-search-input').fill('cliente automação');

    // Aguarda a linha aparecer após o filtro (sem waitForTimeout).
    const linhaCliente = page
      .locator('.cell-value-name')
      .filter({ hasText: 'cliente automação' })
      .first();

    await expect(linhaCliente).toBeVisible();
    await linhaCliente.click();

    // Garante que o modal "Histórico do Cliente" foi aberto.
    await expect(
      page.getByRole('heading', { name: /Histórico do Cliente/i })
    ).toBeVisible();
  });

  await test.step('📦 Aba pacotes acessada', async () => {
    await page.locator('button[data-hist-tab="pacotes"]').click();

    // O botão deve receber a classe .active após o switchHistTab().
    await expect(
      page.locator('button[data-hist-tab="pacotes"]')
    ).toHaveClass(/active/);

    // Confirma que o pane de pacotes está realmente visível (e não o de histórico).
    await expect(
      page.locator('[data-hist-pane="pacotes"]')
    ).toBeVisible();
  });

  await test.step('📦 Pacote adquirido validado', async () => {
    // 🔑 ESCOPO: tudo dentro do pane "Pacotes" para não colidir com o pane
    // "Histórico" (que continua no DOM com display:none e tem textos parecidos).
    const panePacotes = page.locator('[data-hist-pane="pacotes"]');
    const conteudoPacotes = panePacotes.locator('#pacotes-cliente-conteudo');

    // 🔑 ESPERA ASSÍNCRONA: o pane abre com "<p>Carregando pacotes...</p>" e
    // só depois listarPacotesCliente() injeta o <ul.historico-lista>.
    // Aguardamos a lista renderizada — sem timeout fixo.
    const listaPacotes = conteudoPacotes.locator('ul.historico-lista');
    await expect(listaPacotes).toBeVisible({ timeout: 15000 });

    // Item do pacote (primeiro <li> da lista).
    const itemPacote = listaPacotes.locator('li').first();
    await expect(itemPacote).toBeVisible();

    // Nome do pacote vem dentro de <strong> no .hist-item-body.
    await expect(itemPacote.locator('.hist-item-body strong').first())
      .toHaveText('Pacote barba x4');

    // Demais validações escopadas ao item — evita strict-mode violations.
    await expect(itemPacote).toContainText('Barba Completa');
    await expect(itemPacote).toContainText('0/4');
    await expect(itemPacote).toContainText('restam 4');
    await expect(itemPacote).toContainText(dataExpiracao);

    // Badge de status ATIVO.
    await expect(itemPacote.locator('.hist-status-badge')).toContainText(/ATIVO/i);

    log.info('Pacote registrado para o cliente');
  });

  log.finish('CT018');

});
