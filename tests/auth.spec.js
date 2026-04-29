import { test, expect } from '@playwright/test';

async function login(page, email, senha) {
  await page.goto('http://127.0.0.1:5500/index.html');

  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Senha' }).fill(senha);

  await page.getByRole('button', { name: 'Entrar' }).click();

  // 🔥 espera mínima estabilidade do app
  await page.waitForTimeout(1000);
}

test.describe('🔐 Autenticação & Segurança', () => {

  test('TC-AUTH-01 — Login válido', async ({ page }) => {
    await login(page, 'alesionb93@gmail.com', 'Aranjiex22@@');

    await page.waitForLoadState('domcontentloaded');

    // validação mais realista
    await expect(page.locator('body')).toContainText(/dashboard|home|perfil|sair/i);
  });

  test('TC-AUTH-02 — Senha inválida', async ({ page }) => {
    await login(page, 'alesionb93@gmail.com', 'errado@@@');

    // 🔥 espera qualquer feedback visual de erro
    const errorToast = page.locator('text=/incorret|senha|erro/i');

    await expect(errorToast.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-AUTH-03 — Usuário inativo bloqueado', async ({ page }) => {
    await login(page, 'colabuser@gmail.com', 'Aranjiex22@@');

    const error = page.locator('text=/inativo|bloquead|contate/i');

    await expect(error.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-AUTH-04 — Logout', async ({ page }) => {
    await login(page, 'ander@gmail.com', 'Aranjiex22@@');

    // 🔥 espera que algo de "logado" exista antes de procurar logout
    await expect(page.locator('body')).toContainText(/sair|logout|perfil/i);

    // 🔥 tenta múltiplas formas de achar logout
    const logoutBtn = page.locator(
      '#btn-sair, button:has-text("Sair"), text=Logout, text=Sair'
    );

    await expect(logoutBtn.first()).toBeVisible({ timeout: 15000 });

    await logoutBtn.first().click();

    await expect(page.getByRole('button', { name: 'Entrar' }))
      .toBeVisible({ timeout: 10000 });
  });

});