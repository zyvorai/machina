// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { AlertTriangle, Search } from 'lucide-react'
import { Link } from 'react-router'
import { formatFleetDisplayTitle } from '../../../utils/fleetDisplayName'
import { dispatchOpenSpotlight } from '../../../utils/platformJarvisShell'
import type { MissionControlFleetState } from './useMissionControlFleet'

type Props = {
  state: MissionControlFleetState
  warnings: number
  onCreateVm: () => void
}

export default function MissionControlHero({ state, warnings, onCreateVm }: Props) {
  const { cluster, hosts, running, onlineHosts, storagePct, needsAttention, attentionMode, setAttentionMode } = state
  const fleetTitle = formatFleetDisplayTitle(cluster, hosts)
  const healthy = !state.loading && hosts.length > 0 && warnings === 0 && onlineHosts === hosts.length

  const controlPlaneDown = Boolean(state.error)
  const status: 'connecting' | 'offline' | 'degraded' | 'operational' = state.loading
    ? 'connecting'
    : controlPlaneDown
      ? 'offline'
      : healthy
        ? 'operational'
        : 'degraded'
  const word = {
    connecting: 'Connecting…',
    offline: 'Control plane offline',
    degraded: 'Degraded',
    operational: 'Operational',
  }[status]

  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const metrics = [
    { label: 'VMs running', value: state.loading || controlPlaneDown ? '—' : String(running) },
    {
      label: 'Hosts online',
      value: state.loading || controlPlaneDown ? '—' : `${onlineHosts}/${hosts.length}`,
    },
    { label: 'Memory used', value: controlPlaneDown ? '—' : storagePct != null ? `${Math.round(storagePct)}%` : '—' },
    { label: 'Alerts', value: controlPlaneDown ? '—' : warnings ? String(warnings) : 'None' },
  ]

  return (
    <>
      <header className="apple-section apple-hero-band mc-hero mc-hero-ribbon" data-testid="mission-control-hero">
        <p className="apple-eyebrow">Machina · {fleetTitle}</p>
        <p className="text-[17px] text-[var(--text-secondary)] tracking-tight mb-2 text-center">{hello}</p>
        <h1 className="apple-display">{word}</h1>
        <p className="apple-lede">
          {controlPlaneDown
            ? 'Machina controller is unreachable — inventory and fleet metrics are unavailable until it recovers.'
            : 'Your private cloud control plane. Guests live in Machine Finder — this home stays calm.'}
        </p>
        <div className="apple-cta-row">
          <button type="button" onClick={onCreateVm} className="btn-primary">
            New VM
          </button>
          <Link to="/platform/vms" className="apple-text-link">
            Machine Finder <span aria-hidden>›</span>
          </Link>
          <button type="button" className="apple-text-link" onClick={() => dispatchOpenSpotlight()}>
            <Search className="w-4 h-4" />
            Search
            <span className="font-mono text-[12px] text-[var(--text-muted)] ml-1">⌘K</span>
          </button>
          {needsAttention > 0 && (
            <button
              type="button"
              className={`apple-text-link ${attentionMode ? 'text-[var(--machina-status-warn)]' : ''}`}
              onClick={() => setAttentionMode(!attentionMode)}
              data-testid="attention-mode-toggle"
            >
              <AlertTriangle className="w-4 h-4" />
              {needsAttention} need attention
            </button>
          )}
        </div>
      </header>

      <section className="apple-section apple-section--tight" aria-label="Fleet metrics">
        <div className="apple-metric-band">
          {metrics.map((g) => (
            <div key={g.label} className="min-w-0">
              <div className="apple-metric-value">{g.value}</div>
              <div className="apple-metric-label">{g.label}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
