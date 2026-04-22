const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.setTimeout(60000);

test(
'E2E criação de usuário - fase 1 navegação',
async ({ page }) => {

  await login(page, {
    email: 'ander@gmail.com',
    senha: 'Aranjiex22@@'
  });

  const uniqueEmail =
   `alesioltda+${Date.now()}@proton.me`;

  console.log('Email de teste:', uniqueEmail);

  await page.waitForLoadState('networkidle');

  // Configurações
  await page
    .getByRole('button', { name: /Configurações/ })
    .click();

  // Usuários
  await page
    .getByRole('button', { name: /Usuários/ })
    .click();

  // Novo Usuário
  await page
    .getByRole('button', { name: /Novo Usuário/ })
    .click();

  // Nome
  await page
    .getByRole('textbox', {
      name: 'Nome completo'
    })
    .fill('Usuario Automacao');

  // Email (seletor real do codegen)
  await page
    .getByRole('textbox', {
      name: 'email@exemplo.com'
    })
    .fill(uniqueEmail);

  // valida email preenchido
  await expect(
    page.getByDisplayValue(uniqueEmail)
  ).toBeVisible();

});