// tests/professionals.spec.js
// 💈 Profissionais
// Cobre: TC-PRO-04, TC-VIN-04
//
// Dependências de SEED:
//  - Profissional A com 2 usuários vinculados (1 ativo + 1 inativo)
//  - Profissional B com TODOS os usuários vinculados inativos
//  - Profissional C com profissionais.ativo = false
//
// ⚠️ TC-PRO-04 e TC-VIN-04 são REGRESSÕES de bug recente (card sumindo
//    indevidamente / aparecendo quando não deveria).

const { test, expect } = require('@playwright/test');
const { BASE_URL, loginAsAdmin } = require('./helpers/auth');

test.describe('💈 Profissionais', () => {

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('TC-PRO-04 — Card aparece se PELO MENOS UM usuário vinculado estiver ativo [CRÍTICO]', async ({ page }) => {
    // Profissional A: 1 usuário ativo + 1 usuário inativo → card DEVE aparecer
    await page.goto(`${BASE_URL}/agenda.html#profissionais`);
    await page.waitForSelector('[data-testid="lista-profissionais"], .profissionais-grid', { timeout: 10000 });

    const profA = page.locator('[data-testid="card-profissional"]:has-text("Profissional A"), .card-profissional:has-text("Profissional A")');
    await expect(profA).toBeVisible();

    // Card deve ter foto/avatar visível (regressão do bug em que a foto sumia)
    await expect(profA.locator('img, .avatar, [data-testid="prof-foto"]')).toBeVisible();
  });

  test('TC-VIN-04 — Profissional inativo NÃO aparece no select de agendamento [CRÍTICO]', async ({ page }) => {
    // Profissional C tem profissionais.ativo=false
    await page.goto(`${BASE_URL}/agenda.html`);
    await page.waitForLoadState('networkidle');

    // Abre modal de novo agendamento
    await page.click('[data-testid="btn-novo-agendamento"], #btn-novo-agendamento');
    await page.waitForSelector('[data-testid="select-profissional"], #select-profissional', { timeout: 5000 });

    const opcoes = await page.locator('[data-testid="select-profissional"] option, #select-profissional option').allTextContents();

    // Profissional C (inativo) NÃO pode aparecer
    expect(opcoes.join('|')).not.toMatch(/Profissional C/i);

    // Profissional B (ativo na tabela mas sem usuários ativos vinculados) também NÃO deve aparecer
    expect(opcoes.join('|')).not.toMatch(/Profissional B/i);
  });

});
