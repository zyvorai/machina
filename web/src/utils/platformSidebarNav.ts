// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AppWindow,
  Archive,
  ArrowRightLeft,
  Bell,
  BellPlus,
  Blocks,
  Boxes,
  BrainCircuit,
  Building2,
  Cable,
  CalendarClock,
  Camera,
  CheckCircle2,
  Cloud,
  Component,
  Container,
  Copy,
  Cpu,
  Crosshair,
  Database,
  Eye,
  FileCheck2,
  Flame,
  Gauge,
  Gavel,
  HardDrive,
  History,
  Home,
  Image,
  LayoutDashboard,
  LayoutGrid,
  Layers,
  LifeBuoy,
  Lightbulb,
  ListChecks,
  Monitor,
  Network,
  Package,
  Plug,
  Radar,
  Route,
  ScrollText,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Terminal,
  TrendingUp,
  Waypoints,
  Wrench,
  Zap,
} from 'lucide-react'
import type { PlatformDesktopTier } from './platformDesktopTier'
import { isPathAllowedForTier } from './platformDesktopTier'
import { menubarProductGroupsForTier } from './platformMacMenus'
import { PLATFORM_PAGE_LABELS, type PlatformNavItem } from './platformNav'

export type SidebarRailItem = {
  to: string
  label: string
  icon: LucideIcon
}

export type SidebarProductSection = {
  id: string
  label: string
  icon: LucideIcon
  items: SidebarRailItem[]
}

const GROUP_ICONS: Record<string, LucideIcon> = {
  workloads: Monitor,
  infra: Server,
  ops: Activity,
  secure: Shield,
  admin: Settings,
  more: LayoutGrid,
}

const RAIL_PINNED_PATHS = [
  '/platform',
  '/vms',
  '/platform/vms',
  '/platform/hosts',
  '/platform/settings',
] as const

const PATH_ICON_OVERRIDES: Record<string, LucideIcon> = {
  '/': Home,
  '/platform': LayoutDashboard,
  '/vms': Monitor,
  '/create': Cpu,
  '/containers': Container,
  '/networks': Waypoints,
  '/storage': Database,
  '/fleet-cloud': Cloud,
  '/k8s/workloads': Boxes,
  // Workloads
  '/platform/vms': Monitor,
  '/platform/workloads': Layers,
  '/platform/applications': AppWindow,
  '/platform/templates': Copy,
  '/platform/fleet-snapshots': Camera,
  '/platform/blueprints': Blocks,
  // Infra
  '/platform/infrastructure': LayoutDashboard,
  '/platform/hosts': Server,
  '/platform/datacenter': Building2,
  '/platform/storage': HardDrive,
  '/platform/networks': Network,
  '/platform/reports': Gauge,
  '/platform/gpu': Zap,
  '/platform/content': Image,
  '/platform/cloud-init': Terminal,
  '/platform/enroll': Server,
  // Ops
  '/platform/operations': Wrench,
  '/platform/activity': Activity,
  '/platform/events': History,
  '/platform/backups': Archive,
  '/platform/maintenance': TrendingUp,
  '/platform/tasks': ListChecks,
  '/platform/notifications': Bell,
  '/platform/alert-rules': BellPlus,
  '/platform/scheduled-jobs': CalendarClock,
  '/platform/migration': ArrowRightLeft,
  '/platform/network-canvas': Waypoints,
  '/platform/placement': LifeBuoy,
  '/platform/topology': Route,
  '/platform/observability': Eye,
  '/platform/recommendations': Lightbulb,
  // Secure
  '/platform/soc': Radar,
  '/platform/zeus/security': ShieldCheck,
  '/platform/zeus/security/firewall': Flame,
  '/platform/zeus/security/ports': Plug,
  '/platform/zeus/security/services': CheckCircle2,
  '/platform/zeus/security/activity': Activity,
  '/platform/zeus/security/compliance': FileCheck2,
  '/platform/zeus/security/k8s': Component,
  '/platform/zeus/security/cloud': Cloud,
  '/platform/zeus/security/connectivity': Cable,
  '/platform/zeus/security/policies': ScrollText,
  '/platform/zyra/security/hunt': Crosshair,
  '/platform/zyra/security/enforcement': Gavel,
  '/platform/policy': Shield,
  // Admin / Zyra / other
  '/platform/administration': Settings,
  '/platform/zyra': BrainCircuit,
  '/platform/zyra/configure': BrainCircuit,
  '/platform/ai-providers': BrainCircuit,
  '/platform/settings': Settings,
  '/platform/users': Settings,
  '/platform/projects': LayoutGrid,
  '/platform/enterprise': Settings,
  '/platform/api-keys': Settings,
  '/platform/webhooks': Settings,
  '/platform/developer': LayoutGrid,
}

function labelForPath(path: string): string {
  const key = path.split('?')[0] || path
  return PLATFORM_PAGE_LABELS[key] ?? key.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') ?? path
}

function iconForPath(path: string, fallback: LucideIcon): LucideIcon {
  const key = path.split('?')[0] || path
  return PATH_ICON_OVERRIDES[key] ?? fallback
}

/** Zeus-style pinned icon rail — primary day-to-day destinations. */
export function sidebarRailPinnedForTier(tier: PlatformDesktopTier): SidebarRailItem[] {
  return RAIL_PINNED_PATHS.filter((path) => isPathAllowedForTier(path, tier)).map((to) => ({
    to,
    label: labelForPath(to),
    icon: iconForPath(to, LayoutGrid),
  }))
}

/** Product groups moved from the menubar into the sidebar (Workloads, Infra, …). */
export function sidebarProductSectionsForTier(
  tier: PlatformDesktopTier,
  integrationItems: PlatformNavItem[] = [],
): SidebarProductSection[] {
  return menubarProductGroupsForTier(tier, integrationItems)
    .map((group) => ({
      id: group.id,
      label: group.compact,
      icon: GROUP_ICONS[group.id] ?? LayoutGrid,
      items: group.sections.flatMap((section) =>
        section.items.map((item) => ({
          to: item.to,
          label: item.label,
          icon: iconForPath(item.to, GROUP_ICONS[group.id] ?? LayoutGrid),
        })),
      ),
    }))
    .filter((section) => section.items.length > 0)
}
