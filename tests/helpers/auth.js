// tests/helpers/auth.js
// v6 — Corrige net::ERR_ABORTED em regressão CI.
//
// Causa raiz do ERR_ABORTED (CT008/CT009/CT017/CT020/CT021):
//
//   v5 fazia:
//     1) context.clearCookies()
//     2) page.goto('/index.html', { waitUntil: 'domcontentloaded' })
//        -> nesse momento localStorage AINDA contém o token do teste anterior;
//           o bootstrap do Slotify detecta sessão válida e dispara
//           location.replace('/agenda...') durante o load.
//           Isso aborta o goto em curso => net::ERR_ABORTED.
//     3) localStorage.clear()
//     4) page.goto('/index.html', { waitUntil: 'load' })
//        -> se o redirect client-side do passo 2 ainda estiver em voo,
//           este segundo goto também é cancelado => net::ERR_ABORTED.
//
//   Os specs que falham são exatamente os que rodam logo após um teste
//   que deixou storage com token válido (CT008 depois de CT007, CT017
//   depois de CT016, CT020/CT021 na cauda da regressão). Daí o padrão
//   16 OK / 5 falhas — não é ambiente fora.
//
// Correção v6:
//   - Limpamos storage em about:blank usando o contexto, ANTES de tocar
//     no host do app. Sem origem do app carregada, não há bootstrap, não
//     há redirect, não há ERR_ABORTED.
//   - Tolerância explícita a ERR_ABORTED em qualquer goto (se o app
//     resolveu fazer um redirect client-side, isso é sucesso, não falha:
//     verificamos a URL pós-navegação).
//   - Removido o goto duplicado: a tela de login é carregada uma única
//     vez, com waitUntil:'domcontentloaded' (a tela é estática e simples).
//   - Lógica de detecção de sucesso (multi-sinal) e select-tenant mantida.

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
// goto tolerante a ERR_ABORTED.
// Se o app redireciona client-side (location.replace) durante o load, o
// Chromium aborta a navegação original e o Playwright lança
// "net::ERR_ABORTED". Para nós isso é sucesso: a página efetivamente saiu
// do /index.html. Validamos pela URL final.
// ---------------------------------------------------------------------------
async function gotoTolerante(page, url, opts = {}) {
  try {
    await page.goto(url, opts);
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/ERR_ABORTED|frame was detached|navigation interrupted/i.test(msg)) {
      log(`goto abortado (provavelmente redirect client-side): ${msg.split('\n')[0]}`);
      // Aguarda a navegação resultante se houver uma em curso.
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      return;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Higienização do contexto ANTES de qualquer goto no host do app.
//
// Estratégia: limpar cookies via API do contexto (não precisa de página
// carregada) e limpar storage por origem usando o CDP (Storage.clearDataForOrigin)
// — funciona em about:blank. Se CDP não estiver disponível (não-chromium),
// caímos no fallback: goto rápido só para obter origem.
// ---------------------------------------------------------------------------
async function limparContexto(page) {
  try { await page.context().clearCookies(); } catch (_) {}

  // Tenta via CDP (Chromium) — não exige carregar o app.
  let limpouViaCdp = false;
  try {
    const origin = new URL(BASE_URL).origin;
    const client = await page.context().newCDPSession(page);
    await client.send('Storage.clearDataForOrigin', {
      origin,
      storageTypes: 'all',
    });
    await client.detach().catch(() => {});
    limpouViaCdp = true;
    log(`storage limpo via CDP para origin=${origin}`);
  } catch (e) {
    log(`CDP indisponível (${(e && e.message || e).toString().split('\n')[0]}) — usando fallback`);
  }

  if (limpouViaCdp) return;

  // Fallback (browsers não-Chromium): goto curto, com commit, ignorando aborts.
  // 'commit' retorna assim que o servidor responde — sem dar tempo de o
  // bootstrap do app rodar e disparar redirect.
  await gotoTolerante(page, `${BASE_URL}/index.html`, { waitUntil: 'commit', timeout: 15000 });
  try {
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

// Sonda de sessão por token persistido.
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
 * Login genérico (admin/colab/master). Tolerante a ERR_ABORTED.
 */
async function login(page, { email, senha }) {
  await gotoTolerante(page, `${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', senha);
  await page.click('#btn-login');
  await page.waitForURL(/agenda|select-tenant/, { timeout: 15000 });
}

async function loginAsAdmin(page)       { return login(page, USERS.admin); }
async function loginAsColaborador(page) { return login(page, USERS.colaborador); }
async function loginAsMaster(page)      { return login(page, USERS.master); }

/**
 * Login do Slotify (CT008–CT021). v6 — ERR_ABORTED tolerado.
 */
async function loginSlotify(page) {
  const LOGIN_USER = process.env.QA_SLOTIFY_USER || 'automacao';
  const LOGIN_PASS = process.env.QA_SLOTIFY_PASS || 'Aranjiex22@@';
  const POST_CLICK_TIMEOUT = 25000;
  const t0 = Date.now();

  log('login iniciado');

  // 1) Higieniza contexto SEM carregar o app (CDP em about:blank).
  await limparContexto(page);

  // 2) Carrega tela de login. domcontentloaded é suficiente — a tela é
  //    estática (sem fetches que importem para enxergar o form). Usar
  //    'load' aqui era o que estourava ERR_ABORTED em regressão se um
  //    redirect client-side residual entrasse em ação.
  await gotoTolerante(page, `${BASE_URL}/index.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Se o app já está autenticado por algum motivo (caso raro: clearData
  // não pegou IndexedDB num browser não-Chromium), seguimos para agenda.
  if (/\/agenda/i.test(page.url())) {
    log(`já autenticado após goto (url=${page.url()}) — pulando form`);
  } else {
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    const campoLogin    = page.getByRole('textbox', { name: 'Login ou e-mail' });
    const campoSenha    = page.getByRole('textbox', { name: 'Senha' });
    const btnEntrar     = page.getByRole('button',  { name: 'Entrar' });
    const erroPreencha  = page.getByText(/Preencha login e senha/i);

    await campoLogin.waitFor({ state: 'visible', timeout: 15000 });
    await campoSenha.waitFor({ state: 'visible', timeout: 5000 });
    await btnEntrar.waitFor({ state: 'visible', timeout: 5000 });

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

    const headingAgenda = page.getByRole('heading', { name: /Agendamentos/i });
    const btnNovo       = page.getByRole('button',  { name: /\+\s*Novo/i });

    const aguardarResultado = async (timeout) => {
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
        `Verifique credenciais (QA_SLOTIFY_USER/PASS), BASE_URL e backend no CI.`
      );
    }

    if (resultado === 'ok-tenant' || /select-tenant/i.test(page.url())) {
      log('select-tenant detectado — escolhendo primeiro tenant');
      const tenant = page.locator(
        '[data-testid="tenant-card"], .tenant-card, [data-tenant-id], button:has-text("Selecionar")'
      ).first();
      await tenant.click({ timeout: 8000 }).catch(() => {});
      await page.waitForURL(/agenda/, { timeout: 15000 }).catch(() => {});
    }
  }

  // Confirmação final — "+ Novo" visível e habilitado (agenda interagível).
  const btnNovoFinal = page.getByRole('button', { name: /\+\s*Novo/i });
  await expect(btnNovoFinal).toBeVisible({ timeout: 20000 });
  await expect(btnNovoFinal).toBeEnabled({ timeout: 20000 });

  log(`login concluído em ${Date.now() - t0}ms — url=${page.url()}`);
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
