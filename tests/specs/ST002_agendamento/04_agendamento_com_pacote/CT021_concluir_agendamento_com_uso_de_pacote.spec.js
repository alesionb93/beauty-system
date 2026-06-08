import { test, expect } from '@playwright/test';
const { loginSlotify } = require('../../../helpers/auth');
const { log } = require('../../../helpers/logger');
const { aguardarDashboard } = require('../../../helpers/dashboard');

test('CT021 - Concluir agendamento com uso de pacote', async ({ page }) => {

  let dataFormatada;

  log.start('CT021');

  await test.step('✅ Login realizado', async () => {

    await loginSlotify(page);

  });

  await test.step('✅ Dia do agendamento aberto', async () => {

    const data = new Date();

    data.setDate(
      data.getDate() + 13
    );

    const ano = data.getFullYear();
    const mes = String(
      data.getMonth() + 1
    ).padStart(2, '0');

    const diaMes = String(
      data.getDate()
    ).padStart(2, '0');

    dataFormatada =
      `${ano}-${mes}-${diaMes}`;

    await page
      .getByRole('button', {
        name: String(data.getDate())
      })
      .click();

    await expect(
      page.getByText('20:00 – 20:30')
    ).toBeVisible();

  });

  await test.step('✅ Agendamento aberto', async () => {

    await page
      .getByText('20:00 – 20:30')
      .click();

    await expect(
      page.getByText('cliente automação')
    ).toBeVisible();

  });

  await test.step('✅ Atendimento concluído', async () => {

    await page
      .getByRole('button', {
        name: /Concluir atendimento/i
      })
      .click();

    await page
      .locator('#btn-confirmar-concluir-atendimento')
      .click();

    // IMPORTANTE:
    // Atendimento usando saldo de pacote NÃO abre modal de pagamento

    await expect(
      page.locator('#modal-pagamento-ag')
    ).toBeHidden({ timeout: 5000 });

    log.info(
      'Atendimento concluído utilizando saldo de pacote'
    );

  });

  await test.step('📊 Dashboard acessado', async () => {

    await page.evaluate(() => {
      try {
        localStorage.setItem(
          'ff_comissoes_ativo',
          '1'
        );
      } catch (_) {}
    });

    await page
      .locator('button[data-page="dashboard"]')
      .click();

    await aguardarDashboard(page);

  });

  await test.step('✅ Filtro aplicado', async () => {

    await page
      .locator('#dash-inicio')
      .fill(dataFormatada);

    await page
      .locator('#dash-fim')
      .fill(dataFormatada);

    await page
      .locator('.btn-dash-apply')
      .click();

    await aguardarDashboard(page);

  });

  await test.step('📊 Indicadores principais validados', async () => {

    await expect(
      page.locator('#dash-total-ag')
    ).toHaveText('1');

    await expect(
      page.locator('#dash-total-servicos')
    ).toHaveText('1');

    await expect(
      page.locator('#dash-ticket')
    ).toContainText('0');

    await expect(
      page.locator('#dash-faturamento')
    ).toContainText('0');

  });

  await test.step('📊 Recebido e pendente validados', async () => {

    await expect(
      page.locator('#dash-pag-recebido')
    ).toContainText('0');

    await expect(
      page.locator('#dash-pag-pendente')
    ).toContainText('0');

  });

  await test.step('📊 Profissional Daryl validado', async () => {

    const linhaDaryl = page
      .locator('#dash-prof-tbody tr')
      .first();

    await expect(
      linhaDaryl.locator('td:nth-child(1)')
    ).toHaveText('Daryl');

    await expect(
      linhaDaryl.locator('td:nth-child(2)')
    ).toHaveText('1');

    await expect(
      linhaDaryl.locator('td:nth-child(3)')
    ).toHaveText('1');

    await expect(
      linhaDaryl.locator('td:nth-child(4)')
    ).toContainText('0');

    await expect(
      linhaDaryl.locator('td:nth-child(5)')
    ).toContainText('0');

    await expect(
      linhaDaryl.locator('td.dash-prof-cell-caixinha')
    ).toContainText('0');

    await expect(
      linhaDaryl.locator(
        'td.dash-prof-cell-total-receber'
      )
    ).toContainText('0');

  });

  await test.step('👤 Módulo clientes acessado', async () => {

    await page
      .locator('button[data-page="clientes"]')
      .click();

    await expect(
      page.locator('#clients-search-input')
    ).toBeVisible();

  });

  await test.step('👤 Cliente automação localizado', async () => {

    await page
      .locator('#clients-search-input')
      .fill('cliente automação');

    const linhaCliente = page
      .locator('.cell-value-name')
      .filter({
        hasText: 'cliente automação'
      })
      .first();

    await expect(
      linhaCliente
    ).toBeVisible();

    await linhaCliente.click();

    await expect(
      page.getByRole('heading', {
        name: /Histórico do Cliente/i
      })
    ).toBeVisible();

  });

  await test.step('📦 Aba pacotes acessada', async () => {

    await page
      .locator(
        'button[data-hist-tab="pacotes"]'
      )
      .click();

    await expect(
      page.locator(
        'button[data-hist-tab="pacotes"]'
      )
    ).toHaveClass(/active/);

    await expect(
      page.locator(
        '[data-hist-pane="pacotes"]'
      )
    ).toBeVisible();

  });

  await test.step('📦 Pacote atualizado validado', async () => {

    const panePacotes = page.locator(
      '[data-hist-pane="pacotes"]'
    );

    const listaPacotes = panePacotes.locator(
      'ul.historico-lista'
    );

    await expect(
      listaPacotes
    ).toBeVisible({ timeout: 15000 });

    const itemPacote = listaPacotes
      .locator('li')
      .first();

    await expect(
      itemPacote
    ).toContainText('Pacote barba x4');

    await expect(
      itemPacote
    ).toContainText('Barba Completa');

    await expect(
      itemPacote
    ).toContainText('2/4');

    await expect(
      itemPacote
    ).toContainText('restam 2');

    await expect(
      itemPacote.locator(
        '.hist-status-badge'
      )
    ).toContainText(/ATIVO/i);

    log.info(
      'Pacote atualizado para 2/4 utilizado'
    );

  });

  log.finish('CT021');

});