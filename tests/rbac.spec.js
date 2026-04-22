// tests/rbac.spec.js
// 🔌 Supabase / RBAC / Modais
// Cobre: TC-SUP-01, TC-SUP-04, TC-RBC-01, TC-MOD-04
//
// ⚠️ TC-SUP-04 é melhor como API TEST (chama edge function direto)
//    do que como UI test — está implementado via request fixture do Playwright.
//
// Dependências:
//  - Login admin e colaborador funcionando
//  - SUPABASE_URL e SUPABASE_ANON_KEY no env (para TC-SUP-04)
//  - Edge function `admin-create-user` deployada

const { test, expect, request: pwRequest } = require('@playwright/test');
const { BASE_URL, USERS, loginAsAdmin, loginAsColaborador } = require('./helpers/auth');

const SUPABASE_URL      = process.env.SUPABASE_URL      || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

test.describe('🔌 Supabase / RBAC / Modais', () => {

  test('TC-SUP-01 — Persistência após F5 [ALTO]', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/agenda.html#usuarios`);
    await page.waitForSelector('[data-testid="lista-usuarios"], #lista-usuarios, .usuarios-grid', { timeout: 10000 });

    // Captura estado antes do reload
    const cardsAntes = await page.locator('[data-testid="card-usuario"], .card-usuario').count();
    expect(cardsAntes).toBeGreaterThan(0);

    // F5
    await page.reload();
    await page.waitForSelector('[data-testid="lista-usuarios"], #lista-usuarios, .usuarios-grid', { timeout: 10000 });

    const cardsDepois = await page.locator('[data-testid="card-usuario"], .card-usuario').count();
    expect(cardsDepois).toBe(cardsAntes);

    // Sessão ainda válida (não voltou pra login)
    expect(page.url()).not.toMatch(/index\.html$/);
  });

  test('TC-SUP-04 — Edge function valida role admin [CRÍTICO] [API TEST]', async ({ playwright }) => {
    // Esse teste é melhor executado via API direto na edge function.
    // Pula se as variáveis de ambiente Supabase não estiverem configuradas.
    test.skip(!SUPABASE_URL || !SUPABASE_ANON_KEY, 'SUPABASE_URL/ANON_KEY não configurados');

    const apiCtx = await playwright.request.newContext();

    // 1) Login como COLABORADOR (não-admin) via Supabase auth
    const loginRes = await apiCtx.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      data: { email: USERS.colaborador.email, password: USERS.colaborador.senha },
    });
    expect(loginRes.ok()).toBeTruthy();
    const { access_token } = await loginRes.json();

    // 2) Tenta chamar a edge function admin-create-user com token de colaborador
    const fnRes = await apiCtx.post(`${SUPABASE_URL}/functions/v1/admin-create-user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      data: { nome: 'Hacker', email: `hack.${Date.now()}@qa.test`, senha: 'SenhaForte@123' },
    });

    // Edge function DEVE retornar 401/403
    expect([401, 403]).toContain(fnRes.status());

    const body = await fnRes.json().catch(() => ({}));
    expect(JSON.stringify(body)).toMatch(/forbidden|unauthorized|admin|permission/i);
  });

  test('TC-RBC-01 — Colaborador NÃO vê tela de usuários [CRÍTICO]', async ({ page }) => {
    await loginAsColaborador(page);
    await page.goto(`${BASE_URL}/agenda.html`);
    await page.waitForLoadState('networkidle');

    // Item "Usuários" no menu não deve estar visível
    const menuUsuarios = page.locator('[data-testid="menu-usuarios"], a[href*="#usuarios"], nav >> text=/Usuários/i');
    await expect(menuUsuarios).toHaveCount(0);

    // Acesso direto via hash deve ser bloqueado/redirecionado
    await page.goto(`${BASE_URL}/agenda.html#usuarios`);
    await page.waitForTimeout(1500);

    // Não deve ver a lista de usuários
    const lista = page.locator('[data-testid="lista-usuarios"], #lista-usuarios');
    await expect(lista).toBeHidden();
  });

  test('TC-MOD-04 — Modal NÃO fecha quando submit falha [ALTO]', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/agenda.html#usuarios`);
    await page.waitForSelector('[data-testid="lista-usuarios"], #lista-usuarios, .usuarios-grid', { timeout: 10000 });

    // Mocka a edge function para responder 500
    await page.route('**/functions/v1/admin-create-user', route =>
      route.fulfill({ status: 500, contentType: 'application/json',
        body: JSON.stringify({ error: 'Erro interno simulado' }) }),
    );

    await page.click('[data-testid="btn-novo-usuario"], #btn-novo-usuario');
    await page.fill('[data-testid="input-nome"], #input-nome',   'Erro Teste');
    await page.fill('[data-testid="input-email"], #input-email', `erro.${Date.now()}@qa.test`);
    await page.fill('[data-testid="input-senha"], #input-senha', 'SenhaForte@123');
    await page.click('[data-testid="btn-confirmar-criar"], #btn-confirmar-criar');

    // Toast de erro aparece
    await expect(page.locator('.toast-error, [data-testid="toast-error"]').first()).toBeVisible({ timeout: 5000 });
    // Modal CONTINUA aberto para o usuário corrigir
    await expect(page.locator('[data-testid="modal-novo-usuario"], #modal-novo-usuario')).toBeVisible();
  });

});
