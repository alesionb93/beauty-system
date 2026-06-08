import { test, expect } from '@playwright/test';

test('CT002 - Login admin', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByRole('textbox', { name: 'Login ou e-mail' }).click();
  await page.getByRole('textbox', { name: 'Login ou e-mail' }).fill('nicolas');
  await page.getByRole('textbox', { name: 'Senha' }).click();
  await page.getByRole('textbox', { name: 'Senha' }).fill('Aranjiex22@@');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(
  page.getByRole('heading', { name: 'Agendamentos' })
).toBeVisible();
});