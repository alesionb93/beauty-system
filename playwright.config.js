const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',

  fullyParallel: false,

  reporter: [
    [
      'html',
      {
        open: 'always'
      }
    ],
    [
      './tests/reporters/business-reporter.js'
    ]
  ],

  use: {
    baseURL:
      process.env.BASE_URL ||
      'http://127.0.0.1:5500',

    headless: true,

    screenshot: 'only-on-failure',

    video: 'retain-on-failure',

    trace: 'retain-on-failure'
  },

  outputDir: 'test-results'
});