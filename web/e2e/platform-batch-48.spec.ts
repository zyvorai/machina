// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { test, expect } from '@playwright/test'
import { mockPlatformApi } from './platformMock'

test('hosts list shows stale heartbeat host as offline', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal', staleHost: true })
  await page.goto('/platform/hosts')
  await expect(page.getByText('stale-host').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('offline').first()).toBeVisible()
})

test('storage discover imports pools from hosts', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal', emptyStorage: true })
  await page.goto('/platform/storage?tab=pools')
  await expect(page.getByText('No storage pools')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Import from hosts/i }).last().click()
  await expect(page.getByText('default').first()).toBeVisible({ timeout: 10_000 })
})

test.describe.serial('template readiness', () => {
  async function openTemplateDeploy(page: import('@playwright/test').Page) {
    await mockPlatformApi(page, { tier: 'power' })
    await page.goto('/platform/templates')
    await page.getByRole('button', { name: /^Templates$/ }).click()
    await expect(page.getByText('ubuntu-24.04').first()).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: /Get · Deploy VM/i }).first().click()
  }

  test('template deploy sheet shows readiness traffic light', async ({ page }) => {
    await openTemplateDeploy(page)
    await expect(page.getByText('Ready to deploy')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Disk present on/i)).toBeVisible()
  })

  test('template deploy sheet shows not-ready remediation', async ({ page }) => {
    await mockPlatformApi(page, { tier: 'power', templateNotReady: true })
    await page.goto('/platform/templates')
    await page.getByRole('button', { name: /^Templates$/ }).click()
    await expect(page.getByText('ubuntu-24.04').first()).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: /Get · Deploy VM/i }).first().click()
    await expect(page.getByText('Missing disk image')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Upload the golden image/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /Upload image in Content Library/i })).toBeVisible()
  })
})

test('platform support shows Zyvor guidance', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform/support')
  await expect(page.getByText(/libvirt\/KVM stays the engine/i)).toBeVisible({ timeout: 15_000 })
})

test('show offline hosts command navigates to filtered hosts', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal', staleHost: true })
  await page.goto('/platform')
  await page.locator('.tahoe-context-bar').click()
  await page.keyboard.press('Control+k')
  const spotlight = page.locator('.liquid-glass-modal-backdrop').filter({
    has: page.getByPlaceholder(/Zeus/i),
  })
  await spotlight.getByPlaceholder(/Zeus/i).fill('show offline hosts')
  await spotlight.getByRole('button', { name: /Show offline hosts/i }).click()
  await expect(spotlight.getByText('Review command')).toBeVisible()
  await spotlight.getByRole('button', { name: /Confirm/i }).click()
  await expect(page).toHaveURL(/\/platform\/hosts\?filter=offline/, { timeout: 10_000 })
})
