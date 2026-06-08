import { test, expect } from '@playwright/test';
import { loginRobusto } from './_helpers.js';

test('CT001 - Login master admin', async ({ page }) => {
  await loginRobusto(page, 'alesio', 'Aranjiex22@@');
  await expect(page.getByText('SELECIONE O CLIENTE')).toBeVisible({ timeout: 15000 });
});
