// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { test, expect } from '@playwright/test'

const platformInfo = {
  version: '0.1.0-test',
  tls: { enabled: false },
  auth: { pam_service: 'sshd', oidc_enabled: false },
  kubevirt: {
    exec_enabled: false,
    default_namespace: 'default',
    default_storage_class: 'local-path',
    virtio_container_disk_image: 'registry:5000/kubevirt/virt-launcher',
    machine_type: 'q35',
  },
  openstack: {
    enabled: true,
    configured: true,
    cloud_name: 'test',
    upload_enabled: false,
    upload_timeout_secs: 300,
    default_os_cloud: 'test',
    default_boot_instance: false,
  },
}

const openstackLiveStatus = {
  reachable: true,
  keystone_reachable: true,
  compute_reachable: true,
  glance_reachable: true,
  connected: true,
  cloud_name: 'test',
}

async function mockUnauthenticatedApi(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/auth/providers')) {
      return route.fulfill({
        json: {
          pam: { enabled: true },
          ldap: { enabled: false },
          oidc: { enabled: false, button_label: 'Sign in with SSO' },
        },
      })
    }
    if (url.includes('/auth/session')) {
      return route.fulfill({ status: 401, json: { error: 'unauthenticated' } })
    }
    return route.fulfill({ status: 401, json: { error: 'unauthenticated', error_code: 'unauthorized' } })
  })
}

async function mockAuthenticatedApi(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/auth/session')) {
      return route.fulfill({
        json: {
          authenticated: true,
          username: 'admin',
          role: 'admin',
          auth_source: 'pam',
        },
      })
    }
    if (url.includes('/auth/providers')) {
      return route.fulfill({
        json: {
          pam: { enabled: true },
          ldap: { enabled: false },
          oidc: { enabled: false, button_label: 'Sign in with SSO' },
        },
      })
    }
    if (url.includes('/system/platform-info')) {
      return route.fulfill({ json: platformInfo })
    }
    if (url.includes('/openstack/status')) {
      return route.fulfill({ json: openstackLiveStatus })
    }
    if (url.includes('/openstack/clouds')) {
      return route.fulfill({ json: { clouds: [{ name: 'test', active: true }] } })
    }
    if (url.includes('/openstack/instances')) {
      return route.fulfill({
        status: 503,
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><body>Bad Gateway</body></html>',
      })
    }
    if (url.includes('/fleet/status')) {
      return route.fulfill({ json: { enabled: false, peers: [] } })
    }
    if (url.includes('/fleet/vms')) {
      return route.fulfill({ json: { enabled: false, vms: [] } })
    }
    if (url.includes('/fleet/metrics')) {
      return route.fulfill({
        json: {
          enabled: false,
          local: {
            host_cpu_percent: 0,
            host_memory_percent: 0,
            load_1: 0,
            vm_count: 0,
            vms_running: 0,
          },
          peers: [],
        },
      })
    }
    if (url.includes('/fleet/alerts')) {
      return route.fulfill({ json: { peers: [], total_unacknowledged: 0 } })
    }
    if (url.endsWith('/vms') || url.match(/\/vms(\?|$)/)) {
      return route.fulfill({ json: [] })
    }
    if (url.includes('/networks')) {
      return route.fulfill({ json: [] })
    }
    if (url.includes('/storage/pools')) {
      return route.fulfill({ json: [] })
    }
    if (url.includes('/node')) {
      return route.fulfill({
        json: { hostname: 'test-host', memory_mb: 16384, cpus: 8, hypervisor: 'kvm' },
      })
    }
    if (url.includes('/events/stream') || url.includes('/ws/')) {
      return route.abort()
    }
    return route.fulfill({ json: {} })
  })
}

test('login page shows PAM form when OIDC is off', async ({ page }) => {
  await mockUnauthenticatedApi(page)
  await page.goto('/login')
  await expect(page.getByText('Machina').first()).toBeVisible()
  await expect(page.getByLabel('Username')).toBeVisible()
})

test('authenticated /login redirects to dashboard', async ({ page }) => {
  await mockAuthenticatedApi(page)
  await page.goto('/login')
  await expect(page).toHaveURL('/', { timeout: 15_000 })
  await expect(page.locator('#main-content')).toBeVisible({ timeout: 15_000 })
})

test('VM list shows empty state when authenticated', async ({ page }) => {
  await mockAuthenticatedApi(page)
  await page.goto('/vms')
  await expect(page.getByRole('heading', { name: /virtual machines/i })).toBeVisible({ timeout: 15_000 })
})

test('Fleet page loads when authenticated', async ({ page }) => {
  await mockAuthenticatedApi(page)
  await page.goto('/fleet')
  await expect(page.getByRole('heading', { name: 'Fleet', exact: true })).toBeVisible({ timeout: 15_000 })
})

test('language switcher changes login label', async ({ page }) => {
  await mockUnauthenticatedApi(page)
  await page.goto('/login')
  await page.getByLabel('Language').selectOption('es')
  await expect(page.getByLabel('Usuario')).toBeVisible()
})

test('OpenStack instances shows sanitized error when API returns HTML', async ({ page }) => {
  await mockAuthenticatedApi(page)
  await page.goto('/openstack/instances')
  await expect(page.getByText(/Failed to load instances/i)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/HTML error page/i).first()).toBeVisible()
})
