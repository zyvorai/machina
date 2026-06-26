// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { Link } from 'react-router'
import { Server, LayoutTemplate, Camera, Boxes, Rocket, LayoutGrid } from 'lucide-react'
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

export default function PlatformWorkloadsHub() {
  return (
    <PlatformPageChrome
      title="Workloads"
      subtitle="Virtual machines, templates, and containerized workloads"
      icon={<LayoutGrid className="w-6 h-6 text-slate-400" />}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NavCard to="/platform/vms" icon={<Server className="w-5 h-5" />} title="Virtual Machines" subtitle="All fleet VMs — search, filter, manage" />
        <NavCard to="/platform/templates" icon={<LayoutTemplate className="w-5 h-5" />} title="Templates" subtitle="Golden images and cloud-init templates" />
        <NavCard to="/platform/fleet-snapshots" icon={<Camera className="w-5 h-5" />} title="Snapshots" subtitle="Fleet-wide snapshot management" />
        <NavCard to="/platform/applications" icon={<Boxes className="w-5 h-5" />} title="Applications" subtitle="Deployed application stacks" />
        <NavCard to="/platform/blueprints" icon={<Rocket className="w-5 h-5" />} title="Blueprints" subtitle="Automation shortcuts and launchpad" />
      </div>
    </PlatformPageChrome>
  )
}
