// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { Link } from 'react-router'
import { Database, Network, Map, Server, Archive, Layers, LayoutGrid } from 'lucide-react'
import PlatformPageChrome from '../../components/platform/PlatformPageChrome'

interface NavCardProps {
  to: string
  icon: React.ReactNode
  title: string
  subtitle: string
}

function NavCard({ to, icon, title, subtitle }: NavCardProps) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-5 transition hover:border-white/[0.16] hover:bg-white/[0.07]"
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] text-slate-300 group-hover:text-white">
        {icon}
      </span>
      <div>
        <div className="text-sm font-semibold text-slate-100 group-hover:text-white">{title}</div>
        <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>
      </div>
    </Link>
  )
}

export default function PlatformInfrastructureHub() {
  return (
    <PlatformPageChrome
      title="Infrastructure"
      subtitle="Storage, networking, and physical host resources"
      icon={<LayoutGrid className="w-6 h-6 text-slate-400" />}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NavCard to="/platform/storage" icon={<Database className="w-5 h-5" />} title="Storage" subtitle="Pools, volumes, and disk tiers" />
        <NavCard to="/platform/networks" icon={<Network className="w-5 h-5" />} title="Networks" subtitle="Virtual and physical networks" />
        <NavCard to="/platform/network-canvas" icon={<Map className="w-5 h-5" />} title="Network Canvas" subtitle="Visual topology editor" />
        <NavCard to="/platform/hosts" icon={<Server className="w-5 h-5" />} title="Hosts" subtitle="Managed hypervisor hosts" />
        <NavCard to="/platform/placement" icon={<Layers className="w-5 h-5" />} title="Placement" subtitle="Resource scheduling and affinity" />
        <NavCard to="/platform/backups" icon={<Archive className="w-5 h-5" />} title="Backups" subtitle="Fleet backup schedules and status" />
      </div>
    </PlatformPageChrome>
  )
}
