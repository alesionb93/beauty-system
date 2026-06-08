import { test, expect } from '@playwright/test';

test('CT005 - Campos vazios', async ({ page }) => {
  await page.goto('http://127.0.0.1:5500/index.html');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByText('Preencha login e senha.').click();
  await page.goto('http://127.0.0.1:5500/index.html');
});