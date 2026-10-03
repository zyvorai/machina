// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  Archive,
  Boxes,
  ClipboardList,
  Clock,
  Cpu,
  Download,
  FolderKanban,
  Gauge,
  GitBranch,
  HardDrive,
  Key,
  Layers,
  Lightbulb,
  Monitor,
  Network,
  Package,
  PieChart,
  Server,
  Plug,
  Settings,
  Shield,
  Terminal,
  UserPlus,
  Users,
  Webhook,
  Workflow,
  Wrench,
} from 'lucide-react'
import PlatformPageChrome, { PlatformBackLink } from './PlatformPageChrome'
import PlatformHubLaunchpad, { type HubGroup } from './tahoe/PlatformHubLaunchpad'
import {
  dashboardZoneById,
  filterTilesForTier,
  type DashboardZoneId,
  type ZoneTileDef,
} from '../../utils/platformDashboardZones'
import { usePlatformDesktopTier } from '../../hooks/usePlatformDesktopTier'

const TILE_ICONS: Record<string, LucideIcon> = {
  clusters: Server,
  hosts: Server,
  storage: HardDrive,
  networks: Network,
  capacity: PieChart,
  applications: Package,
  vms: Monitor,
  pods: Boxes,
  deployments: Layers,
  cronjobs: Clock,
  monitoring: Activity,
  events: Terminal,
  backups: Archive,
  upgrades: Download,
  users: Users,
  projects: FolderKanban,
  policies: Shield,
  integrations: Plug,
  gpu: Cpu,
  content: Package,
  templates: Layers,
  'cloud-init': Terminal,
  enroll: UserPlus,
  tasks: ClipboardList,
  alerts: Activity,
  migration: GitBranch,
  snapshots: Archive,
  dr: Shield,
  observability: Gauge,
  topology: GitBranch,
  reports: PieChart,
  recommendations: Lightbulb,
  blueprints: Workflow,
  'api-keys': Key,
  webhooks: Webhook,
  keychain: Shield,
  settings: Settings,
}

function tilesToLaunchpad(tiles: ZoneTileDef[]) {
  return tiles.map((tile) => {
    const Icon = TILE_ICONS[tile.id] ?? Boxes
    return {
      to: tile.to,
      label: tile.label,
      icon: <Icon className="w-8 h-8" strokeWidth={1.75} />,
    }
  })
}

type PlatformZoneHubProps = {
  zoneId: DashboardZoneId
  embedded?: boolean
  extraTiles?: ZoneTileDef[]
  extraGroup?: { label: string; subtitle?: string; tiles: ZoneTileDef[] }
  subtitleStats?: React.ReactNode
  headerIcon?: React.ReactNode
  loading?: boolean
}

export default function PlatformZoneHub({
  zoneId,
  embedded,
  extraTiles = [],
  extraGroup,
  subtitleStats,
  headerIcon,
  loading,
}: PlatformZoneHubProps) {
  const [tier] = usePlatformDesktopTier()
  const zone = dashboardZoneById(zoneId)
  if (!zone) return null

  const primaryTiles = filterTilesForTier(zone.tiles, tier)
  const supplementalTiles = filterTilesForTier(extraTiles, tier)
  const groups: HubGroup[] = [
    {
      label: zone.label,
      subtitle: zone.description,
      tiles: tilesToLaunchpad(primaryTiles),
    },
  ]

  if (supplementalTiles.length > 0) {
    groups.push({
      label: 'More',
      tiles: tilesToLaunchpad(supplementalTiles),
    })
  }

  if (extraGroup && extraGroup.tiles.length > 0) {
    groups.push({
      label: extraGroup.label,
      subtitle: extraGroup.subtitle,
      tiles: tilesToLaunchpad(filterTilesForTier(extraGroup.tiles, tier)),
    })
  }

  return (
    <PlatformPageChrome
      compact={embedded}
      hideHeader={embedded}
      loading={loading}
      prepend={embedded ? undefined : <PlatformBackLink to="/platform" label="Platform" />}
      title={embedded ? undefined : zone.label}
      subtitle={
        embedded ? undefined : (
          <span className="flex flex-col gap-1">
            <span className="text-[var(--text-muted)]">{zone.description}</span>
            {subtitleStats}
          </span>
        )
      }
      icon={embedded ? undefined : headerIcon}
      contentClassName="space-y-4"
    >
      <PlatformHubLaunchpad groups={groups} />
    </PlatformPageChrome>
  )
}
