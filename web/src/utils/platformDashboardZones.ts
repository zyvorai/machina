// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

// Four-zone dashboard IA — Infrastructure · Workloads · Operations · Administration.

import type { PlatformDesktopTier } from './platformDesktopTier'
import { tierAtLeast } from './platformDesktopTier'

export type DashboardZoneId = 'infrastructure' | 'workloads' | 'operations' | 'administration'

export type ZoneTileDef = {
  id: string
  to: string
  label: string
  minTier?: PlatformDesktopTier
}

export type DashboardZoneDef = {
  id: DashboardZoneId
  label: string
  description: string
  hubPath: string
  tiles: ZoneTileDef[]
}

export const DASHBOARD_ZONE_DEFS: DashboardZoneDef[] = [
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    description: 'Clusters, hosts, storage, networks, and capacity',
    hubPath: '/platform/infrastructure',
    tiles: [
      { id: 'clusters', to: '/platform/datacenter', label: 'Clusters', minTier: 'power' },
      { id: 'hosts', to: '/platform/hosts', label: 'Hosts' },
      { id: 'storage', to: '/platform/storage', label: 'Storage' },
      { id: 'networks', to: '/platform/networks', label: 'Networks', minTier: 'power' },
      { id: 'capacity', to: '/platform/reports', label: 'Capacity', minTier: 'power' },
    ],
  },
  {
    id: 'workloads',
    label: 'Workloads',
    description: 'Applications, VMs, and Kubernetes objects',
    hubPath: '/platform/workloads',
    tiles: [
      { id: 'applications', to: '/platform/applications', label: 'Applications', minTier: 'power' },
      { id: 'vms', to: '/platform/vms', label: 'Machine Finder' },
      { id: 'pods', to: '/k8s/workloads', label: 'Containers / Pods', minTier: 'power' },
      { id: 'deployments', to: '/k8s/workloads', label: 'Deployments', minTier: 'power' },
      { id: 'cronjobs', to: '/k8s/workloads', label: 'Cron Jobs', minTier: 'power' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    description: 'Monitoring, events, backups, and upgrades',
    hubPath: '/platform/operations',
    tiles: [
      { id: 'monitoring', to: '/platform/activity', label: 'Monitoring', minTier: 'power' },
      { id: 'events', to: '/platform/events', label: 'Events', minTier: 'power' },
      { id: 'backups', to: '/platform/backups', label: 'Backups' },
      { id: 'upgrades', to: '/platform/maintenance', label: 'Upgrades', minTier: 'power' },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    description: 'Users, projects, policies, and integrations',
    hubPath: '/platform/administration',
    tiles: [
      { id: 'users', to: '/platform/users', label: 'Users', minTier: 'power' },
      { id: 'projects', to: '/platform/projects', label: 'Projects', minTier: 'power' },
      { id: 'policies', to: '/platform/policy', label: 'Policies', minTier: 'power' },
      { id: 'integrations', to: '/platform/settings?section=integrations', label: 'Integrations' },
    ],
  },
]

export function zoneTilesForTier(zone: DashboardZoneDef, tier: PlatformDesktopTier): ZoneTileDef[] {
  return zone.tiles.filter((tile) => tierAtLeast(tier, tile.minTier ?? 'normal'))
}

export function dashboardZonesForTier(tier: PlatformDesktopTier): DashboardZoneDef[] {
  return DASHBOARD_ZONE_DEFS.map((zone) => ({
    ...zone,
    tiles: zoneTilesForTier(zone, tier),
  })).filter((zone) => zone.tiles.length > 0)
}

export function dashboardZoneById(id: DashboardZoneId): DashboardZoneDef | undefined {
  return DASHBOARD_ZONE_DEFS.find((zone) => zone.id === id)
}

/** Extended infrastructure tiles shown inside the Infrastructure hub (beyond the dashboard quadrant). */
export const INFRASTRUCTURE_HUB_EXTRA_TILES: ZoneTileDef[] = [
  { id: 'gpu', to: '/platform/gpu', label: 'GPU Command Center', minTier: 'power' },
  { id: 'content', to: '/platform/content', label: 'Images & ISOs', minTier: 'power' },
  { id: 'templates', to: '/platform/templates', label: 'Templates', minTier: 'power' },
  { id: 'cloud-init', to: '/platform/cloud-init', label: 'Cloud-Init Studio', minTier: 'power' },
  { id: 'enroll', to: '/platform/enroll', label: 'Add Host', minTier: 'power' },
]

/** Extended operations tiles — lifecycle and fleet insights beyond the dashboard quadrant. */
export const OPERATIONS_HUB_EXTRA_TILES: ZoneTileDef[] = [
  { id: 'tasks', to: '/platform/tasks', label: 'Tasks', minTier: 'power' },
  { id: 'alerts', to: '/platform/notifications', label: 'Alerts' },
  { id: 'migration', to: '/platform/migration', label: 'Migration', minTier: 'power' },
  { id: 'snapshots', to: '/platform/fleet-snapshots', label: 'Fleet Snapshots', minTier: 'power' },
  { id: 'dr', to: '/platform/placement', label: 'Disaster Recovery', minTier: 'power' },
  { id: 'observability', to: '/platform/observability', label: 'Observability', minTier: 'power' },
  { id: 'topology', to: '/platform/topology', label: 'Topology', minTier: 'power' },
  { id: 'reports', to: '/platform/reports', label: 'Reports', minTier: 'power' },
  { id: 'recommendations', to: '/platform/recommendations', label: 'Recommendations', minTier: 'power' },
  { id: 'blueprints', to: '/platform/blueprints', label: 'Shortcuts', minTier: 'power' },
]

/** Extended administration tiles — API keys, webhooks, and enterprise settings. */
export const ADMINISTRATION_HUB_EXTRA_TILES: ZoneTileDef[] = [
  { id: 'api-keys', to: '/platform/api-keys', label: 'API Keys', minTier: 'power' },
  { id: 'webhooks', to: '/platform/webhooks', label: 'Webhooks', minTier: 'power' },
  { id: 'keychain', to: '/platform/enterprise', label: 'Keychain', minTier: 'power' },
  { id: 'settings', to: '/platform/settings', label: 'Settings' },
]

export function filterTilesForTier(tiles: ZoneTileDef[], tier: PlatformDesktopTier): ZoneTileDef[] {
  return tiles.filter((tile) => tierAtLeast(tier, tile.minTier ?? 'normal'))
}
