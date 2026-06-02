// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { test, expect } from '@playwright/test'
import { ensureLoggedIn } from './helpers/liveAuth'

const live = process.env.PLAYWRIGHT_LIVE_URL?.replace(/\/$/, '')

test.skip(!live, 'Set PLAYWRIGHT_LIVE_URL to run live platform tests')

const LIVE_ROUTES = [
  '/platform',
  '/platform/vms',
  '/platform/hosts',
  '/platform/integrations',
  '/platform/settings',
  '/platform/storage',
  '/platform/backups',
  '/platform/backups?tab=destinations',
  '/platform/notifications',
  '/platform/developer',
  '/platform/zeus/security/policies',
]

for (const path of LIVE_ROUTES) {
  test(`live ${path} renders without fatal error`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await ensureLoggedIn(page, live!)
    await page.goto(`${live}${path}`)
    await expect(page.locator('#login-username')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.locator('body')).not.toBeEmpty({ timeout: 20_000 })
    await expect(page.getByText('Application error|Something went wrong')).toHaveCount(0)
    expect(errors.filter((e) => !e.includes('ResizeObserver'))).toEqual([])
  })
}

test('live health', async ({ request }) => {
  const res = await request.get(`${live}/api/v1/health`, { ignoreHTTPSErrors: true })
  expect(res.ok()).toBeTruthy()
})

test('live openapi spec', async ({ request }) => {
  const host = new URL(live!).hostname
  const ctrl = await request.get(`http://${host}:5093/api/v1/openapi.json`)
  expect(ctrl.ok()).toBeTruthy()
  const ctrlBody = await ctrl.json()
  expect(ctrlBody.openapi).toMatch(/^3\./)
  expect(Object.keys(ctrlBody.paths ?? {}).length).toBeGreaterThan(200)

  const daemon = await request.get(`${live}/api/v1/openapi.json`, { ignoreHTTPSErrors: true })
  expect(daemon.ok()).toBeTruthy()
  const ct = daemon.headers()['content-type'] ?? ''
  expect(ct).toContain('application/json')
  const daemonBody = await daemon.json()
  expect(daemonBody.openapi).toMatch(/^3\./)
  expect(Object.keys(daemonBody.paths ?? {}).length).toBeGreaterThan(200)
})
