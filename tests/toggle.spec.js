// tests/toggle.spec.js
// 🔄 Toggle de ativação de usuários
// Cobre: TC-TGL-01, TC-TGL-04, TC-TGL-07
//
// Dependências:
//  - Login admin
//  - Pelo menos 1 usuário colaborador inativo (para TC-TGL-04)
//  - Pelo menos 1 usuário colaborador ativo (para TC-TGL-01)
//
// ⚠️ TC-TGL-07 é REGRESSÃO de bug histórico (sufixo _inactive no nome).
//    Não pode falhar — se falhar, a regressão voltou.

const { test, expect } = require('@playwright/test');
const { BASE_URL, loginAsAdmin } = require('./helpers/auth');

test.describe('🔄 Toggle de ativação', () => {

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/agenda.html#usuarios`);
    // Mostrar inativos para conseguir manipular
    const checkboxInativos = page.locator('[data-testid="check-exibir-inativos"], #check-exibir-inativos');
    if (await checkboxInativos.isVisible().catch(() => false)) {
      await checkboxInativos.check();
    }
    await page.waitForTimeout(500);
  });

  test('TC-TGL-01 — Toggle abre modal de confirmação [ALTO]', async ({ page }) => {
    const primeiroToggle = page.locator('[data-testid^="toggle-usuario-"], .toggle-usuario').first();
    await primeiroToggle.click();

    const modal = page.locator('[data-testid="modal-confirm-toggle"], #modal-confirm-toggle');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Botão cancelar deve fechar sem alterar
    await page.click('[data-testid="btn-cancelar-toggle"], #btn-cancelar-toggle');
    await expect(modal).toBeHidden();
  });

  test('TC-TGL-04 — Reativar usuário inativo [CRÍTICO]', async ({ page }) => {
    // Localiza o primeiro usuário inativo (badge "Inativo")
    const cardInativo = page.locator('[data-testid="card-usuario"]:has(.badge-inativo), .card-usuario:has-text("Inativo")').first();
    await expect(cardInativo).toBeVisible({ timeout: 5000 });

    const emailUsuario = await cardInativo.locator('[data-testid="user-email"], .user-email').textContent();

    await cardInativo.locator('[data-testid^="toggle-usuario-"], .toggle-usuario').click();
    await page.click('[data-testid="btn-confirmar-toggle"], #btn-confirmar-toggle');

    await expect(page.locator('.toast-success, [data-testid="toast-success"]')).toBeVisible({ timeout: 8000 });

    // Após reload, usuário deve estar ATIVO
    await page.reload();
    await page.waitForTimeout(1000);
    const cardReativado = page.locator(`[data-testid="card-usuario"]:has-text("${emailUsuario}")`);
    await expect(cardReativado.locator('.badge-ativo, text=/Ativo/i')).toBeVisible();
  });

  test('TC-TGL-07 — REGRESSÃO: nome NUNCA pode ter sufixo _inactive [CRÍTICO]', async ({ page }) => {
    // Bug histórico: ao inativar, o backend gravava "Nome_inactive" no campo nome.
    // Esse teste protege contra a regressão.

    // Inativa o primeiro usuário ativo
    const cardAtivo = page.locator('[data-testid="card-usuario"]:has(.badge-ativo)').first();
    const nomeOriginal = (await cardAtivo.locator('[data-testid="user-nome"], .user-nome').textContent()).trim();

    await cardAtivo.locator('[data-testid^="toggle-usuario-"], .toggle-usuario').click();
    await page.click('[data-testid="btn-confirmar-toggle"], #btn-confirmar-toggle');
    await page.waitForTimeout(1500);

    // Recarrega e verifica que o nome continua LIMPO
    await page.reload();
    await page.waitForTimeout(1000);

    const cardAposReload = page.locator(`[data-testid="card-usuario"]:has-text("${nomeOriginal}")`);
    const nomeAtual = (await cardAposReload.locator('[data-testid="user-nome"], .user-nome').textContent()).trim();

    expect(nomeAtual).toBe(nomeOriginal);
    expect(nomeAtual).not.toContain('_inactive');
    expect(nomeAtual).not.toMatch(/_inactive|_inativo/i);
  });

});
