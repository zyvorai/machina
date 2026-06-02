// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Activity, RefreshCw } from 'lucide-react'
import PageLayout from '../../components/PageLayout'
import { MacSectionTitle } from '../../components/platform/mac/PlatformMacUi'
import {
  getClusterSettings,
  getHaStatus,
  getPlacementRecommendations,
  listFenceEvents,
  listMigrationJobs,
  patchClusterSettings,
  refreshPlacement,
  type ClusterSettings,
  type FenceEvent,
  type HaStatusResponse,
  type MigrationJob,
  type PlacementRecommendation,
} from '../../api/platform'
import { formatUserError } from '../../utils/apiError'
import {statusToneClass, hubLinkClasses} from '../../utils/semanticColors'

export default function PlatformPlacement() {
  const [rows, setRows] = useState<PlacementRecommendation[]>([])
  const [ha, setHa] = useState<HaStatusResponse | null>(null)
  const [settings, setSettings] = useState<ClusterSettings | null>(null)
  const [migrations, setMigrations] = useState<MigrationJob[]>([])
  const [fences, setFences] = useState<FenceEvent[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [recs, haSt, cluster, mig, fence] = await Promise.all([
        getPlacementRecommendations(),
        getHaStatus(),
        getClusterSettings(),
        listMigrationJobs(),
        listFenceEvents(),
      ])
      setRows(recs)
      setHa(haSt)
      setSettings(cluster)
      setMigrations(mig)
      setFences(fence)
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  const toggleAutoMigrate = async () => {
    if (!settings) return
    try {
      const next = await patchClusterSettings({ drs_auto_migrate: !settings.drs_auto_migrate })
      setSettings(next)
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }

  const updateThreshold = async (v: number) => {
    if (!settings) return
    try {
      setSettings(await patchClusterSettings({ drs_cpu_threshold: v }))
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }

  const setPlacementPolicy = async (policy: string) => {
    if (!settings) return
    try {
      setSettings(await patchClusterSettings({ placement_policy: policy }))
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  return (
    <PageLayout hideHeader error={error}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <MacSectionTitle title="Placement & HA" subtitle="DRS-style recommendations and high-availability status" />
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-xs" onClick={async () => {
            try { setRows(await refreshPlacement()) } catch (e: unknown) { setError(formatUserError(e)) }
          }}>Recompute</button>
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void load()}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </header>
      {settings && (
        <section className="card p-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">DRS auto-migrate</h2>
            <p className="text-slate-400 text-sm mt-1">
              When enabled, the controller queues live migrations for overloaded hosts (CPU/memory &gt; {settings.drs_cpu_threshold}%).
            </p>
          </div>
          <button type="button" className={settings.drs_auto_migrate ? 'btn-primary' : 'btn-secondary'} onClick={() => void toggleAutoMigrate()}>
            {settings.drs_auto_migrate ? 'Enabled' : 'Disabled'}
          </button>
          <label className="text-sm w-full mt-3 block">
            CPU/memory threshold: {settings.drs_cpu_threshold}%
            <input type="range" min={50} max={95} value={settings.drs_cpu_threshold}
              onChange={(e) => void updateThreshold(Number(e.target.value))} className="w-full mt-1" />
          </label>
          <label className="text-sm w-full mt-3 block">
            Placement policy
            <select className="input mt-1 block w-48" value={settings.placement_policy}
              onChange={(e) => void setPlacementPolicy(e.target.value)}>
              <option value="balanced">Balanced</option>
              <option value="packed">Packed</option>
            </select>
          </label>
        </section>
      )}
      {ha && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="card p-4"><div className="text-slate-400 text-sm">HA-enabled VMs</div><div className="text-2xl font-semibold">{ha.status.enabled_vms}</div></div>
          <div className="card p-4"><div className="text-slate-400 text-sm">Offline hosts</div><div className={`text-2xl font-semibold ${statusToneClass('warn')}`}>{ha.status.offline_hosts}</div></div>
          <div className="card p-4"><div className="text-slate-400 text-sm">HA events (24h)</div><div className="text-2xl font-semibold">{ha.status.recent_events}</div></div>
        </div>
      )}
      <section className="card p-4">
        <h2 className="font-semibold mb-3">Placement recommendations</h2>
        {rows.length === 0 ? (
          <p className="text-slate-400 text-sm">No recommendations — cluster load is balanced.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {rows.map((r) => (
              <li key={`${r.vm_id}-${r.to_host_id}`} className="border-b border-slate-800 pb-3">
                <div className="flex justify-between gap-4">
                  <Link to={`/platform/vms/${r.vm_id}`} className={`$font-medium ${hubLinkClasses()}`}>{r.vm_name}</Link>
                  <span className="text-slate-500">score {r.score.toFixed(1)}</span>
                </div>
                <p className="text-slate-400 mt-1">{r.from_host_name} → {r.to_host_name}</p>
                <p className="text-slate-500 mt-1">{r.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {migrations.length > 0 && (
        <section className="card p-4">
          <h2 className="font-semibold mb-3">Recent migrations</h2>
          <ul className="space-y-2 text-sm text-slate-400">{migrations.slice(0, 10).map((m) => (
            <li key={m.id}>{m.status} · VM {m.vm_id.slice(0, 8)} · {m.progress}%</li>
          ))}</ul>
        </section>
      )}
      {fences.length > 0 && (
        <section className="card p-4">
          <h2 className="font-semibold mb-3">Fence events</h2>
          <ul className="space-y-2 text-sm text-slate-400">{fences.slice(0, 10).map((f) => (
            <li key={f.id} className={statusToneClass(f.success ? 'ok' : 'error')}>
              host {f.host_id.slice(0, 8)} — {f.message || f.action}
            </li>
          ))}</ul>
        </section>
      )}
      {ha && ha.events.length > 0 && (
        <section className="card p-4">
          <h2 className="font-semibold mb-3">Recent HA events</h2>
          <ul className="space-y-2 text-sm text-slate-400">
            {ha.events.slice(0, 15).map((e) => (
              <li key={e.id}><span className="text-slate-300">{e.action}</span> — {e.message}</li>
            ))}
          </ul>
        </section>
      )}
    </PageLayout>
  )
}
