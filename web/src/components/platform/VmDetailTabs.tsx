// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import DetailTabs from './DetailTabs'

export type VmDetailTab =
  | 'overview'
  | 'doctor'
  | 'console'
  | 'performance'
  | 'disks'
  | 'network'
  | 'guestHealth'
  | 'guestServices'
  | 'security'
  | 'snapshots'
  | 'backup'
  | 'topology'
  | 'events'
  | 'settings'

const PRIMARY = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'console' as const, label: 'Console' },
  { id: 'performance' as const, label: 'Performance' },
  { id: 'doctor' as const, label: 'Doctor' },
  { id: 'disks' as const, label: 'Disks' },
]

const MORE = [
  { id: 'network' as const, label: 'Network', group: 'Connectivity' },
  { id: 'guestHealth' as const, label: 'Guest health', group: 'Guest' },
  { id: 'guestServices' as const, label: 'Guest services', group: 'Guest' },
  { id: 'security' as const, label: 'Security & ports', group: 'Guest' },
  { id: 'snapshots' as const, label: 'Snapshots', group: 'Data' },
  { id: 'backup' as const, label: 'Backup', group: 'Data' },
  { id: 'topology' as const, label: 'Topology', group: 'Fleet' },
  { id: 'events' as const, label: 'Events', group: 'Fleet' },
  { id: 'settings' as const, label: 'Settings', group: 'Admin' },
]

interface VmDetailTabsProps {
  active: VmDetailTab
  onChange: (tab: VmDetailTab) => void
}

export default function VmDetailTabs({ active, onChange }: VmDetailTabsProps) {
  return <DetailTabs primary={PRIMARY} more={MORE} active={active} onChange={onChange} />
}

export function isGuestRelatedTab(tab: VmDetailTab): boolean {
  return tab === 'overview' || tab === 'guestHealth' || tab === 'guestServices' || tab === 'security'
}
