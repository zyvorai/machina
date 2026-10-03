// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { Link } from 'react-router'
import { AlertTriangle, Radar, Shield, Activity, Search, Lock } from 'lucide-react'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { AppleDestinationList } from '../../components/platform/apple/AppleStoryKit'
import {
  MacGlassPanel,
} from '../../components/platform/mac/PlatformMacUi'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import SecurityTimelinePanel from '../../components/platform/SecurityTimelinePanel'
import {
  getFleetSecurityTimeline,
  getFleetSensors,
  getFleetThreatSummary,
  getFabricHealth,
  getZeusSecurityGraph,
  getZeusSecuritySensors,
  getZeusSecurityStatus,
  installFleetTetragon,
  nlSecuritySearch,
  syncSecurityAlerts,
  type FleetSensorRow,
  type FleetThreatSummary,
  type FabricHealth,
  type SecurityEvent,
  type SecurityGraph,
  type ZeusSecurityStatus,
} from '../../api/zeusSecurity'
import EbpfActionMenu from '../../components/platform/EbpfActionMenu'
import { formatUserError } from '../../utils/apiError'
import { riskTone, statusBadgeClasses, statusPillClasses, statusToneClass, hubLinkClasses } from '../../utils/semanticColors'
import { useToastContext } from '../../contexts/ToastContext'

function threatPillTone(score: number): 'ok' | 'warn' | 'neutral' {
  if (score >= 80) return 'ok'
  if (score >= 50) return 'warn'
  return 'neutral'
}

const SECURITY_DESTINATIONS = [
  { to: '/platform/zeus/security/firewall', title: 'Zeus Firewall', subtitle: 'Host firewall profiles, ports, lockdown', icon: <Shield className="w-5 h-5" /> },
  { to: '/platform/soc', title: 'SOC', subtitle: 'Security operations center and alert triage', icon: <Radar className="w-5 h-5" /> },
  { to: '/platform/zyra/security/hunt', title: 'Threat hunting', subtitle: 'Interactive hunt workspace', icon: <Search className="w-5 h-5" /> },
  { to: '/platform/zyra/security/enforcement', title: 'Runtime enforcement', subtitle: 'eBPF TracingPolicy and deny rules', icon: <Lock className="w-5 h-5" /> },
  { to: '/platform/zeus/security/activity', title: 'Firewall activity', subtitle: 'Blocked and allowed connections', icon: <Activity className="w-5 h-5" /> },
  { to: '/platform/zeus/security/ports', title: 'Open ports', subtitle: 'Exposure scanner with process metadata', icon: <AlertTriangle className="w-5 h-5" /> },
]

function SecurityGraphViz({ graph }: { graph: SecurityGraph | null }) {
  if (!graph?.nodes?.length) {
    return <p className="text-sm text-[var(--text-muted)]">Security graph will populate when hosts and users are enrolled.</p>
  }
  return (
    <ul className="divide-y divide-[var(--apple-hairline)]">
      {graph.nodes.slice(0, 12).map((n) => (
        <li
          key={n.id}
          className={`flex items-center justify-between gap-3 py-2.5 text-sm ${
            n.risk === 'high' ? statusToneClass('error') : 'text-[var(--text-primary)]'
          }`}
        >
          <div className="min-w-0">
            <p className="font-medium truncate">{n.label}</p>
            <p className="text-xs text-[var(--text-muted)]">{n.kind}{n.risk ? ` · ${n.risk} risk` : ''}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function PlatformSecurityCenter() {
  const toast = useToastContext()
  const [status, setStatus] = useState<ZeusSecurityStatus | null>(null)
  const [threat, setThreat] = useState<FleetThreatSummary | null>(null)
  const [graph, setGraph] = useState<SecurityGraph | null>(null)
  const [sensorCount, setSensorCount] = useState(0)
  const [sensorMatrix, setSensorMatrix] = useState<FleetSensorRow[]>([])
  const [sensorRegistry, setSensorRegistry] = useState<Array<Record<string, unknown>>>([])
  const [fleetEnrollBusy, setFleetEnrollBusy] = useState(false)
  const [confirmEnrollTetragon, setConfirmEnrollTetragon] = useState(false)
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
      const [st, th, gr, fleetSensors, sensorReg, tl, health] = await Promise.all([
        getZeusSecurityStatus(),
        getFleetThreatSummary(),
        getZeusSecurityGraph(),
        getFleetSensors(),
        getZeusSecuritySensors().catch(() => ({ sensors: [] as Array<Record<string, unknown>> })),
        getFleetSecurityTimeline(24),
        getFabricHealth(),
      ])
      setStatus(st)
      setThreat(th)
      setGraph(gr)
      setSensorCount(fleetSensors.sensors?.length ?? fleetSensors.matrix?.length ?? 0)
      setSensorMatrix(fleetSensors.matrix ?? [])
      setSensorRegistry(sensorReg.sensors ?? [])
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
  const unhealthySensors = sensorMatrix.filter((r) => r.tetragon_status !== 'healthy' && r.host_state === 'online')

  const enrollFleetTetragon = () => {
    setConfirmEnrollTetragon(true)
  }

  const doEnrollFleetTetragon = () => {
    setConfirmEnrollTetragon(false)
    setFleetEnrollBusy(true)
    void installFleetTetragon()
      .then((r) => toast.success(r.summary))
      .catch((e: unknown) => toast.error(formatUserError(e)))
      .finally(() => setFleetEnrollBusy(false))
  }

  return (
    <PlatformPageChrome
      eyebrow="Platform"
      error={error}
      onErrorRetry={() => void load()}
      contentLoading={loading && !threat}
      prepend={<PlatformBackLink to="/platform/zyra" label="Machina Zyra OS" />}
      title="Security Center"
      subtitle={
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className={statusPillClasses(threatPillTone(score))}>Threat {Math.round(score)}</span>
          {threat && (
            <span className="text-[var(--text-muted)]">
              {critical.length} critical · {sensorCount} sensors · {threat.firewall_targets} firewall targets
            </span>
          )}
          {status && (
            <span className={statusPillClasses(status.fabric_reachable ? 'ok' : 'warn')}>
              {status.fabric_reachable ? 'Fabric online' : 'Fabric unreachable'}
            </span>
          )}
          <span className="text-[var(--text-muted)]">PacketWolf eBPF · observe, understand, secure</span>
        </span>
      }
      icon={<Shield className="w-6 h-6 text-[var(--text-muted)]" />}
      actions={<PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >

      {status && !status.fabric_reachable && status.packetwolf.enabled && (
        <PlatformEmptyState
          title="PacketWolf fabric unreachable"
          subtitle={status.packetwolf.summary}
          action={
            <Link to="/platform/settings?section=integrations" className="btn-primary text-sm">Wire in Settings</Link>
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
          <ul className="text-sm text-[var(--text-secondary)] space-y-1">
            {fabricHealth.issues?.slice(0, 5).map((issue) => (
              <li key={`${String(issue.host_id ?? '')}-${issue.summary}`} className={statusToneClass('warn')}>
                {issue.summary}
                {issue.host_id ? (
                  <>
                    {' '}
                    <Link to={`/platform/zyra/machines/${issue.host_id}`} className={`text-xs ${hubLinkClasses()}`}>
                      {issue.host_id}
                    </Link>
                    {' · '}
                    <Link to="/platform/zyra/security/enforcement" className={`text-xs ${hubLinkClasses()}`}>
                      enforcement
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
          <AppleDestinationList items={SECURITY_DESTINATIONS} />

          <MacGlassPanel
            title="Tetragon sensor matrix"
            subtitle="Fleet enrollment status — PacketWolf sensors joined with controller hosts"
            action={
              unhealthySensors.length > 0 ? (
                <button type="button" className="btn-secondary text-xs" disabled={fleetEnrollBusy} onClick={enrollFleetTetragon}>
                  Enroll fleet Tetragon
                </button>
              ) : undefined
            }
          >
            {sensorMatrix.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No hosts enrolled.</p>
            ) : (
              <ul className="text-sm space-y-2">
                {sensorMatrix.slice(0, 12).map((row) => (
                  <li key={row.host_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.04] pb-2">
                    <span className="text-[var(--text-secondary)]">
                      {row.hostname || row.host_id}
                      <span className={`ml-2 text-xs ${statusToneClass(row.tetragon_status === 'healthy' ? 'ok' : 'warn')}`}>
                        {row.tetragon_status}
                      </span>
                      <span className="text-[var(--text-muted)] text-xs ml-2">{row.host_state}</span>
                    </span>
                    <Link to={`/platform/zyra/machines/${row.host_id}`} className={`text-xs ${hubLinkClasses()}`}>
                      Machine security
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </MacGlassPanel>

          {sensorRegistry.length > 0 && (
            <MacGlassPanel
              title="Sensor registry"
              subtitle="GET /api/v1/zeus-security/sensors — enrolled PacketWolf / Tetragon endpoints"
            >
              <ul className="text-sm space-y-2">
                {sensorRegistry.slice(0, 10).map((row, i) => (
                  <li key={String(row.id ?? row.host_id ?? i)} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.04] pb-2">
                    <span className="text-[var(--text-secondary)]">
                      {String(row.hostname ?? row.name ?? row.host_id ?? 'sensor')}
                      {row.kind ? <span className="text-[var(--text-muted)] text-xs ml-2">{String(row.kind)}</span> : null}
                    </span>
                    <span className={`text-xs ${statusToneClass(row.healthy === false || row.status === 'unhealthy' ? 'warn' : 'ok')}`}>
                      {String(row.status ?? (row.healthy === false ? 'unhealthy' : 'healthy'))}
                    </span>
                  </li>
                ))}
              </ul>
            </MacGlassPanel>
          )}

          <MacGlassPanel title="Critical" subtitle="Requires attention">
            {critical.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No critical security events in the current window.</p>
            ) : (
              <ul className="space-y-2">
                {critical.slice(0, 8).map((ev, i) => (
                  <li key={ev.id ? String(ev.id) : `${String(ev.host_id ?? '')}-${String(ev.kind ?? ev.type ?? '')}-${i}`} className={`text-sm flex flex-wrap items-center justify-between gap-2 ${statusToneClass('error')}`}>
                    <span>{String(ev.description ?? ev.summary ?? ev.message ?? ev.anomaly_type ?? ev.kind ?? ev.type ?? 'event')}</span>
                    <EbpfActionMenu
                      hostId={ev.host_id ? String(ev.host_id) : undefined}
                      suggestedKind="deny_process"
                      suggestedMatch="/usr/bin/nc"
                      huntQueryId="reverse-shell"
                      compact
                    />
                  </li>
                ))}
              </ul>
            )}
          </MacGlassPanel>

          <MacGlassPanel title="Infrastructure security graph" subtitle={threat.security_graph_summary}>
            <SecurityGraphViz graph={graph} />
          </MacGlassPanel>

          <MacGlassPanel title="Zeus security search" subtitle="Natural language event search">
            <div className="flex flex-wrap gap-2 mb-2">
              <input
                aria-label="Zeus security search query"
                className="input text-sm flex-1 min-w-[14rem]"
                placeholder="Show every process that opened port 8080 last week"
                value={nlQuery}
                onChange={(e) => setNlQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runNlSearch()}
              />
              <button type="button" className="btn-secondary text-sm" onClick={runNlSearch}>Search</button>
            </div>
            {nlResults && (
              <div className="space-y-2">
                <p className="text-sm text-[var(--text-muted)]">
                  {nlResults}
                  {nlLlm ? <span className="text-[var(--link)]/80 ml-1">· AI</span> : null}
                </p>
                <EbpfActionMenu suggestedKind="deny_process" suggestedMatch={nlQuery.trim() || '/usr/bin/nc'} huntQueryId="reverse-shell" compact />
              </div>
            )}
          </MacGlassPanel>

          <SecurityTimelinePanel events={timeline} />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => void syncSecurityAlerts().then((r) => toast.success(r.summary)).catch((e: unknown) => toast.error(formatUserError(e)))}
            >
              Sync alerts to Notifications
            </button>
          </div>

        </>
      )}
      <ConfirmDialog
        open={confirmEnrollTetragon}
        title="Enroll Fleet Tetragon"
        message={`Enroll Tetragon on all online hosts (${unhealthySensors.length || 'fleet'} sensor gap)? Agents will be installed and TracingPolicies applied.`}
        confirmLabel="Enroll"
        variant="warning"
        onCancel={() => setConfirmEnrollTetragon(false)}
        onConfirm={doEnrollFleetTetragon}
      />
    </PlatformPageChrome>
  )
}
