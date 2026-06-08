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
    headless: true,

    screenshot: 'only-on-failure',

    video: 'retain-on-failure',

    trace: 'retain-on-failure'
  },

  outputDir: 'test-results'
});