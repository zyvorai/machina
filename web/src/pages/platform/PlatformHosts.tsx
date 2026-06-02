// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { RefreshCw, Server, Wrench } from 'lucide-react'
import PageLayout from '../../components/PageLayout'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import PlatformTahoeHero from '../../components/platform/tahoe/PlatformTahoeHero'
import FinderView, { type FinderViewMode } from '../../components/platform/mac/FinderView'
import { gradientForName } from '../../components/platform/mac/PlatformMacUi'
import {
  enqueueValidateHost,
  hostMaintenance,
  listPlatformHosts,
  syncAllHosts,
  syncHost,
  type PlatformHost,
} from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import {hostStateTone, statusToneClass, hubLinkClasses} from '../../utils/semanticColors'

function hostTone(h: PlatformHost): 'ok' | 'warn' | 'default' {
  const tone = hostStateTone(h.state, h.fenced, h.maintenance_mode)
  if (tone === 'ok') return 'ok'
  if (tone === 'warn' || tone === 'error') return 'warn'
  return 'default'
}

const VIEW_KEY = 'platform-hosts-finder-view'

export default function PlatformHosts() {
  const toast = useToastContext()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const filterOffline = searchParams.get('filter') === 'offline'
  const [hosts, setHosts] = useState<PlatformHost[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<FinderViewMode>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY)
      if (v === 'icons' || v === 'list' || v === 'columns') return v
    } catch { /* ignore */ }
    return 'icons'
  })

  const load = useCallback(async () => {
    setError(null)
    try {
      setHosts(await listPlatformHosts())
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, viewMode) } catch { /* ignore */ }
  }, [viewMode])

  const act = async (id: string, fn: () => Promise<unknown>, label: string) => {
    setBusy(id + label)
    try {
      await fn()
      toast.success(label)
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setBusy(null)
    }
  }

  const online = hosts.filter((h) => h.state === 'online').length
  const visibleHosts = useMemo(() => {
    let rows = filterOffline ? hosts.filter((h) => h.state === 'offline') : hosts
    const q = search.trim().toLowerCase()
    if (q) rows = rows.filter((h) => h.hostname.toLowerCase().includes(q) || h.address?.toLowerCase().includes(q))
    return rows
  }, [hosts, filterOffline, search])

  const selected = visibleHosts.find((h) => h.id === selectedId) ?? null

  const toolbar = (
    <>
      <button type="button" className="btn-secondary text-sm" onClick={async () => {
        try { await syncAllHosts(); toast.success('Sync all queued') } catch (e: unknown) { toast.error(formatUserError(e)) }
      }}>Sync all</button>
      <button type="button" onClick={() => void load()} className="btn-secondary"><RefreshCw className="w-4 h-4" /></button>
    </>
  )

  const listContent = viewMode === 'list' ? (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-slate-400 border-b border-white/[0.06]">
            <th className="p-3 text-left">Host</th>
            <th className="p-3">State</th>
            <th className="p-3">VMs</th>
            <th className="p-3">CPU</th>
          </tr>
        </thead>
        <tbody>
          {visibleHosts.map((h) => (
            <tr
              key={h.id}
              className={`border-b border-slate-900/80 cursor-pointer ${selectedId === h.id ? 'bg-sky-500/10' : 'hover:bg-white/[0.02]'}`}
              onClick={() => setSelectedId(h.id)}
            >
              <td className="p-3"><Link to={`/platform/hosts/${h.id}`} className={`hover:underline ${hubLinkClasses()}`} onClick={(e) => e.stopPropagation()}>{h.hostname}</Link></td>
              <td className="p-3 capitalize text-center">{h.state}</td>
              <td className="p-3 text-center">{h.vm_count}</td>
              <td className="p-3 text-center">{h.cpu_percent != null ? `${h.cpu_percent.toFixed(0)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {visibleHosts.map((h) => (
        <button
          key={h.id}
          type="button"
          onClick={() => setSelectedId(h.id)}
          className={`platform-mac-stat rounded-2xl border p-5 space-y-3 text-left transition ${
            selectedId === h.id ? 'border-sky-400/40 ring-1 ring-sky-400/20' : 'border-white/[0.06]'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradientForName(h.hostname)} flex items-center justify-center text-white`}>
              <Server className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="font-semibold text-white truncate block">{h.hostname}</span>
              <p className={`text-xs capitalize mt-0.5 ${
                hostTone(h) === 'default' ? 'text-slate-500' : statusToneClass(hostTone(h) === 'ok' ? 'ok' : 'warn')
              }`}>
                {h.maintenance_mode ? 'maintenance' : h.state}
              </p>
            </div>
          </div>
          <p className="text-xs text-white/50">{h.vm_count} VM(s) · {h.cpu_percent != null ? `${h.cpu_percent.toFixed(0)}% CPU` : 'CPU —'}</p>
        </button>
      ))}
    </div>
  )

  const inspector = selected ? (
    <div className="p-4 space-y-4 h-full overflow-y-auto">
      <div>
        <h3 className="font-semibold text-white">{selected.hostname}</h3>
        <p className="text-xs text-white/50 mt-1">{selected.address || '—'}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-white/40">State</dt><dd className="text-white capitalize">{selected.state}</dd></div>
        <div><dt className="text-white/40">VMs</dt><dd className="text-white">{selected.vm_count}</dd></div>
        <div><dt className="text-white/40">Validation</dt><dd className="capitalize">{selected.validation_status || 'pending'}</dd></div>
        <div><dt className="text-white/40">CPU</dt><dd>{selected.cpu_percent != null ? `${selected.cpu_percent.toFixed(0)}%` : '—'}</dd></div>
      </dl>
      <div className="flex flex-col gap-2">
        <Link to={`/platform/hosts/${selected.id}`} className="btn-primary text-sm text-center">Open host</Link>
        <button type="button" className="btn-secondary text-xs" disabled={busy !== null} onClick={() => void act(selected.id, () => enqueueValidateHost(selected.id), 'Validation queued')}>Validate</button>
        <button type="button" className="btn-secondary text-xs" disabled={busy !== null} onClick={() => void act(selected.id, () => syncHost(selected.id), 'Sync queued')}>Sync</button>
        <button type="button" className="btn-secondary text-xs" disabled={busy !== null} onClick={() => void act(selected.id, () => hostMaintenance(selected.id, 'enter'), 'Maintenance entered')}>
          <Wrench className="w-3 h-3 inline" /> Maintenance
        </button>
      </div>
    </div>
  ) : null

  const columnsContent = (
    <div className="flex min-h-[360px] border border-white/[0.06] rounded-xl overflow-hidden">
      <div className="w-56 shrink-0 border-r border-white/[0.06] overflow-y-auto">
        {visibleHosts.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => setSelectedId(h.id)}
            className={`w-full text-left px-3 py-2 text-sm border-b border-white/[0.04] ${selectedId === h.id ? 'bg-sky-500/15 text-sky-100' : 'text-white/80 hover:bg-white/[0.03]'}`}
          >
            {h.hostname}
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto">
        {selected ? inspector : <p className="p-4 text-sm text-white/40">Select a host</p>}
      </div>
    </div>
  )

  return (
    <PageLayout hideHeader error={error}>
      <PlatformTahoeHero
        title={filterOffline ? 'Offline hosts' : 'Hosts'}
        subtitle="Hypervisors enrolled in this fleet — sync, validate, and open host detail."
        icon={Server}
        stats={[
          { label: 'Total', value: String(hosts.length), tone: 'sky' },
          { label: 'Online', value: String(online), tone: online === hosts.length ? 'emerald' : 'amber' },
          { label: 'VMs', value: String(hosts.reduce((s, h) => s + h.vm_count, 0)), tone: 'violet' },
        ]}
      />

      <div className="tahoe-content space-y-4">
      <FinderView
        title="Hosts"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Filter hosts…"
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        toolbarActions={toolbar}
        pathSegments={[
          { label: 'Platform', onClick: () => navigate('/platform') },
          { label: filterOffline ? 'Offline hosts' : 'Hosts' },
        ]}
        listContent={listContent}
        columnsContent={columnsContent}
        inspector={inspector}
        isEmpty={visibleHosts.length === 0 && !error}
        emptyState={
          <PlatformEmptyState
            icon={Server}
            title={filterOffline ? 'No offline hosts' : 'No hosts enrolled'}
            subtitle={filterOffline ? 'All hypervisors are reporting heartbeats.' : 'Add a hypervisor to start managing VMs.'}
          >
            {!filterOffline ? <Link to="/platform/enroll" className="tahoe-btn-primary text-sm">Add Host</Link> : null}
          </PlatformEmptyState>
        }
      />
      </div>
    </PageLayout>
  )
}
