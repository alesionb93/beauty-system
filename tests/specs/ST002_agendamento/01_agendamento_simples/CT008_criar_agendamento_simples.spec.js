import { test, expect } from '@playwright/test';
const { loginSlotify } = require('../../../helpers/auth');
const { log } = require('../../../helpers/logger');
const { aguardarDashboard, aguardarValorEstavel } = require('../../../helpers/dashboard');

/**
 * Helper local — abre o modal "Novo Agendamento" de forma robusta.
 *
 * IMPORTANTE (v2 — 2026-06-09):
 * Não validamos mais a visibilidade do container `#modal-agendamento`.
 * Evidência da pipeline (CT012 passa com o fluxo direto, CT008 com o
 * gate falhava): o wrapper do modal pode estar em estado considerado
 * "hidden" pelo Playwright (ex.: container com size 0, classe `hidden`
 * no shell ou apenas overlay com visibility:hidden) MESMO quando os
 * elementos internos já estão montados e interativos.
 *
 * Estratégia robusta:
 *   1. Esperar a tela de Agendamentos estar pronta (heading visível).
 *   2. Clicar em "+ Novo".
 *   3. Esperar diretamente o elemento INTERNO interativo que o teste
 *      precisa usar a seguir (tab "Nome"). É o mesmo gate de fato que
 *      o auto-wait do Playwright aplica no CT012.
 *   4. Retry único do click se o tab não aparecer em 4s.
 */
async function abrirNovoAgendamento(page) {
  await expect(page.getByRole('heading', { name: 'Agendamentos' })).toBeVisible();

  const botaoNovo = page.getByRole('button', { name: '+ Novo' });
  await expect(botaoNovo).toBeVisible();
  await expect(botaoNovo).toBeEnabled();

  // Alvo real: a tab "Nome" só existe DENTRO do modal aberto.
  // Se ela ficou visível, o modal está usável — não importa o estado
  // do container externo.
  const tabNome = page.getByRole('tab', { name: /Nome/ });

  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    await botaoNovo.click();
    try {
      await expect(tabNome).toBeVisible({ timeout: 4000 });
      return;
    } catch (err) {
      if (tentativa === 2) throw err;
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
