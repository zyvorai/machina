// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  getFleetDesktop,
  getFleetLinuxHealth,
  type FleetDesktopOverview,
  type FleetLinuxHealthOverview,
} from '../api/platform'

const DEFAULT_POLL_MS = 75_000

interface FleetDesktopContextValue {
  desktop: FleetDesktopOverview | null
  linuxHealth: FleetLinuxHealthOverview | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const FleetDesktopContext = createContext<FleetDesktopContextValue | null>(null)

export function FleetDesktopProvider({ children }: { children: ReactNode }) {
  const [desktop, setDesktop] = useState<FleetDesktopOverview | null>(null)
  const [linuxHealth, setLinuxHealth] = useState<FleetLinuxHealthOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
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
  }, [])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), DEFAULT_POLL_MS)
    return () => window.clearInterval(t)
  }, [refresh])

  const value = useMemo(
    () => ({ desktop, linuxHealth, loading, error, refresh }),
    [desktop, linuxHealth, loading, error, refresh],
  )

  return (
    <FleetDesktopContext.Provider value={value}>
      {children}
    </FleetDesktopContext.Provider>
  )
}

export function useFleetDesktopContext(): FleetDesktopContextValue {
  const ctx = useContext(FleetDesktopContext)
  if (!ctx) {
    throw new Error('useFleetDesktopContext must be used within FleetDesktopProvider')
  }
  return ctx
}

/** Optional context for components outside platform shell (returns null when absent). */
export function useFleetDesktopContextOptional(): FleetDesktopContextValue | null {
  return useContext(FleetDesktopContext)
}
