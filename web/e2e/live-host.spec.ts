// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { test, expect } from '@playwright/test'
import { liveCredentials, loginAtMachinaLoginPage } from './helpers/liveAuth'

/** Smoke against a running daemon (set PLAYWRIGHT_LIVE_URL, e.g. https://212.8.252.194:5092). */
const live = process.env.PLAYWRIGHT_LIVE_URL?.replace(/\/$/, '')
test.skip(!live, 'Set PLAYWRIGHT_LIVE_URL to run live-host tests')

test('health endpoint', async ({ request }) => {
  const res = await request.get(`${live}/api/v1/health`)
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  expect(body.status).toBe('healthy')
})

test('login page and auth providers', async ({ page }) => {
  await page.goto(`${live}/login`)
  await expect(page.getByText('Machina').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('Username')).toBeVisible()
  const providers = await page.request.get(`${live}/api/v1/auth/providers`)
  expect(providers.ok()).toBeTruthy()
  const p = await providers.json()
  expect(p.pam?.enabled).toBe(true)
})

test('language switcher on login', async ({ page }) => {
  await page.goto(`${live}/login`)
  await page.getByLabel('Language').selectOption('es')
  await expect(page.getByLabel('Usuario')).toBeVisible()
})

test('PAM login at /login reaches dashboard', async ({ page }) => {
  test.skip(!liveCredentials(), 'Set PLAYWRIGHT_LIVE_USER/PASS')
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await loginAtMachinaLoginPage(page, live!)
  await expect(page).toHaveURL(`${live}/`)
  await expect(page.locator('#main-content')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Page not found')).not.toBeVisible()
  expect(errors).toEqual([])
})
