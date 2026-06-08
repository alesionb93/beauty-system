import { test, expect } from '@playwright/test';
import { loginRobusto } from './_helpers.js';

test('CT007 - Logout colaborador', async ({ page }) => {
  await loginRobusto(page, 'nicolas', 'Aranjiex22@@');

  await page.waitForURL(/agenda\.html/, { timeout: 20000 });

  await page.waitForFunction(
    () => document.querySelectorAll('.sk-overlay').length === 0,
    null,
    { timeout: 15000 }
  );

  await page.waitForFunction(() => {
    const days = document.querySelectorAll('#calendar-days .calendar-day, #calendar-days > *');
    const dayPanel = document.querySelector('#day-appointments');
    const monthLabel = document.getElementById('month-year')?.textContent?.trim();
    return days.length >= 28
        && !!dayPanel && dayPanel.children.length > 0
        && !!monthLabel && monthLabel.length > 0;
  }, null, { timeout: 20000 });

  await page.waitForFunction(() => {
    return Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
  }, null, { timeout: 10000 });

  await expect(async () => {
    await page.locator('#btn-sair').click();
    await expect(page).toHaveURL(/index\.html/, { timeout: 1500 });
  }).toPass({ timeout: 20000, intervals: [500, 1000, 1500] });

  await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible();

  const tenant = await page.evaluate(() => localStorage.getItem('currentTenantId'));
  expect(tenant).toBeNull();
});
