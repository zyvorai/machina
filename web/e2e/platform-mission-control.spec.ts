// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { test, expect } from '@playwright/test'
import { mockPlatformApi } from './platformMock'

test('platform mission control overlay opens from Jarvis', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))

  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform')
  await expect(page.getByTestId('platform-jarvis-shell')).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('machina-open-mission-control')))
  await expect(page.getByRole('dialog', { name: 'Mission Control' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('dialog', { name: 'Mission Control' }).getByText('Live fleet')).toBeVisible()
  expect(errors).toEqual([])
})

test('platform jarvis briefing strip', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform')
  await expect(page.getByTestId('platform-jarvis-shell')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /Ask Machina/i })).toBeVisible()
  await expect(page.getByTestId('platform-jarvis-shell').locator('button.btn-secondary', { hasText: 'Mission Control' })).toBeVisible()
})
