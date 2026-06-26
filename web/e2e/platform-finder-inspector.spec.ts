// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { test, expect } from '@playwright/test'
import { mockPlatformApi } from './platformMock'

test('Machine Finder command center shows actions for selected VM', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform/vms')
  await expect(page.getByRole('heading', { name: 'Machine Finder', exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('vm-1').first()).toBeVisible({ timeout: 15_000 })
  await page.getByText('vm-1').first().click()
  const inspector = page.getByTestId('machine-finder-command-center')
  await expect(inspector).toBeVisible({ timeout: 10_000 })
  await expect(inspector.getByRole('link', { name: 'Open VM detail' })).toBeVisible()
  await expect(inspector.getByText('Command Center')).toBeVisible()
})

test('Machine Finder topology lens shows geography labels', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform/vms?lens=topology')
  await expect(page.getByTestId('machine-finder-topology')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'host-1' }).click()
  await expect(page.getByRole('link', { name: 'Open host' })).toBeVisible({ timeout: 10_000 })
  const inspector = page.locator('.platform-finder-inspector').first()
  await expect(inspector).toBeVisible()
  await expect(inspector.getByText('Site', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^vm-1 running/ }).click()
  await expect(inspector.getByText('State', { exact: true })).toBeVisible()
  await expect(inspector.getByRole('link', { name: 'Open VM' })).toBeVisible()
})
