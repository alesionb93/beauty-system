import { test, expect } from '@playwright/test';

test('CT003 - Senha invalida', async ({ page }) => {
  await page.goto('http://127.0.0.1:5500/index.html');
  await page.getByRole('textbox', { name: 'Login ou e-mail' }).click();
  await page.getByRole('textbox', { name: 'Login ou e-mail' }).fill('alesionb');
  await page.getByRole('textbox', { name: 'Login ou e-mail' }).press('Tab');
  await page.getByRole('textbox', { name: 'Senha' }).fill('katakon123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByText('Login ou senha incorretos.').click();
});