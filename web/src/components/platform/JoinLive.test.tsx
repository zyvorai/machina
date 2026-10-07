// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import FleetCloudMap, { hostTone, ringPositions } from './FleetCloudMap'
import MacTerminal from './MacTerminal'
import JoinLivePanel from './JoinLivePanel'
import { terminalLines } from '../../utils/joinProgress'

vi.mock('../../api/platform', () => ({
  getJoinProgress: vi.fn(),
  listPlatformHosts: vi.fn(),
}))
import { getJoinProgress, listPlatformHosts } from '../../api/platform'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const host = (name: string, state = 'online') => ({ id: name, hostname: name, state, vm_count: 2, cpu_percent: 40 })
const ev = (id: string, step: string, level: string, message: string) => ({ id, step, level, message, created_at: '2026-10-07 10:00:01.500' })

describe('MacTerminal', () => {
  it('draws a black window with the typed command and coloured lines', () => {
    render(<MacTerminal title="join" prompt="machina-agent join" lines={terminalLines([ev('1', 'register', 'ok', 'host record created')])} />)
    const t = screen.getByTestId('mac-terminal')
    expect(t.style.background).toMatch(/#000|rgb\(0, 0, 0\)/)
    expect(screen.getByText('machina-agent join')).toBeTruthy()
    const ok = screen.getByText('host record created')
    expect(ok.style.color).toMatch(/#30d158|rgb\(48, 209, 88\)/)
  })
  it('shows a waiting line before anything arrives', () => {
    render(<MacTerminal title="join" lines={[]} waiting="waiting for the host" />)
    expect(screen.getByText(/waiting for the host/)).toBeTruthy()
  })
})

describe('FleetCloudMap', () => {
  it('lists every machine and a pulsing node for a joining one', () => {
    render(<MemoryRouter><FleetCloudMap hosts={[host('a'), host('b', 'offline')]} joining={{ label: 'node-9' }} /></MemoryRouter>)
    expect(screen.getByTestId('fleet-map-host-a')).toBeTruthy()
    expect(screen.getByTestId('fleet-map-host-b')).toBeTruthy()
    expect(screen.getByTestId('fleet-map-joining').textContent).toContain('node-9')
    expect(screen.getByLabelText(/1 of 2 hosts online, 4 VMs/)).toBeTruthy()
  })
  it('places nodes around the controller and maps states to tones', () => {
    expect(ringPositions(4)).toHaveLength(4)
    expect(new Set(ringPositions(6).map((p) => `${p.x},${p.y}`)).size).toBe(6)
    expect(hostTone({ state: 'online' })).toBe('ok')
    expect(hostTone({ state: 'online', maintenance_mode: true })).toBe('warn')
    expect(hostTone({ state: 'offline' })).toBe('error')
  })
})

describe('JoinLivePanel', () => {
  it('shows the stages and log as the controller reports them', async () => {
    vi.mocked(listPlatformHosts).mockResolvedValue([host('existing')] as never)
    vi.mocked(getJoinProgress).mockResolvedValue({
      token_status: 'joined',
      events: [ev('1', 'token', 'info', 'enrollment token issued'), ev('2', 'contact', 'info', 'node-9 (10.0.0.9) contacted the controller'), ev('3', 'register', 'ok', 'host record created')],
      host: { id: 'n9', hostname: 'node-9', address: '10.0.0.9', state: 'provisioning', validation_status: 'pending', vm_count: 0, cpu_percent: 0 },
    })
    render(<MemoryRouter><JoinLivePanel token="join-abc" command="curl x | sudo bash -s -- --token join-abc" /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('host record created')).toBeTruthy())
    expect(document.querySelector('[data-stage="register"]')?.getAttribute('data-status')).toBe('done')
    expect(document.querySelector('[data-stage="validate"]')?.getAttribute('data-status')).toBe('active')
    expect(screen.getByText(/--token join-abc••••|--token join-abc/)).toBeTruthy()
    expect(screen.queryByText('curl x | sudo bash -s -- --token join-abc')).toBeNull()
  })
})
