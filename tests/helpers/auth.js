// tests/helpers/auth.js
// Helpers de autenticação reutilizáveis pela suíte.
// Reaproveita o padrão do tests/login.spec.js já existente no projeto.
//
// IMPORTANTE: ajuste estas constantes no .env ou diretamente abaixo
// conforme as credenciais de teste do seu ambiente Supabase de QA.

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5500';

// Contas de teste — substitua pelos seeds reais do seu ambiente de QA.
// Recomendação: criar essas contas via script de seed antes de rodar a suíte.
const USERS = {
  admin: {
    email: process.env.QA_ADMIN_EMAIL || 'admin.qa@beautysystem.test',
    senha: process.env.QA_ADMIN_PASS  || 'AdminQA@123',
  },
  colaborador: {
    email: process.env.QA_COLAB_EMAIL || 'colab.qa@beautysystem.test',
    senha: process.env.QA_COLAB_PASS  || 'ColabQA@123',
  },
  inativo: {
    email: process.env.QA_INATIVO_EMAIL || 'inativo.qa@beautysystem.test',
    senha: process.env.QA_INATIVO_PASS  || 'InativoQA@123',
  },
  master: {
    email: process.env.QA_MASTER_EMAIL || 'master.qa@beautysystem.test',
    senha: process.env.QA_MASTER_PASS  || 'MasterQA@123',
  },
};

/**
 * Faz login na aplicação. Mesmo padrão do login.spec.js existente.
 * Após login, espera redirect para /agenda ou /select-tenant.
 */
async function login(page, { email, senha }) {
  await page.goto(`${BASE_URL}/index.html`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', senha);
  await page.click('#btn-login');
  await page.waitForURL(/agenda|select-tenant/, { timeout: 15000 });
}

async function loginAsAdmin(page)        { return login(page, USERS.admin); }
async function loginAsColaborador(page)  { return login(page, USERS.colaborador); }
async function loginAsMaster(page)       { return login(page, USERS.master); }

/**
 * Garante que estamos na tela /agenda (caso o login caia em select-tenant
 * por o usuário ter múltiplos tenants).
 */
async function ensureOnAgenda(page) {
  if (page.url().includes('select-tenant')) {
    // Seleciona o primeiro tenant disponível
    await page.click('[data-testid="tenant-card"]:first-child, .tenant-card:first-child');
    await page.waitForURL(/agenda/, { timeout: 10000 });
  }
}

/**
 * Logout via botão da UI. Se o seletor mudar, ajustar aqui.
 */
async function logout(page) {
  await page.click('[data-testid="btn-logout"], #btn-logout, button:has-text("Sair")');
  await page.waitForURL(/index\.html|\/$/, { timeout: 10000 });
}

module.exports = {
  BASE_URL,
  USERS,
  login,
  loginAsAdmin,
  loginAsColaborador,
  loginAsMaster,
  ensureOnAgenda,
  logout,
};
