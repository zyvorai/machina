// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Activity, Gauge, Timer } from 'lucide-react'
import { MacGlassPanel, MacStatWidget } from '../../components/platform/mac/PlatformMacUi'
import DetailTabs from '../../components/platform/DetailTabs'
import OperatingSurfaceLayout from '../../components/platform/OperatingSurfaceLayout'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { usePlatformTabState } from '../../hooks/usePlatformTabState'
import {
  getObservabilityOverview,
  listApiTraces,
  type ApiTraceSpan,
  type ObservabilityOverview,
  type SloStatusItem,
} from '../../api/platform'
import { fleetPrometheusAggregateUrl } from '../../api/fleet'
import { getControllerBase } from '../../api/platform'
import { formatUserError } from '../../utils/apiError'
import {hostStateTone, httpStatusTone, migrationReadinessTone, riskTone, statusBadgeClasses, statusBgClass, statusPillClasses, statusToneClass, taskStatusTone, webhookDeliveryTone, hubLinkClasses} from '../../utils/semanticColors'

function sloTone(status: string): 'ok' | 'warn' | 'error' {
  if (status === 'ok') return 'ok'
  if (status === 'warn') return 'warn'
  return 'error'
}

function SloRow({ slo }: { slo: SloStatusItem }) {
  const pct = Math.min(100, Math.max(0, slo.current_pct))
  return (
    <li className="rounded-xl border border-white/[0.06] bg-slate-900/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div>
          <p className="font-medium text-slate-200">{slo.name}</p>
          <p className="text-xs text-slate-500">{slo.target}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded ${statusBadgeClasses(sloTone(slo.status))}`}>{slo.status}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
        <span>{pct.toFixed(2)}%</span>
        <span className="text-slate-600">/</span>
        <span>{slo.objective_pct ?? 100}% objective</span>
        <span className="text-slate-600">·</span>
        <span>burn {(slo.burn_rate ?? 0).toFixed(3)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div
          role="progressbar"
          aria-label="SLO achievement"
          aria-valuenow={Math.round(Math.min(100, Math.max(0, pct)))}
          aria-valuemin={0}
          aria-valuemax={100}
          className={`h-full rounded-full ${statusBgClass(sloTone(slo.status))}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-slate-500 mt-2">{slo.description}</p>
    </li>
  )
}

export default function PlatformObservability() {
  const OBS_TABS = [
    { id: 'slos' as const, label: 'SLOs' },
    { id: 'traces' as const, label: 'Traces' },
    { id: 'metrics' as const, label: 'Metrics' },
  ]
  const [lens, setLens] = usePlatformTabState(OBS_TABS.map((t) => t.id), { defaultTab: 'slos', paramKey: 'lens' })
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<ObservabilityOverview | null>(null)
  const [traces, setTraces] = useState<ApiTraceSpan[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [o, t] = await Promise.all([getObservabilityOverview(), listApiTraces(50)])
      setOverview(o)
      setTraces(t)
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load()}
      loading={loading && !overview && !error}
      prepend={<PlatformBackLink to="/platform/operations" label="Operations" />}
      title="Observability"
      subtitle="SLO dashboards and API trace inventory."
      icon={<Gauge className="w-6 h-6 text-slate-400" />}
      actions={<PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      {overview && (
        <OperatingSurfaceLayout testId="platform-observability-page">
          <p className="text-sm text-slate-400">{overview.summary}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <MacStatWidget label="SLO policies" value={String((overview.slos ?? []).length)} icon={<Gauge className="w-4 h-4" />} />
            <MacStatWidget label="Traces (1h)" value={String(overview.trace_count_1h)} icon={<Activity className="w-4 h-4" />} />
            <MacStatWidget label="p95 latency" value={`${overview.p95_latency_ms} ms`} icon={<Timer className="w-4 h-4" />} />
          </div>
          <DetailTabs primary={OBS_TABS} active={lens} onChange={setLens} />

          {lens === 'slos' && (
            (overview.slos ?? []).length === 0 ? (
              <PlatformEmptyState
                icon={Gauge}
                title="No SLO policies configured"
                subtitle="Define service level objectives in controller settings to track burn rate."
              />
            ) : (
              <MacGlassPanel title="SLO dashboard" action={
                <button type="button" className={`text-xs ${hubLinkClasses()}`} onClick={() => void load()}>Refresh</button>
              }>
                <ul className="space-y-3">
                  {(overview.slos ?? []).map((slo) => (
                    <SloRow key={slo.name} slo={slo} />
                  ))}
                </ul>
              </MacGlassPanel>
            )
          )}

          {lens === 'traces' && (
            traces.length === 0 ? (
              <PlatformEmptyState
                icon={Activity}
                title="No API traces recorded"
                subtitle="Browse the platform to populate trace spans in the last hour."
              />
            ) : (
              <MacGlassPanel title="Recent API traces">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left" aria-label="Recent API traces">
                    <thead className="text-xs text-slate-500 border-b border-slate-700">
                      <tr>
                        <th className="py-2 pr-4">Time</th>
                        <th className="py-2 pr-4">Method</th>
                        <th className="py-2 pr-4">Path</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traces.map((t) => (
                        <tr key={t.id} className="border-b border-slate-800/60">
                          <td className="py-2 pr-4 text-slate-500 text-xs whitespace-nowrap">{t.recorded_at}</td>
                          <td className="py-2 pr-4 text-slate-300 font-mono text-xs">{t.method}</td>
                          <td className="py-2 pr-4 text-slate-400 font-mono text-xs max-w-md truncate">{t.path}</td>
                          <td className={`py-2 pr-4 text-xs ${statusToneClass(httpStatusTone(t.status_code))}`}>
                            {t.status_code}
                          </td>
                          <td className="py-2 text-slate-400 text-xs">{t.duration_ms} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </MacGlassPanel>
            )
          )}

          {lens === 'metrics' && (
            <MacGlassPanel title="Fleet Prometheus" subtitle="Scrape aggregate metrics from the controller">
              <p className="text-sm text-slate-400 mb-2">Text exposition format — suitable for Prometheus or Grafana data source.</p>
              <div className="flex flex-wrap gap-3">
                <a href={fleetPrometheusAggregateUrl()} className={`text-sm ${hubLinkClasses()}`} target="_blank" rel="noreferrer">
                  Fleet aggregate →
                </a>
                <a href={`${getControllerBase()}/api/v1/metrics/prometheus`} className={`text-sm ${hubLinkClasses()}`} target="_blank" rel="noreferrer">
                  Controller /metrics/prometheus →
                </a>
              </div>
            </MacGlassPanel>
          )}
        </OperatingSurfaceLayout>
      )}
    </PlatformPageChrome>
  )
}
