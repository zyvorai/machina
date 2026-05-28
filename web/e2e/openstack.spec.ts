// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

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

async function mockOpenStackApi(page: import('@playwright/test').Page) {
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
    if (url.match(/\/openstack\/instances(\?|$)/)) {
      const u = new URL(url)
      const search = u.searchParams.get('search')
      return route.fulfill({
        json: {
          instances: [{ id: 'srv-1', name: 'web-1', status: 'ACTIVE', ip_addresses: [] }],
          has_more: false,
          search_truncated: Boolean(search),
        },
      })
    }
    if (url.includes('/openstack/heat/stacks') && route.request().method() === 'GET') {
      if (url.includes('/resources')) {
        return route.fulfill({
          json: {
            resources: [{
              logical_resource_id: 'nothing',
              resource_name: 'nothing',
              resource_status: 'CREATE_COMPLETE',
              resource_type: 'OS::Heat::None',
            }],
          },
        })
      }
      if (url.includes('/events')) {
        return route.fulfill({
          json: {
            events: [{
              resource_name: 'nothing',
              resource_status: 'CREATE_COMPLETE',
              event_time: '2026-01-01T00:00:00Z',
            }],
          },
        })
      }
      if (url.includes('/template')) {
        return route.fulfill({ json: { template: 'heat_template_version: 2016-10-14\n' } })
      }
      if (url.match(/\/heat\/stacks\/[^/]+\/[^/]+$/)) {
        return route.fulfill({
          json: {
            stack: {
              stack_name: 'demo',
              id: 'stack-1',
              stack_status: 'CREATE_COMPLETE',
              outputs: [{ output_key: 'url', output_value: 'http://example' }],
            },
          },
        })
      }
      return route.fulfill({
        json: {
          stacks: [{ stack_name: 'demo', id: 'stack-1', stack_status: 'CREATE_COMPLETE' }],
        },
      })
    }
    if (url.includes('/openstack/subnets')) {
      return route.fulfill({ json: { subnets: [] } })
    }
    if (url.includes('/openstack/load-balancers') && route.request().method() === 'GET') {
      if (url.includes('/listeners')) {
        return route.fulfill({
          json: {
            listeners: [{
              id: 'listener-1',
              name: 'http',
              protocol: 'HTTP',
              protocol_port: 80,
              provisioning_status: 'ACTIVE',
              operating_status: 'ONLINE',
            }],
          },
        })
      }
      if (url.includes('/pools')) {
        return route.fulfill({ json: { pools: [] } })
      }
      if (url.match(/\/load-balancers\/[^/]+$/)) {
        return route.fulfill({
          json: {
            loadbalancer: {
              id: 'lb-1',
              name: 'public-lb',
              provisioning_status: 'ACTIVE',
              operating_status: 'ONLINE',
              vip_address: '10.0.0.5',
            },
          },
        })
      }
      return route.fulfill({
        json: {
          loadbalancers: [{ id: 'lb-1', name: 'public-lb', provisioning_status: 'ACTIVE', operating_status: 'ONLINE' }],
        },
      })
    }
    if (url.includes('/openstack/identity/projects')) {
      if (url.match(/\/identity\/projects\/[^/]+$/)) {
        return route.fulfill({
          json: { project: { id: 'proj-1', name: 'demo', enabled: true } },
        })
      }
      return route.fulfill({
        json: { projects: [{ id: 'proj-1', name: 'demo', enabled: true }] },
      })
    }
    if (url.includes('/openstack/identity/users')) {
      return route.fulfill({ json: { users: [{ id: 'u-1', name: 'admin', enabled: true }] } })
    }
    if (url.includes('/openstack/identity/roles')) {
      return route.fulfill({ json: { roles: [{ id: 'role-1', name: 'member' }] } })
    }
    if (url.includes('/openstack/identity/role-assignments')) {
      return route.fulfill({
        json: {
          role_assignments: [{
            role_id: 'role-1',
            user_id: 'u-1',
            project_id: 'proj-1',
            role_name: 'member',
            user_name: 'admin',
          }],
        },
      })
    }
    if (url.includes('/openstack/network-topology')) {
      return route.fulfill({
        json: {
          graph: {
            nodes: [
              { id: 'net-1', label: 'private', kind: 'network' },
              { id: 'rtr-1', label: 'router1', kind: 'router' },
            ],
            edges: [{ from: 'net-1', to: 'rtr-1', kind: 'router-interface' }],
          },
        },
      })
    }
    if (url.includes('/events/stream') || url.includes('/ws/')) {
      return route.abort()
    }
    return route.fulfill({ json: {} })
  })
}

test('OpenStack instances pagination shows search truncated warning', async ({ page }) => {
  await mockOpenStackApi(page)
  await page.goto('/openstack/instances')
  await expect(page.getByText('OpenStack Instances')).toBeVisible({ timeout: 15_000 })
  const search = page.getByPlaceholder(/search name or id/i)
  await expect(search).toBeVisible({ timeout: 15_000 })
  await search.fill('web')
  await expect(page.getByText(/Search capped at 500 matches/i)).toBeVisible({ timeout: 15_000 })
})

test('OpenStack Heat page lists stacks', async ({ page }) => {
  await mockOpenStackApi(page)
  await page.goto('/openstack/heat')
  await expect(page.getByRole('heading', { name: /heat stacks/i })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('demo')).toBeVisible()
})

test('OpenStack topology renders SVG graph', async ({ page }) => {
  await mockOpenStackApi(page)
  await page.goto('/openstack/topology')
  await expect(page.getByRole('heading', { name: /neutron topology/i })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('private')).toBeVisible()
  await expect(page.getByText('router1')).toBeVisible()
})

test('OpenStack load balancers page lists LBs', async ({ page }) => {
  await mockOpenStackApi(page)
  await page.goto('/openstack/load-balancers')
  await expect(page.getByRole('heading', { name: /octavia load balancers/i })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('link', { name: 'public-lb' })).toBeVisible({ timeout: 15_000 })
})

test('OpenStack Heat detail shows resources tab', async ({ page }) => {
  await mockOpenStackApi(page)
  await page.goto('/openstack/heat/demo/stack-1')
  await expect(page.getByRole('heading', { name: 'demo' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Resources' }).click()
  await expect(page.getByText('OS::Heat::None')).toBeVisible({ timeout: 15_000 })
})

test('OpenStack load balancer detail shows listeners', async ({ page }) => {
  await mockOpenStackApi(page)
  await page.goto('/openstack/load-balancers/lb-1')
  await expect(page.getByRole('heading', { name: 'public-lb' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('http · HTTP:80')).toBeVisible()
})

test('OpenStack identity project detail shows role assignments', async ({ page }) => {
  await mockOpenStackApi(page)
  await page.goto('/openstack/identity/projects/proj-1')
  await expect(page.getByRole('heading', { name: 'demo' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('cell', { name: 'member' })).toBeVisible()
})

test('OpenStack identity page lists projects and users', async ({ page }) => {
  await mockOpenStackApi(page)
  await page.goto('/openstack/identity')
  await expect(page.getByRole('heading', { name: /keystone identity/i })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('cell', { name: 'demo' })).toBeVisible()
  await page.getByRole('button', { name: /users/i }).click()
  await expect(page.getByRole('cell', { name: 'admin' })).toBeVisible()
})
