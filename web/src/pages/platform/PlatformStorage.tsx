// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, Clock, HardDrive, Layers, Loader2, Plus, RefreshCw, Shield } from 'lucide-react'
import ErrorBanner from '../../components/ErrorBanner'
import DetailTabs from '../../components/platform/DetailTabs'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton, platformStatSubtitle } from '../../components/platform/PlatformPageChrome'
import { usePlatformTabState } from '../../hooks/usePlatformTabState'
import { StructuredErrorBanner } from '../../components/StructuredErrorBanner'
import { storageErrorPresentation } from '../../utils/storageErrorPresentation'
import FleetSettingsPane from '../../components/platform/FleetSettingsPane'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import {
  MacGlassPanel,
  MacListRow,
  MacSheet,
  MacStatWidget,
  gradientForName,
} from '../../components/platform/mac/PlatformMacUi'
import {
  bindStoragePoolTier,
  createStoragePool,
  deleteStoragePool,
  discoverStoragePools,
  getFleetStorage,
  getStorageBackupSla,
  getStorageTiersOverview,
  listPlatformHosts,
  listStoragePools,
  patchStoragePool,
  syncAllHosts,
  upsertStorageBackupSla,
  type FleetStorageOverview,
  type StorageBackupSla,
  type StoragePool,
  type StorageTierOverview,
} from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import {statusBadgeClasses, statusToneClass, hubLinkClasses} from '../../utils/semanticColors'

type TabId = 'disks' | 'pools' | 'tiers' | 'sla'

const STORAGE_TABS: Array<{ id: TabId; label: string }> = [
  { id: 'disks', label: 'Disks' },
  { id: 'pools', label: 'Pools' },
  { id: 'tiers', label: 'Tiers' },
  { id: 'sla', label: 'Backup SLA' },
]

function capacityRing(used: number, cap: number) {
  if (cap <= 0) return 0
  return Math.min(100, Math.round((used / cap) * 100))
}

export default function PlatformStorage() {
  const toast = useToastContext()
  const [tab, setTab] = usePlatformTabState<TabId>(STORAGE_TABS.map((t) => t.id), { defaultTab: 'disks' })

  const [rows, setRows] = useState<StoragePool[]>([])
  const [fleetStorage, setFleetStorage] = useState<FleetStorageOverview | null>(null)
  const [tiers, setTiers] = useState<StorageTierOverview[]>([])
  const [slaPolicies, setSlaPolicies] = useState<StorageBackupSla[]>([])
  const [hostCount, setHostCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [name, setName] = useState('datastore-01')
  const [path, setPath] = useState('/var/lib/libvirt/images')
  const [creating, setCreating] = useState(false)
  const [bindDraft, setBindDraft] = useState<Record<string, string>>({})
  const [binding, setBinding] = useState<string | null>(null)
  const [slaEdit, setSlaEdit] = useState<StorageBackupSla | null>(null)
  const [slaRpo, setSlaRpo] = useState(24)
  const [slaRto, setSlaRto] = useState(4)
  const [slaRetention, setSlaRetention] = useState(30)
  const [slaSaving, setSlaSaving] = useState(false)

  const tierName = (id?: string | null) => tiers.find((t) => t.id === id)?.name ?? null

  const load = useCallback(async (autoDiscover = false) => {
    setError(null)
    try {
      const [pools, hosts, tierOverview, sla] = await Promise.all([
        listStoragePools(),
        listPlatformHosts(),
        getStorageTiersOverview().catch(() => ({ tiers: [], summary: '' })),
        getStorageBackupSla().catch(() => ({ policies: [], summary: '' })),
      ])
      setTiers(tierOverview.tiers)
      setSlaPolicies(sla.policies ?? [])
      setHostCount(hosts.filter((h) => h.state === 'online').length)
      if (pools.length === 0 && autoDiscover && hosts.some((h) => h.state === 'online')) {
        setDiscovering(true)
        try {
          const r = await discoverStoragePools()
          const imported = r.pools ?? []
          setRows(imported)
          if (imported.length > 0) {
            toast.success(`Imported ${imported.length} storage pool(s) from libvirt`)
          }
        } catch (e: unknown) {
          setError(formatUserError(e))
        } finally {
          setDiscovering(false)
        }
      } else {
        setRows(pools)
      }
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [toast])

  useEffect(() => { void load(true) }, [load])

  useEffect(() => {
    if (tab !== 'disks') return
    void getFleetStorage().then(setFleetStorage).catch(() => setFleetStorage(null))
  }, [tab])

  const runDiscover = async () => {
    setDiscovering(true)
    setError(null)
    try {
      const r = await discoverStoragePools()
      const found = r.pools ?? []
      setRows(found)
      toast.success(found.length ? `Found ${found.length} pool(s)` : 'No libvirt pools on online hosts')
      await load(false)
    } catch (e: unknown) {
      const msg = formatUserError(e)
      setError(msg)
      toast.error(msg)
    } finally {
      setDiscovering(false)
    }
  }

  const bindTier = async (poolId: string, tierId: string) => {
    setBinding(poolId)
    try {
      await bindStoragePoolTier(poolId, tierId)
      toast.success('Pool assigned to tier')
      await load(false)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setBinding(null)
    }
  }

  const openSlaEdit = (policy: StorageBackupSla) => {
    setSlaEdit(policy)
    setSlaRpo(policy.rpo_hours)
    setSlaRto(policy.rto_hours)
    setSlaRetention(policy.retention_days)
  }

  const saveSla = async () => {
    if (!slaEdit) return
    setSlaSaving(true)
    try {
      await upsertStorageBackupSla(slaEdit.pool_id, {
        rpo_hours: slaRpo,
        rto_hours: slaRto,
        retention_days: slaRetention,
      })
      toast.success('Backup SLA updated')
      setSlaEdit(null)
      await load(false)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setSlaSaving(false)
    }
  }

  const totalCap = rows.reduce((s, p) => s + p.capacity_gib, 0)
  const totalUsed = rows.reduce((s, p) => s + p.used_gib, 0)

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load(false)}
      className="platform-readable"
      prepend={<PlatformBackLink to="/platform/resources" label="Resources" />}
      title="Storage"
      subtitle={
        <span className="flex flex-col gap-1">
          <span className="text-slate-400">Pools, tiers, backup SLA, and fleet disk health</span>
          {rows.length > 0
            ? platformStatSubtitle([
                { label: 'Pools', value: String(rows.length) },
                { label: 'Capacity', value: `${totalUsed.toFixed(0)} / ${totalCap.toFixed(0)} GiB` },
                { label: 'Online hosts', value: String(hostCount) },
              ])
            : null}
        </span>
      }
      icon={<HardDrive className="w-6 h-6 text-slate-400" />}
      actions={
        <>
          {tab === 'pools' && (
            <>
              <button type="button" className="btn-secondary text-sm" disabled={discovering} onClick={() => void runDiscover()}>
                {discovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Import from hosts
              </button>
              <button type="button" className="btn-secondary text-sm" disabled={discovering} onClick={async () => {
                try { await syncAllHosts(); toast.success('Host sync queued') } catch (e: unknown) { toast.error(formatUserError(e)) }
              }}>Sync hosts</button>
              <button type="button" className="btn-primary flex items-center gap-2 text-sm" onClick={() => setSheetOpen(true)}><Plus className="w-4 h-4" /> Add pool</button>
            </>
          )}
          <PlatformRefreshButton onClick={() => void load(false)} />
        </>
      }
      contentClassName="space-y-4"
    >
      <DetailTabs primary={STORAGE_TABS} active={tab} onChange={setTab} />

      {error && (storageErrorPresentation(error) ? (
        <StructuredErrorBanner error={storageErrorPresentation(error)!} />
      ) : (
        <ErrorBanner message={error} />
      ))}
      {error && storageErrorPresentation(error) && (
        <p className="text-xs text-slate-500">
          <Link to="/platform/hosts" className={hubLinkClasses()}>Hosts</Link>
          {' · '}
          <Link to="/node" className={hubLinkClasses()}>Classic node tools</Link>
        </p>
      )}

      {tab === 'disks' && (
        <div className="space-y-4">
          {fleetStorage && (
            <>
              <p className="text-sm text-slate-400">{fleetStorage.summary}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MacStatWidget label="Pools" value={String(fleetStorage.pool_count)} icon={<HardDrive className="w-4 h-4" />} />
                <MacStatWidget
                  label="Used / capacity"
                  value={fleetStorage.total_capacity_gib > 0 ? `${fleetStorage.total_used_gib}/${fleetStorage.total_capacity_gib} GiB` : '—'}
                  icon={<Layers className="w-4 h-4" />}
                />
                <MacStatWidget
                  label="Pools >85%"
                  value={String(fleetStorage.pools_over_85_pct)}
                  icon={<AlertTriangle className="w-4 h-4" />}
                  tone={fleetStorage.pools_over_85_pct > 0 ? 'warn' : 'ok'}
                />
                <MacStatWidget
                  label="SMART failures"
                  value={String(fleetStorage.smart_failure_count)}
                  icon={<Shield className="w-4 h-4" />}
                  tone={fleetStorage.smart_failure_count > 0 ? 'warn' : 'ok'}
                />
              </div>
            </>
          )}
          {!fleetStorage && (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading fleet storage…
            </div>
          )}
          {fleetStorage && (fleetStorage.pools?.length ?? 0) > 0 && (
            <MacGlassPanel title="Pool health" subtitle="Capacity rings across all registered storage pools.">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 -mt-1">
                {fleetStorage.pools.map((p) => {
                  const pct = capacityRing(p.used_gib, p.capacity_gib)
                  const ringClass = p.status === 'critical' ? statusToneClass('error') : p.status === 'warn' ? statusToneClass('warn') : statusToneClass('info')
                  return (
                    <article key={p.id} className="platform-mac-stat rounded-2xl border border-white/[0.06] bg-slate-900/40 p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${gradientForName(p.name)} flex items-center justify-center text-white shrink-0`}>
                          <HardDrive className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold truncate">{p.name}</p>
                          <p className="text-xs text-slate-500 capitalize">{p.storage_class}{p.tier_name ? ` · ${p.tier_name}` : ''}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="relative w-14 h-14 shrink-0">
                          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
                            <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-slate-800" />
                            <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${pct} 100`} className={ringClass} />
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">{Math.round(p.used_pct)}%</span>
                        </div>
                        <dl className="text-xs space-y-1 flex-1">
                          <div><dt className="text-slate-500 inline">Used </dt><dd className="inline text-slate-200">{p.used_gib} GiB</dd></div>
                          <div><dt className="text-slate-500 inline">Capacity </dt><dd className="inline text-slate-200">{p.capacity_gib || '—'} GiB</dd></div>
                        </dl>
                      </div>
                    </article>
                  )
                })}
              </div>
            </MacGlassPanel>
          )}
          {fleetStorage && (
            <MacGlassPanel title="SMART status" subtitle="Failed disks reported by online hypervisors (linux-obs).">
              {(fleetStorage.smart_disks ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">No SMART failures detected on sampled hosts.</p>
              ) : (
                <div className="divide-y divide-white/[0.04] -mx-1">
                  {(fleetStorage.smart_disks ?? []).map((d) => (
                    <MacListRow
                      key={`${d.host_id}-${d.device}`}
                      title={`${d.hostname} · ${d.device}`}
                      subtitle={d.summary}
                      href={`/platform/hosts/${d.host_id}`}
                    />
                  ))}
                </div>
              )}
            </MacGlassPanel>
          )}
        </div>
      )}

      {tab !== 'disks' && (
      <div className="grid gap-3 sm:grid-cols-3">
        <MacStatWidget label="Pools" value={String(rows.length)} icon={<HardDrive className="w-4 h-4" />} />
        <MacStatWidget label="Tiers" value={String(tiers.length)} icon={<Layers className="w-4 h-4" />} />
        <MacStatWidget label="Used / capacity" value={totalCap > 0 ? `${totalUsed}/${totalCap} GiB` : '—'} icon={<Clock className="w-4 h-4" />} />
      </div>
      )}

      {tab === 'pools' && (
        <>
          {rows.length === 0 && !error ? (
            <PlatformEmptyState title="No storage pools" subtitle="Import libvirt pools from your KVM hosts, or add one manually.">
              <button type="button" className="btn-primary mt-3" disabled={discovering} onClick={() => void runDiscover()}>
                {discovering ? 'Importing…' : 'Import from hosts'}
              </button>
            </PlatformEmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((p) => {
                const pct = capacityRing(p.used_gib, p.capacity_gib)
                return (
                  <article key={p.id} className="platform-mac-stat rounded-2xl border border-white/[0.06] bg-slate-900/50 p-5 space-y-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradientForName(p.name)} flex items-center justify-center text-white`}>
                        <HardDrive className="w-6 h-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{p.name}</p>
                        <p className="text-xs text-slate-500 capitalize">{p.storage_class} · {p.backend}</p>
                        <p className="text-xs text-violet-300/80 mt-0.5">{tierName(p.tier_id) ?? 'No tier'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="relative w-14 h-14 shrink-0">
                        <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-slate-800" />
                            <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${pct} 100`} className={pct > 85 ? statusToneClass('warn') : statusToneClass('info')} />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">{pct}%</span>
                      </div>
                      <dl className="text-xs space-y-1 flex-1">
                        <div><dt className="text-slate-500 inline">Used </dt><dd className="inline text-slate-200">{p.used_gib} GiB</dd></div>
                        <div><dt className="text-slate-500 inline">Capacity </dt><dd className="inline text-slate-200">{p.capacity_gib || '—'} GiB</dd></div>
                        {p.path && <div className="text-slate-500 truncate" title={p.path}>{p.path}</div>}
                      </dl>
                    </div>
                    {tiers.length > 0 && (
                      <div className="flex gap-2">
                        <select
                          className="input text-xs flex-1"
                          value={bindDraft[p.id] ?? p.tier_id ?? ''}
                          onChange={(e) => setBindDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                        >
                          <option value="">Select tier…</option>
                          {tiers.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          disabled={binding === p.id || !(bindDraft[p.id] ?? p.tier_id)}
                          onClick={() => {
                            const tid = bindDraft[p.id] ?? p.tier_id
                            if (tid) void bindTier(p.id, tid)
                          }}
                        >
                          Bind
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      className="btn-secondary text-xs w-full"
                      onClick={async () => {
                        const next = window.prompt('Capacity (GiB)', String(p.capacity_gib || 100))
                        if (!next) return
                        try {
                          await patchStoragePool(p.id, { capacity_gib: Number(next) })
                          toast.success('Pool updated')
                          await load(false)
                        } catch (e: unknown) {
                          toast.error(formatUserError(e))
                        }
                      }}
                    >
                      Edit capacity
                    </button>
                    <button type="button" className="btn-danger text-xs w-full" onClick={async () => {
                      try { await deleteStoragePool(p.id); toast.success('Deleted'); await load(false) } catch (e: unknown) { toast.error(formatUserError(e)) }
                    }}>Remove from inventory</button>
                  </article>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'tiers' && (
        <MacGlassPanel title="Storage tiers" subtitle="Gold / silver / bronze taxonomy with IOPS and replication stubs.">
          {tiers.length === 0 ? (
            <p className="text-sm text-slate-400">No tiers — run migration 028 to seed defaults.</p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-white/[0.06]">
                    <th className="py-2 px-2">Name</th>
                    <th className="py-2 px-2">Class</th>
                    <th className="py-2 px-2">IOPS</th>
                    <th className="py-2 px-2">Replication</th>
                    <th className="py-2 px-2">Snapshots</th>
                    <th className="py-2 px-2">RPO</th>
                    <th className="py-2 px-2">Pools</th>
                  </tr>
                </thead>
                <tbody>
                  {tiers.map((t) => (
                    <tr key={t.id} className="border-b border-white/[0.04] text-slate-200">
                      <td className="py-2.5 px-2 font-medium">{t.name}</td>
                      <td className="py-2.5 px-2 capitalize">{t.tier_class}</td>
                      <td className="py-2.5 px-2">{t.iops_tier}</td>
                      <td className="py-2.5 px-2">{t.replication}</td>
                      <td className="py-2.5 px-2">{t.snapshot_retention_days}d</td>
                      <td className="py-2.5 px-2">{t.backup_rpo_hours}h</td>
                      <td className="py-2.5 px-2">{t.pool_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </MacGlassPanel>
      )}

      {tab === 'sla' && (
        <MacGlassPanel title="Backup SLA" subtitle="Per-pool RPO/RTO compliance grades (simulated).">
          {slaPolicies.length === 0 ? (
            <p className="text-sm text-slate-400">No SLA policies — import pools first.</p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-white/[0.06]">
                    <th className="py-2 px-2">Pool</th>
                    <th className="py-2 px-2">Tier</th>
                    <th className="py-2 px-2">RPO</th>
                    <th className="py-2 px-2">RTO</th>
                    <th className="py-2 px-2">Retention</th>
                    <th className="py-2 px-2">Grade</th>
                    <th className="py-2 px-2" />
                  </tr>
                </thead>
                <tbody>
                  {slaPolicies.map((s) => (
                    <tr key={s.id} className="border-b border-white/[0.04] text-slate-200">
                      <td className="py-2.5 px-2">{s.pool_name}</td>
                      <td className="py-2.5 px-2">{s.tier_name ?? '—'}</td>
                      <td className="py-2.5 px-2">{s.rpo_hours}h</td>
                      <td className="py-2.5 px-2">{s.rto_hours}h</td>
                      <td className="py-2.5 px-2">{s.retention_days}d</td>
                      <td className="py-2.5 px-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          statusBadgeClasses(s.compliance_grade === 'A' ? 'ok' : s.compliance_grade === 'B' ? 'info' : 'warn')
                        }`}>{s.compliance_grade}</span>
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <button type="button" className={`text-xs hover:underline ${hubLinkClasses()}`} onClick={() => openSlaEdit(s)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </MacGlassPanel>
      )}

      <MacSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Add storage pool">
        <div className="space-y-4">
          <label className="block text-sm"><span className="text-slate-400">Name</span><input className="input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="block text-sm"><span className="text-slate-400">Path on host</span><input className="input mt-1 w-full" value={path} onChange={(e) => setPath(e.target.value)} /></label>
          <button type="button" className="btn-primary w-full" disabled={creating} onClick={async () => {
            setCreating(true)
            try {
              await createStoragePool({ name, path, storage_class: 'silver' })
              toast.success('Pool added')
              setSheetOpen(false)
              await load(false)
            } catch (e: unknown) { toast.error(formatUserError(e)) }
            finally { setCreating(false) }
          }}>{creating ? 'Adding…' : 'Add pool'}</button>
        </div>
      </MacSheet>

      <MacSheet open={!!slaEdit} onClose={() => setSlaEdit(null)} title={`Edit backup SLA — ${slaEdit?.pool_name ?? ''}`}>
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-slate-400">RPO (hours)</span>
            <input type="number" min={1} max={168} className="input mt-1 w-full" value={slaRpo} onChange={(e) => setSlaRpo(Number(e.target.value))} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">RTO (hours)</span>
            <input type="number" min={1} max={72} className="input mt-1 w-full" value={slaRto} onChange={(e) => setSlaRto(Number(e.target.value))} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Retention (days)</span>
            <input type="number" min={1} max={365} className="input mt-1 w-full" value={slaRetention} onChange={(e) => setSlaRetention(Number(e.target.value))} />
          </label>
          <button type="button" className="btn-primary w-full" disabled={slaSaving} onClick={() => void saveSla()}>
            {slaSaving ? 'Saving…' : 'Save SLA'}
          </button>
        </div>
      </MacSheet>
      {tab === 'disks' && <FleetSettingsPane kind="storage" />}
    </PlatformPageChrome>
  )
}
