// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Camera } from 'lucide-react'
import { Archive, Clock, Database, RotateCcw } from 'lucide-react'
import { MacGlassPanel } from '../../components/platform/mac/PlatformMacUi'
import PlatformStandardView from '../../components/platform/tahoe/PlatformStandardView'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import {
  createBackupTarget,
  createVmBackupWithTarget,
  getFleetBackups,
  listBackupTargets,
  listBackupTimeline,
  restoreVmBackup,
  type BackupTarget,
  type BackupTimelineEntry,
  type FleetBackupOverview,
} from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import {hostStateTone, httpStatusTone, migrationReadinessTone, riskTone, statusBadgeClasses, statusPillClasses, statusToneClass, taskStatusTone, webhookDeliveryTone, hubLinkClasses} from '../../utils/semanticColors'

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = (start.getTime() - day.getTime()) / 86_400_000
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

type TabId = 'timeline' | 'destinations'

export default function PlatformBackups() {
  const toast = useToastContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: TabId = searchParams.get('tab') === 'destinations' ? 'destinations' : 'timeline'
  const [timeline, setTimeline] = useState<BackupTimelineEntry[]>([])
  const [targets, setTargets] = useState<BackupTarget[]>([])
  const [fleet, setFleet] = useState<FleetBackupOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [targetName, setTargetName] = useState('nfs-primary')
  const [targetKind, setTargetKind] = useState('nfs')
  const [backupVmId, setBackupVmId] = useState('')
  const [backupTargetId, setBackupTargetId] = useState('')
  const [backupType, setBackupType] = useState<'full' | 'incremental'>('full')

  const load = useCallback(async () => {
    setError(null)
    try {
      const [t, f, tg] = await Promise.all([listBackupTimeline(), getFleetBackups(), listBackupTargets()])
      setTimeline(t)
      setFleet(f)
      setTargets(tg)
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const grouped = useMemo(() => {
    const map = new Map<string, BackupTimelineEntry[]>()
    for (const e of timeline) {
      const key = dayLabel(e.created_at)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return [...map.entries()]
  }, [timeline])

  const restore = async (entry: BackupTimelineEntry) => {
    if (entry.kind !== 'backup' || entry.status !== 'completed') return
    setRestoring(entry.id)
    try {
      await restoreVmBackup(entry.vm_id, entry.id)
      toast.success(`Restore queued for ${entry.vm_name}`)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setRestoring(null)
    }
  }

  const addTarget = async () => {
    try {
      await createBackupTarget({ name: targetName, kind: targetKind })
      toast.success('Backup destination added')
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  const queueBackup = async () => {
    if (!backupVmId.trim()) return
    try {
      await createVmBackupWithTarget(backupVmId.trim(), {
        target_id: backupTargetId || undefined,
        backup_type: backupType,
      })
      toast.success('Backup queued')
      setBackupVmId('')
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  return (
    <PlatformStandardView
      className="space-y-6 max-w-3xl"
      title="Time Machine"
      description="Fleet backup timeline, S3/MinIO destinations, and scheduled snapshots."
      icon={Archive}
      loading={loading}
      error={error}
      stats={
        fleet
          ? [
              { label: 'Today', value: String(fleet.backups_completed_24h), tone: 'emerald' },
              { label: 'Failed 24h', value: String(fleet.backups_failed_24h), tone: fleet.backups_failed_24h ? 'amber' : 'sky' },
              { label: 'Snapshots', value: String(fleet.snapshots_total), tone: 'violet' },
              { label: 'Destinations', value: String(targets.length), tone: 'sky' },
            ]
          : undefined
      }
    >
      <p className="text-xs text-slate-500 flex flex-wrap gap-3">
        <Link to="/platform/fleet-snapshots" className={`inline-flex items-center gap-1 ${hubLinkClasses()}`}>
          <Camera className="w-3.5 h-3.5" /> Fleet snapshot schedules
        </Link>
      </p>
      <div role="tablist" className="flex flex-wrap gap-2 border-b border-white/[0.06] pb-1">
        {([
          ['timeline', 'Timeline', Archive],
          ['destinations', 'Destinations', Database],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setSearchParams(id === 'timeline' ? {} : { tab: id })}
            className={`px-4 py-2 text-sm rounded-t-lg flex items-center gap-2 transition ${
              tab === id ? 'bg-slate-800/80 text-orange-300 border-b-2 border-orange-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'destinations' && (
        <div className="space-y-4">
          <MacGlassPanel title="Backup destinations" subtitle="Register NFS, S3, or local targets for fleet backups.">
            <div className="grid gap-3 md:grid-cols-3 mb-4">
              <input className="input text-sm" placeholder="Name" value={targetName} onChange={(e) => setTargetName(e.target.value)} />
              <select className="input text-sm" aria-label="Destination type" value={targetKind} onChange={(e) => setTargetKind(e.target.value)}>
                <option value="nfs">nfs</option>
                <option value="s3">s3</option>
                <option value="local">local</option>
              </select>
              <button type="button" className="tahoe-btn-primary text-sm" onClick={() => void addTarget()}>Add destination</button>
            </div>
            <ul className="divide-y divide-white/[0.04]">
              {targets.map((t) => (
                <li key={t.id} className="py-2 flex justify-between gap-2 text-sm">
                  <span className="text-slate-200">{t.name}</span>
                  <span className="text-slate-500 uppercase text-xs">{t.kind}</span>
                </li>
              ))}
              {targets.length === 0 && <li className="text-sm text-slate-500 py-2">No destinations — add one above.</li>}
            </ul>
          </MacGlassPanel>
          <MacGlassPanel title="Queue VM backup" subtitle="Full qcow2 or incremental (chains prior completed backup on host).">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <input className="input text-sm" placeholder="VM id" value={backupVmId} onChange={(e) => setBackupVmId(e.target.value)} />
              <select className="input text-sm" aria-label="Backup type" value={backupType} onChange={(e) => setBackupType(e.target.value as 'full' | 'incremental')}>
                <option value="full">Full backup</option>
                <option value="incremental">Incremental</option>
              </select>
              <select className="input text-sm" aria-label="Backup destination" value={backupTargetId} onChange={(e) => setBackupTargetId(e.target.value)}>
                <option value="">Default target</option>
                {targets.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.kind})</option>)}
              </select>
              <button type="button" className="btn-secondary text-sm" onClick={() => void queueBackup()}>Queue backup</button>
            </div>
          </MacGlassPanel>
        </div>
      )}

      {tab === 'timeline' && (
        <>
          <p className="text-sm text-slate-500">
            Need per-VM legacy jobs? <Link to="/backups" className={hubLinkClasses()}>Open classic backups UI →</Link>
          </p>
          {fleet?.summary ? <p className="text-sm text-slate-400">{fleet.summary}</p> : null}
          <div className="space-y-6">
            {grouped.length === 0 && !error && (
              <PlatformEmptyState icon={Archive} title="No backup events yet" subtitle="Create backups from VM detail pages or run fleet backup jobs.">
                <Link to="/platform/vms" className="tahoe-btn-ghost text-sm">Browse VMs</Link>
              </PlatformEmptyState>
            )}
            {grouped.map(([day, entries]) => (
              <section key={day}>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">{day}</h2>
                <div className="relative pl-4 border-l border-slate-700/60 space-y-3">
                  {entries.map((e) => (
                    <article key={`${e.kind}-${e.id}`} className="relative tahoe-glass-card p-4 flex gap-4">
                      <span className="absolute -left-[1.35rem] top-5 w-2.5 h-2.5 rounded-full bg-slate-600 border-2 border-slate-900" />
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${e.status === 'completed' ? statusBadgeClasses('ok') : 'bg-slate-800 text-slate-400'}`}>
                        <Archive className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {new Date(e.created_at).toLocaleTimeString()}
                          <span className="text-slate-600">· {e.kind}</span>
                        </p>
                        <p className="text-sm font-medium text-slate-200 mt-0.5">{e.label}</p>
                        <Link to={`/platform/vms/${e.vm_id}`} className={`text-xs hover:underline ${hubLinkClasses()}`}>{e.vm_name}</Link>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {e.kind === 'backup' && e.status === 'completed' && (
                          <button type="button" className="tahoe-btn-primary text-xs flex items-center gap-1" disabled={restoring === e.id} onClick={() => void restore(e)}>
                            <RotateCcw className="w-3 h-3" /> {restoring === e.id ? 'Queuing…' : 'Restore'}
                          </button>
                        )}
                        {e.kind === 'snapshot' && (
                          <Link to={`/platform/vms/${e.vm_id}`} className="tahoe-btn-ghost text-xs text-center">Snapshots</Link>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
      <MacGlassPanel title="Per-VM backups" subtitle="Full backup history and restore live on each VM detail page.">
        <Link to="/platform/vms" className={`text-sm hover:underline ${hubLinkClasses()}`}>Browse VMs →</Link>
      </MacGlassPanel>
    </PlatformStandardView>
  )
}
