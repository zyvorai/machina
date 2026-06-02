// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { test, expect } from '@playwright/test'
import { mockPlatformApi } from './platformMock'

test('Security Center loads with threat score', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/zeus/security')
  await expect(page.getByRole('heading', { name: 'Security Center' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Fleet threat score')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/4 nodes/)).toBeVisible({ timeout: 15_000 })
})

test('Machine Security view shows process tabs', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/zeus/machines/h1')
  await expect(page.getByRole('heading', { name: 'Machine security' })).toBeVisible({ timeout: 15_000 })
  const tabBar = page.locator('div.flex.flex-wrap.items-center.gap-1.border-b').filter({
    has: page.getByRole('button', { name: 'Processes' }),
  })
  await tabBar.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Containers' }).click()
  await expect(page.getByText('ns/zeus')).toBeVisible({ timeout: 15_000 })
})

test('Runtime enforcement workspace loads', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/zeus/security/enforcement')
  await expect(page.getByRole('heading', { name: 'Runtime enforcement' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Block reverse-shell listeners')).toBeVisible()
})

test('Threat hunting workspace loads', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/zeus/security/hunt')
  await expect(page.getByRole('heading', { name: 'Threat hunting' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Threat correlations')).toBeVisible()
  await page.getByRole('button', { name: 'Generate' }).click()
  await expect(page.getByText(/correlation finding/)).toBeVisible({ timeout: 15_000 })
})
