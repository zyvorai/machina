// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, Radar, Shield, ShieldAlert } from 'lucide-react'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import {
  MacGlassPanel,
  MacStatWidget,
} from '../../components/platform/mac/PlatformMacUi'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import SecurityTimelinePanel from '../../components/platform/SecurityTimelinePanel'
import {
  getFleetSecurityTimeline,
  getFleetThreatSummary,
  getFabricHealth,
  getZeusSecurityGraph,
  getZeusSecuritySensors,
  getZeusSecurityStatus,
  nlSecuritySearch,
  syncSecurityAlerts,
  type FleetThreatSummary,
  type FabricHealth,
  type SecurityEvent,
  type SecurityGraph,
  type ZeusSecurityStatus,
} from '../../api/zeusSecurity'
import { formatUserError } from '../../utils/apiError'
import { riskTone, statusBadgeClasses, statusPillClasses, statusSurfaceClasses, statusToneClass, hubLinkClasses } from '../../utils/semanticColors'
import { useToastContext } from '../../contexts/ToastContext'

function threatPillTone(score: number): 'ok' | 'warn' | 'neutral' {
  if (score >= 80) return 'ok'
  if (score >= 50) return 'warn'
  return 'neutral'
}

function threatStatTone(score: number): 'ok' | 'warn' | 'default' {
  if (score >= 80) return 'ok'
  if (score >= 50) return 'warn'
  return 'default'
}

function SecurityGraphViz({ graph }: { graph: SecurityGraph | null }) {
  if (!graph?.nodes?.length) {
    return <p className="text-sm text-slate-500">Security graph will populate when hosts and users are enrolled.</p>
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {graph.nodes.slice(0, 12).map((n) => (
        <div
          key={n.id}
          className={`rounded-lg border px-3 py-2 text-sm ${
            n.risk === 'high'
              ? statusSurfaceClasses('error')
              : 'border-white/[0.08] bg-slate-900/40 text-slate-200'
          }`}
        >
          <p className="font-medium truncate">{n.label}</p>
          <p className="text-xs text-slate-500">{n.kind}{n.risk ? ` · ${n.risk} risk` : ''}</p>
        </div>
      ))}
    </div>
  )
}

export default function PlatformSecurityCenter() {
  const toast = useToastContext()
  const [status, setStatus] = useState<ZeusSecurityStatus | null>(null)
  const [threat, setThreat] = useState<FleetThreatSummary | null>(null)
  const [graph, setGraph] = useState<SecurityGraph | null>(null)
  const [sensorCount, setSensorCount] = useState(0)
  const [timeline, setTimeline] = useState<SecurityEvent[]>([])
  const [fabricHealth, setFabricHealth] = useState<FabricHealth | null>(null)
  const [nlQuery, setNlQuery] = useState('')
  const [nlResults, setNlResults] = useState<string | null>(null)
  const [nlLlm, setNlLlm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [st, th, gr, sensors, tl, health] = await Promise.all([
        getZeusSecurityStatus(),
        getFleetThreatSummary(),
        getZeusSecurityGraph(),
        getZeusSecuritySensors(),
        getFleetSecurityTimeline(24),
        getFabricHealth(),
      ])
      setStatus(st)
      setThreat(th)
      setGraph(gr)
      setSensorCount(sensors.sensors?.length ?? 0)
      setTimeline(tl.events ?? [])
      setFabricHealth(health)
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const runNlSearch = () => {
    if (!nlQuery.trim()) return
    void nlSecuritySearch(nlQuery.trim())
      .then((r) => {
        const hits = (r.results as { results?: unknown[] })?.results ?? []
        const count = r.hit_count ?? hits.length
        setNlResults(`${count} result(s) for "${r.search_query}"${r.llm_powered ? ' · AI translated' : ''}`)
        setNlLlm(Boolean(r.llm_powered))
      })
      .catch((e: unknown) => toast.error(formatUserError(e)))
  }

  const score = threat?.fleet_threat_score ?? 0
  const critical = threat?.critical_events ?? []

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load()}
      contentLoading={loading && !threat}
      prepend={<PlatformBackLink to="/platform/zeus" label="Machina Zeus OS" />}
      title="Security Center"
      subtitle={
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className={statusPillClasses(threatPillTone(score))}>Threat {Math.round(score)}</span>
          {status && (
            <span className={statusPillClasses(status.fabric_reachable ? 'ok' : 'warn')}>
              {status.fabric_reachable ? 'Fabric online' : 'Fabric unreachable'}
            </span>
          )}
          <span className="text-slate-400">PacketWolf eBPF · observe, understand, secure</span>
        </span>
      }
      icon={<Shield className="w-6 h-6 text-slate-400" />}
      actions={<PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >

      {status && !status.fabric_reachable && status.packetwolf.enabled && (
        <PlatformEmptyState
          title="PacketWolf fabric unreachable"
          subtitle={status.packetwolf.summary}
          action={
            <Link to="/platform/integrations" className="btn-primary text-sm">Wire in Integrations</Link>
          }
        />
      )}

      {status?.packetwolf?.storage?.clickhouse?.reachable && (
        <p className={`text-xs ${statusToneClass('ok')} opacity-90`}>ClickHouse hot storage connected</p>
      )}
      {status?.packetwolf?.storage?.opensearch?.reachable && (
        <p className={`text-xs ${statusToneClass('ok')} opacity-90`}>
          OpenSearch hunt index connected
          {status.packetwolf.storage.opensearch.document_count != null
            ? ` · ${status.packetwolf.storage.opensearch.document_count} documents`
            : ''}
        </p>
      )}

      {fabricHealth && (fabricHealth.issues?.length ?? 0) > 0 && (
        <MacGlassPanel title="Fabric health" subtitle={fabricHealth.summary ?? fabricHealth.status}>
          <ul className="text-sm text-slate-300 space-y-1">
            {fabricHealth.issues?.slice(0, 5).map((issue, i) => (
              <li key={i} className={statusToneClass('warn')}>
                {issue.summary}
                {issue.host_id ? (
                  <>
                    {' '}
                    <Link to={`/platform/zeus/machines/${issue.host_id}`} className={`text-xs ${hubLinkClasses()}`}>
                      {issue.host_id}
                    </Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </MacGlassPanel>
      )}

      {threat && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MacStatWidget
              label="Fleet threat score"
              value={String(Math.round(score))}
              icon={<Shield className="w-4 h-4" />}
              tone={threatStatTone(score)}
            />
            <MacStatWidget
              label="Critical events"
              value={String(critical.length)}
              icon={<ShieldAlert className="w-4 h-4" />}
              tone={critical.length > 0 ? 'warn' : 'ok'}
            />
            <MacStatWidget
              label="Tetragon sensors"
              value={String(sensorCount)}
              icon={<Radar className="w-4 h-4" />}
            />
            <MacStatWidget
              label="Firewall targets"
              value={String(threat.firewall_targets)}
              icon={<AlertTriangle className="w-4 h-4" />}
            />
          </div>

          <MacGlassPanel title="Critical" subtitle="Requires attention">
            {critical.length === 0 ? (
              <p className="text-sm text-slate-500">No critical security events in the current window.</p>
            ) : (
              <ul className="space-y-2">
                {critical.slice(0, 8).map((ev, i) => (
                  <li key={i} className={`text-sm flex items-start gap-2 ${statusToneClass('error')}`}>
                    <span className="shrink-0">•</span>
                    <span>
                      {String(ev.summary ?? ev.kind ?? 'event')}
                      {ev.host_id ? (
                        <>
                          {' '}
                          <Link to={`/platform/zeus/machines/${String(ev.host_id)}`} className={hubLinkClasses()}>
                            ({String(ev.host_id)})
                          </Link>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </MacGlassPanel>

          <MacGlassPanel title="Infrastructure security graph" subtitle={threat.security_graph_summary}>
            <SecurityGraphViz graph={graph} />
          </MacGlassPanel>

          <MacGlassPanel title="Security Copilot search" subtitle="Natural language event search">
            <div className="flex flex-wrap gap-2 mb-2">
              <input
                className="input text-sm flex-1 min-w-[14rem]"
                placeholder="Show every process that opened port 8080 last week"
                value={nlQuery}
                onChange={(e) => setNlQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runNlSearch()}
              />
              <button type="button" className="btn-secondary text-sm" onClick={runNlSearch}>Search</button>
            </div>
            {nlResults && (
              <p className="text-sm text-slate-400">
                {nlResults}
                {nlLlm ? <span className="text-violet-300/80 ml-1">· AI</span> : null}
              </p>
            )}
          </MacGlassPanel>

          <SecurityTimelinePanel events={timeline} />

          <div className="flex flex-wrap gap-2">
            <Link to="/platform/zeus/security/hunt" className="btn-secondary text-sm">Threat hunting workspace</Link>
            <Link to="/platform/zeus/security/enforcement" className="btn-secondary text-sm">Runtime enforcement</Link>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => void syncSecurityAlerts().then((r) => toast.success(r.summary)).catch((e: unknown) => toast.error(formatUserError(e)))}
            >
              Sync alerts to Notifications
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Link to="/platform/zeus/security/firewall" className="rounded-xl border border-white/[0.08] p-4 hover:border-blue-500/40 transition">
              <p className="font-semibold text-slate-100">Machine Security (Firewall)</p>
              <p className="text-xs text-slate-500 mt-1">Host firewall profiles, ports, lockdown</p>
            </Link>
            <Link to="/platform/zeus/security/activity" className="rounded-xl border border-white/[0.08] p-4 hover:border-blue-500/40 transition">
              <p className="font-semibold text-slate-100">Firewall Activity</p>
              <p className="text-xs text-slate-500 mt-1">Blocked and allowed connections</p>
            </Link>
            <Link to="/platform/zeus/security/ports" className="rounded-xl border border-white/[0.08] p-4 hover:border-blue-500/40 transition">
              <p className="font-semibold text-slate-100">Open Ports</p>
              <p className="text-xs text-slate-500 mt-1">Exposure scanner with process metadata</p>
            </Link>
          </div>

        </>
      )}
    </PlatformPageChrome>
  )
}
