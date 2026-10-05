import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', retries: 1, timeout: 150_000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5192', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
