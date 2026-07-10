import { test, expect } from '@playwright/test';
import { loginRobusto } from './_helpers.js';

test('CT003 - Senha invalida', async ({ page }) => {
  await loginRobusto(page, 'alesionb', 'katakon123');
  await expect(page.getByText('Login ou senha incorretos.')).toBeVisible({ timeout: 15000 });
});
