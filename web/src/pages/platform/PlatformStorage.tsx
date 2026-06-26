// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
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
import StoragePoolWizard from '../../components/platform/StoragePoolWizard'
import {
  MacGlassPanel,
  MacListRow,
  MacSheet,
  MacStatWidget,
  gradientForName,
} from '../../components/platform/mac/PlatformMacUi'
import {
  bindStoragePoolTier,
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
  activateStoragePool,
  deactivateStoragePool,
  refreshStoragePool,
  listLiveStoragePools,
  type FleetStorageOverview,
  type StorageBackupSla,
  type StoragePool,
  type StorageTierOverview,
  type LiveStoragePoolInfo,
} from '../../api/platform'
import {
  createStoragePoolVolume,
  deleteStoragePoolVolume,
  getStorageSnapshotPolicy as getPoolSnapshotPolicy,
  listStoragePoolVolumes,
  type StoragePoolVolume,
} from '../../api/platformStorage'
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
  const [poolWizardOpen, setPoolWizardOpen] = useState(false)
  const [bindDraft, setBindDraft] = useState<Record<string, string>>({})
  const [binding, setBinding] = useState<string | null>(null)
  const [slaEdit, setSlaEdit] = useState<StorageBackupSla | null>(null)
  const [slaRpo, setSlaRpo] = useState(24)
  const [slaRto, setSlaRto] = useState(4)
  const [slaRetention, setSlaRetention] = useState(30)
  const [slaSaving, setSlaSaving] = useState(false)
  const [snapshotPolicies, setSnapshotPolicies] = useState<Record<string, { pool_name: string; snapshot_retention_days: number; summary: string }>>({})
  const [snapshotPolicyLoading, setSnapshotPolicyLoading] = useState<string | null>(null)
  const [livePools, setLivePools] = useState<Record<string, LiveStoragePoolInfo>>({})
  const [poolActionId, setPoolActionId] = useState<string | null>(null)
  const [expandedPoolId, setExpandedPoolId] = useState<string | null>(null)
  const [poolVolumes, setPoolVolumes] = useState<Record<string, StoragePoolVolume[]>>({})
  const [volumesLoading, setVolumesLoading] = useState<string | null>(null)
  const [volumeCreatePool, setVolumeCreatePool] = useState<StoragePool | null>(null)
  const [volumeName, setVolumeName] = useState('')
  const [volumeCapacityGb, setVolumeCapacityGb] = useState(10)
  const [volumeFormat, setVolumeFormat] = useState('qcow2')
  const [volumeSaving, setVolumeSaving] = useState(false)
  const [confirmVolume, setConfirmVolume] = useState<{ poolId: string; volName: string; poolName: string } | null>(null)
  const [confirmPoolId, setConfirmPoolId] = useState<string | null>(null)
  const [resizePool, setResizePool] = useState<{ id: string; name: string; currentGib: number } | null>(null)
  const [resizePoolInput, setResizePoolInput] = useState('')

  const tierName = (id?: string | null) => tiers.find((t) => t.id === id)?.name ?? null

  const loadSnapshotPolicy = async (poolId: string) => {
    setSnapshotPolicyLoading(poolId)
    try {
      const r = await getPoolSnapshotPolicy(poolId)
      setSnapshotPolicies((prev) => ({ ...prev, [poolId]: r }))
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setSnapshotPolicyLoading(null)
    }
  }

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
      if (hosts.some((h) => h.state === 'online')) {
        listLiveStoragePools()
          .then((live) => {
            const map: Record<string, LiveStoragePoolInfo> = {}
            for (const p of live.pools ?? []) map[p.name] = p
            setLivePools(map)
          })
          .catch(() => setLivePools({}))
      }
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

  const loadPoolVolumes = async (poolId: string) => {
    setVolumesLoading(poolId)
    try {
      const r = await listStoragePoolVolumes(poolId)
      setPoolVolumes((prev) => ({ ...prev, [poolId]: r.volumes ?? [] }))
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setVolumesLoading(null)
    }
  }

  const togglePoolVolumes = (poolId: string) => {
    if (expandedPoolId === poolId) {
      setExpandedPoolId(null)
      return
    }
    setExpandedPoolId(poolId)
    if (!poolVolumes[poolId]) void loadPoolVolumes(poolId)
  }

  const saveVolume = async () => {
    if (!volumeCreatePool || !volumeName.trim()) return
    setVolumeSaving(true)
    try {
      await createStoragePoolVolume(volumeCreatePool.id, {
        name: volumeName.trim(),
        capacity_gb: Math.max(1, volumeCapacityGb),
        format: volumeFormat,
      })
      toast.success(`Created volume ${volumeName.trim()}`)
      setVolumeCreatePool(null)
      setVolumeName('')
      setVolumeCapacityGb(10)
      await loadPoolVolumes(volumeCreatePool.id)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setVolumeSaving(false)
    }
  }

  const removeVolume = async (poolId: string, volName: string) => {
    setVolumesLoading(poolId)
    try {
      await deleteStoragePoolVolume(poolId, volName)
      toast.success(`Deleted ${volName}`)
      await loadPoolVolumes(poolId)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setVolumesLoading(null)
    }
  }

  const totalCap = rows.reduce((s, p) => s + p.capacity_gib, 0)
  const totalUsed = rows.reduce((s, p) => s + p.used_gib, 0)

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load(false)}
      className="platform-readable"
      prepend={<PlatformBackLink to="/platform/infrastructure" label="Infrastructure" />}
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
              <button type="button" className="btn-primary flex items-center gap-2 text-sm" onClick={() => setPoolWizardOpen(true)}><Plus className="w-4 h-4" /> Add pool</button>
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
              <div className="flex flex-wrap gap-2 mt-3">
                <button type="button" className="btn-primary" disabled={discovering} onClick={() => void runDiscover()}>
                  {discovering ? 'Importing…' : 'Import from hosts'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setPoolWizardOpen(true)}>Add pool wizard</button>
              </div>
            </PlatformEmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((p) => {
                const pct = capacityRing(p.used_gib, p.capacity_gib)
                const live = livePools[p.name]
                const active = live?.state === 'running'
                return (
                  <article key={p.id} className="platform-mac-stat rounded-2xl border border-white/[0.06] bg-slate-900/50 p-5 space-y-4" data-testid={`storage-pool-${p.name}`}>
                    <div className="flex items-start gap-3">
                      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradientForName(p.name)} flex items-center justify-center text-white`}>
                        <HardDrive className="w-6 h-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{p.name}</p>
                        <p className="text-xs text-slate-500 capitalize">{p.storage_class} · {p.backend}</p>
                        <p className="text-xs text-violet-300/80 mt-0.5">{tierName(p.tier_id) ?? 'No tier'}</p>
                        {live && (
                          <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${statusBadgeClasses(active ? 'ok' : 'warn')}`}>
                            {live.state}
                          </span>
                        )}
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
                          aria-label="Storage tier"
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
                    <div className="flex flex-wrap gap-2">
                      {!active ? (
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          disabled={poolActionId === p.id || hostCount === 0}
                          data-testid={`pool-activate-${p.name}`}
                          onClick={async () => {
                            setPoolActionId(p.id)
                            try {
                              await activateStoragePool(p.id)
                              toast.success(`Activated ${p.name}`)
                              await load(false)
                            } catch (e: unknown) {
                              toast.error(formatUserError(e))
                            } finally {
                              setPoolActionId(null)
                            }
                          }}
                        >
                          {poolActionId === p.id ? 'Activating…' : 'Activate'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          disabled={poolActionId === p.id}
                          data-testid={`pool-deactivate-${p.name}`}
                          onClick={async () => {
                            setPoolActionId(p.id)
                            try {
                              await deactivateStoragePool(p.id)
                              toast.success(`Deactivated ${p.name}`)
                              await load(false)
                            } catch (e: unknown) {
                              toast.error(formatUserError(e))
                            } finally {
                              setPoolActionId(null)
                            }
                          }}
                        >
                          Deactivate
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={poolActionId === p.id || !active}
                        onClick={async () => {
                          setPoolActionId(p.id)
                          try {
                            await refreshStoragePool(p.id)
                            toast.success(`Refreshed ${p.name}`)
                            await load(false)
                          } catch (e: unknown) {
                            toast.error(formatUserError(e))
                          } finally {
                            setPoolActionId(null)
                          }
                        }}
                      >
                        Refresh
                      </button>
                    </div>
                    <div className="space-y-2 border-t border-white/[0.04] pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          data-testid={`pool-volumes-toggle-${p.name}`}
                          onClick={() => togglePoolVolumes(p.id)}
                        >
                          {expandedPoolId === p.id ? 'Hide volumes' : 'Volumes'}
                          {poolVolumes[p.id]?.length ? ` (${poolVolumes[p.id].length})` : ''}
                        </button>
                        {expandedPoolId === p.id && active && (
                          <button
                            type="button"
                            className="btn-primary text-xs"
                            data-testid={`pool-volume-create-${p.name}`}
                            onClick={() => {
                              setVolumeCreatePool(p)
                              setVolumeName('')
                              setVolumeCapacityGb(10)
                              setVolumeFormat('qcow2')
                            }}
                          >
                            <Plus className="w-3 h-3 inline mr-1" />
                            New volume
                          </button>
                        )}
                      </div>
                      {expandedPoolId === p.id && (
                        <div className="rounded-lg border border-white/[0.06] bg-slate-950/40 p-2">
                          {volumesLoading === p.id && !poolVolumes[p.id] ? (
                            <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading volumes…</p>
                          ) : (poolVolumes[p.id]?.length ?? 0) === 0 ? (
                            <p className="text-xs text-slate-500">{active ? 'No volumes in this pool.' : 'Activate the pool to manage volumes.'}</p>
                          ) : (
                            <ul className="text-xs space-y-2">
                              {poolVolumes[p.id]?.map((v) => (
                                <li key={v.name} className="flex flex-wrap items-center justify-between gap-2 text-slate-300">
                                  <span>
                                    <span className="font-medium text-slate-200">{v.name}</span>
                                    {' · '}
                                    {v.capacity_gb} GiB
                                    {v.allocation_gb > 0 && ` (${v.allocation_gb} GiB allocated)`}
                                    {v.vol_type && ` · ${v.vol_type}`}
                                  </span>
                                  <button
                                    type="button"
                                    className="btn-danger text-[10px]"
                                    disabled={volumesLoading === p.id}
                                    data-testid={`pool-volume-delete-${p.name}-${v.name}`}
                                    onClick={() => setConfirmVolume({ poolId: p.id, volName: v.name, poolName: p.name })}
                                  >
                                    Delete
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          {expandedPoolId === p.id && (
                            <button
                              type="button"
                              className="btn-secondary text-[10px] mt-2"
                              disabled={volumesLoading === p.id || !active}
                              onClick={() => void loadPoolVolumes(p.id)}
                            >
                              Refresh volumes
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn-secondary text-xs w-full"
                      disabled={snapshotPolicyLoading === p.id}
                      onClick={() => void loadSnapshotPolicy(p.id)}
                    >
                      {snapshotPolicyLoading === p.id ? 'Loading policy…' : 'Snapshot policy'}
                    </button>
                    {snapshotPolicies[p.id] && (
                      <p className="text-xs text-slate-400">
                        {snapshotPolicies[p.id].summary}
                        {' · '}
                        <span className="text-violet-300/90">{snapshotPolicies[p.id].snapshot_retention_days}d retention</span>
                      </p>
                    )}
                    <button
                      type="button"
                      className="btn-secondary text-xs w-full"
                      onClick={() => {
                        setResizePoolInput(String(p.capacity_gib || 100))
                        setResizePool({ id: p.id, name: p.name, currentGib: p.capacity_gib || 100 })
                      }}
                    >
                      Edit capacity
                    </button>
                    <button type="button" className="btn-danger text-xs w-full" onClick={() => setConfirmPoolId(p.id)}>Remove from host & inventory</button>
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
              <table className="w-full text-sm" aria-label="Storage tiers">
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
              <table className="w-full text-sm" aria-label="Backup SLA policies">
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

      <StoragePoolWizard
        open={poolWizardOpen}
        onClose={() => setPoolWizardOpen(false)}
        onCreated={async () => {
          toast.success('Pool added')
          await load(false)
        }}
      />

      <MacSheet open={!!volumeCreatePool} onClose={() => setVolumeCreatePool(null)} title={`New volume — ${volumeCreatePool?.name ?? ''}`}>
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-slate-400">Name</span>
            <input className="input mt-1 w-full" value={volumeName} onChange={(e) => setVolumeName(e.target.value)} placeholder="data-01.qcow2" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Capacity (GiB)</span>
            <input type="number" min={1} className="input mt-1 w-full" value={volumeCapacityGb} onChange={(e) => setVolumeCapacityGb(Number(e.target.value))} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Format</span>
            <select className="input mt-1 w-full" value={volumeFormat} onChange={(e) => setVolumeFormat(e.target.value)}>
              <option value="qcow2">qcow2</option>
              <option value="raw">raw</option>
            </select>
          </label>
          <button type="button" className="btn-primary w-full" disabled={volumeSaving || !volumeName.trim()} onClick={() => void saveVolume()}>
            {volumeSaving ? 'Creating…' : 'Create volume'}
          </button>
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
      <ConfirmDialog
        open={confirmVolume !== null}
        title="Delete Volume"
        message={`Permanently delete volume "${confirmVolume?.volName}" from pool "${confirmVolume?.poolName}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => setConfirmVolume(null)}
        onConfirm={async () => {
          if (!confirmVolume) return
          try { await removeVolume(confirmVolume.poolId, confirmVolume.volName) }
          catch (e: unknown) { toast.error(formatUserError(e)) }
          finally { setConfirmVolume(null) }
        }}
      />
      <ConfirmDialog
        open={confirmPoolId !== null}
        title="Remove Storage Pool"
        message={`Remove pool "${rows.find((p) => p.id === confirmPoolId)?.name}" from the hypervisor and inventory? This cannot be undone.`}
        confirmLabel="Remove"
        variant="danger"
        onCancel={() => setConfirmPoolId(null)}
        onConfirm={async () => {
          try { await deleteStoragePool(confirmPoolId!); toast.success('Pool removed'); await load(false) }
          catch (e: unknown) { toast.error(formatUserError(e)) }
          finally { setConfirmPoolId(null) }
        }}
      />
      {resizePool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setResizePool(null)}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-700/50">
              <span className="text-lg font-semibold">Edit pool capacity</span>
              <p className="text-sm text-slate-400 mt-1">Pool: {resizePool.name}</p>
            </div>
            <div className="p-5 space-y-3">
              <label className="block text-sm text-slate-400">Capacity (GiB)</label>
              <input
                type="number"
                min={1}
                className="input-field w-full"
                value={resizePoolInput}
                onChange={(e) => setResizePoolInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const n = Number(resizePoolInput)
                    if (!n || n < 1) return
                    const id = resizePool.id
                    setResizePool(null)
                    void patchStoragePool(id, { capacity_gib: n })
                      .then(() => { toast.success('Pool updated'); void load(false) })
                      .catch((err: unknown) => toast.error(formatUserError(err)))
                  } else if (e.key === 'Escape') {
                    setResizePool(null)
                  }
                }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-3 px-5 pb-5">
              <button type="button" onClick={() => setResizePool(null)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition">Cancel</button>
              <button
                type="button"
                disabled={!resizePoolInput || Number(resizePoolInput) < 1}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => {
                  const n = Number(resizePoolInput)
                  if (!n || n < 1) return
                  const id = resizePool.id
                  setResizePool(null)
                  void patchStoragePool(id, { capacity_gib: n })
                    .then(() => { toast.success('Pool updated'); void load(false) })
                    .catch((err: unknown) => toast.error(formatUserError(err)))
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </PlatformPageChrome>
  )
}
