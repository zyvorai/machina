// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { Link, useLocation } from 'react-router'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import { useOpenStackConnection } from '../hooks/useOpenStackConnection'
import { Cloud, Server, HardDrive, Plus, GitBranch, LayoutGrid, Settings, Shield, Network, Key, Disc, Cpu, Layers, Globe, Camera, Scale, KeyRound, Map } from 'lucide-react'
import OpenStackCloudPicker from './OpenStackCloudPicker'

const TABS = [
  { to: '/openstack', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/openstack/instances', label: 'Instances', icon: Server },
  { to: '/openstack/images', label: 'Glance', icon: HardDrive },
  { to: '/openstack/volumes', label: 'Volumes', icon: Disc },
  { to: '/openstack/volume-snapshots', label: 'Snapshots', icon: Camera },
  { to: '/openstack/flavors', label: 'Flavors', icon: Cpu },
  { to: '/openstack/server-groups', label: 'Groups', icon: Layers },
  { to: '/openstack/networking', label: 'Network', icon: Network },
  { to: '/openstack/topology', label: 'Topology', icon: Map },
  { to: '/openstack/floating-ips', label: 'FIPs', icon: Globe },
  { to: '/openstack/heat', label: 'Heat', icon: Layers },
  { to: '/openstack/load-balancers', label: 'LBs', icon: Scale },
  { to: '/openstack/identity', label: 'Identity', icon: KeyRound },
  { to: '/openstack/keypairs', label: 'Keys', icon: Key },
  { to: '/openstack/security-groups', label: 'Security', icon: Shield },
  { to: '/openstack/create', label: 'Create', icon: Plus },
  { to: '/openstack/migrations', label: 'Migrations', icon: GitBranch, requiresHypersdk: true },
] as const

export default function OpenStackSubNav() {
  const { pathname } = useLocation()
  const { info } = usePlatformInfo()
  const { phase, cloudName } = useOpenStackConnection()
  const hypersdkEnabled = Boolean(info?.hypersdk?.enabled)
  const tabs = TABS.filter((t) => !('requiresHypersdk' in t && t.requiresHypersdk) || hypersdkEnabled)
  const needsWire = phase === 'off' || phase === 'needsWire'

  let statusLabel = 'Not wired — run openstack-wire-cloud.sh'
  if (phase === 'live') statusLabel = cloudName || 'cloud · live'
  else if (phase === 'unreachable') statusLabel = `${cloudName || 'cloud'} · unreachable`

  return (
    <nav
      className="mb-6 flex flex-wrap gap-1 p-1 rounded-xl border border-sky-500/25 bg-sky-950/20 backdrop-blur-sm"
      aria-label="OpenStack"
    >
      {needsWire && (
        <Link
          to="/settings?openstack=1"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition text-amber-300/95 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20"
        >
          <Settings className="w-4 h-4 shrink-0" />
          Wire cloud
        </Link>
      )}
      {tabs.map(({ to, label, icon: Icon, ...rest }) => {
        const end = 'end' in rest && rest.end
        const active = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`)
        return (
          <Link
            key={to}
            to={to}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
              active
                ? 'bg-sky-600 text-white shadow-md shadow-sky-600/25'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </Link>
        )
      })}
      <span
        className={`hidden sm:inline-flex items-center gap-1.5 ml-auto px-3 py-2 text-xs ${
          phase === 'live'
            ? 'text-sky-300/80'
            : phase === 'unreachable'
              ? 'text-red-300/80'
              : 'text-amber-300/80'
        }`}
      >
        <Cloud className="w-3.5 h-3.5" />
        {statusLabel}
        <OpenStackCloudPicker />
      </span>
    </nav>
  )
}
