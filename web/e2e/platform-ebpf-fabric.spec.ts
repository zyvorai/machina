// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { test, expect } from '@playwright/test'
import { mockPlatformApi } from './platformMock'

test('Security Center shows sensor matrix and fleet enroll CTA', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/zeus/security')
  await expect(page.getByRole('heading', { name: 'Security Center' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Tetragon sensor matrix')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('host-1', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Enroll fleet Tetragon' }).click()
  // ConfirmDialog (React modal) — click the "Enroll" confirm button
  await page.getByRole('dialog').getByRole('button', { name: 'Enroll' }).click()
  await expect(page.getByText(/Tetragon enrollment queued/i)).toBeVisible({ timeout: 10_000 })
})

test('runtime enforcement apply and TracingPolicy preview', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/zeus/security/enforcement')
  await expect(page.getByRole('heading', { name: 'Runtime enforcement' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Block shadow file read')).toBeVisible()
  await page.getByRole('button', { name: 'Preview' }).first().click()
  await expect(page.getByText('TracingPolicy preview')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('packetwolf-pol-deny-nc')).toBeVisible()
})

test('threat hunting correlation row shows enforce action', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/zeus/security/hunt')
  await expect(page.getByRole('heading', { name: 'Threat hunting' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Threat correlations')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enforce' }).first()).toBeVisible({ timeout: 10_000 })
})

test('network canvas threat pulse shows investigate actions', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/network-canvas')
  await expect(page.getByText('Network canvas', { exact: true })).toBeVisible({ timeout: 15_000 })
  const enforce = page.getByRole('button', { name: 'Enforce' })
  if (await enforce.count()) {
    await expect(enforce.first()).toBeVisible()
  }
})
