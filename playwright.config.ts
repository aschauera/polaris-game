import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit-mobile', testMatch: '**/mobile.spec.ts', use: { browserName: 'webkit', launchOptions: {} } },
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'npm run build && npm start',
    env: { POLARIS_DB: '.polaris/e2e.sqlite', PORT: '4173', PUBLIC_ORIGIN: 'http://127.0.0.1:4173' },
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
