import { test, expect } from '@playwright/test';

test('CT006 - Logout master admin', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByRole('textbox', { name: 'Login ou e-mail' }).click();
  await page.getByRole('textbox', { name: 'Login ou e-mail' }).fill('alesio');
  await page.getByRole('textbox', { name: 'Senha' }).click();
  await page.getByRole('textbox', { name: 'Senha' }).fill('Aranjiex22@@');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('button', { name: ' Sair' }).click();
  await page.getByText('— Sistema de Agendamento —').click();
  await page.goto('/index.html');
});