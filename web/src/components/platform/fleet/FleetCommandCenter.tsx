// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  Camera,
  ChevronRight,
  Copy,
  Monitor,
  Pause,
  Play,
  Power,
  Sparkles,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react'
import { runVmHealthCheck } from '../../../api/platform'
import VmStatusBadge from '../../VmStatusBadge'
import { formatVmMemoryGiB } from '../../../utils/vmVisual'
import { useToastContext } from '../../../contexts/ToastContext'
import ConsoleTheatrePreview from './ConsoleTheatrePreview'
import VmConsoleQuickLinks from './VmConsoleQuickLinks'
import { cinemaHubPath, studioHubPath } from '../../../utils/consoleExperienceMode'
import { DetailPanel, MetricList, type MetricItem } from '../DetailPanel'
import type { FleetCommandCenterProps } from './fleetCommandCenterTypes'

export default function FleetCommandCenter({
  selectedVm,
  hosts,
  hostMap,
  onSsh,
  onMigrate,
  onPower,
  onSnapshot,
  onDelete,
  onAdopt,
  showTheatrePreview = false,
  className = '',
  testId = 'fleet-command-center',
}: FleetCommandCenterProps) {
  const toast = useToastContext()
  const [healthScore, setHealthScore] = useState<number | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)

  useEffect(() => {
    if (!selectedVm) {
      setHealthScore(null)
      return
    }
    setHealthLoading(true)
    void runVmHealthCheck(selectedVm.id)
      // Number(x) || null would drop a real score of 0 (worst health). Keep 0.
      .then((h) => {
        const n = h.score != null ? Number(h.score) : NaN
        setHealthScore(Number.isFinite(n) ? n : null)
      })
      .catch(() => setHealthScore(null))
      .finally(() => setHealthLoading(false))
  }, [selectedVm?.id])

  if (!selectedVm) {
    return (
      <DetailPanel
        empty
        emptyMessage="Select a machine to open Command Center"
        className={className}
        testId={testId}
      />
    )
  }

  const vmState = selectedVm.observed_state
  const running = vmState === 'running'
  const paused = vmState === 'paused'
  const shutoff = vmState === 'shutoff' || vmState === 'shut off'

  const metrics: MetricItem[] = [
    { label: 'Health', value: healthLoading ? '…' : (healthScore != null ? `${healthScore}/100` : '—') },
    { label: 'vCPU', value: `${selectedVm.vcpus} cores` },
    { label: 'Memory', value: formatVmMemoryGiB(selectedVm.memory_mib) },
    { label: 'Source', value: <span className="capitalize">{selectedVm.inventory_source ?? 'libvirt'}</span>, span: true },
    ...(selectedVm.guest_ip ? [{ label: 'Guest IP', value: <span className="font-mono text-emerald-600/90">{selectedVm.guest_ip}</span>, span: true }] : []),
  ]

  const primaryPowerAction = running ? (
    <button
      type="button"
      className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center justify-center gap-1.5 border-amber-500/30 text-amber-700 hover:bg-amber-500/10"
      onClick={() => void onPower(selectedVm, 'shutdown')}
    >
      <Power className="w-3.5 h-3.5" /> Shutdown
    </button>
  ) : paused ? (
    <button
      type="button"
      className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center justify-center gap-1.5 border-[var(--apple-hairline)] text-emerald-700 hover:bg-emerald-500/10"
      onClick={() => void onPower(selectedVm, 'resume')}
    >
      <Play className="w-3.5 h-3.5" /> Resume
    </button>
  ) : (
    <button
      type="button"
      className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center justify-center gap-1.5 border-[var(--apple-hairline)] text-emerald-700 hover:bg-emerald-500/10"
      onClick={() => void onPower(selectedVm, 'start')}
    >
      <Play className="w-3.5 h-3.5" /> Start
    </button>
  )

  return (
    <DetailPanel
      title="Command Center"
      subtitle={selectedVm.name}
      statusBadge={<VmStatusBadge state={vmState} />}
      footer={
        <Link
          to={cinemaHubPath(selectedVm.id)}
          className="btn-primary text-sm w-full text-center inline-flex items-center justify-center gap-1.5"
        >
          <Monitor className="w-3.5 h-3.5" /> Open Cinema
        </Link>
      }
      className={className}
      testId={testId}
    >
      <MetricList items={metrics} />

      <div className="space-y-2">
        <p className="text-xs font-medium text-[var(--text-muted)]">Power</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {primaryPowerAction}
          {(running || paused) && (
            <IconBtn icon={Square} label="Stop" onClick={() => void onPower(selectedVm, 'stop')} />
          )}
          {running && (
            <IconBtn icon={Pause} label="Pause" onClick={() => void onPower(selectedVm, 'pause')} />
          )}
          {!running && !paused && !shutoff && (
            <IconBtn icon={Power} label="Shutdown" onClick={() => void onPower(selectedVm, 'shutdown')} />
          )}
          <IconBtn icon={Camera} label="Snapshot" onClick={() => void onSnapshot(selectedVm)} />
          {selectedVm.inventory_source !== 'kubevirt' && (
            <IconBtn icon={Terminal} label="SSH" onClick={() => onSsh(selectedVm)} />
          )}
          <IconBtn
            icon={Trash2}
            label="Delete VM"
            tone="danger"
            className="ml-auto"
            onClick={() => void onDelete(selectedVm)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-[var(--text-muted)]">Console</p>
        <VmConsoleQuickLinks vmId={selectedVm.id} running={running} />
        <div className="flex items-center gap-4">
          <Link to={studioHubPath(selectedVm.id)} className="btn-link text-xs">
            Studio <ChevronRight className="w-3 h-3" />
          </Link>
          <Link to={`/platform/vms/${selectedVm.id}`} className="btn-link text-xs">
            Open VM detail <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {(selectedVm.guest_ip || (selectedVm.host_id && hosts.length > 1) || selectedVm.managed === false) && (
        <div className="flex flex-wrap items-center gap-2">
          {selectedVm.guest_ip && (
            <button
              type="button"
              className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1"
              onClick={() => {
                void navigator.clipboard.writeText(selectedVm.guest_ip!)
                toast.success('Guest IP copied')
              }}
            >
              <Copy className="w-3.5 h-3.5" /> Copy IP
            </button>
          )}

          {selectedVm.managed === false && (
            <button
              type="button"
              className="btn-secondary text-xs py-1.5 px-3"
              onClick={() => void onAdopt(selectedVm)}
            >
              Adopt discovered VM
            </button>
          )}
        </div>
      )}

      {selectedVm.host_id && hosts.length > 1 && (
        <MigratePicker
          vm={selectedVm}
          hosts={hosts}
          hostMap={hostMap}
          onPick={(destId, destName) => onMigrate(selectedVm, destId, destName)}
        />
      )}

      {showTheatrePreview && running && (
        <ConsoleTheatrePreview vmId={selectedVm.id} vmName={selectedVm.name} />
      )}

      <div className="flex gap-2.5 rounded-lg bg-[var(--apple-surface)] p-3 text-xs">
        <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#0071e3]" />
        <p className="text-[var(--text-secondary)]">
          <span className="font-medium text-[var(--text-primary)]">Zyra — </span>
          {healthScore != null && healthScore < 70
            ? 'Health score is low. Review backups and guest agent connectivity.'
            : selectedVm.guest_ip
              ? 'Machine is reachable. Console and SSH are ready.'
              : 'No guest IP yet. Check network and guest tools.'}
        </p>
      </div>
    </DetailPanel>
  )
}

function IconBtn({
  icon: Icon,
  label,
  onClick,
  tone = 'default',
  className = '',
}: {
  icon: typeof Play
  label: string
  onClick: () => void
  tone?: 'default' | 'danger'
  className?: string
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`btn-secondary !min-h-0 w-7 h-7 !p-0 inline-flex items-center justify-center rounded-full ${
        tone === 'danger' ? 'text-red-600 hover:bg-red-500/10' : ''
      } ${className}`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  )
}

function MigratePicker({
  vm,
  hosts,
  hostMap,
  onPick,
}: {
  vm: FleetCommandCenterProps['selectedVm']
  hosts: FleetCommandCenterProps['hosts']
  hostMap: Map<string, string>
  onPick: (destId: string, destName: string) => void
}) {
  if (!vm) return null
  const candidates = hosts.filter((h) => h.id !== vm.host_id)
  if (candidates.length === 0) return null
  return (
    <div>
      <p className="text-xs font-medium text-[var(--text-muted)] mb-1">Migrate to</p>
      <select
        aria-label="Migrate VM to host"
        className="w-full text-xs rounded-lg bg-[var(--apple-surface)] border border-white/10 px-2 py-1.5"
        defaultValue=""
        onChange={(e) => {
          const id = e.target.value
          if (!id) return
          const host = hosts.find((h) => h.id === id)
          if (host) onPick(id, host.hostname)
          e.target.value = ''
        }}
      >
        <option value="">Select host…</option>
        {candidates.map((h) => (
          <option key={h.id} value={h.id}>
            {h.hostname} ({hostMap.get(h.id) ?? h.id.slice(0, 8)})
          </option>
        ))}
      </select>
    </div>
  )
}
