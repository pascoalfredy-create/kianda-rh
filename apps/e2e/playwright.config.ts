import { defineConfig, devices } from '@playwright/test';

/**
 * Testes no navegador contra a API (Node) e a web (next start) locais, com o Postgres do CI.
 * Pré-requisitos: migrações aplicadas e `pnpm --filter @kianda/web build` feito antes.
 * Cada teste cria a sua própria empresa: não depende dos dados de demonstração nem da ordem.
 */
const ci = !!process.env.CI;
const env = { ...process.env, API_JWT_SECRET: process.env.API_JWT_SECRET ?? 'segredo-e2e-com-mais-de-trinta-e-dois-caracteres', WEB_ORIGIN: 'http://localhost:3000' } as Record<string, string>;

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: ci ? 1 : 0,
  forbidOnly: ci,
  reporter: ci ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure', screenshot: 'only-on-failure', locale: 'pt-PT', timezoneId: 'Africa/Luanda' },
  projects: [
    { name: 'computador', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec/ },
    { name: 'telemovel', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
  webServer: [
    { command: 'npx tsx src/server.ts', cwd: '../api', port: 4000, env, reuseExistingServer: !ci, timeout: 60_000 },
    { command: 'npx next start -p 3000', cwd: '../web', url: 'http://localhost:3000/login', env: { ...env, API_URL: 'http://localhost:4000' }, reuseExistingServer: !ci, timeout: 120_000 },
  ],
});
