import { test as setup } from '@playwright/test';

setup('autenticar usuário', async ({ page }) => {

  await page.goto('http://127.0.0.1:5500/index.html');

  await page.getByRole('textbox', {
    name: 'Login ou e-mail'
  }).fill('nicolas');

  await page.getByRole('textbox', {
    name: 'Senha'
  }).fill('Aranjiex22@@');

  await page.getByRole('button', {
    name: 'Entrar'
  }).click();

  await page.waitForTimeout(3000);

  await page.context().storageState({
    path: 'playwright/.auth/admin.json'
  });

});