// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { test, expect } from '@playwright/test'
import { mockPlatformApi } from './platformMock'

async function expectRouteVisible(page: import('@playwright/test').Page, path: string, text: RegExp) {
  await page.goto(path)
  if (path === '/platform/resources') {
    await expect(page.getByRole('heading', { name: 'Resources' })).toBeVisible({ timeout: 20_000 })
    return
  }
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 })
}

const NORMAL_ROUTES: Array<{ path: string; text: RegExp }> = [
  { path: '/platform', text: /Production Cluster|Dashboard|Zyvor Platform/i },
  { path: '/platform/vms', text: /Finder/i },
  { path: '/platform/hosts', text: /Hosts/i },
  { path: '/platform/integrations', text: /Apps & Integrations/i },
  { path: '/platform/settings', text: /Settings|General/i },
  { path: '/platform/backups', text: /Backup|Time Machine/i },
  { path: '/platform/storage', text: /Storage|Disk/i },
]

const ADVANCED_ROUTES: Array<{ path: string; text: RegExp }> = [
  { path: '/platform/resources', text: /Resources/i },
  { path: '/platform/operations', text: /Operations/i },
  { path: '/platform/policy', text: /Policy & Quotas/i },
  { path: '/platform/events', text: /Logs|Console|Audit/i },
  { path: '/platform/zeus/security/policies', text: /Policy Studio/i },
  { path: '/platform/recommendations', text: /Recommendations/i },
  { path: '/platform/observability', text: /Observability/i },
]

const POWER_ROUTES: Array<{ path: string; text: RegExp }> = [
  { path: '/platform/observability', text: /Observability/i },
  { path: '/platform/placement', text: /Placement & HA/i },
  { path: '/platform/policy', text: /Policy & Quotas/i },
  { path: '/platform/api-keys', text: /API Keys/i },
  { path: '/platform/resources', text: /Resources/i },
]

test.describe('power tier platform routes', () => {
  for (const { path, text } of POWER_ROUTES) {
    test(`${path} loads without JS crash`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (err) => errors.push(err.message))
      await mockPlatformApi(page, { tier: 'power' })
      await expectRouteVisible(page, path, text)
      expect(errors).toEqual([])
    })
  }
})

test.describe('normal tier platform routes', () => {
  for (const { path, text } of NORMAL_ROUTES) {
    test(`${path} loads without JS crash`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (err) => errors.push(err.message))
      await mockPlatformApi(page, { tier: 'normal' })
      await expectRouteVisible(page, path, text)
      expect(errors).toEqual([])
    })
  }
})

test.describe('advanced tier platform routes', () => {
  for (const { path, text } of ADVANCED_ROUTES) {
    test(`${path} loads without JS crash`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (err) => errors.push(err.message))
      await mockPlatformApi(page, { tier: 'advanced' })
      await expectRouteVisible(page, path, text)
      expect(errors).toEqual([])
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
  await expect(page.getByText('OpenStack preview')).toBeVisible()
  await expect(page.getByText('Kubernetes preview')).toBeVisible()
  await expect(page.getByText('web-01')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Instances').first()).toBeVisible()
  await expect(page.getByText('k3s')).toBeVisible()
})

test('integrations hub lists classic Machina tools', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform/integrations')
  await expect(page.getByText('Classic Machina tools')).toBeVisible()
  await expect(page.locator('a[href="/import"]').getByText('Import VM')).toBeVisible()
  await expect(page.locator('a[href="/node"]').getByText('Node & libvirt')).toBeVisible()
  await expect(page.getByText('Leaving the desktop')).toBeVisible()
})

test('Go menu navigates without tier bounce on allowed route', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform')
  await expect(page.getByText(/Production Cluster|Dashboard|Zyvor Platform/i).first()).toBeVisible({ timeout: 15_000 })
  const menubar = page.locator('.mac-menubar-inner')
  await menubar.getByRole('button', { name: 'Go', exact: true }).click()
  await page.locator('.mac-menu-panel').getByRole('button', { name: 'Finder' }).click()
  await expect(page).toHaveURL(/\/platform\/vms/)
})

test('View menu hides power-only destinations at normal tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform')
  await expect(page.getByText(/Production Cluster|Dashboard|Zyvor Platform/i).first()).toBeVisible({ timeout: 15_000 })
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
  await page.goto('/platform/vms/v1')
  await expect(page.getByRole('heading', { name: 'vm-1' })).toBeVisible({ timeout: 15_000 })
  const tabBar = page.locator('div.flex.flex-wrap.items-center.gap-1.border-b').filter({
    has: page.getByRole('button', { name: 'Overview' }),
  })
  await tabBar.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Topology' }).click()
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
