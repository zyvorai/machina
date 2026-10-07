// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Plus, RefreshCw, Server, Wrench } from 'lucide-react'
import PageLayout from '../../components/PageLayout'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import HostEnrollWizard from '../../components/platform/HostEnrollWizard'
import FleetCloudImmersive from '../../components/platform/FleetCloudImmersive'
import FinderView, { type FinderViewMode } from '../../components/platform/mac/FinderView'
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
import { statusPillClasses, hubLinkClasses } from '../../utils/semanticColors'
import HostFleetCard, { HostCommandCenter } from '../../components/platform/fleet/HostFleetCard'
import { TahoeTableWrap } from '../../components/platform/tahoe/TahoeListKit'
import { useExpandable } from '../../hooks/useExpandable'
import { ExpandableToggle } from '../../components/ui/ExpandableToggle'

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
  const [display, setDisplay] = useState<'cards' | 'cloud'>(() => {
    try { return localStorage.getItem('machina.hosts.display') === 'cloud' ? 'cloud' : 'cards' } catch { return 'cards' }
  })
  useEffect(() => {
    try { localStorage.setItem('machina.hosts.display', display) } catch { /* ignore */ }
  }, [display])
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
  // All four Finder view modes (icons/list/columns' chip row/columns' pill row) render the same
  // `visibleHosts`; `selected` stays looked up against the full list so an expanded-then-collapsed
  // selection isn't lost.
  const hostList = useExpandable(visibleHosts, 30)

  const toolbar = (
    <>
      <button type="button" className="btn-secondary text-sm" onClick={async () => {
        try { await syncAllHosts(); toast.success('Sync all queued') } catch (e: unknown) { toast.error(formatUserError(e)) }
      }}>Sync all</button>
      <button type="button" aria-label="Refresh" onClick={() => void load()} className="btn-secondary text-xs"><RefreshCw className="w-4 h-4" /></button>
    </>
  )

  const listContent = viewMode === 'list' ? (
    <TahoeTableWrap>
      <table className="apple-table w-full text-sm" aria-label="Managed hosts">
        <thead>
          <tr>
            <th scope="col">Host</th>
            <th scope="col" className="text-center">State</th>
            <th scope="col" className="text-center">VMs</th>
            <th scope="col" className="text-center">CPU</th>
            <th scope="col" className="text-center">Linux</th>
          </tr>
        </thead>
        <tbody>
          {hostList.shown.map((h) => (
            <tr
              key={h.id}
              className={`cursor-pointer ${selectedId === h.id ? 'bg-[var(--accent)]/10' : ''}`}
              onClick={() => setSelectedId(h.id)}
            >
              <td><Link to={`/platform/hosts/${h.id}`} className={`hover:underline ${hubLinkClasses()}`} onClick={(e) => e.stopPropagation()}>{h.hostname}</Link></td>
              <td className="capitalize text-center">{h.state}</td>
              <td className="text-center">{h.vm_count}</td>
              <td className="text-center">{h.cpu_percent != null ? `${h.cpu_percent.toFixed(0)}%` : '—'}</td>
              <td className="text-center">
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
    </TahoeTableWrap>
  ) : (
    <div className="flex flex-wrap gap-2">
      {hostList.shown.map((h) => (
        <button
          key={h.id}
          type="button"
          onClick={() => setSelectedId(h.id)}
          className={`px-3.5 py-2 rounded-full text-sm transition ${
            selectedId === h.id
              ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
              : 'text-[var(--text-secondary)] bg-[var(--apple-fill-tertiary)]/50 hover:bg-[var(--apple-fill-tertiary)]'
          }`}
        >
          {h.hostname}
        </button>
      ))}
    </div>
  )

  const inspector = selected ? (
    <div className="platform-finder-inspector p-4 space-y-4">
      <div>
        <h2 className="font-semibold text-[var(--text-primary)]">{selected.hostname}</h2>
        <p className="platform-finder-inspector-subtitle mt-1">{selected.address || '—'}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div><dt className="platform-finder-inspector-label">State</dt><dd className="text-[var(--text-primary)] capitalize">{selected.state}</dd></div>
        <div><dt className="platform-finder-inspector-label">VMs</dt><dd className="text-[var(--text-primary)]">{selected.vm_count}</dd></div>
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
    <div className="flex flex-col gap-4 w-full">
      <div className="flex flex-wrap gap-2">
        {hostList.shown.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => setSelectedId(h.id)}
            className={`px-3.5 py-2 rounded-full text-sm transition ${
              selectedId === h.id
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-[var(--text-secondary)] bg-[var(--apple-fill-tertiary)]/50 hover:bg-[var(--apple-fill-tertiary)]'
            }`}
          >
            {h.hostname}
          </button>
        ))}
      </div>
      <div className="w-full min-w-0">
        {selected ? inspector : <p className="platform-finder-inspector platform-finder-inspector-empty p-4 text-[var(--text-muted)]">Select a host</p>}
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
        <span aria-live="polite" className="flex flex-wrap items-center gap-2 text-sm">
          <span className={statusPillClasses(fleetTone)}>{online} / {hosts.length} online</span>
          <span className="text-[var(--text-muted)]">{totalVms} VM{totalVms === 1 ? '' : 's'} fleet-wide</span>
          {filterOffline && <span className="text-[var(--text-muted)]">Showing offline only</span>}
        </span>
      }
      icon={<Server className="w-6 h-6 text-[var(--text-muted)]" />}
      actions={
        <>
          <button type="button" className="btn-secondary text-sm" onClick={async () => {
            try { await syncAllHosts(); toast.success('Sync all queued') } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>Sync all</button>
          <button type="button" aria-label="Refresh" onClick={() => void load()} className="btn-secondary text-xs"><RefreshCw className="w-4 h-4" /></button>
          {!filterOffline && (
            <button type="button" className="btn-primary text-sm inline-flex items-center gap-1" onClick={() => setEnrollWizardOpen(true)}>
              <Plus className="w-4 h-4" /> Add host
            </button>
          )}
        </>
      }
      contentClassName="space-y-4"
    >
      {hosts.length > 0 && (
        <div role="tablist" aria-label="Hosts display" className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
          {(['cards', 'cloud'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={display === m} data-testid={`hosts-display-${m}`}
              className={`px-3 py-1 rounded-md ${display === m ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)]'}`}
              onClick={() => setDisplay(m)}>{m === 'cards' ? 'Cards' : 'Cloud map'}</button>
          ))}
        </div>
      )}
      {display === 'cloud' && hosts.length > 0 && (
        <section aria-label="Machines in this cloud" data-testid="hosts-cloud-map" className="w-full">
          <FleetCloudImmersive hosts={hosts} selectedId={selectedId} onSelect={setSelectedId} />
        </section>
      )}
      {display === 'cards' && viewMode === 'icons' && visibleHosts.length > 0 && (
        <div className="flex flex-col gap-4 w-full" data-testid="host-fleet-panels">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 w-full nl-stagger">
            {hostList.shown.map((h) => (
              <HostFleetCard
                key={h.id}
                host={h}
                linux={linuxByHost[h.id]}
                selected={selectedId === h.id}
                onSelect={() => setSelectedId(h.id)}
              />
            ))}
          </div>
          {selected ? <HostCommandCenter host={selected} linux={linuxByHost[selected.id]} /> : null}
        </div>
      )}
      {hostList.showToggle && (
        <ExpandableToggle expanded={hostList.expanded} hidden={hostList.hidden} listId={hostList.listId} onToggle={hostList.toggle} noun="hosts" />
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
        listContent={viewMode === 'icons' ? null : listContent}
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
