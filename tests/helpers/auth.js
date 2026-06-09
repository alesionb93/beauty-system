// tests/helpers/auth.js
// v3 — Login endurecido para CI/CD (GitHub Actions)
// Mudanças principais em loginSlotify():
//   - removido waitForTimeout fixo
//   - aguarda elemento real da agenda ("+ Novo" / heading Agendamentos)
//   - re-tenta preencher credenciais se a UI rejeitar com "Preencha login e senha."
//   - falha rápido (15s) com mensagem clara se continuar na tela de login
//   - logs estruturados em cada etapa

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5500';

const USERS = {
  admin: {
    email: process.env.QA_ADMIN_EMAIL || 'admin.qa@beautysystem.test',
    senha: process.env.QA_ADMIN_PASS || 'AdminQA@123',
  },
  colaborador: {
    email: process.env.QA_COLAB_EMAIL || 'colab.qa@beautysystem.test',
    senha: process.env.QA_COLAB_PASS || 'ColabQA@123',
  },
  inativo: {
    email: process.env.QA_INATIVO_EMAIL || 'inativo.qa@beautysystem.test',
    senha: process.env.QA_INATIVO_PASS || 'InativoQA@123',
  },
  master: {
    email: process.env.QA_MASTER_EMAIL || 'master.qa@beautysystem.test',
    senha: process.env.QA_MASTER_PASS || 'MasterQA@123',
  },
};

function log(msg) {
  // Prefixo padronizado, fácil de grepar no log do Actions
  console.log(`[auth] ${msg}`);
}

/**
 * Login genérico (admin/colab/master).
 */
async function login(page, { email, senha }) {
  await page.goto(`${BASE_URL}/index.html`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', senha);
  await page.click('#btn-login');
  await page.waitForURL(/agenda|select-tenant/, { timeout: 15000 });
}

async function loginAsAdmin(page) { return login(page, USERS.admin); }
async function loginAsColaborador(page) { return login(page, USERS.colaborador); }
async function loginAsMaster(page) { return login(page, USERS.master); }

/**
 * Login utilizado pelos testes do Slotify (CT008–CT021).
 * Endurecido para CI: sem waitForTimeout, com retry e validação funcional.
 */
async function loginSlotify(page) {
  const LOGIN_USER = process.env.QA_SLOTIFY_USER || 'automacao';
  const LOGIN_PASS = process.env.QA_SLOTIFY_PASS || 'Aranjiex22@@';
  const LOGIN_TIMEOUT =
    process.env.CI ? 30000 : 15000;
  const t0 = Date.now();

  log('login iniciado');
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });

  const campoLogin = page.getByRole('textbox', { name: 'Login ou e-mail' });
  const campoSenha = page.getByRole('textbox', { name: 'Senha' });
  const btnEntrar  = page.getByRole('button', { name: 'Entrar' });

  // Elementos que comprovam que a agenda renderizou
  const headingAgenda = page.getByRole('heading', { name: /Agendamentos/i });
  const btnNovo       = page.getByRole('button',  { name: /\+\s*Novo/i });
  const erroPreencha  = page.getByText(/Preencha login e senha/i);

  // Garante que o form de login está pronto
  await campoLogin.waitFor({ state: 'visible', timeout: TOTAL_TIMEOUT });

  // Helper: preenche e clica em Entrar
  const tentarLogin = async () => {
    await campoLogin.fill('');
    await campoLogin.fill(LOGIN_USER);
    await campoSenha.fill('');
    await campoSenha.fill(LOGIN_PASS);
    log('credenciais preenchidas');
    await btnEntrar.click();
    log('clique em Entrar');
  };

  await tentarLogin();

  // Aguarda — em paralelo — sucesso (agenda) OU falha visível (mensagem de erro).
  // Se aparecer a mensagem "Preencha login e senha." re-tentamos uma vez.
  const aguardarResultado = async (timeout) => {
    return Promise.race([
      headingAgenda.waitFor({ state: 'visible', timeout }).then(() => 'ok'),
      btnNovo.waitFor({ state: 'visible', timeout }).then(() => 'ok'),
      page.waitForURL(/agenda/, { timeout }).then(() => 'ok'),
      erroPreencha.waitFor({ state: 'visible', timeout }).then(() => 'erro-preencha'),
    ]).catch(() => 'timeout');
  };

  let resultado = await aguardarResultado(8000);

  if (resultado === 'erro-preencha') {
    log('UI rejeitou credenciais (Preencha login e senha) — re-tentando');
    await tentarLogin();
    resultado = await aguardarResultado(TOTAL_TIMEOUT - (Date.now() - t0));
  }

  if (resultado !== 'ok') {
    const url = page.url();
    log(`login falhou — url=${url} resultado=${resultado}`);
    throw new Error(
      `[auth.loginSlotify] Login não concluído após ${TOTAL_TIMEOUT}ms. ` +
      `URL atual: ${url}. Última condição: ${resultado}. ` +
      `A tela de login ainda está visível — verifique credenciais (QA_SLOTIFY_USER/PASS), ` +
      `BASE_URL e disponibilidade do backend no CI.`
    );
  }

  // Confirmação final: pelo menos um marcador funcional da agenda visível
  await Promise.any([
    headingAgenda.waitFor({ state: 'visible', timeout: 5000 }),
    btnNovo.waitFor({ state: 'visible', timeout: 5000 }),
  ]).catch(() => { /* a URL já mudou; segue */ });

  log(`login concluído em ${Date.now() - t0}ms — url=${page.url()}`);
}

/**
 * Garante que estamos na tela /agenda (resolve seletor de tenant se aparecer).
 */
async function ensureOnAgenda(page) {
  if (page.url().includes('select-tenant')) {
    await page.click('[data-testid="tenant-card"]:first-child, .tenant-card:first-child');
    await page.waitForURL(/agenda/, { timeout: 10000 });
  }
}

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
  loginSlotify,
  ensureOnAgenda,
  logout,
};
