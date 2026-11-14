import { defineConfig, devices } from '@playwright/test';
import { config } from './config.js';

// Local runs can use an installed Chrome: PW_CHANNEL=chrome
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 1,                // one retry filters out network blips
  workers: 4,
  outputDir: 'reports/test-artifacts',
  reporter: [
    ['list'],
    ['json', { outputFile: 'reports/playwright.json' }],
    ['html', { outputFolder: 'reports/playwright', open: 'never' }],
  ],
  use: {
    baseURL: config.baseUrl,
    userAgent: config.userAgent,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    navigationTimeout: 45_000,
    channel,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], userAgent: config.userAgent, channel } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel }, testIgnore: /seo\.spec/ },
  ],
});
