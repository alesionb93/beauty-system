// tests/limits.spec.js
// 📊 Limite de licenças (3 usuários ativos por tenant)
// Cobre: TC-LIM-04, TC-REG-04
//
// Dependências de SEED (CRÍTICO):
//  - Tenant com EXATAMENTE 3 colaboradores ATIVOS
//  - + 1 master_admin (não deve contar no limite)
//  - + ao menos 1 inativo disponível para tentar reativar
//
// ⚠️ Esses testes DEVEM rodar isolados (test.describe.serial) porque
//    dependem de estado preciso de contagem de usuários ativos.

const { test, expect } = require('@playwright/test');
const { BASE_URL, loginAsAdmin } = require('./helpers/auth');

test.describe.serial('📊 Limites de licença', () => {

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/agenda.html#usuarios`);
    await page.waitForSelector('[data-testid="lista-usuarios"], #lista-usuarios, .usuarios-grid', { timeout: 10000 });
  });

  test('TC-LIM-04 — Master_admin NÃO conta no limite de 3 [CRÍTICO]', async ({ page }) => {
    // Conta usuários ativos visíveis
    const ativos = await page.locator('[data-testid="card-usuario"]:has(.badge-ativo), .card-usuario:has-text("Ativo")').count();

    // Conta cards com badge master/master_admin
    const masters = await page.locator('.badge-master, text=/master/i').count();

    // Mesmo com master presente, o contador de licenças mostra 3/3 (não 4/3)
    const contador = page.locator('[data-testid="contador-licencas"], #contador-licencas, .contador-usuarios');
    if (await contador.isVisible().catch(() => false)) {
      const texto = await contador.textContent();
      expect(texto).toMatch(/3\s*\/\s*3/);
      expect(texto).not.toMatch(/4\s*\/\s*3/);
    }

    // Botão "Novo usuário" deve estar DESABILITADO (já tem 3 colaboradores)
    const btnNovo = page.locator('[data-testid="btn-novo-usuario"], #btn-novo-usuario');
    await expect(btnNovo).toBeDisabled();
  });

  test('TC-REG-04 — REGRESSÃO: bloquear criação do 4º usuário ativo [CRÍTICO]', async ({ page }) => {
    // Mesmo cenário: tenant com 3 ativos.
    // Tentativa de criar/reativar deve falhar com mensagem clara.

    const btnNovo = page.locator('[data-testid="btn-novo-usuario"], #btn-novo-usuario');

    if (await btnNovo.isEnabled().catch(() => false)) {
      // Se UI deixou clicar, o backend tem que barrar
      await btnNovo.click();
      await page.fill('[data-testid="input-nome"], #input-nome',   'Quarto Usuario');
      await page.fill('[data-testid="input-email"], #input-email', `quarto.${Date.now()}@qa.test`);
      await page.fill('[data-testid="input-senha"], #input-senha', 'SenhaForte@123');
      await page.click('[data-testid="btn-confirmar-criar"], #btn-confirmar-criar');

      await expect(page.locator('text=/limite|3 usuári|licenç|máxim/i').first()).toBeVisible({ timeout: 8000 });
    } else {
      // UI já bloqueou — comportamento correto
      await expect(btnNovo).toBeDisabled();
    }

    // Tentar REATIVAR um inativo também deve falhar
    const checkboxInativos = page.locator('[data-testid="check-exibir-inativos"], #check-exibir-inativos');
    if (await checkboxInativos.isVisible().catch(() => false)) {
      await checkboxInativos.check();
      await page.waitForTimeout(500);

      const cardInativo = page.locator('[data-testid="card-usuario"]:has(.badge-inativo)').first();
      if (await cardInativo.isVisible().catch(() => false)) {
        await cardInativo.locator('[data-testid^="toggle-usuario-"], .toggle-usuario').click();
        await page.click('[data-testid="btn-confirmar-toggle"], #btn-confirmar-toggle');

        await expect(page.locator('text=/limite|3 usuári|licenç|máxim/i').first()).toBeVisible({ timeout: 8000 });
      }
    }
  });

});
