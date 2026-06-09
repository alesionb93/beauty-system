const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',

  timeout: 90_000,

  expect: {
    timeout: 10_000,
  },

  fullyParallel: false,

  retries: process.env.CI ? 1 : 0,

  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : 'list',

  use: {
    // URL base usada pelos testes que fazem:
    // page.goto('/index.html')
    baseURL: process.env.BASE_URL,

    // HARDENING DE AMBIENTE
    timezoneId: 'America/Sao_Paulo',
    locale: 'pt-BR',

    // TIMEOUTS
    actionTimeout: 15_000,
    navigationTimeout: 30_000,

    // DIAGNÓSTICO
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // BROWSER
    headless: true,
    viewport: {
      width: 1366,
      height: 768,
    },
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});