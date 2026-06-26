// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { describe, expect, it } from 'vitest'
import {
  formatFleetDisplayTitle,
  formatPlatformHostLabel,
  isGenericClusterName,
} from './fleetDisplayName'

describe('fleetDisplayName', () => {
  it('detects generic cluster names', () => {
    expect(isGenericClusterName('default')).toBe(true)
    expect(isGenericClusterName('Production Cluster')).toBe(true)
    expect(isGenericClusterName('Edge West')).toBe(false)
  })

  it('formats host label with hostname and address', () => {
    expect(formatPlatformHostLabel({ hostname: 'hypervisor-1', address: '10.0.0.5' })).toBe(
      'hypervisor-1 · 10.0.0.5',
    )
  })

  it('prefers management IP when hostname is localhost', () => {
    expect(formatPlatformHostLabel({ hostname: 'localhost', address: '10.0.0.1' })).toBe(
      '10.0.0.1',
    )
  })

  it('uses host identity when cluster name is default', () => {
    expect(
      formatFleetDisplayTitle(
        { name: 'default' },
        [{ hostname: 'localhost', address: '10.0.0.1', state: 'online' }],
      ),
    ).toBe('10.0.0.1')
  })

  it('keeps a custom cluster name', () => {
    expect(
      formatFleetDisplayTitle(
        { name: 'Production East' },
        [{ hostname: 'node-a', address: '10.0.0.1', state: 'online' }],
      ),
    ).toBe('Production East')
  })
})
