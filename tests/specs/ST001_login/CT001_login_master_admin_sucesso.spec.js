import { test, expect } from '@playwright/test';

test('CT001 - Login master admin ', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByRole('textbox', { name: 'Login ou e-mail' }).click();
  await page.getByRole('textbox', { name: 'Login ou e-mail' }).fill('alesio');
  await page.getByRole('textbox', { name: 'Senha' }).click();
  await page.getByRole('textbox', { name: 'Senha' }).fill('Aranjiex22@@');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(
  page.getByText('SELECIONE O CLIENTE')
).toBeVisible();
});
