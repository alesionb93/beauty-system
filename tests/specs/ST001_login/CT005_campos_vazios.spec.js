import { test, expect } from '@playwright/test';
import { abrirLogin } from './_helpers.js';

test('CT005 - Campos vazios', async ({ page }) => {
  const { entrar } = await abrirLogin(page);
  await entrar.click();
  await expect(page.getByText('Preencha login e senha.')).toBeVisible({ timeout: 10000 });
});
