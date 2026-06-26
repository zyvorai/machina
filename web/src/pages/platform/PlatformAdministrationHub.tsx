// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { Link } from 'react-router'
import { Settings, Users, Key, FolderOpen, Bell, ServerCrash, LayoutGrid } from 'lucide-react'
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

export default function PlatformAdministrationHub() {
  return (
    <PlatformPageChrome
      title="Administration"
      subtitle="Users, access control, and platform configuration"
      icon={<LayoutGrid className="w-6 h-6 text-slate-400" />}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NavCard to="/platform/settings" icon={<Settings className="w-5 h-5" />} title="Settings" subtitle="Platform and integrations configuration" />
        <NavCard to="/platform/users" icon={<Users className="w-5 h-5" />} title="Users" subtitle="Accounts, roles, and permissions" />
        <NavCard to="/platform/api-keys" icon={<Key className="w-5 h-5" />} title="API Keys" subtitle="Programmatic access tokens" />
        <NavCard to="/platform/projects" icon={<FolderOpen className="w-5 h-5" />} title="Projects" subtitle="Resource grouping and quotas" />
        <NavCard to="/platform/notifications" icon={<Bell className="w-5 h-5" />} title="Notifications" subtitle="Alert channels and escalation rules" />
        <NavCard to="/platform/enroll" icon={<ServerCrash className="w-5 h-5" />} title="Enroll Host" subtitle="Add a new hypervisor host to the fleet" />
      </div>
    </PlatformPageChrome>
  )
}
