// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { Link } from 'react-router'
import { ListTodo, Radio, Activity, Wrench, BarChart2, LayoutGrid } from 'lucide-react'
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

export default function PlatformOperationsHub() {
  return (
    <PlatformPageChrome
      title="Operations"
      subtitle="Task queues, events, and fleet health monitoring"
      icon={<LayoutGrid className="w-6 h-6 text-slate-400" />}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NavCard to="/platform/tasks" icon={<ListTodo className="w-5 h-5" />} title="Tasks" subtitle="Async task queue and status" />
        <NavCard to="/platform/events" icon={<Radio className="w-5 h-5" />} title="Events" subtitle="Fleet lifecycle event stream" />
        <NavCard to="/platform/activity" icon={<Activity className="w-5 h-5" />} title="Activity Monitor" subtitle="Real-time host and VM activity" />
        <NavCard to="/platform/maintenance" icon={<Wrench className="w-5 h-5" />} title="Maintenance" subtitle="Scheduled maintenance windows" />
        <NavCard to="/platform/reports" icon={<BarChart2 className="w-5 h-5" />} title="Reports" subtitle="Fleet usage and cost reports" />
      </div>
    </PlatformPageChrome>
  )
}
