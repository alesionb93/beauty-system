import { test, expect } from '@playwright/test';

test('CT004 - Usuario inativo', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByRole('textbox', { name: 'Login ou e-mail' }).click();
  await page.getByRole('textbox', { name: 'Login ou e-mail' }).fill('colabuser@gmail.com');
  await page.getByRole('textbox', { name: 'Senha' }).click();
  await page.getByRole('textbox', { name: 'Senha' }).fill('Aranjiex22@@');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByText('Usuário inativo. Contate o').click();
});