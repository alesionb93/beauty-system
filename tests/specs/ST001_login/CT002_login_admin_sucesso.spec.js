import { test, expect } from '@playwright/test';
import { loginRobusto } from './_helpers.js';

test('CT002 - Login admin', async ({ page }) => {
  await loginRobusto(page, 'nicolas', 'Aranjiex22@@');
  await expect(page.getByRole('heading', { name: 'Agendamentos' })).toBeVisible({ timeout: 20000 });
});
