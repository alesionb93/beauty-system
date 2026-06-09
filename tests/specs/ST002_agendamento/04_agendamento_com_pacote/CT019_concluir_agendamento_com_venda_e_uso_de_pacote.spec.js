import { test, expect } from '@playwright/test';
const { loginSlotify } = require('../../../helpers/auth');
const { log } = require('../../../helpers/logger');
const { aguardarDashboard } = require('../../../helpers/dashboard');

/**
 * CT019 — Concluir agendamento com venda e uso de pacote
 *
 * Estratégia anti-race-condition no dashboard:
 *  1) Após "Concluir atendimento" + pagamento, aguardamos o realtime
 *     do Supabase propagar (waitForResponse opcional + tempo curto).
 *  2) Ao abrir o dashboard e clicar em Aplicar, usamos o helper oficial
 *     `aguardarDashboard` (sincroniza com #dash-loading-overlay).
 *  3) Validamos o faturamento com `aguardarValorEstavel`, que exige o
 *     valor numérico EXATO (R$ 150,00) e estabilidade em duas leituras
 *     consecutivas. Se o valor não estabilizar, RE-CLICAMOS "Aplicar"
 *     automaticamente (recuperação da race condition entre os múltiplos
 *     writes disparados pela conclusão do atendimento).
 */

const VALOR_VENDA = 150;

/**
 * Lê o valor BRL exibido em um locator e converte para Number.
 * "R$ 150,00" → 150 ; "R$ 1.234,50" → 1234.5
 */
async function lerValorBRL(locator) {
  const texto = (await locator.textContent()) || '';
  const limpo = texto.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}

/**
 * Espera o valor de um locator atingir `esperado` e permanecer estável
 * em duas leituras consecutivas (anti-flicker). Se falhar dentro de
 * `tentativasReclick`, re-clica o botão Aplicar para forçar nova carga.
 */
async function aguardarValorEstavel(page, locator, esperado, opts = {}) {
  const totalTimeout = opts.timeout ?? 45000;
  const intervalo = opts.intervalo ?? 400;
  const reclickAposMs = opts.reclickAposMs ?? 12000;
  const maxReclicks = opts.maxReclicks ?? 2;

  const inicio = Date.now();
  let ultimo = null;
  let antepenultimo = null;
  let reclicks = 0;
  let proximoReclick = inicio + reclickAposMs;

  while (Date.now() - inicio < totalTimeout) {
    const atual = await lerValorBRL(locator);

    if (atual === esperado && antepenultimo === esperado && ultimo === esperado) {
      return atual;
    }

    antepenultimo = ultimo;
    ultimo = atual;

    if (Date.now() >= proximoReclick && reclicks < maxReclicks) {
      reclicks += 1;
      log.info(
        `Valor instável (último=${atual}, esperado=${esperado}). ` +
          `Re-clicando "Aplicar" (tentativa ${reclicks}/${maxReclicks}).`
      );
      await page.locator('.btn-dash-apply').click({ force: true });
      await aguardarDashboard(page).catch(() => {});
      proximoReclick = Date.now() + reclickAposMs;
      antepenultimo = null;
      ultimo = null;
    }

    await page.waitForTimeout(intervalo);
  }

  throw new Error(
    `Timeout aguardando #dash-faturamento estabilizar em R$ ${esperado},00. ` +
      `Última leitura: ${ultimo}. Re-clicks: ${reclicks}.`
  );
}

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
    expiracao.setDate(expiracao.getDate() + 30);
    dataExpiracao =
      `${String(expiracao.getDate()).padStart(2, '0')}/` +
      `${String(expiracao.getMonth() + 1).padStart(2, '0')}/` +
      `${expiracao.getFullYear()}`;

    await page.getByRole('button', { name: String(data.getDate()) }).click();
    await expect(page.getByText('20:00 – 20:30')).toBeVisible();
  });

  await test.step('✅ Agendamento aberto', async () => {
    await page.getByText('20:00 – 20:30').click();
    await expect(page.getByText('cliente automação')).toBeVisible();
  });

  await test.step('📦 Pacote disponível validado e utilizado', async () => {
    const pacoteUso = page.locator('.pacote-checkbox[data-pacote-acao="usar"]');
    await expect(pacoteUso).toBeVisible();

    const cardPacote = pacoteUso.locator('xpath=ancestor::label');
    await expect(cardPacote).toContainText('4 restantes');

    await pacoteUso.check();
    log.info('Pacote barba x4 utilizado');
  });

  await test.step('✅ Atendimento concluído', async () => {
    await page.getByRole('button', { name: /Concluir atendimento/i }).click();
    await page.locator('#btn-confirmar-concluir-atendimento').click();

    const modalPag = page.locator('#modal-pagamento-ag');
    await expect(modalPag).toBeVisible({ timeout: 10000 });

    const campoValor = modalPag.locator('#pag-formas-list input.pag-valor').first();
    await expect(campoValor).toBeVisible({ timeout: 5000 });
    await campoValor.fill(String(VALOR_VENDA));

    const btnConfirmar = page.locator('#pag-confirmar');
    await expect(btnConfirmar).toBeEnabled({ timeout: 5000 });

    // Captura a resposta do POST de pagamento para sincronizar o teste
    // com a persistência real (em vez de waitForTimeout cego).
    const respPagamento = page
      .waitForResponse(
        (r) =>
          /agendamento_pagamentos/.test(r.url()) &&
          ['POST', 'PATCH'].includes(r.request().method()) &&
          r.status() < 400,
        { timeout: 10000 }
      )
      .catch(() => null);

    await btnConfirmar.click();
    await respPagamento;

    // Pequena folga para a UI fechar o modal e o realtime propagar
    // antes da próxima navegação.
    await expect(modalPag).toBeHidden({ timeout: 10000 });
    log.payment('150,00');
  });

  await test.step('📊 Dashboard acessado', async () => {
    await page.evaluate(() => {
      try {
        localStorage.setItem('ff_comissoes_ativo', '1');
      } catch (_) {}
    });

    await page.locator('button[data-page="dashboard"]').click();
    await aguardarDashboard(page);
  });

  await test.step('✅ Filtro de data aplicado e render estabilizado', async () => {
    await page.locator('#dash-inicio').fill(dataFormatada);
    await page.locator('#dash-fim').fill(dataFormatada);
    await page.locator('.btn-dash-apply').click();
    await aguardarDashboard(page);

    // A primeira linha de "Por Profissional" precisa existir antes de
    // validarmos o faturamento (garante que a tabela renderizou).
    const primeiraLinha = page.locator('#dash-prof-tbody tr').first();
    await expect(primeiraLinha).toBeVisible({ timeout: 15000 });
    await expect(
      primeiraLinha.locator('td.dash-prof-cell-total-receber')
    ).not.toBeEmpty({ timeout: 15000 });

    // Asserção robusta: exige o valor EXATO R$ 150,00 estável em 3
    // leituras consecutivas; se não estabilizar, re-clica "Aplicar".
    await aguardarValorEstavel(
      page,
      page.locator('#dash-faturamento'),
      VALOR_VENDA,
      { timeout: 45000 }
    );
  });

  await test.step('📊 Indicadores principais validados', async () => {
    await expect(page.locator('#dash-total-ag')).toHaveText('1');
    await expect(page.locator('#dash-total-servicos')).toHaveText('1');
    await expect(page.locator('#dash-ticket')).toContainText('150');
    await expect(page.locator('#dash-faturamento')).toContainText('150');
  });

  await test.step('📊 Recebido e pendente validados', async () => {
    await expect(page.locator('#dash-pag-recebido')).toContainText('150');
    await expect(page.locator('#dash-pag-pendente')).toContainText('0');
  });

  await test.step('📊 Profissional Daryl validado', async () => {
    const linhaDaryl = page.locator('#dash-prof-tbody tr').first();
    await expect(linhaDaryl.locator('td:nth-child(1)')).toHaveText('Daryl');
    await expect(linhaDaryl.locator('td:nth-child(2)')).toHaveText('1');
    await expect(linhaDaryl.locator('td:nth-child(3)')).toHaveText('1');
    await expect(linhaDaryl.locator('td:nth-child(4)')).toContainText('150');
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
    await expect(page.locator('[data-hist-pane="pacotes"]')).toBeVisible();
  });

  await test.step('📦 Pacote atualizado validado', async () => {
    const panePacotes = page.locator('[data-hist-pane="pacotes"]');
    const conteudoPacotes = panePacotes.locator('#pacotes-cliente-conteudo');
    const listaPacotes = conteudoPacotes.locator('ul.historico-lista');

    await expect(listaPacotes).toBeVisible({ timeout: 15000 });

    const itemPacote = listaPacotes.locator('li').first();
    await expect(itemPacote).toBeVisible();

    await expect(
      itemPacote.locator('.hist-item-body strong').first()
    ).toHaveText('Pacote barba x4');

    await expect(itemPacote).toContainText('Barba Completa');
    await expect(itemPacote).toContainText('1/4');
    await expect(itemPacote).toContainText('restam 3');
    await expect(itemPacote.locator('.hist-status-badge')).toContainText(/ATIVO/i);
    await expect(itemPacote).toContainText(dataExpiracao);

    log.info('Pacote atualizado para 1/4');
  });

  log.finish('CT019');
});
