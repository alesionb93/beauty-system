import { test, expect } from '@playwright/test';

test('CT005 - Campos vazios', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByText('Preencha login e senha.').click();
  await page.goto('/index.html');
});