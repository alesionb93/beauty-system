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
    ? [
        ['./tests/reporters/business-reporter.js'],
        ['html', { open: 'never' }]
      ]
    : './tests/reporters/business-reporter.js',

  use: {
    baseURL: process.env.BASE_URL,

    timezoneId: 'America/Sao_Paulo',
    locale: 'pt-BR',

    actionTimeout: 15_000,
    navigationTimeout: 30_000,

    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

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