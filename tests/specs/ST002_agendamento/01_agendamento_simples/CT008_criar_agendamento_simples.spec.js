import { test, expect } from '@playwright/test';
const { loginSlotify } = require('../../../helpers/auth');
const {
  abrirNovoAgendamento,
  locTabNome,
} = require('../../../helpers/agendamento');
const { log } = require('../../../helpers/logger');
const { aguardarDashboard, aguardarValorEstavel } = require('../../../helpers/dashboard');

/**
 * CT008 — v4 (2026-06-13)
 *
 * Mudanças vs v3:
 *  - Confia no novo helper abrirNovoAgendamento (v5) que valida a classe
 *    `.active` no #modal-identificacao — o sinal real emitido por
 *    openModal() em script.js. Sem heading-text, sem role=dialog.
 *  - Após o modal abrir, clicamos a tab "Nome" pelo data-attribute estável
 *    (#modal-identificacao [data-search-type="nome"]) e não mais pelo
 *    accessible name " Nome" (que era frágil ao espaço inicial).
 *  - Aguardamos #id-panel-nome ficar visível antes de digitar — esse é o
 *    sinal real de que setupIdentificacaoModal trocou de painel.
 */
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
    await locTabNome(page).click();
    await expect(page.locator('#id-panel-nome')).toBeVisible();
    await page.locator('#id-nome').fill('cliente');
    // O botão "Selecionar" aparece após o autocomplete retornar resultados.
    const btnSelecionar = page.getByRole('button', { name: 'Selecionar' }).first();
    await expect(btnSelecionar).toBeVisible({ timeout: 10000 });
    await btnSelecionar.click();
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
    data.setDate(data.getDate() + 1);
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    dataFormatada = `${ano}-${mes}-${dia}`;

    await page.locator('#ag-data').fill(dataFormatada);
    await page.locator('#ag-hora-h').selectOption('20');
    await page.locator('#ag-minuto').selectOption('00');
  });

  await test.step('✅ Agendamento salvo', async () => {
    const respCriacao = page.waitForResponse(
      (r) => /agendamentos?($|\?|\/)/.test(r.url())
        && ['POST', 'PATCH', 'PUT'].includes(r.request().method()),
      { timeout: 15000 }
    );

    await page.getByRole('button', { name: 'Salvar' }).click();
    const response = await respCriacao;
    expect(response.ok()).toBeTruthy();
    // await expect(page.getByText(/20:00\s*[–-]\s*21:00/).first()).toBeVisible({ timeout: 10000 });
    // await expect(page.getByText('Alesio Barreiro').first()).toBeVisible();
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
