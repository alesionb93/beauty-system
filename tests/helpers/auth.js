async function loginSlotify(page) {
  const LOGIN_USER = process.env.QA_SLOTIFY_USER || 'automacao';
  const LOGIN_PASS = process.env.QA_SLOTIFY_PASS || 'Aranjiex22@@';

  const LOGIN_TIMEOUT =
    process.env.CI ? 30000 : 15000;

  const t0 = Date.now();

  log('login iniciado');

  await page.goto(`${BASE_URL}/index.html`, {
    waitUntil: 'domcontentloaded'
  });

  const campoLogin = page.getByRole('textbox', {
    name: 'Login ou e-mail'
  });

  const campoSenha = page.getByRole('textbox', {
    name: 'Senha'
  });

  const btnEntrar = page.getByRole('button', {
    name: 'Entrar'
  });

  // Evita strict mode violation
  const headingAgenda = page.locator('#page-agendamentos h2');

  const btnNovo = page.getByRole('button', {
    name: /\+\s*Novo/i
  });

  const erroPreencha = page.getByText(
    /Preencha login e senha/i
  );

  await campoLogin.waitFor({
    state: 'visible',
    timeout: LOGIN_TIMEOUT
  });

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

  const aguardarResultado = async (timeout) => {
    return Promise.race([
      headingAgenda
        .waitFor({
          state: 'visible',
          timeout
        })
        .then(() => 'ok'),

      btnNovo
        .waitFor({
          state: 'visible',
          timeout
        })
        .then(() => 'ok'),

      page
        .waitForURL(/agenda/, {
          timeout
        })
        .then(() => 'ok'),

      erroPreencha
        .waitFor({
          state: 'visible',
          timeout
        })
        .then(() => 'erro-preencha')
    ]).catch(() => 'timeout');
  };

  let resultado = await aguardarResultado(8000);

  if (resultado === 'erro-preencha') {
    log(
      'UI rejeitou credenciais (Preencha login e senha) — re-tentando'
    );

    await tentarLogin();

    resultado = await aguardarResultado(
      LOGIN_TIMEOUT - (Date.now() - t0)
    );
  }

  if (resultado !== 'ok') {
    const url = page.url();

    log(
      `login falhou — url=${url} resultado=${resultado}`
    );

    throw new Error(
      `[auth.loginSlotify] Login não concluído após ${LOGIN_TIMEOUT}ms. ` +
      `URL atual: ${url}. Última condição: ${resultado}. ` +
      `A tela de login ainda está visível — verifique credenciais ` +
      `(QA_SLOTIFY_USER/PASS), BASE_URL e disponibilidade do backend no CI.`
    );
  }

  await Promise.any([
    headingAgenda.waitFor({
      state: 'visible',
      timeout: 5000
    }),

    btnNovo.waitFor({
      state: 'visible',
      timeout: 5000
    })
  ]).catch(() => {});

  log(
    `login concluído em ${Date.now() - t0}ms — url=${page.url()}`
  );
}