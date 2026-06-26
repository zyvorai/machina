// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { test, expect } from '@playwright/test'
import { mockPlatformApi } from './platformMock'

test('classic storage empty state links back to platform via shell bridge', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal', emptyStorage: true })
  await page.goto('/storage')
  await expect(page.getByText('No storage pools')).toBeVisible({ timeout: 15_000 })
  const backLink = page.locator('.shell-bridge-bar').getByRole('link', { name: /Back to Platform/i })
  await backLink.click()
  await expect(page).toHaveURL(/\/platform/, { timeout: 20_000 })
})

test('classic navbar help opens platform guide dialog', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/vms')
  await expect(page.getByRole('heading', { name: /Virtual machines/i })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Help menu' }).click()
  await page.getByRole('menuitem', { name: 'Platform guide…' }).click()
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/libvirt\/KVM stays the engine/i)).toBeVisible()
})

test('platform help menu opens platform guide dialog', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform/vms')
  await expect(page.getByRole('heading', { level: 1, name: 'Machine Finder' })).toBeVisible({
    timeout: 15_000,
  })
  await page.locator('.mac-menubar-inner').getByRole('button', { name: 'Help', exact: true }).click()
  await page.locator('.mac-menu-panel').getByRole('button', { name: 'Platform guide…' }).click()
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/libvirt\/KVM stays the engine/i)).toBeVisible()
})

test('platform VM detail links to ConsoleHub', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/vms/v1')
  // "Open Cinema" is the action bar link that routes to /consolehub
  await expect(page.getByRole('link', { name: 'Open Cinema' }).first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('link', { name: 'Open Cinema' }).first().click()
  await expect(page).toHaveURL(/\/consolehub/)
})
