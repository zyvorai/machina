// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { test, expect } from '@playwright/test'
import { mockPlatformApi } from './platformMock'
import {
  assertNoShellClickBlockers,
  assertShellNavResponsive,
  clickRandomSidebar,
} from './helpers/platformShellHelpers'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('control center tile navigation does not trap clicks', async ({ page }) => {
  await page.goto('/platform/vms')
  await expect(page.getByRole('heading', { level: 1, name: 'Machine Finder' })).toBeVisible({
    timeout: 15_000,
  })

  await page.getByRole('button', { name: 'Control Center' }).click()
  await page.getByRole('link', { name: 'Cluster' }).click()
  await expect(page).toHaveURL(/\/platform\/?$/)
  await assertShellNavResponsive(page)
})

test('mission control plus dock navigation stays responsive', async ({ page }) => {
  await page.goto('/platform/hosts')
  await expect(page.getByRole('heading', { name: /Hosts/i })).toBeVisible({ timeout: 15_000 })

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('machina-open-mission-control'))
  })
  await expect(page.getByRole('dialog', { name: 'Mission Control' })).toBeVisible({ timeout: 5000 })

  const dock = page.getByRole('navigation', { name: 'Platform dock' })
  await page.mouse.move(720, 895)
  await page.waitForTimeout(350)
  await dock.getByRole('link', { name: 'Machines' }).click()
  await expect(page).toHaveURL(/\/platform\/vms/)
  await assertNoShellClickBlockers(page)
  await assertShellNavResponsive(page)
})

test('random sidebar, dock, and menubar clicks stay navigable', { retries: 1 }, async ({ page }) => {
  await page.goto('/platform')
  await expect(page.getByTestId('mission-control-briefing')).toBeVisible({ timeout: 15_000 })

  for (let round = 0; round < 6; round++) {
    await clickRandomSidebar(page)
    await assertNoShellClickBlockers(page)

    await page.keyboard.press('Meta+,')
    await expect(page).toHaveURL(/\/platform\/settings/)
    await assertShellNavResponsive(page)

    await page.getByRole('button', { name: 'Control Center' }).click()
    const opsTile = page.getByRole('link', { name: 'Operations' }).first()
    if (await opsTile.count()) {
      await opsTile.click()
      await assertShellNavResponsive(page)
    } else {
      await page.keyboard.press('Escape')
      await assertNoShellClickBlockers(page)
    }

    const dock = page.getByRole('navigation', { name: 'Platform dock' })
    await page.mouse.move(720, 895)
    await page.waitForTimeout(350)
    await dock.getByRole('link').nth(round % 3).click()
    await expect(page).toHaveURL(/\/platform/)
    await assertNoShellClickBlockers(page)
  }
})
