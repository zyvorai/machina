// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, ArrowRightLeft, Boxes, Server, X } from 'lucide-react'
import {
  getClusterSummary,
  getFleetMission,
  listNotifications,
  listPlatformHosts,
  listPlatformTasks,
  listPlatformVms,
  type ClusterSummary,
  type FleetMissionOverview,
  type PlatformHost,
  type PlatformTask,
  type PlatformVm,
} from '../../api/platform'
import { getAiCapacity, getAiCompliance, getAiCost, getSreForecast, getZeusSummary, type CapacityPlan, type ComplianceReport, type CostAnalysis, type SreForecast } from '../../api/ai'
import MachinaEnvironmentPlanner from '../ai/MachinaEnvironmentPlanner'
import MachinaInfrastructureTimeline from '../ai/MachinaInfrastructureTimeline'
import MachinaMissionStack from '../ai/MachinaMissionStack'
import InfrastructureDnaStrip from './InfrastructureDnaStrip'
import InfrastructureEarthView from './InfrastructureEarthView'
import MissionControlDesktopZones from './mac/MissionControlDesktopZones'
import { MacSectionTitle } from './mac/PlatformMacUi'
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut'
import { formatUserError } from '../../utils/apiError'
import { hostStateTone, statusActionLinkClasses, statusChipClasses, statusToneClass } from '../../utils/semanticColors'
import { useFleetDesktop } from '../../hooks/useFleetDesktop'
import { useMissionControl } from './mac/MissionControlContext'
import { loadPlatformDesktopTabs } from '../../utils/platformDesktopTabs'
import { usePlatformDesktopTier } from '../../hooks/usePlatformDesktopTier'
import { operationsHubHref, tasksHubHref } from '../../utils/platformHubLinks'

export default function MissionControlOverlay() {
  const { open, closeMissionControl } = useMissionControl()
  const [hosts, setHosts] = useState<PlatformHost[]>([])
  const [vms, setVms] = useState<PlatformVm[]>([])
  const [tasks, setTasks] = useState<PlatformTask[]>([])
  const [cluster, setCluster] = useState<ClusterSummary | null>(null)
  const [mission, setMission] = useState<FleetMissionOverview | null>(null)
  const [alerts, setAlerts] = useState<Array<{ id: string; kind: string; created_at: string }>>([])
  const [aiCost, setAiCost] = useState<CostAnalysis | null>(null)
  const [aiCap, setAiCap] = useState<CapacityPlan | null>(null)
  const [aiComp, setAiComp] = useState<ComplianceReport | null>(null)
  const [sreForecasts, setSreForecasts] = useState<SreForecast[]>([])
  const [zeusStatus, setZeusStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { desktop, linuxHealth } = useFleetDesktop(open, 120_000)
  const [tier] = usePlatformDesktopTier()

  const load = useCallback(async () => {
    setError(null)
    try {
      const [h, v, t, c, m, n, cost, cap, comp, sre, zeus] = await Promise.all([
        listPlatformHosts().catch(() => []),
        listPlatformVms().catch(() => []),
        listPlatformTasks().catch(() => []),
        getClusterSummary().catch(() => null),
        getFleetMission().catch(() => null),
        listNotifications(true).catch(() => []),
        getAiCost().catch(() => null),
        getAiCapacity().catch(() => null),
        getAiCompliance().catch(() => null),
        getSreForecast().catch(() => ({ forecasts: [] })),
        getZeusSummary().catch(() => null),
      ])
      setHosts(h)
      setVms(v)
      setTasks(t)
      setCluster(c)
      setMission(m)
      setAlerts(n)
      setAiCost(cost)
      setAiCap(cap)
      setAiComp(comp)
      setSreForecasts(sre.forecasts ?? [])
      setZeusStatus(zeus ? `${zeus.status} · ${zeus.highlights?.[0] ?? zeus.tagline}` : null)
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  useKeyboardShortcut({
    key: 'Escape',
    handler: () => { if (open) closeMissionControl() },
    enabled: open,
  })

  if (!open) return null

  const failedTasks = tasks.filter((t) => t.status === 'failed')
  const migrations = tasks.filter((t) => t.operation.includes('migrate'))
  const openWindows = loadPlatformDesktopTabs().filter((t) => t.path !== '/platform')

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-950/95 backdrop-blur-xl overflow-y-auto animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Mission Control"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close Mission Control"
        onClick={closeMissionControl}
      />
      <div className="relative z-[1] min-h-full">
        <header className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-slate-950/90">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Mission Control</h1>
            <p className="text-sm text-slate-500">
              Infrastructure Earth · {cluster?.name || 'Cluster'} · {hosts.length} hosts · {vms.length} VMs
            </p>
          </div>
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={closeMissionControl}>
            <X className="w-4 h-4" /> Close
          </button>
        </header>

        {error && <p className={`px-6 py-2 text-sm ${statusToneClass('error')}`}>{error}</p>}

        <div className="px-6 py-2">
          <InfrastructureDnaStrip compact />
        </div>

        {openWindows.length > 0 && (
          <div className="px-6 py-3 border-b border-white/[0.06]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35 mb-2">Open windows</p>
            <div className="flex flex-wrap gap-2">
              {openWindows.map((tab) => (
                <Link
                  key={tab.path}
                  to={tab.path}
                  className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs text-white/70 hover:text-white hover:bg-white/[0.08] transition"
                  onClick={closeMissionControl}
                >
                  {tab.label}
                </Link>
              ))}
            </div>
          </div>
        )}

        {(aiCost || aiCap || aiComp) && (
          <div className="px-6 pb-2 flex flex-wrap gap-3 text-xs">
            {aiCost && (
              <Link to="/platform/reports" className={statusChipClasses('ok')} onClick={closeMissionControl}>
                Cost ${aiCost.estimated_monthly_usd.toFixed(0)}/mo · {aiCost.idle_vm_count} idle
              </Link>
            )}
            {aiCap && (
              <Link to="/platform/reports" className={statusChipClasses('info')} onClick={closeMissionControl}>
                Capacity {aiCap.memory_headroom_mib} MiB headroom
              </Link>
            )}
            {aiComp && (
              <Link to="/platform/reports" className={statusChipClasses('warn')} onClick={closeMissionControl}>
                Compliance {aiComp.score}/100 (Grade {aiComp.grade})
              </Link>
            )}
          </div>
        )}

        {sreForecasts.length > 0 && (
          <div className="px-6 pb-2 flex flex-wrap gap-2 text-xs">
            {sreForecasts.slice(0, 4).map((f) => (
              <span
                key={`${f.vm_id}-${f.resource}`}
                className={statusChipClasses(f.severity === 'critical' ? 'error' : 'warn')}
              >
                AI SRE: {f.message}
              </span>
            ))}
          </div>
        )}

        {zeusStatus && (
          <div className="px-6 pb-2">
            <Link to="/platform/zeus" className="text-xs text-orange-300/90 hover:underline" onClick={closeMissionControl}>{zeusStatus}</Link>
          </div>
        )}

        {desktop && (
          <div className="px-6 pb-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-white/[0.08] bg-slate-900/60 px-3 py-1 text-slate-300">{desktop.summary}</span>
            {(linuxHealth?.pressure_hosts ?? desktop.pressure_hosts) > 0 && (
              <Link to="/platform/hosts" className={statusChipClasses('warn')} onClick={closeMissionControl}>
                {linuxHealth?.summary ?? desktop.linux_summary}
              </Link>
            )}
          </div>
        )}

        <div className="px-6 py-2">
          <MissionControlDesktopZones onNavigate={closeMissionControl} />
        </div>

        <div className="px-6 pt-2 pb-1">
          <MacSectionTitle title="Live fleet" subtitle="Infrastructure Earth, AI planners, and inventory" />
        </div>

        <div className="px-6 py-4">
          <InfrastructureEarthView mission={mission} />
        </div>

        <div className="px-6 pb-4 space-y-4">
          <MachinaEnvironmentPlanner />
          <MachinaMissionStack />
          <MachinaInfrastructureTimeline hours={4} />
        </div>

        <div className="p-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
          <section className="rounded-2xl border border-white/[0.06] bg-slate-900/50 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-400 flex items-center gap-2"><Server className="w-4 h-4" /> Hosts</h2>
            <ul className="space-y-2 text-sm max-h-64 overflow-y-auto">
              {hosts.map((h) => (
                <li key={h.id}>
                  <Link to={`/platform/hosts/${h.id}`} className={`flex justify-between ${statusActionLinkClasses('info', 'hover:opacity-90')}`} onClick={closeMissionControl}>
                    <span>{h.hostname}</span>
                    <span className={statusToneClass(hostStateTone(h.state))}>{h.state}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-2xl border border-white/[0.06] bg-slate-900/50 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-400 flex items-center gap-2"><Boxes className="w-4 h-4" /> Virtual machines</h2>
            <ul className="space-y-2 text-sm max-h-64 overflow-y-auto">
              {vms.slice(0, 24).map((v) => (
                <li key={v.id}>
                  <Link to={`/platform/vms/${v.id}`} className={`flex justify-between ${statusActionLinkClasses('info', 'hover:opacity-90')}`} onClick={closeMissionControl}>
                    <span className="truncate">{v.name}</span>
                    <span className="text-slate-500 shrink-0 ml-2">{v.observed_state}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-2xl border border-white/[0.06] bg-slate-900/50 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Alerts</h2>
            {alerts.length === 0 ? (
              <p className="text-sm text-slate-500">No unread alerts</p>
            ) : (
              <ul className="space-y-2 text-sm max-h-64 overflow-y-auto">
                {alerts.map((a) => (
                  <li key={a.id} className={statusToneClass('warn')}>{a.kind}</li>
                ))}
              </ul>
            )}
            <Link to={operationsHubHref(tier)} className={`text-xs ${statusActionLinkClasses('info')}`} onClick={closeMissionControl}>Open Operations hub →</Link>
          </section>
          <section className="rounded-2xl border border-white/[0.06] bg-slate-900/50 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-400 flex items-center gap-2"><ArrowRightLeft className="w-4 h-4" /> Migrations & tasks</h2>
            <p className="text-xs text-slate-500">{migrations.length} migration tasks · {failedTasks.length} failed</p>
            <ul className="space-y-2 text-sm max-h-48 overflow-y-auto">
              {failedTasks.slice(0, 8).map((t) => (
                <li key={t.id} className={`truncate ${statusToneClass('error')} opacity-90`}>{t.operation} — {t.status}</li>
              ))}
            </ul>
            <Link to={tasksHubHref(tier)} className={`text-xs ${statusActionLinkClasses('info')}`} onClick={closeMissionControl}>View all tasks →</Link>
          </section>
        </div>
      </div>
    </div>
  )
}
