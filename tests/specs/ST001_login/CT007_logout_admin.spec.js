import { test, expect } from '@playwright/test';

test('CT007 - Logout colaborador', async ({ page }) => {
  await page.goto('/index.html');

  await page.getByRole('textbox', { name: 'Login ou e-mail' }).fill('nicolas');
  await page.getByRole('textbox', { name: 'Senha' }).fill('Aranjiex22@@');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // 1) Chegou na agenda
  await page.waitForURL(/agenda\.html/);

  // 2) Skeleton terminou
  await page.waitForFunction(
    () => document.querySelectorAll('.sk-overlay').length === 0,
    null,
    { timeout: 15000 }
  );

  // 3) Init da agenda terminou de fato:
  //    - calendário com dias renderizados (loadAppointments rodou)
  //    - painel do dia já populado (loadBloqueios é a última etapa antes do listener)
  await page.waitForFunction(() => {
    const days = document.querySelectorAll('#calendar-days .calendar-day, #calendar-days > *');
    const dayPanel = document.querySelector('#day-appointments');
    const monthLabel = document.getElementById('month-year')?.textContent?.trim();
    return days.length >= 28
        && !!dayPanel && dayPanel.children.length > 0
        && !!monthLabel && monthLabel.length > 0;
  }, null, { timeout: 20000 });

  // 4) Token Supabase já presente em localStorage (sessão estabelecida)
  await page.waitForFunction(() => {
    return Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
  }, null, { timeout: 10000 });

  // 5) Clica com retry: enquanto o handler ainda não foi anexado,
  //    o clique é no-op e a URL não muda. expect.toPass refaz até funcionar.
  await expect(async () => {
    await page.locator('#btn-sair').click();
    await expect(page).toHaveURL(/index\.html/, { timeout: 1500 });
  }).toPass({ timeout: 20000, intervals: [500, 1000, 1500] });

  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();

  // Sanidade: tenant limpo
  const tenant = await page.evaluate(() => localStorage.getItem('currentTenantId'));
  expect(tenant).toBeNull();
});
