import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://127.0.0.1:5500/index.html');
  await page.getByRole('textbox', { name: 'Login ou e-mail' }).click();
  await page.getByRole('textbox', { name: 'Login ou e-mail' }).fill('alesio');
  await page.getByRole('textbox', { name: 'Senha' }).click();
  await page.getByRole('textbox', { name: 'Senha' }).fill('Aranjiex22@@');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(
  page.getByText('SELECIONE O CLIENTE')
).toBeVisible();
});
PS C:\Users\SuperFast\Documents\Slotify> npm list playwright
beauti-system@1.0.0 C:\Users\SuperFast\Documents\Slotify
`-- @playwright/test@1.59.1
  `-- playwright@1.59.1

PS C:\Users\SuperFast\Documents\Slotify> npm list @playwright/test
beauti-system@1.0.0 C:\Users\SuperFast\Documents\Slotify
`-- @playwright/test@1.59.1

PS C:\Users\SuperFast\Documents\Slotify>