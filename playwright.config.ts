import { defineConfig } from '@playwright/test';

// Browser smoke tests run against the production build (`vite preview`) so the
// shipped bundle and its Content-Security-Policy are what gets exercised.
// Demo mode (?demo=1) makes no network calls; live-mode cases seed a fake key
// and intercept the OCR endpoint with page.route(), so no request reaches
// DeepSeek and no charges can occur.
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
