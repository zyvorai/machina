// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { Link } from 'react-router'
import { Monitor, Server, Wrench } from 'lucide-react'
import type { FleetLinuxHostItem, PlatformHost } from '../../../api/platform'
import { statusPillClasses, utilizationBarClass } from '../../../utils/semanticColors'
import { DetailPanel, MetricList, type MetricItem } from '../DetailPanel'

type Props = {
  host: PlatformHost
  linux?: FleetLinuxHostItem
  selected?: boolean
  onSelect?: () => void
}

export default function HostFleetCard({ host, linux, selected, onSelect }: Props) {
  const online = host.state === 'online' && !host.maintenance_mode
  const linuxPressure = linux?.status === 'pressure' || linux?.status === 'thermal'
  const memPct = host.memory_total_mib && host.memory_total_mib > 0
    ? Math.round(((host.memory_used_mib ?? 0) / host.memory_total_mib) * 100)
    : null

  return (
    <article
      className={`mc-host-fleet-card rounded-2xl border p-5 transition-all duration-200 cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_14px_34px_-20px_rgba(0,113,227,0.45)] ${
        selected ? 'border-[var(--accent)]/40 bg-[var(--accent)]/5' : 'border-white/[0.08] bg-[var(--apple-surface)] hover:bg-white/[0.02]'
      }`}
      onClick={onSelect}
      data-testid={`host-fleet-card-${host.id}`}
    >
      <header className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h2 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <span className="grid place-items-center w-8 h-8 rounded-xl text-white shadow-sm" style={{ background: 'linear-gradient(145deg,#0a84ff,#5e5ce6)' }}><Server className="w-4 h-4" /></span>
            {host.hostname}
          </h2>
          <p className="text-xs mt-0.5 font-mono text-[var(--accent)]" data-testid="host-card-ip">{host.address || '—'}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Libvirt host · {linux?.status ?? 'Linux ok'}</p>
        </div>
        <span className={statusPillClasses(online && !linuxPressure ? 'ok' : 'warn')}>
          {!online ? host.state : linuxPressure ? 'Under pressure' : 'Healthy'}
        </span>
      </header>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-4 text-xs">
        <div>
          <p className="text-[var(--text-muted)]">VMs</p>
          <p className="mt-0.5 text-2xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums">{host.vm_count}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Network</p>
          <p className="mt-0.5 text-sm font-semibold text-emerald-600 pt-1.5">OK</p>
        </div>
        <Meter label="CPU" pct={Math.round(host.cpu_percent ?? 0)} />
        <Meter label="Memory" pct={memPct} />
      </div>
      <footer className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
        <Link to={`/platform/hosts/${host.id}`} className="btn-secondary text-xs">Open host</Link>
        <Link to={`/platform/vms?lens=topology&host=${encodeURIComponent(host.id)}`} className="btn-secondary text-xs inline-flex items-center gap-1"><Monitor className="w-3 h-3" /> Machines</Link>
      </footer>
    </article>
  )
}

function Meter({ label, pct }: { label: string; pct: number | null }) {
  const v = pct == null ? 0 : Math.max(0, Math.min(100, pct))
  return (
    <div>
      <p className="flex justify-between text-[var(--text-muted)]"><span>{label}</span><span className="text-[var(--text-primary)] tabular-nums">{pct != null ? `${pct}%` : '—'}</span></p>
      <div className="mt-1.5 h-1.5 rounded-full bg-[var(--apple-fill-tertiary)] overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${utilizationBarClass(v, { warn: 75, error: 90 })}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  )
}

export function HostCommandCenter({
  host,
  linux,
}: {
  host: PlatformHost | null
  linux?: FleetLinuxHostItem
}) {
  if (!host) {
    return (
      <DetailPanel
        empty
        emptyMessage="Select a host for Command Center"
        testId="host-command-center-empty"
      />
    )
  }

  const online = host.state === 'online' && !host.maintenance_mode
  const linuxPressure = linux?.status === 'pressure' || linux?.status === 'thermal'
  const memPct = host.memory_total_mib && host.memory_total_mib > 0
    ? Math.round(((host.memory_used_mib ?? 0) / host.memory_total_mib) * 100)
    : null

  const metrics: MetricItem[] = [
    { label: 'State', value: <span className={online ? 'text-emerald-600' : 'text-amber-600'}>{host.maintenance_mode ? 'maintenance' : host.state}</span> },
    { label: 'VMs', value: String(host.vm_count) },
    { label: 'CPU', value: `${Math.round(host.cpu_percent ?? 0)}%` },
    { label: 'Memory', value: memPct != null ? `${memPct}%` : '—' },
    { label: 'Linux', value: linux?.status ?? '—', span: true },
  ]

  return (
    <DetailPanel
      title="Host Command Center"
      subtitle={host.hostname}
      statusBadge={
        <span className={statusPillClasses(online && !linuxPressure ? 'ok' : 'warn')}>
          {!online ? host.state : linuxPressure ? 'Under pressure' : 'Healthy'}
        </span>
      }
      footer={
        <Link
          to={`/platform/hosts/${host.id}`}
          className="btn-primary text-sm w-full text-center inline-flex items-center justify-center gap-1.5"
        >
          <Wrench className="w-3.5 h-3.5" /> Open host detail
        </Link>
      }
      testId="host-command-center"
    >
      <MetricList items={metrics} />
      <div className="flex flex-wrap gap-2">
        <Link
          to={`/platform/vms?lens=topology&host=${encodeURIComponent(host.id)}`}
          className="btn-secondary text-xs flex-1 text-center inline-flex items-center justify-center gap-1"
        >
          <Monitor className="w-3 h-3" /> Machine Finder
        </Link>
        <Link to="/platform/enroll" className="btn-secondary text-xs flex-1 text-center">Add VM</Link>
      </div>
    </DetailPanel>
  )
}
