// Helpers compartilhados para login robusto em CI
import { expect } from '@playwright/test';

export async function abrirLogin(page) {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  // Espera o form estar realmente pronto (DOM + handlers prováveis)
  const login = page.locator('#login, [name="login"], input[type="text"]').first();
  const senha = page.locator('#senha, [name="senha"], input[type="password"]').first();
  const entrar = page.getByRole('button', { name: /entrar/i });
  await expect(login).toBeVisible();
  await expect(login).toBeEditable();
  await expect(senha).toBeVisible();
  await expect(senha).toBeEditable();
  await expect(entrar).toBeVisible();
  await expect(entrar).toBeEnabled();
  // Pequeno yield para garantir que listeners de init terminaram (sem timeout fixo grande)
  await page.waitForLoadState('networkidle').catch(() => {});
  return { login, senha, entrar };
}

// Preenche e VALIDA o valor; se foi sobrescrito por re-render, refaz com retry.
export async function preencherComRetry(locator, valor) {
  await expect(async () => {
    await locator.click();
    await locator.fill('');
    await locator.fill(valor);
    // Se algum handler limpou, tenta digitação char-a-char
    if ((await locator.inputValue()) !== valor) {
      await locator.fill('');
      await locator.pressSequentially(valor, { delay: 20 });
    }
    await expect(locator).toHaveValue(valor, { timeout: 1500 });
  }).toPass({ timeout: 10000, intervals: [200, 400, 800] });
}

export async function loginRobusto(page, usuario, senhaTxt) {
  const { login, senha, entrar } = await abrirLogin(page);
  await preencherComRetry(login, usuario);
  await preencherComRetry(senha, senhaTxt);
  // Reconfirma antes de submeter (defensivo p/ CI)
  await expect(login).toHaveValue(usuario);
  await expect(senha).toHaveValue(senhaTxt);
  await entrar.click();
}
