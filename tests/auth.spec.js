// tests/auth.spec.js

const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('./helpers/auth');

test.describe('🔐 Autenticação & Segurança', () => {

  test('TC-AUTH-01 — Login válido', async ({ page }) => {

    await page.goto(`${BASE_URL}/index.html`);

    await page.fill('input[type="email"]', 'alesionb93@gmail.com');
    await page.fill('input[type="password"]', 'Aranjiex22@@');

    await page.click('#btn-login');

    await expect(page).toHaveURL(
      /agenda|select-tenant/,
      { timeout:15000 }
    );

  });


  test('TC-AUTH-02 — Senha inválida', async ({ page }) => {

    await page.goto(`${BASE_URL}/index.html`);

    await page.fill('input[type="email"]', 'alesionb93@gmail.com');
    await page.fill('input[type="password"]', 'senha-errada-xyz');

    await page.click('#btn-login');

    await expect(page).not.toHaveURL(/agenda|select-tenant/);

    await expect(
      page.getByText('Email ou senha incorretos.')
    ).toBeVisible();

  });


  test('TC-AUTH-03 — Usuário inativo bloqueado', async ({ page }) => {

    await page.goto(`${BASE_URL}/index.html`);

    await page.fill(
      'input[type="email"]',
      'colabuser@gmail.com'
    );

    await page.fill(
      'input[type="password"]',
      'Aranjiex22@@'
    );

    await page.click('#btn-login');

    await page.waitForTimeout(2000);

    await expect(page).not.toHaveURL(/agenda/);

  });


  test('TC-AUTH-04 — Logout limpa sessão', async ({ page }) => {

    // LOGIN

    await page.goto(`${BASE_URL}/index.html`);

    await page.fill(
      'input[type="email"]',
      'ander@gmail.com'
    );

    await page.fill(
      'input[type="password"]',
      'Aranjiex22@@'
    );

    await page.click('#btn-login');

    await expect(page).toHaveURL(
      /agenda|select-tenant/,
      { timeout:15000 }
    );


    // GARANTE QUE A SIDEBAR CARREGOU
    await page.waitForTimeout(3000);


    // TENTATIVA 1
    try {

      await page.locator('#btn-sair').click({
        timeout:3000
      });

    } catch {

      // TENTATIVA 2
      try {

        await page.getByText('Sair').click({
          timeout:3000
        });

      } catch {

        // TENTATIVA 3 (FORÇA)
        await page.evaluate(() => {

          document
            .querySelector('#btn-sair')
            ?.click();

        });

      }

    }


    // VALIDA VOLTA LOGIN

    await expect(
      page
    ).toHaveURL(
      /index\.html|\/$/,
      { timeout:10000 }
    );


    // TENTA ACESSAR URL DIRETA

    await page.goto(
      `${BASE_URL}/agenda.html`
    );

    await page.waitForTimeout(1500);

    await expect(page).toHaveURL(
      /index\.html|\/$/
    );


    // SESSÃO LIMPA

    const hasSession = await page.evaluate(() => {

      const keys = Object.keys(localStorage);

      return keys.some(
        k =>
          k.includes('supabase') ||
          k.includes('sb-')
      );

    });

    expect(hasSession).toBe(false);

  });

});