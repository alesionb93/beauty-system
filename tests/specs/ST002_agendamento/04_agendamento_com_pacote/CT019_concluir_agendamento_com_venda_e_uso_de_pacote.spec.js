import { test, expect } from '@playwright/test';
const { loginSlotify } = require('../../../helpers/auth');
const { log } = require('../../../helpers/logger');

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

    expiracao.setDate(
      expiracao.getDate() + 30
    );

    dataExpiracao =
      `${String(expiracao.getDate()).padStart(2, '0')}/` +
      `${String(expiracao.getMonth() + 1).padStart(2, '0')}/` +
      `${expiracao.getFullYear()}`;

    await page
      .getByRole('button', { name: String(data.getDate()) })
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

  await test.step('📦 Pacote disponível validado e utilizado', async () => {

    const pacoteUso = page.locator(
      '.pacote-checkbox[data-pacote-acao="usar"]'
    );

    await expect(
      pacoteUso
    ).toBeVisible();

    const cardPacote = pacoteUso.locator(
      'xpath=ancestor::label'
    );

    await expect(
      cardPacote
    ).toContainText('4 restantes');

    await pacoteUso.check();

    log.info('Pacote barba x4 utilizado');

  });

  await test.step('✅ Atendimento concluído', async () => {

    await page
      .getByRole('button', { name: /Concluir atendimento/i })
      .click();

    await page
      .locator('#btn-confirmar-concluir-atendimento')
      .click();

    const modalPag = page.locator(
      '#modal-pagamento-ag'
    );

    await expect(
      modalPag
    ).toBeVisible({ timeout: 10000 });

    const campoValor = modalPag
      .locator('#pag-formas-list input.pag-valor')
      .first();

    await expect(
      campoValor
    ).toBeVisible({ timeout: 5000 });

    await campoValor.fill('150');

    const btnConfirmar = page.locator(
      '#pag-confirmar'
    );

    await expect(
      btnConfirmar
    ).toBeEnabled({ timeout: 5000 });

    await btnConfirmar.click();

    await page.waitForTimeout(3000);

    log.payment('150,00');

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

    await page.waitForTimeout(1500);

  });

  await test.step('✅ Filtro de data aplicado e render estabilizado', async () => {

    await page
      .locator('#dash-inicio')
      .fill(dataFormatada);

    await page
      .locator('#dash-fim')
      .fill(dataFormatada);

    await page
      .locator('.btn-dash-apply')
      .click();

    // Espera semântica: o Dashboard está pronto quando a primeira linha
    // de "Por Profissional" existe E os indicadores principais já refletem
    // a venda concluída. Os matchers do Playwright fazem retry automático,
    // então não há necessidade de polling de innerHTML nem de waits fixos.
    const primeiraLinha = page.locator(
      '#dash-prof-tbody tr'
    ).first();

    await expect(
      primeiraLinha
    ).toBeVisible({ timeout: 15000 });

    await expect(
      primeiraLinha.locator(
        'td.dash-prof-cell-total-receber'
      )
    ).not.toBeEmpty({ timeout: 15000 });

    // Aguarda o faturamento principal ser hidratado com o valor da venda
    // (garante que o pipeline de render terminou antes das validações).
    await expect(
      page.locator('#dash-faturamento')
    ).toContainText('150', { timeout: 15000 });

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
    ).toContainText('150');

    await expect(
      page.locator('#dash-faturamento')
    ).toContainText('150');

  });

  await test.step('📊 Recebido e pendente validados', async () => {

    await expect(
      page.locator('#dash-pag-recebido')
    ).toContainText('150');

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
    ).toContainText('150');

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
      .locator('button[data-hist-tab="pacotes"]')
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

    const conteudoPacotes = panePacotes.locator(
      '#pacotes-cliente-conteudo'
    );

    const listaPacotes = conteudoPacotes.locator(
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
    ).toBeVisible();

    await expect(
      itemPacote
        .locator('.hist-item-body strong')
        .first()
    ).toHaveText('Pacote barba x4');

    await expect(
      itemPacote
    ).toContainText('Barba Completa');

    await expect(
      itemPacote
    ).toContainText('1/4');

    await expect(
      itemPacote
    ).toContainText('restam 3');

    await expect(
      itemPacote.locator('.hist-status-badge')
    ).toContainText(/ATIVO/i);

    await expect(
      itemPacote
    ).toContainText(dataExpiracao);

    log.info(
      'Pacote atualizado para 1/4'
    );

  });

  log.finish('CT019');

});
