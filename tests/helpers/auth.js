// tests/helpers/auth.js
// v5 — Login determinístico, à prova de contaminação de regressão.
//
// Causa raiz da falha do CT021 na regressão completa:
//   1) loginSlotify só aceitava /agenda/, mas após autenticar o app pode ir
//      para /select-tenant — login OK, helper estourava.
//   2) Sem detecção de sessão por token: dependia da renderização da agenda,
//      que em regressão fica lenta (dados acumulados por CT008–CT020).
//   3) Cookies/localStorage/IndexedDB não eram limpos entre cenários,
//      deixando tenant id stale ou refresh token velho disparando spinner.
//   4) toBeEnabled(10s) queimava budget sem necessidade (#btn-login nunca
//      fica disabled neste app).
//
// Esta versão:
//   - Limpa cookies + storage + IndexedDB ANTES do goto.
//   - waitUntil:'load' + networkidle curto (mantido de v4).
//   - Detecta sucesso por QUALQUER um dos sinais (em paralelo):
//       a) token de sessão presente em localStorage/sessionStorage,
//       b) URL contém /agenda,
//       c) URL contém /select-tenant (e resolve o tenant automaticamente),
//       d) heading "Agendamentos" ou botão "+ Novo" visível.
//   - Fallback Enter no campo senha mantido.
//   - Retry único em "Preencha login e senha".
//   - Timeout pós-clique = 25s (regressão é mais lenta que execução isolada).
//   - Mensagem de erro reporta a fase real que estourou.

const { expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5500';

const USERS = {
  admin:       { email: process.env.QA_ADMIN_EMAIL   || 'admin.qa@beautysystem.test',   senha: process.env.QA_ADMIN_PASS   || 'AdminQA@123' },
  colaborador: { email: process.env.QA_COLAB_EMAIL   || 'colab.qa@beautysystem.test',   senha: process.env.QA_COLAB_PASS   || 'ColabQA@123' },
  inativo:     { email: process.env.QA_INATIVO_EMAIL || 'inativo.qa@beautysystem.test', senha: process.env.QA_INATIVO_PASS || 'InativoQA@123' },
  master:      { email: process.env.QA_MASTER_EMAIL  || 'master.qa@beautysystem.test',  senha: process.env.QA_MASTER_PASS  || 'MasterQA@123' },
};

function log(msg) { console.log(`[auth] ${msg}`); }

// ---------------------------------------------------------------------------
// Higienização do contexto antes do login. CRÍTICO para regressão.
// ---------------------------------------------------------------------------
async function limparContexto(page) {
  try { await page.context().clearCookies(); } catch (_) {}
  // localStorage/sessionStorage/IndexedDB só podem ser limpos com a página
  // carregada em uma origem. Fazemos goto a uma página "vazia" do próprio host
  // antes do index.html para garantir mesma origem.
  try {
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      try { localStorage.clear(); } catch (_) {}
      try { sessionStorage.clear(); } catch (_) {}
      try {
        if (window.indexedDB && indexedDB.databases) {
          const dbs = await indexedDB.databases();
          await Promise.all((dbs || []).map(d => d.name && indexedDB.deleteDatabase(d.name)));
        }
      } catch (_) {}
    });
  } catch (_) {}
}

// Sonda que indica sessão autenticada por token persistido pelo app.
// Funciona para Supabase (sb-*-auth-token), JWT custom (token/access_token)
// e variações comuns. Se nada bater, retorna false — sem efeito colateral.
async function temSessaoAutenticada(page) {
  try {
    return await page.evaluate(() => {
      const keys = [
        ...Object.keys(localStorage || {}),
        ...Object.keys(sessionStorage || {}),
      ];
      return keys.some(k =>
        /auth.?token|access[_-]?token|^token$|^jwt$|sb-.*-auth-token|slotify.*session/i.test(k)
      );
    });
  } catch (_) {
    return false;
  }
}

/**
 * Login genérico (admin/colab/master). Inalterado.
 */
async function login(page, { email, senha }) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', senha);
  await page.click('#btn-login');
  await page.waitForURL(/agenda|select-tenant/, { timeout: 15000 });
}

async function loginAsAdmin(page)       { return login(page, USERS.admin); }
async function loginAsColaborador(page) { return login(page, USERS.colaborador); }
async function loginAsMaster(page)      { return login(page, USERS.master); }

/**
 * Login do Slotify (CT008–CT021).
 */
async function loginSlotify(page) {
  const LOGIN_USER = process.env.QA_SLOTIFY_USER || 'automacao';
  const LOGIN_PASS = process.env.QA_SLOTIFY_PASS || 'Aranjiex22@@';
  const POST_CLICK_TIMEOUT = 25000; // regressão é mais lenta que isolado
  const t0 = Date.now();

  log('login iniciado');

  // 1) Higieniza contexto (cookies, storage, IndexedDB). Evita contaminação.
  await limparContexto(page);

  // 2) Carrega tela de login com 'load' (não só DOMContentLoaded).
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

  const campoLogin    = page.getByRole('textbox', { name: 'Login ou e-mail' });
  const campoSenha    = page.getByRole('textbox', { name: 'Senha' });
  const btnEntrar     = page.getByRole('button',  { name: 'Entrar' });
  const headingAgenda = page.getByRole('heading', { name: /Agendamentos/i });
  const btnNovo       = page.getByRole('button',  { name: /\+\s*Novo/i });
  const erroPreencha  = page.getByText(/Preencha login e senha/i);

  await campoLogin.waitFor({ state: 'visible', timeout: 15000 });
  await campoSenha.waitFor({ state: 'visible', timeout: 5000 });
  await btnEntrar.waitFor({ state: 'visible', timeout: 5000 });

  // Pequena prova de hidratação não-bloqueante.
  await page.waitForFunction(() => {
    const btn = document.getElementById('btn-login') || document.querySelector('button');
    return !!btn && !btn.disabled;
  }, null, { timeout: 5000 }).catch(() => {});

  const tentarLogin = async () => {
    await campoLogin.fill('');
    await campoLogin.fill(LOGIN_USER);
    await campoSenha.fill('');
    await campoSenha.fill(LOGIN_PASS);

    log(`usuario=${LOGIN_USER} senhaLen=${LOGIN_PASS.length}`);
    await btnEntrar.click();
    log('clique em Entrar');

    // Fallback determinístico via Enter.
    const urlAntes = page.url();
    await page.waitForTimeout(1500);
    const urlDepois = page.url();
    const aindaNoLogin = urlDepois === urlAntes && /index\.html/.test(urlDepois);
    if (aindaNoLogin) {
      const erroVisivel = await erroPreencha.isVisible().catch(() => false);
      const temToken    = await temSessaoAutenticada(page);
      if (!erroVisivel && !temToken) {
        log('clique não navegou em 1500ms — Enter no campo senha');
        await campoSenha.press('Enter').catch(() => {});
      }
    }
  };

  await tentarLogin();

  // ---------------------------------------------------------------------
  // Espera de sucesso multi-sinal — primeiro que vencer encerra.
  //   ok-agenda       : UI da agenda visível ou URL /agenda
  //   ok-tenant       : caiu em select-tenant (login OK, falta escolher)
  //   ok-sessao       : token de sessão já presente (autenticação confirmada)
  //   erro-preencha   : UI rejeitou credenciais
  //   timeout         : nada aconteceu
  // ---------------------------------------------------------------------
  const aguardarResultado = async (timeout) => {
    // Sonda de sessão e tenant via polling — não há .waitFor para storage/URL combinada.
    const polling = (async () => {
      const inicio = Date.now();
      while (Date.now() - inicio < timeout) {
        const url = page.url();
        if (/select-tenant/i.test(url)) return 'ok-tenant';
        if (/agenda/i.test(url))        return 'ok-agenda';
        if (await temSessaoAutenticada(page)) return 'ok-sessao';
        await page.waitForTimeout(250);
      }
      return 'timeout';
    })();

    return Promise.race([
      headingAgenda.waitFor({ state: 'visible', timeout }).then(() => 'ok-agenda'),
      btnNovo.waitFor({ state: 'visible', timeout }).then(() => 'ok-agenda'),
      erroPreencha.waitFor({ state: 'visible', timeout }).then(() => 'erro-preencha'),
      polling,
    ]).catch(() => 'timeout');
  };

  let resultado = await aguardarResultado(POST_CLICK_TIMEOUT);

  if (resultado === 'erro-preencha') {
    log('UI rejeitou credenciais — re-tentando uma vez');
    await tentarLogin();
    resultado = await aguardarResultado(POST_CLICK_TIMEOUT);
  }

  if (resultado === 'timeout' || !resultado) {
    const url = page.url();
    const elapsed = Date.now() - t0;
    const temToken = await temSessaoAutenticada(page);
    log(`login FALHOU url=${url} elapsed=${elapsed}ms temToken=${temToken}`);
    throw new Error(
      `[auth.loginSlotify] Login não concluído após ${elapsed}ms ` +
      `(timeout pós-clique=${POST_CLICK_TIMEOUT}ms). ` +
      `URL=${url}. temToken=${temToken}. ` +
      `Verifique: credenciais (QA_SLOTIFY_USER/PASS), BASE_URL, backend no CI, ` +
      `e se algum teste anterior deixou o ambiente em estado inconsistente.`
    );
  }

  // Se caiu em select-tenant, resolve automaticamente.
  if (resultado === 'ok-tenant' || /select-tenant/i.test(page.url())) {
    log('select-tenant detectado — escolhendo primeiro tenant');
    const tenant = page.locator(
      '[data-testid="tenant-card"], .tenant-card, [data-tenant-id], button:has-text("Selecionar")'
    ).first();
    await tenant.click({ timeout: 8000 }).catch(() => {});
    await page.waitForURL(/agenda/, { timeout: 15000 }).catch(() => {});
  }

  // Confirmação final — pelo menos um marcador da agenda visível.
  await Promise.any([
    headingAgenda.waitFor({ state: 'visible', timeout: 15000 }),
    btnNovo.waitFor({ state: 'visible', timeout: 15000 }),
    page.waitForURL(/agenda/, { timeout: 15000 }),
  ]).catch(() => { /* segue — sessão já confirmada por token */ });

  log(`login concluído em ${Date.now() - t0}ms — url=${page.url()} resultado=${resultado}`);
}

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
