import { test, expect } from '@playwright/test';
import { loginRobusto } from './_helpers.js';

test('CT004 - Usuario inativo', async ({ page }) => {
  await loginRobusto(page, 'colabuser@gmail.com', 'Aranjiex22@@');
  await expect(page.getByText(/Usuário inativo/i)).toBeVisible({ timeout: 15000 });
});
