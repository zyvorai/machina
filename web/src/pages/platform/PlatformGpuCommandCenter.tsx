// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Cpu, Monitor, RefreshCw, Server } from 'lucide-react'
import PageLayout from '../../components/PageLayout'
import PageSkeleton from '../../components/PageSkeleton'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import PlatformTahoeHero from '../../components/platform/tahoe/PlatformTahoeHero'
import { MacGlassPanel, MacStatWidget } from '../../components/platform/mac/PlatformMacUi'
import { getFleetGpu, type FleetGpuOverview, type GpuProfileKind } from '../../api/platform'
import { getGpuPlacement } from '../../api/ai'
import { formatUserError } from '../../utils/apiError'
import { hubLinkClasses, statusBadgeClasses, statusToneClass } from '../../utils/semanticColors'

function profileBadge(kind: GpuProfileKind) {
  switch (kind) {
    case 'mig':
      return statusBadgeClasses('info')
    case 'vgpu':
      return statusBadgeClasses('warn')
    case 'cuda':
      return statusBadgeClasses('ok')
    case 'passthrough':
      return statusBadgeClasses('neutral')
    default:
      return statusBadgeClasses('neutral')
  }
}

function profileLabel(kind: GpuProfileKind) {
  switch (kind) {
    case 'mig':
      return 'MIG'
    case 'vgpu':
      return 'vGPU'
    case 'cuda':
      return 'CUDA'
    case 'passthrough':
      return 'Passthrough'
    default:
      return 'GPU'
  }
}

export default function PlatformGpuCommandCenter() {
  const [overview, setOverview] = useState<FleetGpuOverview | null>(null)
  const [workload, setWorkload] = useState('inference')
  const [placement, setPlacement] = useState<{ summary: string; candidates: Array<{ hostname: string; gpu_capable: boolean; score: number; reason: string }> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [placementBusy, setPlacementBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      setOverview(await getFleetGpu())
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadPlacement = useCallback(async () => {
    setPlacementBusy(true)
    try {
      setPlacement(await getGpuPlacement(workload))
    } catch {
      setPlacement(null)
    } finally {
      setPlacementBusy(false)
    }
  }, [workload])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadPlacement() }, [loadPlacement])

  return (
    <PageLayout hideHeader error={error} onErrorRetry={() => void load()}>
      <PlatformTahoeHero
        title="GPU Command Center"
        subtitle="MIG, vGPU, and CUDA placement — inventory from host tags plus AI placement advisor."
        icon={Cpu}
        stats={overview ? [
          { label: 'GPU hosts', value: String(overview.gpu_host_count), tone: 'violet' },
          { label: 'GPU VMs', value: String(overview.gpu_vm_count), tone: 'emerald' },
          { label: 'CUDA ready', value: String(overview.cuda_ready_hosts), tone: 'sky' },
        ] : []}
      />

      <div className="tahoe-content space-y-4">
        {loading && <PageSkeleton />}

        {!loading && overview && overview.gpu_host_count === 0 && (
          <PlatformEmptyState
            icon={Cpu}
            title="No GPU inventory yet"
            subtitle="Tag hosts with gpu, nvidia, mig, vgpu, or cuda on host detail — discovery agent feeds Phase 54 v2."
          >
            <Link to="/platform/hosts" className={`tahoe-btn-ghost text-sm ${hubLinkClasses()}`}>Browse hosts</Link>
            <Link to="/platform/zeus" className="tahoe-btn-primary text-sm">Open Zeus OS</Link>
          </PlatformEmptyState>
        )}

        {!loading && overview && overview.gpu_host_count > 0 && (
          <>
            <p className="text-sm text-white/45">{overview.summary}</p>

            {overview.profiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {overview.profiles.map((p) => (
                  <span key={p.kind} className={`px-3 py-1 rounded-full text-xs border ${profileBadge(p.kind)}`}>
                    {p.label} · {p.host_count} host{p.host_count === 1 ? '' : 's'} · {p.vm_count} VM{p.vm_count === 1 ? '' : 's'}
                  </span>
                ))}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <MacStatWidget label="MIG hosts" value={String(overview.mig_hosts)} icon={<Cpu className="w-4 h-4" />} />
              <MacStatWidget label="vGPU hosts" value={String(overview.vgpu_hosts)} icon={<Cpu className="w-4 h-4" />} tone="warn" />
              <MacStatWidget label="CUDA ready" value={String(overview.cuda_ready_hosts)} icon={<Cpu className="w-4 h-4" />} tone="ok" />
            </div>

            <MacGlassPanel title="GPU hosts" subtitle="Site, rack, profile, and VM occupancy">
              <div className="overflow-x-auto -mt-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-white/[0.06]">
                      <th className="py-2 pr-2">Host</th>
                      <th className="py-2 pr-2">Profile</th>
                      <th className="py-2 pr-2">Model</th>
                      <th className="py-2 pr-2">Site / rack</th>
                      <th className="py-2 pr-2">GPU VMs</th>
                      <th className="py-2 pr-2">vGPU slices</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.hosts.map((h) => (
                      <tr key={h.host_id} className="border-b border-white/[0.04] text-slate-200">
                        <td className="py-2 pr-2">
                          <Link to={`/platform/hosts/${h.host_id}`} className={`hover:underline ${hubLinkClasses()}`}>{h.hostname}</Link>
                        </td>
                        <td className="py-2 pr-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${profileBadge(h.profile)}`}>{profileLabel(h.profile)}</span>
                        </td>
                        <td className="py-2 pr-2 text-slate-400">{h.model_hint}</td>
                        <td className="py-2 pr-2 text-slate-400 text-xs">{h.site || '—'} / {h.rack || '—'}</td>
                        <td className="py-2 pr-2">{h.gpu_vm_count}</td>
                        <td className="py-2 pr-2">{h.vgpu_slices > 0 ? h.vgpu_slices : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </MacGlassPanel>

            {overview.vms.length > 0 && (
              <MacGlassPanel title="GPU workloads" subtitle="Tagged VMs across the fleet">
                <ul className="text-sm space-y-2 -mt-2">
                  {overview.vms.map((v) => (
                    <li key={v.vm_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.04] pb-2">
                      <Link to={`/platform/vms/${v.vm_id}`} className={`inline-flex items-center gap-1.5 hover:underline ${hubLinkClasses()}`}>
                        <Monitor className="w-3.5 h-3.5" />
                        {v.vm_name}
                      </Link>
                      <span className="text-xs text-slate-500">
                        {v.hostname ?? 'unplaced'} · <span className={statusToneClass(v.observed_state === 'running' ? 'ok' : 'neutral')}>{v.observed_state}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </MacGlassPanel>
            )}

            <MacGlassPanel title="CUDA placement advisor" subtitle="Rank hosts for inference / training workloads">
              <div className="flex flex-wrap gap-2 items-end -mt-2 mb-3">
                <label className="text-xs text-slate-400 flex flex-col gap-1">
                  Workload
                  <input
                    value={workload}
                    onChange={(e) => setWorkload(e.target.value)}
                    className="input text-sm min-w-[200px]"
                    placeholder="inference, training, llama…"
                  />
                </label>
                <button type="button" className="btn-secondary text-sm" disabled={placementBusy} onClick={() => void loadPlacement()}>
                  {placementBusy ? 'Ranking…' : 'Refresh ranking'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => void load()} aria-label="Refresh inventory">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              {placement && (
                <>
                  <p className="text-sm text-slate-300 mb-3">{placement.summary}</p>
                  <ul className="text-sm space-y-2">
                    {placement.candidates.map((c) => (
                      <li key={c.hostname} className="flex flex-wrap justify-between gap-2 border-b border-white/[0.04] pb-2">
                        <span className="inline-flex items-center gap-1.5 text-slate-200">
                          <Server className="w-3.5 h-3.5 shrink-0" />
                          {c.hostname}
                          {c.gpu_capable && <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusBadgeClasses('ok')}`}>GPU</span>}
                        </span>
                        <span className="text-xs text-slate-500">{c.reason} · score {c.score.toFixed(0)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </MacGlassPanel>
          </>
        )}
      </div>
    </PageLayout>
  )
}
