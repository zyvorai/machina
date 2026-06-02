// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import type { Page } from '@playwright/test'

export type DesktopTier = 'normal' | 'power' | 'advanced'

const TIER_KEY = 'machina-platform-desktop-tier'
const WELCOME_KEY = 'zyvor-platform-welcome-done'

/** Primary Machina PAM submit label (OIDC off). Secondary when SSO is enabled. */
export const MACHINA_LOGIN_SUBMIT =
  /sign in to machina|sign in with password|sign in|log in/i

export function liveCredentials() {
  const user = process.env.PLAYWRIGHT_LIVE_USER
  const pass = process.env.PLAYWRIGHT_LIVE_PASS
  return user && pass ? { user, pass } : null
}

export async function fillMachinaLoginForm(page: Page, user: string, pass: string) {
  await page.locator('#login-username').fill(user)
  await page.locator('#login-password').fill(pass)
}

export async function submitMachinaLogin(page: Page) {
  await page.getByRole('button', { name: MACHINA_LOGIN_SUBMIT }).click()
}

export async function isMachinaLoginVisible(page: Page) {
  return page.locator('#login-username').isVisible().catch(() => false)
}

/** Sign in via the Machina login form when credentials are set. No-op if already authenticated. */
export async function ensureLoggedIn(page: Page, baseUrl: string, entryPath = '/platform') {
  const creds = liveCredentials()
  await page.goto(`${baseUrl}${entryPath}`)
  if (!creds) return
  if (!(await isMachinaLoginVisible(page))) return
  await fillMachinaLoginForm(page, creds.user, creds.pass)
  await submitMachinaLogin(page)
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 })
  await page.locator('#login-username').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {})
}

/** PAM login starting at `/login`; expects redirect to dashboard (`/`). */
export async function loginAtMachinaLoginPage(page: Page, baseUrl: string) {
  const creds = liveCredentials()
  if (!creds) throw new Error('Set PLAYWRIGHT_LIVE_USER and PLAYWRIGHT_LIVE_PASS')
  await page.goto(`${baseUrl}/login`)
  await fillMachinaLoginForm(page, creds.user, creds.pass)
  await submitMachinaLogin(page)
  await page.waitForURL((url) => url.pathname === '/', { timeout: 30_000 })
}

export async function setDesktopTier(page: Page, tier: DesktopTier) {
  await page.addInitScript(
    ([t, welcomeKey, tierKey]) => {
      localStorage.setItem(welcomeKey, '1')
      localStorage.setItem(tierKey, t)
    },
    [tier, WELCOME_KEY, TIER_KEY] as const,
  )
}

export interface PlatformInfoFlags {
  openstackEnabled: boolean
  k8sEnabled: boolean
}

export async function fetchPlatformFlags(page: Page, baseUrl: string): Promise<PlatformInfoFlags> {
  try {
    const res = await page.request.get(`${baseUrl}/api/v1/system/platform-info`, {
      ignoreHTTPSErrors: true,
    })
    if (!res.ok()) return { openstackEnabled: false, k8sEnabled: false }
    const body = (await res.json()) as {
      openstack?: { enabled?: boolean }
      kubevirt?: { enabled?: boolean; exec_enabled?: boolean }
    }
    return {
      openstackEnabled: Boolean(body.openstack?.enabled),
      k8sEnabled: Boolean(body.kubevirt?.exec_enabled ?? body.kubevirt?.enabled),
    }
  } catch {
    return { openstackEnabled: false, k8sEnabled: false }
  }
}
