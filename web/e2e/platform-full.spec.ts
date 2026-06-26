// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { test, expect } from '@playwright/test'
import { mockPlatformApi } from './platformMock'

async function expectRouteVisible(
  page: import('@playwright/test').Page,
  path: string,
  heading: string | RegExp,
) {
  await page.goto(path)
  await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 20_000 })
}

const NORMAL_ROUTES: Array<{ path: string; heading: string | RegExp }> = [
  { path: '/platform', heading: /e2e-cluster|host-1|Mission Control|Machina fleet/i },
  { path: '/platform/vms', heading: 'Machine Finder' },
  { path: '/platform/hosts', heading: 'Hosts' },
  { path: '/platform/integrations', heading: 'Apps & Integrations' },
  { path: '/platform/settings', heading: /Settings|General/i },
  { path: '/platform/backups', heading: 'Time Machine' },
  { path: '/platform/storage', heading: 'Storage' },
]

const ADVANCED_ROUTES: Array<{ path: string; heading: string | RegExp }> = [
  { path: '/platform/infrastructure', heading: 'Infrastructure' },
  { path: '/platform/operations', heading: 'Operations' },
  { path: '/platform/policy', heading: 'Policy & Quotas' },
  { path: '/platform/events', heading: 'Logs & Audit' },
  { path: '/platform/zeus/security/policies', heading: 'Policy Studio' },
  { path: '/platform/recommendations', heading: 'Recommendations' },
  { path: '/platform/observability', heading: 'Observability' },
]

const POWER_ROUTES: Array<{ path: string; heading: string | RegExp }> = [
  { path: '/platform/observability', heading: 'Observability' },
  { path: '/platform/placement', heading: 'Placement & HA' },
  { path: '/platform/policy', heading: 'Policy & Quotas' },
  { path: '/platform/api-keys', heading: /API keys/i },
  { path: '/platform/infrastructure', heading: 'Infrastructure' },
]

test.describe('power tier platform routes', () => {
  for (const { path, heading } of POWER_ROUTES) {
    test(`${path} loads without JS crash`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (err) => errors.push(err.message))
      await mockPlatformApi(page, { tier: 'power' })
      await expectRouteVisible(page, path, heading)
      expect(errors.filter((e) => !e.includes('ResizeObserver'))).toEqual([])
    })
  }
})

test.describe('normal tier platform routes', () => {
  for (const { path, heading } of NORMAL_ROUTES) {
    test(`${path} loads without JS crash`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (err) => errors.push(err.message))
      await mockPlatformApi(page, { tier: 'normal' })
      await expectRouteVisible(page, path, heading)
      expect(errors.filter((e) => !e.includes('ResizeObserver'))).toEqual([])
    })
  }
})

test.describe('advanced tier platform routes', () => {
  for (const { path, heading } of ADVANCED_ROUTES) {
    test(`${path} loads without JS crash`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (err) => errors.push(err.message))
      await mockPlatformApi(page, { tier: 'advanced' })
      await expectRouteVisible(page, path, heading)
      expect(errors.filter((e) => !e.includes('ResizeObserver'))).toEqual([])
    })
  }
})

test('integrations hub lists OpenStack when enabled', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform/integrations')
  await expect(page.getByRole('heading', { name: 'Apps & Integrations' })).toBeVisible()
  await expect(page.locator('a[href="/openstack"]').getByText('OpenStack', { exact: true })).toBeVisible()
  await expect(page.getByText('Kubernetes', { exact: true })).toBeVisible()
})

test('integrations hub shows live OpenStack and K8s preview stats', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform/integrations')
  await expect(page.getByText('OpenStack preview')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Kubernetes preview')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Instances').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('web-01')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('k3s')).toBeVisible({ timeout: 15_000 })
})

test('integrations hub lists classic Machina tools', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform/integrations')
  await expect(page.getByText('Classic Machina tools')).toBeVisible()
  await expect(page.locator('a[href="/import"]').getByText('Import VM')).toBeVisible()
  await expect(page.locator('a[href="/node"]').getByText('Node & libvirt')).toBeVisible()
  await expect(page.getByText('Leaving the desktop')).toBeVisible()
})

test('Go menu navigates without tier bounce on allowed route', { retries: 1 }, async ({ page }) => {
  test.setTimeout(90_000)
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform')
  await expect(page.getByRole('heading', { name: /e2e-cluster|Production Cluster|Zyvor Platform/i })).toBeVisible({
    timeout: 30_000,
  })
  const menubar = page.locator('.mac-menubar-inner')
  await menubar.getByRole('button', { name: 'Go', exact: true }).click()
  await page.locator('.mac-menu-panel').getByRole('button', { name: 'Finder' }).click()
  await expect(page).toHaveURL(/\/platform\/vms/)
})

test('View menu hides power-only destinations at normal tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform')
  await expect(page.getByRole('heading', { name: /e2e-cluster|Production Cluster|Zyvor Platform/i })).toBeVisible({
    timeout: 15_000,
  })
  const menubar = page.locator('.mac-menubar-inner')
  await menubar.getByRole('button', { name: 'View', exact: true }).click()
  const viewPanel = page.locator('.mac-menu-panel').filter({ has: page.getByText('Mission Control') })
  await expect(viewPanel).toBeVisible()
  await expect(viewPanel.getByRole('button', { name: 'Zeus OS' })).toHaveCount(0)
  await expect(viewPanel.getByRole('button', { name: 'Activity Monitor' })).toHaveCount(0)
  await expect(viewPanel.getByRole('button', { name: 'Finder' })).toHaveCount(0)
})

test('backups destinations tab loads at normal tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform/backups?tab=destinations')
  await expect(page.getByRole('heading', { name: 'Backup destinations' })).toBeVisible({ timeout: 15_000 })
})

test('vm detail topology tab loads at power tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/vms/v1?tab=topology')
  await expect(page.getByRole('heading', { name: 'vm-1' }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('2 nodes · 1 edges')).toBeVisible({ timeout: 15_000 })
})

test('firewall policy studio multisite panel loads at advanced tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'advanced' })
  await page.goto('/platform/zeus/security/policies')
  await expect(page.getByRole('heading', { name: 'Multi-site DR' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Export federation bundle' })).toBeVisible()
})

test('developer route redirects at power tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/developer')
  await expect(page).toHaveURL(/\/platform\/settings/, { timeout: 15_000 })
})

test('zeus OS fleet tab loads without JS crash', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/zeus?tab=fleet')
  await expect(page.getByRole('heading', { name: 'Machina Zeus OS' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Fleet Linux health')).toBeVisible({ timeout: 15_000 })
  expect(errors.filter((e) => !e.includes('ResizeObserver'))).toEqual([])
})

test('network canvas loads without JS crash', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/network-canvas')
  await expect(page.getByRole('heading', { name: 'Network canvas' })).toBeVisible({ timeout: 20_000 })
  expect(errors.filter((e) => !e.includes('ResizeObserver'))).toEqual([])
})
