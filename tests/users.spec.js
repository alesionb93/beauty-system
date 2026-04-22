// tests/users.spec.js
// 👥 Gestão de Usuários
// Cobre: TC-USR-02, TC-USR-03, TC-USR-04
//
// Dependências:
//  - Login admin (beforeEach)
//  - Edge function `admin-create-user` deployada
//  - Tenant precisa ter slot disponível (< 3 ativos) para TC-USR-02
//
// ⚠️ Esses testes CRIAM dados — recomenda-se rodar contra ambiente de QA
//    com cleanup posterior, ou usar emails únicos por execução (timestamp).

const { test, expect } = require('@playwright/test');
const { BASE_URL, loginAsAdmin } = require('./helpers/auth');

test.describe('👥 Gestão de Usuários', () => {

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/agenda.html#usuarios`);
    // Aguarda a tela de usuários carregar
    await page.waitForSelector('[data-testid="lista-usuarios"], #lista-usuarios, .usuarios-grid', { timeout: 10000 });
  });

  test('TC-USR-02 — Criar usuário colaborador válido [ALTO]', async ({ page }) => {
    const emailUnico = `colab.${Date.now()}@qa.test`;

    await page.click('[data-testid="btn-novo-usuario"], #btn-novo-usuario');
    await page.fill('[data-testid="input-nome"], #input-nome',     'Colab QA Auto');
    await page.fill('[data-testid="input-email"], #input-email',   emailUnico);
    await page.fill('[data-testid="input-senha"], #input-senha',   'SenhaForte@123');
    // Permissão padrão = colaborador
    await page.click('[data-testid="btn-confirmar-criar"], #btn-confirmar-criar');

    // Toast de sucesso
    await expect(page.locator('.toast-success, [data-testid="toast-success"]')).toBeVisible({ timeout: 8000 });

    // Card aparece na lista
    await expect(page.locator(`text=${emailUnico}`)).toBeVisible();
  });

  test('TC-USR-03 — Criar usuário com email duplicado é bloqueado [ALTO]', async ({ page }) => {
    // ⚠️ SEED: usar um email que JÁ EXISTE no tenant (ex: do admin)
    const emailExistente = process.env.QA_ADMIN_EMAIL || 'admin.qa@beautysystem.test';

    await page.click('[data-testid="btn-novo-usuario"], #btn-novo-usuario');
    await page.fill('[data-testid="input-nome"], #input-nome',   'Duplicado');
    await page.fill('[data-testid="input-email"], #input-email', emailExistente);
    await page.fill('[data-testid="input-senha"], #input-senha', 'SenhaForte@123');
    await page.click('[data-testid="btn-confirmar-criar"], #btn-confirmar-criar');

    // Erro visível, modal continua aberto (regra TC-MOD-04)
    await expect(page.locator('text=/já existe|duplicad|already|cadastrad/i').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="modal-novo-usuario"], #modal-novo-usuario')).toBeVisible();
  });

  test('TC-USR-04 — Criar usuário com senha curta é bloqueado [MÉDIO]', async ({ page }) => {
    await page.click('[data-testid="btn-novo-usuario"], #btn-novo-usuario');
    await page.fill('[data-testid="input-nome"], #input-nome',   'Senha Curta');
    await page.fill('[data-testid="input-email"], #input-email', `curta.${Date.now()}@qa.test`);
    await page.fill('[data-testid="input-senha"], #input-senha', '123');
    await page.click('[data-testid="btn-confirmar-criar"], #btn-confirmar-criar');

    // Validação client-side OU server-side deve barrar
    await expect(page.locator('text=/mínim|6 caracter|senha curta|password/i').first()).toBeVisible({ timeout: 5000 });
    // Modal continua aberto
    await expect(page.locator('[data-testid="modal-novo-usuario"], #modal-novo-usuario')).toBeVisible();
  });

});
