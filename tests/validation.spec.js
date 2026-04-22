// tests/validation.spec.js
// 🧪 Validação & Edge Cases
// Cobre: TC-VAL-01, TC-EDG-09
//
// Dependências:
//  - Login admin
//  - Tenant com slot livre (< 3 ativos) para conseguir abrir o modal de criação

const { test, expect } = require('@playwright/test');
const { BASE_URL, loginAsAdmin } = require('./helpers/auth');

test.describe('🧪 Validação & Edge Cases', () => {

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/agenda.html#usuarios`);
    await page.waitForSelector('[data-testid="lista-usuarios"], #lista-usuarios, .usuarios-grid', { timeout: 10000 });
  });

  test('TC-VAL-01 — Campos obrigatórios bloqueiam submit [MÉDIO]', async ({ page }) => {
    await page.click('[data-testid="btn-novo-usuario"], #btn-novo-usuario');

    // Submete vazio
    await page.click('[data-testid="btn-confirmar-criar"], #btn-confirmar-criar');

    // Modal continua aberto
    await expect(page.locator('[data-testid="modal-novo-usuario"], #modal-novo-usuario')).toBeVisible();

    // Pelo menos um indicador de validação aparece
    // (HTML5 :invalid OU mensagem custom no DOM)
    const inputsInvalidos = await page.locator('input:invalid').count();
    const msgErro       = await page.locator('text=/obrigatóri|requerid|preencha/i').count();
    expect(inputsInvalidos + msgErro).toBeGreaterThan(0);
  });

  test('TC-EDG-09 — Tentativa de XSS é neutralizada [CRÍTICO]', async ({ page }) => {
    const payload = '<img src=x onerror="window.__xss=true">';
    let alertDisparou = false;
    page.on('dialog', async d => { alertDisparou = true; await d.dismiss(); });

    await page.click('[data-testid="btn-novo-usuario"], #btn-novo-usuario');
    await page.fill('[data-testid="input-nome"], #input-nome',   payload);
    await page.fill('[data-testid="input-email"], #input-email', `xss.${Date.now()}@qa.test`);
    await page.fill('[data-testid="input-senha"], #input-senha', 'SenhaForte@123');
    await page.click('[data-testid="btn-confirmar-criar"], #btn-confirmar-criar');

    // Aguarda render
    await page.waitForTimeout(2000);

    // Nenhum dialog/alert de XSS pode disparar
    expect(alertDisparou).toBe(false);

    // Variável global injetada NÃO pode existir
    const xssOk = await page.evaluate(() => window.__xss === true);
    expect(xssOk).toBe(false);

    // Se o card foi criado, o payload deve aparecer ESCAPADO (texto literal),
    // não como elemento HTML executado.
    const cardCriado = page.locator(`text=${payload}`);
    if (await cardCriado.count() > 0) {
      // Está como texto, não como <img> renderizado
      await expect(cardCriado.first()).toBeVisible();
    }

    // Não deve existir <img onerror=...> injetado no DOM
    const imgInjetada = await page.locator('img[onerror]').count();
    expect(imgInjetada).toBe(0);
  });

});
