// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Plus, RefreshCw, Server, Wrench } from 'lucide-react'
import PageLayout from '../../components/PageLayout'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import HostEnrollWizard from '../../components/platform/HostEnrollWizard'
import FinderView, { type FinderViewMode } from '../../components/platform/mac/FinderView'
import { gradientForName } from '../../components/platform/mac/PlatformMacUi'
import {
  enqueueValidateHost,
  hostMaintenance,
  getFleetLinuxHealth,
  listPlatformHosts,
  syncAllHosts,
  syncHost,
  type FleetLinuxHostItem,
  type PlatformHost,
} from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { hostStateTone, statusPillClasses, statusToneClass, hubLinkClasses } from '../../utils/semanticColors'
import HostFleetCard, { HostCommandCenter } from '../../components/platform/fleet/HostFleetCard'

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
  const [linuxByHost, setLinuxByHost] = useState<Record<string, FleetLinuxHostItem>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [enrollWizardOpen, setEnrollWizardOpen] = useState(false)
  const [viewMode, setViewMode] = useState<FinderViewMode>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY)
      if (v === 'icons' || v === 'list' || v === 'columns') return v
    } catch { /* ignore */ }
    return 'icons'
  })

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [rows, linux] = await Promise.all([
        listPlatformHosts(),
        getFleetLinuxHealth().catch(() => null),
      ])
      setHosts(Array.isArray(rows) ? rows : [])
      const map: Record<string, FleetLinuxHostItem> = {}
      for (const h of linux?.hosts ?? []) map[h.host_id] = h
      setLinuxByHost(map)
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
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
      <table className="w-full text-sm" aria-label="Managed hosts">
        <thead>
          <tr className="text-slate-400 border-b border-white/[0.06]">
            <th className="p-3 text-left">Host</th>
            <th className="p-3">State</th>
            <th className="p-3">VMs</th>
            <th className="p-3">CPU</th>
            <th className="p-3">Linux</th>
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
              <td className="p-3 text-center">
                {linuxByHost[h.id] ? (
                  linuxByHost[h.id].status === 'ok' ? (
                    <span className={`text-[10px] uppercase px-2 py-0.5 rounded border ${statusPillClasses('ok')}`}>
                      {linuxByHost[h.id].status}
                    </span>
                  ) : (
                    <Link
                      to={`/platform/hosts/${h.id}?tab=linux`}
                      className={`text-[10px] uppercase px-2 py-0.5 rounded border hover:underline ${statusPillClasses('warn')}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {linuxByHost[h.id].status}
                    </Link>
                  )
                ) : '—'}
              </td>
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
          <p className="text-xs text-white/50">
            {h.vm_count} VM(s) · {h.cpu_percent != null ? `${h.cpu_percent.toFixed(0)}% CPU` : 'CPU —'}
            {linuxByHost[h.id] && linuxByHost[h.id].status !== 'ok' ? (
              <>
                {' · '}
                <Link to={`/platform/hosts/${h.id}?tab=linux`} className={hubLinkClasses('hover:underline')} onClick={(e) => e.stopPropagation()}>
                  Linux {linuxByHost[h.id].status}
                </Link>
              </>
            ) : linuxByHost[h.id] ? ` · Linux ${linuxByHost[h.id].status}` : ''}
          </p>
        </button>
      ))}
    </div>
  )

  const inspector = selected ? (
    <div className="platform-finder-inspector p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-white">{selected.hostname}</h3>
        <p className="platform-finder-inspector-subtitle mt-1">{selected.address || '—'}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div><dt className="platform-finder-inspector-label">State</dt><dd className="text-white capitalize">{selected.state}</dd></div>
        <div><dt className="platform-finder-inspector-label">VMs</dt><dd className="text-white">{selected.vm_count}</dd></div>
        <div><dt className="platform-finder-inspector-label">Validation</dt><dd className="capitalize">{selected.validation_status || 'pending'}</dd></div>
        <div><dt className="platform-finder-inspector-label">CPU</dt><dd>{selected.cpu_percent != null ? `${selected.cpu_percent.toFixed(0)}%` : '—'}</dd></div>
      </dl>
      <div className="flex flex-col gap-2">
        <Link to={`/platform/hosts/${selected.id}`} className="platform-finder-inspector-cta btn-primary text-sm text-center">Open host</Link>
        <Link
          to={`/platform/vms?lens=topology&host=${encodeURIComponent(selected.id)}`}
          className="btn-secondary text-xs text-center"
        >
          Open in Machine Finder
        </Link>
        <button type="button" className="btn-secondary text-xs" disabled={busy !== null} onClick={() => void act(selected.id, () => enqueueValidateHost(selected.id), 'Validation queued')}>Validate</button>
        <button type="button" className="btn-secondary text-xs" disabled={busy !== null} onClick={() => void act(selected.id, () => syncHost(selected.id), 'Sync queued')}>Sync</button>
        <button type="button" className="btn-secondary text-xs" disabled={busy !== null} onClick={() => void act(selected.id, () => hostMaintenance(selected.id, 'enter'), 'Maintenance entered')}>
          <Wrench className="w-3 h-3 inline" /> Maintenance
        </button>
      </div>
    </div>
  ) : null

  const columnsContent = (
    <div className="flex border border-white/[0.06] rounded-xl">
      <div className="w-56 shrink-0 border-r border-white/[0.06]">
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
      <div className="flex-1 min-w-0">
        {selected ? inspector : <p className="platform-finder-inspector platform-finder-inspector-empty p-4">Select a host</p>}
      </div>
    </div>
  )

  const totalVms = hosts.reduce((s, h) => s + h.vm_count, 0)
  const fleetTone = online === hosts.length && hosts.length > 0 ? 'ok' : online === 0 && hosts.length > 0 ? 'error' : 'warn'

  return (
    <PageLayout
      compact
      error={error}
      loading={loading && hosts.length === 0}
      title={filterOffline ? 'Offline hosts' : 'Hosts'}
      subtitle={
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className={statusPillClasses(fleetTone)}>{online} / {hosts.length} online</span>
          <span className="text-slate-400">{totalVms} VM{totalVms === 1 ? '' : 's'} fleet-wide</span>
          {filterOffline && <span className="text-slate-500">Showing offline only</span>}
        </span>
      }
      icon={<Server className="w-6 h-6 text-slate-400" />}
      actions={
        <>
          <button type="button" className="btn-secondary text-sm" onClick={async () => {
            try { await syncAllHosts(); toast.success('Sync all queued') } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>Sync all</button>
          <button type="button" onClick={() => void load()} className="btn-secondary"><RefreshCw className="w-4 h-4" /></button>
          {!filterOffline && (
            <button type="button" className="btn-primary text-sm inline-flex items-center gap-1" onClick={() => setEnrollWizardOpen(true)}>
              <Plus className="w-4 h-4" /> Add host
            </button>
          )}
        </>
      }
      contentClassName="space-y-4"
    >
      {viewMode === 'icons' && visibleHosts.length > 0 && (
        <div className="flex flex-col xl:flex-row gap-4" data-testid="host-fleet-panels">
          <div className="grid gap-3 sm:grid-cols-2 flex-1 min-w-0">
            {visibleHosts.map((h) => (
              <HostFleetCard
                key={h.id}
                host={h}
                linux={linuxByHost[h.id]}
                selected={selectedId === h.id}
                onSelect={() => setSelectedId(h.id)}
              />
            ))}
          </div>
          <HostCommandCenter host={selected} linux={selected ? linuxByHost[selected.id] : undefined} />
        </div>
      )}
      <FinderView
        title="Fleet"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Filter hosts…"
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        toolbarActions={filterOffline ? toolbar : undefined}
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
            {!filterOffline ? (
              <button type="button" className="tahoe-btn-primary text-sm" onClick={() => setEnrollWizardOpen(true)}>
                Enroll host
              </button>
            ) : null}
          </PlatformEmptyState>
        }
      />
      <HostEnrollWizard open={enrollWizardOpen} onClose={() => setEnrollWizardOpen(false)} />
    </PageLayout>
  )
}
