// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import {
  getFleetDesktop,
  getFleetLinuxHealth,
  type FleetDesktopOverview,
  type FleetLinuxHealthOverview,
} from '../api/platform'
import { useFleetDesktopContextOptional } from '../contexts/FleetDesktopContext'

/**
 * Fleet desktop data. When rendered inside {@link FleetDesktopProvider} (platform shell),
 * reads shared polled state instead of opening a separate poll loop.
 */
export function useFleetDesktop(enabled = true, intervalMs = 60_000) {
  const shared = useFleetDesktopContextOptional()
  const [desktop, setDesktop] = useState<FleetDesktopOverview | null>(null)
  const [linuxHealth, setLinuxHealth] = useState<FleetLinuxHealthOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      const [d, l] = await Promise.all([
        getFleetDesktop(),
        getFleetLinuxHealth().catch(() => null),
      ])
      setDesktop(d)
      setLinuxHealth(l)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Fleet desktop load failed')
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    if (shared) return undefined
    void refresh()
    if (!enabled || intervalMs <= 0) return undefined
    const t = window.setInterval(() => void refresh(), intervalMs)
    return () => window.clearInterval(t)
  }, [shared, enabled, intervalMs, refresh])

  if (shared) {
    return {
      desktop: shared.desktop,
      linuxHealth: shared.linuxHealth,
      loading: shared.loading,
      error: shared.error,
      refresh: shared.refresh,
    }
  }

  return { desktop, linuxHealth, loading, error, refresh }
}
