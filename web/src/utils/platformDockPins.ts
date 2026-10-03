// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  Bell,
  FileBarChart,
  GitBranch,
  HardDrive,
  LayoutDashboard,
  Monitor,
  Network,
  Server,
  Settings,
  Sparkles,
  Terminal,
  Download,
  FolderOpen,
  Wrench,
  ShieldAlert,
} from 'lucide-react'
import { PLATFORM_SIDEBAR } from './platformNav'
import {
  DOCK_PATHS_BY_TIER,
  isPathAllowedForTier,
  loadPlatformDesktopTier,
  PLATFORM_DESKTOP_TIER_EVENT,
  savePlatformDesktopTier,
  type PlatformDesktopTier,
} from './platformDesktopTier'
import { dockPreviewPathsForTier } from './platformHubZones'

export type PlatformDockItem = {
  path: string
  label: string
  icon: LucideIcon
  /** Normal-tier preview pin — unlocks at Power user. */
  preview?: boolean
}

const DOCK_KEY = 'machina-platform-dock-pins'
export const PLATFORM_DOCK_CHANGED_EVENT = 'machina-platform-dock-changed'

const ICON_BY_PATH: Record<string, LucideIcon> = {
  '/platform': LayoutDashboard,
  '/platform/vms': Monitor,
  '/platform/hosts': Server,
  '/platform/storage': HardDrive,
  '/platform/networks': Network,
  '/platform/events': Terminal,
  '/platform/activity': Activity,
  '/platform/reports': FileBarChart,
  '/platform/topology': GitBranch,
  '/platform/maintenance': Download,
  '/platform/notifications': Bell,
  '/platform/zyra': Sparkles,
  '/platform/infrastructure': Server,
  '/platform/workloads': Monitor,
  '/platform/administration': Settings,
  '/platform/resources': Server,
  '/platform/operations': Wrench,
  '/platform/zeus/security': ShieldAlert,
  '/platform/settings': Settings,
}

const LABEL_BY_PATH: Record<string, string> = {
  '/platform': 'Mission Control',
  '/platform/hosts': 'Hosts',
  '/platform/vms': 'Machines',
  '/platform/storage': 'Storage',
  '/platform/networks': 'Network',
  '/platform/zyra': 'Zyra',
  '/platform/events': 'Terminal',
  '/platform/activity': 'Activity',
  '/platform/reports': 'Reports',
  '/platform/topology': 'Topology',
  '/platform/maintenance': 'Updates',
  '/platform/notifications': 'Alerts',
  '/platform/infrastructure': 'Infrastructure',
  '/platform/workloads': 'Workloads',
  '/platform/administration': 'Admin',
  '/platform/resources': 'Infrastructure',
  '/platform/operations': 'Ops',
  '/platform/zeus/security': 'Security',
}

/** Default pinned apps for the Machina platform dock (v9s MacDock pattern). */
export function defaultDockPathsForTier(tier: PlatformDesktopTier = loadPlatformDesktopTier()): string[] {
  return DOCK_PATHS_BY_TIER[tier]
}

export const DEFAULT_PLATFORM_DOCK_PATHS = defaultDockPathsForTier('advanced')

export const PLATFORM_SIDEBAR_FLAT = PLATFORM_SIDEBAR.flatMap((s) =>
  s.items.map((item) => ({ path: item.to, label: item.label })),
)

function itemForPath(path: string, preview = false): PlatformDockItem | null {
  const flat = PLATFORM_SIDEBAR_FLAT.find((i) => i.path === path)
  const Icon = ICON_BY_PATH[path] ?? Monitor
  const label = LABEL_BY_PATH[path] ?? flat?.label
  if (label) return { path, label, icon: Icon, preview }
  if (path in ICON_BY_PATH) {
    return { path, label: path.split('/').pop() ?? path, icon: Icon, preview }
  }
  return null
}

export function loadPlatformDockItems(): PlatformDockItem[] {
  const tier = loadPlatformDesktopTier()
  try {
    const raw = localStorage.getItem(DOCK_KEY)
    if (raw) {
      const paths = JSON.parse(raw) as string[]
      if (Array.isArray(paths)) {
        const allowed = paths.filter((p) => isPathAllowedForTier(p, tier))
        const items = allowed.map((p) => itemForPath(p)).filter(Boolean) as PlatformDockItem[]
        if (items.length) return appendPreviewItems(items, tier)
      }
    }
  } catch {
    /* ignore */
  }
  const items = defaultDockPathsForTier(tier).map((p) => itemForPath(p)).filter(Boolean) as PlatformDockItem[]
  return appendPreviewItems(items, tier)
}

function appendPreviewItems(items: PlatformDockItem[], tier: PlatformDesktopTier): PlatformDockItem[] {
  const previews = dockPreviewPathsForTier(tier)
    .filter((path) => !items.some((item) => item.path === path))
    .map((path) => itemForPath(path, true))
    .filter(Boolean) as PlatformDockItem[]
  return [...items, ...previews]
}

export function unlockDockPreviewPath(path: string) {
  if (loadPlatformDesktopTier() !== 'normal') return false
  if (!dockPreviewPathsForTier('normal').includes(path)) return false
  savePlatformDesktopTier('power')
  resetPlatformDockPaths('power')
  return true
}

export function loadPlatformDockPaths(): string[] {
  return loadPlatformDockItems().map((i) => i.path)
}

export function savePlatformDockPaths(paths: string[]) {
  localStorage.setItem(DOCK_KEY, JSON.stringify(paths))
  window.dispatchEvent(new CustomEvent(PLATFORM_DOCK_CHANGED_EVENT))
}

export function resetPlatformDockPaths(tier: PlatformDesktopTier = loadPlatformDesktopTier()) {
  savePlatformDockPaths(defaultDockPathsForTier(tier))
}

export function usePlatformDockItems(): PlatformDockItem[] {
  const [items, setItems] = useState(loadPlatformDockItems)
  useEffect(() => {
    const refresh = () => setItems(loadPlatformDockItems())
    window.addEventListener(PLATFORM_DOCK_CHANGED_EVENT, refresh)
    window.addEventListener(PLATFORM_DESKTOP_TIER_EVENT, refresh)
    return () => {
      window.removeEventListener(PLATFORM_DOCK_CHANGED_EVENT, refresh)
      window.removeEventListener(PLATFORM_DESKTOP_TIER_EVENT, refresh)
    }
  }, [])
  return items
}

/** @deprecated use loadPlatformDockItems */
export const PLATFORM_DOCK_ITEMS = loadPlatformDockItems()
