// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import DetailTabs from './DetailTabs'

export type HostDetailTab = 'general' | 'network' | 'linux' | 'security' | 'audit'

const PRIMARY: Array<{ id: HostDetailTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'network', label: 'Network' },
  { id: 'linux', label: 'Linux' },
  { id: 'security', label: 'Security' },
]

const MORE: Array<{ id: HostDetailTab; label: string; group?: string }> = [
  { id: 'audit', label: 'Audit', group: 'Compliance' },
]

interface HostDetailTabsProps {
  active: HostDetailTab
  onChange: (tab: HostDetailTab) => void
}

export default function HostDetailTabs({ active, onChange }: HostDetailTabsProps) {
  return <DetailTabs primary={PRIMARY} more={MORE} active={active} onChange={onChange} />
}
