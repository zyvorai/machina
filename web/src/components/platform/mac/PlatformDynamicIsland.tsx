// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Sparkles } from 'lucide-react'
import { useFleetDesktop } from '../../../hooks/useFleetDesktop'
import { usePlatformDesktopTier } from '../../../hooks/usePlatformDesktopTier'
import { activityHubHref, operationsHubHref } from '../../../utils/platformHubLinks'
import { getSreForecast, getZeusApprovalHub, getPredictions, type SreForecast, type Prediction } from '../../../api/ai'
import { getFleetUpdates } from '../../../api/platform'
import { useAi } from '../../../contexts/AiContext'
import { hubLinkClasses, statusBgClass, statusSurfaceClasses, statusToneClass } from '../../../utils/semanticColors'

function islandTone(state: 'ok' | 'warn' | 'notify' | 'alert' | 'zeus'): 'ok' | 'warn' | 'error' | 'info' {
  if (state === 'ok') return 'ok'
  if (state === 'notify' || state === 'zeus') return 'info'
  if (state === 'warn') return 'warn'
  return 'error'
}

export default function PlatformDynamicIsland() {
  const { desktop, linuxHealth } = useFleetDesktop()
  const [tier] = usePlatformDesktopTier()
  const { openCopilot } = useAi()
  const [expanded, setExpanded] = useState(false)
  const [forecasts, setForecasts] = useState<SreForecast[]>([])
  const [topPrediction, setTopPrediction] = useState<Prediction | null>(null)
  const [zeusPending, setZeusPending] = useState(0)
  const [rebootRequiredHosts, setRebootRequiredHosts] = useState(0)

  useEffect(() => {
    void getSreForecast()
      .then((r) => setForecasts(r.forecasts ?? []))
      .catch(() => setForecasts([]))
    void getPredictions()
      .then((r) => setTopPrediction(r.predictions[0] ?? null))
      .catch(() => setTopPrediction(null))
  }, [])

  useEffect(() => {
    void getZeusApprovalHub()
      .then((h) => setZeusPending(Number(h.total_pending ?? 0)))
      .catch(() => setZeusPending(0))
  }, [])

  useEffect(() => {
    void getFleetUpdates()
      .then((u) => setRebootRequiredHosts(u.hosts_reboot_required ?? 0))
      .catch(() => setRebootRequiredHosts(0))
  }, [])

  const pressure = linuxHealth?.pressure_hosts ?? desktop?.pressure_hosts ?? 0
  const criticalForecast = forecasts.find((f) => f.severity === 'critical')
  const failedTasks = desktop?.failed_tasks_24h ?? 0
  const actionableIssues = (desktop?.slo_breach_count ?? 0) + pressure + rebootRequiredHosts
  const alertBacklog = desktop?.unread_notifications ?? 0

  const state = useMemo(() => {
    if (zeusPending > 0) return 'zeus' as const
    if (pressure > 0 || criticalForecast) return 'alert' as const
    if (actionableIssues > 0 || failedTasks > 0) return 'warn' as const
    if (alertBacklog > 0) return 'notify' as const
    return 'ok' as const
  }, [zeusPending, pressure, criticalForecast, actionableIssues, failedTasks, alertBacklog])

  const tone = islandTone(state)

  const formatCount = (n: number) => (n > 999 ? '999+' : String(n))

  const label = state === 'zeus'
    ? `Zeus · ${formatCount(zeusPending)} pending approval${zeusPending === 1 ? '' : 's'}`
    : state === 'ok'
      ? `Healthy · ${desktop?.hosts_online ?? 0}/${desktop?.hosts_total ?? 0} hosts`
      : state === 'warn'
        ? failedTasks > 0 && actionableIssues === 0
          ? `${formatCount(failedTasks)} failed task${failedTasks === 1 ? '' : 's'}`
          : `${formatCount(actionableIssues + (failedTasks > 0 ? 1 : 0))} issue${actionableIssues + (failedTasks > 0 ? 1 : 0) === 1 ? '' : 's'}`
        : state === 'notify'
          ? `${formatCount(alertBacklog)} alert${alertBacklog === 1 ? '' : 's'}`
          : pressure > 0
            ? `${pressure} host(s) under pressure`
            : 'Critical alert'

  return (
    <div className="relative pointer-events-auto">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`mac-dynamic-island inline-flex items-center gap-2 rounded-full border px-4 py-1 text-xs font-medium transition-all ${statusSurfaceClasses(tone)}`}
        aria-expanded={expanded}
      >
        <span className={`h-2 w-2 rounded-full ${statusBgClass(tone)}${tone === 'error' ? ' animate-pulse' : ''}`} />
        {label}
      </button>
      {expanded && (
        <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 w-[min(100vw-2rem,22rem)] rounded-2xl border border-white/[0.1] bg-slate-900/95 backdrop-blur-xl p-4 shadow-2xl z-50 text-left">
          <p className="text-xs font-semibold text-slate-300 mb-2">Infrastructure status</p>
          {desktop && <p className="text-xs text-slate-400 mb-3">{desktop.summary}</p>}
          {zeusPending > 0 && (
            <div className={`rounded-lg p-3 mb-3 text-xs ${statusSurfaceClasses('info')}`}>
              <p className="font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-orange-400" />
                {formatCount(zeusPending)} Zeus approval{zeusPending === 1 ? '' : 's'} pending
              </p>
              <button type="button" className={`mt-2 ${hubLinkClasses('hover:underline')}`} onClick={() => { openCopilot(); setExpanded(false) }}>
                Open Zeus
              </button>
            </div>
          )}
          {alertBacklog > 0 && (
            <p className={`text-xs mb-2 ${statusToneClass('info')} opacity-90`}>
              {alertBacklog.toLocaleString()} unread notification{alertBacklog === 1 ? '' : 's'} in backlog
            </p>
          )}
          {failedTasks > 0 && (
            <p className={`text-xs mb-2 ${statusToneClass('warn')} opacity-90`}>
              {formatCount(failedTasks)} failed task{failedTasks === 1 ? '' : 's'} in the last 24 hours —{' '}
              <Link to={operationsHubHref(tier)} className={hubLinkClasses('hover:underline')} onClick={() => setExpanded(false)}>Operations hub</Link>
            </p>
          )}
          {rebootRequiredHosts > 0 && (
            <p className={`text-xs mb-2 ${statusToneClass('warn')} opacity-90`}>
              {rebootRequiredHosts} host{rebootRequiredHosts === 1 ? '' : 's'} need reboot after OS patches —{' '}
              <Link to="/platform/maintenance?tab=updates" className={hubLinkClasses('hover:underline')} onClick={() => setExpanded(false)}>Maintenance</Link>
            </p>
          )}
          {actionableIssues > 0 && (
            <p className={`text-xs mb-2 ${statusToneClass('warn')} opacity-90`}>
              {actionableIssues} open issue{actionableIssues === 1 ? '' : 's'} (SLO breaches, host pressure, reboots)
            </p>
          )}
          {topPrediction && !criticalForecast && (
            <div className={`rounded-lg p-3 mb-3 text-xs ${statusSurfaceClasses('warn')}`}>
              <p className="font-medium">Predicted failure</p>
              <p className="mt-1 opacity-90">{topPrediction.message}</p>
              <Link to="/platform/zeus" className={`mt-2 inline-block ${hubLinkClasses('hover:underline')}`} onClick={() => setExpanded(false)}>Zeus predictions →</Link>
            </div>
          )}
          {criticalForecast ? (
            <div className={`rounded-lg p-3 mb-3 text-xs ${statusSurfaceClasses('error')}`}>
              <p className="font-medium">Action suggested</p>
              <p className="mt-1 opacity-90">{criticalForecast.message}</p>
            </div>
          ) : pressure > 0 ? (
            <div className={`rounded-lg p-3 mb-3 text-xs ${statusSurfaceClasses('warn')}`}>
              <p>{linuxHealth?.summary ?? desktop?.linux_summary ?? 'Hosts under resource pressure'}</p>
            </div>
          ) : zeusPending === 0 ? (
            <p className={`text-xs mb-3 ${statusToneClass('ok')} opacity-90`}>All monitored systems nominal.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Link to="/platform/hosts" className={hubLinkClasses('text-xs hover:underline')} onClick={() => setExpanded(false)}>Hosts</Link>
            <Link to={operationsHubHref(tier)} className={hubLinkClasses('text-xs hover:underline')} onClick={() => setExpanded(false)}>Operations</Link>
            <Link to={activityHubHref(tier)} className={hubLinkClasses('text-xs hover:underline')} onClick={() => setExpanded(false)}>Activity</Link>
            <button type="button" className={hubLinkClasses('text-xs hover:underline')} onClick={() => { openCopilot(); setExpanded(false) }}>Zeus</button>
          </div>
        </div>
      )}
    </div>
  )
}
