import { test as setup, expect } from '@playwright/test';
import { loginRobusto } from './_helpers.js';

setup('autenticar usuário', async ({ page }) => {
  await loginRobusto(page, 'nicolas', 'Aranjiex22@@');
  // Espera sinal real de sessão, não timeout fixo
  await page.waitForURL(/agenda\.html/, { timeout: 20000 });
  await page.waitForFunction(
    () => Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token')),
    null,
    { timeout: 15000 }
  );
  await page.context().storageState({ path: 'playwright/.auth/admin.json' });
});
