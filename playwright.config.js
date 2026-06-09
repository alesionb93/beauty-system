// playwright.config.js — versão endurecida para CI/CD
//
// Mudanças preventivas (Windows local x Ubuntu GitHub Actions):
//   1. timezoneId: força o Chromium a operar em America/Sao_Paulo
//      em qualquer runner. Resolve `new Date()`, filtros do dashboard
//      e qualquer comparação de "hoje".
//   2. locale: pt-BR. Resolve formatação visual de <input type="date">
//      (que aparecia como MM/DD/YYYY no Ubuntu) e Intl.NumberFormat
//      (R$ 80,00 vs R$ 80.00).
//   3. retries=1 apenas em CI: mascara flake residual sem esconder
//      bugs reais (1 retry, não 3).
//   4. workers=1 em CI: serializa a suíte (mesma tenant compartilhada).
//   5. trace/screenshot/video em retain-on-failure: diagnóstico rico
//      quando algo cair na pipeline.
//
// Se você já tem outras seções (projects, webServer, reporter), MANTÊ-LAS.
// Os blocos críticos a aplicar são `use.timezoneId`, `use.locale`,
// `retries` e `workers`.

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },

  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : 'list',

  use: {
    // === HARDENING DE AMBIENTE ===
    timezoneId: 'America/Sao_Paulo',
    locale: 'pt-BR',

    // === TIMEOUTS ===
    actionTimeout: 15_000,
    navigationTimeout: 30_000,

    // === DIAGNÓSTICO ===
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // === BROWSER ===
    headless: true,
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
