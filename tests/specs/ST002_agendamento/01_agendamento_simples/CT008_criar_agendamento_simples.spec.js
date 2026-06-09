import { test, expect } from '@playwright/test';
const { loginSlotify } = require('../../../helpers/auth');
const { log } = require('../../../helpers/logger');
const { aguardarDashboard, aguardarValorEstavel } = require('../../../helpers/dashboard');

/**
 * Helper local — abre o modal "Novo Agendamento" de forma robusta.
 *
 * Motivo: em Linux/headless o handler de click do botão "+ Novo" pode ser
 * ligado de forma assíncrona pela tela de Agendamentos (após hidratação dos
 * dados do dia). Se o teste clica antes do handler estar pronto, o modal não
 * abre e o próximo locator (`getByRole('tab', { name: ' Nome' })`) trava em
 * timeout porque a tab só existe DENTRO do modal.
 *
 * Estratégia:
 *   1. Esperar a tela de Agendamentos estar realmente pronta (header + grade
 *      do dia renderizados).
 *   2. Clicar em "+ Novo".
 *   3. Esperar o modal aparecer; se não aparecer em 3s, repetir o click.
 */
async function abrirNovoAgendamento(page) {
  // 1) Tela de Agendamentos pronta
  await expect(page.getByRole('heading', { name: 'Agendamentos' })).toBeVisible();

  const botaoNovo = page.getByRole('button', { name: '+ Novo' });
  await expect(botaoNovo).toBeVisible();
  await expect(botaoNovo).toBeEnabled();

  // Locator do modal — qualquer um dos seletores conhecidos do app
  const dialog = page.locator(
    '#modal-agendamento, #modal-novo-agendamento, .modal-agendamento, [role="dialog"]'
  ).first();

  // 2) + 3) click com retry uma única vez
  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    await botaoNovo.click({ trial: false });
    try {
      await expect(dialog).toBeVisible({ timeout: 3500 });
      // Garantir que o conteúdo interno (tabs) já está montado antes de prosseguir
      await expect(
        page.getByRole('tab', { name: /Nome/ })
          .or(page.locator('.tab-cliente-nome, [data-tab="nome"]'))
      ).toBeVisible({ timeout: 5000 });
      return;
    } catch (err) {
      if (tentativa === 2) throw err;
      // Pequena espera antes do retry — handler pode estar a poucos ms de ligar
      await page.waitForTimeout(400);
    }
  }
}

test('CT008 - Criar agendamento simples', async ({ page }) => {
  let dataFormatada;
  log.start('CT008');

  await test.step('✅ Login realizado', async () => {
    await loginSlotify(page);
  });

  await test.step('✅ Novo agendamento aberto', async () => {
    await abrirNovoAgendamento(page);
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
    const data = new Date();
    data.setDate(data.getDate() + 7);
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    dataFormatada = `${ano}-${mes}-${dia}`;

    await page.locator('#ag-data').fill(dataFormatada);
    await page.locator('#ag-hora-h').selectOption('20');
    await page.locator('#ag-minuto').selectOption('00');
  });

  await test.step('✅ Agendamento salvo', async () => {
    // Sincroniza com a persistência real para evitar race no Dashboard
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
