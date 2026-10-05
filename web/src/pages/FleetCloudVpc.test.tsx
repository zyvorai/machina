// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import FleetCloudVpc from './FleetCloudVpc'

const api = vi.hoisted(() => ({ listVpcs: vi.fn(), listSubnets: vi.fn(), listInstanceGroups: vi.fn(), listLaunchTemplates: vi.fn(), retrySubnet: vi.fn(), getCloudPlan: vi.fn() }))
vi.mock('../api/cloud', () => api)
vi.mock('../api/nativeProjects', () => ({ listProjectRegistry: async () => [{ id: 'a', name: 'Project A', enabled: true }, { id: 'b', name: 'Project B', enabled: true }] }))
vi.mock('../api/platform', () => ({ platformFetch: async () => [{ id: 'h', hostname: 'host', state: 'online' }] }))
vi.mock('../components/PageLayout', () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }))
vi.mock('../components/FleetCloudSubNav', () => ({ default: () => null }))
vi.mock('../components/FleetCloudFooter', () => ({ default: () => null }))
vi.mock('../contexts/ToastContext', () => ({ useToastContext: () => ({ error: vi.fn() }) }))

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  api.listVpcs.mockResolvedValue([{ id: 'va', name: 'VPC A', cidr: '10.20.0.0/16' }])
  api.listSubnets.mockResolvedValue([{ id: 's', name: 'apps', cidr: '10.20.1.0/24', status: 'error', last_error: 'Agent unavailable' }])
  api.listInstanceGroups.mockResolvedValue([]); api.listLaunchTemplates.mockResolvedValue([])
  api.retrySubnet.mockResolvedValue({ task_id: 'task' })
  api.getCloudPlan.mockResolvedValue({ forwarding_active: false, warnings: ['Peering is a plan only'], routes: [], peerings: [] })
})
it('shows failed provisioning, retries the subnet and keeps forwarding status explicit', async () => {
  render(<FleetCloudVpc />)
  const retry = await screen.findByRole('button', { name: 'Retry apps' })
  expect(screen.getByRole('alert').textContent).toContain('Agent unavailable')
  fireEvent.click(retry)
  await waitFor(() => expect(api.retrySubnet).toHaveBeenCalledWith('s'))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Inspect plan' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Inspect plan' }))
  expect(await screen.findByText('Forwarding active: no')).toBeTruthy()
  expect(screen.getByText('Peering is a plan only')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Create group' }).hasAttribute('disabled')).toBe(true)
})
it('does not show a previous project response after switching projects', async () => {
  let resolveA!: (value: unknown[]) => void
  const pending = new Promise<unknown[]>(resolve => { resolveA = resolve })
  api.listVpcs.mockImplementation((project: string) => project === 'a' ? pending : Promise.resolve([{ id: 'vb', name: 'VPC B', cidr: '10.21.0.0/16' }]))
  render(<FleetCloudVpc />)
  await waitFor(() => expect(api.listVpcs).toHaveBeenCalledWith('a'))
  fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'b' } })
  await screen.findByRole('option', { name: 'VPC B · 10.21.0.0/16' })
  resolveA([{ id: 'va', name: 'VPC A', cidr: '10.20.0.0/16' }])
  await waitFor(() => expect(api.listVpcs).toHaveBeenCalledWith('b'))
  expect(screen.queryByRole('option', { name: 'VPC A · 10.20.0.0/16' })).toBeNull()
})
