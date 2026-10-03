// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { Link } from 'react-router'
import {
  Activity,
  Archive,
  Boxes,
  Clock,
  Download,
  FolderKanban,
  HardDrive,
  Layers,
  Monitor,
  Network,
  Package,
  PieChart,
  Server,
  Shield,
  Terminal,
  Users,
  Wrench,
  Plug,
} from 'lucide-react'
import { MacGlassPanel } from './mac/PlatformMacUi'
import {
  dashboardZonesForTier,
  type DashboardZoneId,
  type ZoneTileDef,
} from '../../utils/platformDashboardZones'
import type { PlatformDesktopTier } from '../../utils/platformDesktopTier'

const TILE_ICONS: Record<string, typeof Server> = {
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
}

const ZONE_ACCENT: Record<DashboardZoneId, string> = {
  infrastructure: 'text-[var(--link)]',
  workloads: 'text-[var(--accent)]',
  operations: 'text-emerald-400',
  administration: 'text-amber-400',
}

function ZoneTileLink({ tile }: { tile: ZoneTileDef }) {
  const Icon = TILE_ICONS[tile.id] ?? Boxes
  return (
    <Link
      to={tile.to}
      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--apple-surface)] transition"
    >
      <Icon className="h-4 w-4 shrink-0 opacity-75" />
      <span className="truncate">{tile.label}</span>
    </Link>
  )
}

export default function PlatformDashboardZones({ tier }: { tier: PlatformDesktopTier }) {
  const zones = dashboardZonesForTier(tier)

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="platform-dashboard-zones">
      {zones.map((zone) => (
        <MacGlassPanel
          key={zone.id}
          title={zone.label}
          subtitle={zone.description}
          action={
            <Link
              to={zone.hubPath}
              className={`text-xs font-medium ${ZONE_ACCENT[zone.id]} hover:underline`}
            >
              Open hub →
            </Link>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-0.5 -mx-1">
            {zone.tiles.map((tile) => (
              <ZoneTileLink key={`${zone.id}-${tile.id}`} tile={tile} />
            ))}
          </div>
        </MacGlassPanel>
      ))}
    </div>
  )
}
