// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { test, expect } from '@playwright/test'
import { mockPlatformApi } from './platformMock'

test('advanced tier shows sidebar policy and Go menu opens', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'advanced' })
  await page.goto('/platform/policy')
  await expect(page.getByRole('heading', { name: /Policy & Quotas/i })).toBeVisible()

  await page.goto('/platform')
  const goMenu = page.getByRole('button', { name: /^Go$/i })
  if (await goMenu.count()) {
    await goMenu.click()
    await expect(page.getByRole('button', { name: 'All destinations…' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: 'Operations' })).toBeVisible()
  }
})

test('context bar shows security sub-nav on policy studio route', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'advanced' })
  await page.goto('/platform/zeus/security/policies')
  await expect(page.getByRole('heading', { name: /Policy Studio/i })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.tahoe-context-bar')).toBeVisible()
  await expect(page.locator('.tahoe-context-pill', { hasText: 'Policy Studio' })).toBeVisible()
})

test('dashboard has no desktop tabs row', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/vms')
  await page.goto('/platform/hosts')
  await expect(page.locator('.mac-desktop-tabs')).toHaveCount(0)
  await expect(page.locator('.tahoe-context-bar')).toBeVisible()
})

test('policy studio route loads', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'advanced' })
  await page.goto('/platform/zeus/security/policies')
  await expect(page.getByRole('heading', { name: /Policy Studio/i })).toBeVisible()
})

test('normal tier hides sidebar on Jarvis landing', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform')
  await expect(page.getByTestId('platform-jarvis-shell')).toBeVisible()
  await expect(page.locator('.platform-sidebar')).toHaveCount(0)
})

test('security context bar collapses overflow into More menu', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'advanced' })
  await page.goto('/platform/zeus/security/policies')
  await expect(page.locator('.tahoe-context-bar')).toBeVisible()
  await expect(page.locator('.tahoe-context-pill', { hasText: 'Policy Studio' })).toBeVisible()
  await expect(page.locator('.tahoe-context-more')).toBeVisible()
  await page.locator('.tahoe-context-more').click()
  await expect(page.locator('.tahoe-context-overflow-item', { hasText: 'Threat Hunting' })).toBeVisible()
})

test('mobile jump nav stays visible when sidebar is hidden', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/platform')
  await expect(page.locator('#platform-mobile-jump')).toBeVisible()
  await page.keyboard.press('Meta+Alt+s')
  await expect(page.locator('#platform-mobile-jump')).toBeVisible()
})

test('mobile jump nav navigates to hosts on normal tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/platform')
  const jump = page.getByRole('combobox', { name: 'Navigate platform' })
  await jump.selectOption('/platform/hosts')
  await expect(page).toHaveURL(/\/platform\/hosts/)
})

test('mobile jump nav includes hub sections on power tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/platform/tasks')
  const jump = page.getByRole('combobox', { name: 'Navigate platform' })
  await expect(jump).toHaveValue('/platform/tasks')
  await jump.selectOption('/platform/observability')
  await expect(page).toHaveURL(/\/platform\/observability/)
})

test('normal tier alerts quick action opens notification center', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform')
  await page.getByRole('link', { name: 'Alerts' }).click()
  await expect(page).toHaveURL(/\/platform\/notifications/)
})

test('settings context bar collapses overflow into More menu', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'advanced' })
  await page.goto('/platform/settings?section=policy')
  await expect(page.locator('.tahoe-context-bar')).toBeVisible()
  await expect(page.locator('.tahoe-context-pill', { hasText: 'Policy' })).toBeVisible()
  await expect(page.locator('.tahoe-context-more')).toBeVisible()
  await page.locator('.tahoe-context-more').click()
  await expect(page.locator('.tahoe-context-overflow-item', { hasText: 'About' })).toBeVisible()
})

test('policy workspace shows settings context bar on power tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/policy')
  await expect(page.getByRole('heading', { name: /Policy & Quotas/i })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.tahoe-context-bar')).toBeVisible()
  await expect(page.locator('.tahoe-context-pill', { hasText: 'Policy' })).toBeVisible()
})

test('mobile jump nav reflects settings workspace on policy route', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/platform/policy')
  const jump = page.getByRole('combobox', { name: 'Navigate platform' })
  await expect(jump).toHaveValue('/platform/settings?section=policy')
  await jump.selectOption('/platform/settings?section=security')
  await expect(page).toHaveURL(/\/platform\/settings\?section=security/)
})

test('zeus context bar collapses overflow into More menu', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/zeus?tab=knowledge')
  await expect(page.locator('.tahoe-context-bar')).toBeVisible()
  await expect(page.locator('.tahoe-context-pill', { hasText: 'Knowledge' })).toBeVisible()
  await expect(page.locator('.tahoe-context-more')).toBeVisible()
  await page.locator('.tahoe-context-more').click()
  await expect(page.locator('.tahoe-context-overflow-item', { hasText: 'Security Center' })).toBeVisible()
})

test('operations context bar collapses overflow into More menu', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/tasks')
  await expect(page.locator('.tahoe-context-bar')).toBeVisible()
  await expect(page.locator('.tahoe-context-pill', { hasText: 'Tasks' })).toBeVisible()
  await expect(page.locator('.tahoe-context-more')).toBeVisible()
  await page.locator('.tahoe-context-more').click()
  const opsNav = page.getByRole('navigation', { name: 'Operations sections' })
  await expect(opsNav.getByRole('link', { name: 'Observability' })).toBeVisible()
})

test('spotlight lists platform hubs on power tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform')
  const menubar = page.locator('.mac-menubar-inner')
  await menubar.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('button', { name: 'Spotlight Search' }).click()
  await expect(page.getByPlaceholder(/Zeus|Search or type/i)).toBeVisible({ timeout: 5000 })
  const spotlight = page.locator('.liquid-glass-modal-backdrop').filter({
    has: page.getByPlaceholder(/Zeus/i),
  })
  await expect(spotlight.getByText('Platform hubs', { exact: true })).toBeVisible()
  await expect(spotlight.getByRole('button', { name: /Operations Hub ·/i })).toBeVisible()
})

test('spotlight lists operations workspaces on power tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform')
  await page.locator('.tahoe-context-bar').click()
  await page.keyboard.press('Control+k')
  const spotlight = page.locator('.liquid-glass-modal-backdrop').filter({
    has: page.getByPlaceholder(/Zeus/i),
  })
  await expect(
    spotlight.locator('button').filter({ hasText: 'Observability' }).filter({ hasNotText: /Hub ·/ }),
  ).toBeVisible()
})

test('spotlight opens via keyboard shortcut', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform')
  await page.locator('.tahoe-context-bar').click()
  await page.keyboard.press('Control+k')
  await expect(page.getByPlaceholder(/Zeus|Search or type/i)).toBeVisible({ timeout: 5000 })
})

test('context overflow closes after navigation', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform/tasks')
  const more = page.locator('.tahoe-context-more')
  await more.click()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await page.locator('.tahoe-context-overflow-item', { hasText: 'Observability' }).click()
  await expect(page).toHaveURL(/\/platform\/observability/)
  await expect(more).toHaveAttribute('aria-expanded', 'false')
})

test('normal tier hub preview unlocks operations', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform')
  await page.locator('.tahoe-hub-preview-card').filter({ hasText: 'Operations' }).click()
  await expect(page).toHaveURL(/\/platform\/operations/)
})

test('mobile jump nav navigates to resources on power tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/platform')
  const jump = page.getByRole('combobox', { name: 'Navigate platform' })
  await jump.selectOption('/platform/resources')
  await expect(page).toHaveURL(/\/platform\/resources/)
  await expect(page.getByRole('heading', { name: 'Resources' })).toBeVisible({ timeout: 15_000 })
})

test('spotlight lists resources workspaces on power tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform')
  await page.locator('.tahoe-context-bar').click()
  await page.keyboard.press('Control+k')
  const spotlight = page.locator('.liquid-glass-modal-backdrop').filter({
    has: page.getByPlaceholder(/Zeus/i),
  })
  await expect(
    spotlight.getByRole('button', { name: 'Networks Resources workspace' }),
  ).toBeVisible()
})

test('spotlight lists security workspaces on advanced tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'advanced' })
  await page.goto('/platform')
  await page.locator('.tahoe-context-bar').click()
  await page.keyboard.press('Control+k')
  const spotlight = page.locator('.liquid-glass-modal-backdrop').filter({
    has: page.getByPlaceholder(/Zeus/i),
  })
  await expect(
    spotlight.locator('button').filter({ hasText: 'Policy Studio' }).filter({ hasNotText: /Hub ·/ }),
  ).toBeVisible()
})

test('spotlight lists zeus workspaces on power tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform')
  await page.locator('.tahoe-context-bar').click()
  await page.keyboard.press('Control+k')
  const spotlight = page.locator('.liquid-glass-modal-backdrop').filter({
    has: page.getByPlaceholder(/Zeus/i),
  })
  await expect(
    spotlight.locator('button').filter({ hasText: 'Knowledge' }).filter({ hasNotText: /Hub ·/ }),
  ).toBeVisible()
})

test('mobile jump nav navigates security context on advanced tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'advanced' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/platform/zeus/security')
  await expect(page.locator('#platform-mobile-jump')).toBeVisible()
  const jump = page.getByRole('combobox', { name: 'Navigate platform' })
  await expect(jump).toHaveValue('/platform/zeus/security')
  await jump.selectOption({ label: 'Policy Studio' })
  await expect(page).toHaveURL(/\/platform\/zeus\/security\/policies/)
})

test('normal tier zeus route tier bounces to settings', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'normal' })
  await page.goto('/platform/zeus')
  await expect(page).toHaveURL(/\/platform\/settings/, { timeout: 15_000 })
})

test('spotlight hides legacy Pages category on platform desktop', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform')
  await page.locator('.tahoe-context-bar').click()
  await page.keyboard.press('Control+k')
  const spotlight = page.locator('.liquid-glass-modal-backdrop').filter({
    has: page.getByPlaceholder(/Zeus/i),
  })
  await expect(spotlight.getByText('Infrastructure', { exact: true })).toHaveCount(0)
  await expect(spotlight.getByText('Pages', { exact: true })).toHaveCount(0)
})

test('Go menu operations navigates without tier bounce on power tier', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform')
  const menubar = page.locator('.mac-menubar-inner')
  await menubar.getByRole('button', { name: 'Go', exact: true }).click()
  await page.locator('.mac-menu-panel').getByRole('button', { name: 'Operations' }).click()
  await expect(page).toHaveURL(/\/platform\/operations/)
})

test('spotlight platform command shows review before execute', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform')
  await page.locator('.tahoe-context-bar').click()
  await page.keyboard.press('Control+k')
  const spotlight = page.locator('.liquid-glass-modal-backdrop').filter({
    has: page.getByPlaceholder(/Zeus/i),
  })
  await spotlight.getByPlaceholder(/Zeus/i).fill('import storage')
  await spotlight.getByRole('button', { name: /Import storage/i }).click()
  await expect(spotlight.getByText('Review command')).toBeVisible()
  await expect(spotlight.getByText(/Discover storage pools/i)).toBeVisible()
  await spotlight.getByRole('button', { name: /Confirm/i }).click()
  await expect(page.getByText(/Imported storage/i)).toBeVisible({ timeout: 10_000 })
})

test('spotlight import networks command shows review before execute', async ({ page }) => {
  await mockPlatformApi(page, { tier: 'power' })
  await page.goto('/platform')
  await page.locator('.tahoe-context-bar').click()
  await page.keyboard.press('Control+k')
  const spotlight = page.locator('.liquid-glass-modal-backdrop').filter({
    has: page.getByPlaceholder(/Zeus/i),
  })
  await spotlight.getByPlaceholder(/Zeus/i).fill('import networks')
  await spotlight.getByRole('button', { name: /Import networks/i }).click()
  await expect(spotlight.getByText('Review command')).toBeVisible()
  await expect(spotlight.getByText(/Import libvirt networks/i)).toBeVisible()
})
