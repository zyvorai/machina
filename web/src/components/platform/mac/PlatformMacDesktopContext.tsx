// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  defaultSidebarVisibleForTier,
  loadPlatformDesktopTier,
} from '../../../utils/platformDesktopTier'

type PlatformMacDesktopContextValue = {
  sidebarVisible: boolean
  sidebarCollapsed: boolean
  inspectorVisible: boolean
  cinemaChromeHidden: boolean
  toggleSidebar: () => void
  setSidebarVisible: (v: boolean) => void
  setSidebarCollapsed: (v: boolean) => void
  setCinemaChromeHidden: (v: boolean) => void
  toggleInspector: () => void
  setInspectorVisible: (v: boolean) => void
}

const PlatformMacDesktopContext = createContext<PlatformMacDesktopContextValue | null>(null)

const SIDEBAR_COLLAPSED_KEY = 'machina-platform-sidebar-collapsed'
const SIDEBAR_VISIBLE_KEY = 'machina-platform-sidebar-visible'

function loadSidebarVisible(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_VISIBLE_KEY)
    if (raw === '0') return false
    if (raw === '1') return true
  } catch {
    /* ignore */
  }
  return defaultSidebarVisibleForTier(loadPlatformDesktopTier())
}

function persistSidebarVisible(visible: boolean) {
  try {
    localStorage.setItem(SIDEBAR_VISIBLE_KEY, visible ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function defaultSidebarCollapsedForTier(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    if (raw === '0') return false
    if (raw === '1') return true
  } catch {
    /* ignore */
  }
  // Zeus-style icon rail by default
  return true
}

export function PlatformMacDesktopProvider({ children }: { children: ReactNode }) {
  const [sidebarVisible, setSidebarVisibleState] = useState(() => loadSidebarVisible())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => defaultSidebarCollapsedForTier())
  const [inspectorVisible, setInspectorVisible] = useState(true)
  const [cinemaChromeHidden, setCinemaChromeHidden] = useState(false)

  const setSidebarVisible = useCallback((v: boolean) => {
    persistSidebarVisible(v)
    setSidebarVisibleState(v)
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarVisibleState((v) => {
      const next = !v
      persistSidebarVisible(next)
      return next
    })
  }, [])

  const toggleInspector = useCallback(() => setInspectorVisible((v) => !v), [])

  const setCollapsed = useCallback((v: boolean) => {
    setSidebarCollapsed(v)
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? '1' : '0')
  }, [])

  const value = useMemo(
    () => ({
      sidebarVisible,
      sidebarCollapsed,
      inspectorVisible,
      cinemaChromeHidden,
      toggleSidebar,
      setSidebarVisible,
      setSidebarCollapsed: setCollapsed,
      setCinemaChromeHidden,
      toggleInspector,
      setInspectorVisible,
    }),
    [sidebarVisible, sidebarCollapsed, inspectorVisible, cinemaChromeHidden, toggleSidebar, setSidebarVisible, setCollapsed, toggleInspector],
  )

  return <PlatformMacDesktopContext.Provider value={value}>{children}</PlatformMacDesktopContext.Provider>
}

export function usePlatformMacDesktop() {
  const ctx = useContext(PlatformMacDesktopContext)
  if (!ctx) throw new Error('usePlatformMacDesktop must be used within PlatformMacDesktopProvider')
  return ctx
}
