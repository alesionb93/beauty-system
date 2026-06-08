import { test, expect } from '@playwright/test';
import { loginRobusto } from './_helpers.js';

test('CT006 - Logout master admin', async ({ page }) => {
  await loginRobusto(page, 'alesio', 'Aranjiex22@@');
  await expect(page.getByText('SELECIONE O CLIENTE')).toBeVisible({ timeout: 15000 });

  const sair = page.getByRole('button', { name: /sair/i });
  await expect(sair).toBeVisible();
  await expect(async () => {
    await sair.click();
    await expect(page).toHaveURL(/index\.html/, { timeout: 1500 });
  }).toPass({ timeout: 15000, intervals: [500, 1000] });

  await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible();
});
