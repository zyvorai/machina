// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Activity, Network, Server, ShieldAlert } from 'lucide-react'
import PlatformPageChrome, { PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { formatUserError } from '../../utils/apiError'
import { MacGlassPanel, MacStatWidget } from '../../components/platform/mac/PlatformMacUi'
import {
  getNetworkCanvas,
  type NetworkCanvasPayload,
  type PacketWolfFlow,
  type ServiceMapEdge,
  type ServiceMapNode,
} from '../../api/platformNetworkCanvas'
import EbpfActionMenu from '../../components/platform/EbpfActionMenu'
import NetworkServiceMapGraph from '../../components/platform/NetworkServiceMapGraph'
import { hubLinkClasses, statusBadgeClasses, statusToneClass } from '../../utils/semanticColors'

type CanvasNode = { id: string; label: string; kind: string; detail?: string }

function flowLabel(f: PacketWolfFlow): string {
  const srcPod = f.source?.pod
  const dstPod = f.destination?.pod
  const dstIp = f.destination?.ip ?? f.destination_ip
  const port = f.destination_port ?? f.port
  const proto = f.protocol ? `/${f.protocol}` : ''

  if (srcPod || dstPod || dstIp) {
    const srcNs = f.source?.namespace
    const src = srcPod ?? f.source?.ip ?? f.process ?? 'source'
    const srcLabel = srcNs && srcPod ? `${src} (${srcNs})` : src
    const dstNs = f.destination?.namespace
    const dstBase = dstPod ?? (dstIp ? `${dstIp}${port ? `:${port}` : ''}${proto}` : 'unknown')
    const dstLabel = dstNs && dstPod ? `${dstBase} (${dstNs})` : dstBase
    return `${srcLabel} → ${dstLabel}`
  }

  const dst = dstIp ? `${dstIp}${port ? `:${port}` : ''}` : 'unknown'
  const proc = f.process ?? 'process'
  return `${proc} → ${dst}`
}

function edgeTone(health?: string): string {
  if (health === 'blocked') return statusToneClass('error')
  if (health === 'warning') return statusToneClass('warn')
  return statusToneClass('ok')
}

function nodeTone(status?: string, risk?: string): string {
  if (risk === 'high' || status === 'blocked') return statusToneClass('error')
  if (risk === 'medium' || status === 'warning') return statusToneClass('warn')
  return statusToneClass('ok')
}

export default function PlatformNetworkCanvas() {
  const [data, setData] = useState<NetworkCanvasPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      setData(await getNetworkCanvas())
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const nodes = useMemo<CanvasNode[]>(() => {
    if (!data) return []
    const list: CanvasNode[] = []
    for (const n of data.topology.nodes ?? []) {
      list.push({
        id: `${n.kind}-${n.id}`,
        label: n.name,
        kind: n.kind,
        detail: n.state,
      })
    }
    return list
  }, [data])

  const flowEdges = useMemo(() => {
    const flows = data?.flows?.flows ?? []
    return flows.slice(0, 24).map((f, i) => ({
      id: `flow-${i}`,
      label: flowLabel(f),
      verdict: f.verdict ?? 'FORWARDED',
      host: f.host_id ?? f.source?.namespace,
      summary:
        f.summary ??
        (f.source?.pod && f.destination?.pod
          ? `${f.source.pod} → ${f.destination.pod}${f.port ? `:${f.port}` : ''}`
          : undefined),
    }))
  }, [data])

  const svcMap = data?.network_pulse?.service_map
  const svcNodes = svcMap?.nodes ?? []
  const svcEdges = (svcMap?.edges ?? []).slice(0, 32)
  const mapStats = svcMap?.meta?.stats

  const overview = data?.network_pulse?.overview as Record<string, unknown> | undefined
  const liveConnections = typeof overview?.live_connections === 'number' ? overview.live_connections : null
  const dropRate = typeof overview?.drop_rate === 'number' ? overview.drop_rate : null

  const k8sNodes = data?.network_pulse?.k8s_nodes?.nodes ?? []
  const threats = data?.network_pulse?.threats?.threats ?? []
  const topTalkers = data?.network_pulse?.top_talkers?.talkers ?? svcMap?.overlays?.top_talker_nodes ?? []
  const workloads = data?.network_pulse?.workloads?.workloads ?? []
  const timelineEvents = data?.network_pulse?.timeline?.events ?? []

  const localAnomalies = useMemo(() => {
    const found: string[] = []
    for (const w of data?.topology.warnings ?? []) {
      found.push(w.message)
    }
    const pw = data?.anomalies?.anomalies ?? data?.network_pulse?.anomalies?.anomalies ?? []
    for (const a of pw.slice(0, 8)) {
      const text = a.summary ?? a.description
      if (text) found.push(text)
    }
    return found
  }, [data])

  const stats = data?.flow_stats
  const dropped = stats?.dropped ?? stats?.dropped_count ?? 0
  const forwarded = stats?.forwarded ?? stats?.allowed ?? 0

  return (
    <PlatformPageChrome
      compact
      title="Network canvas"
      subtitle="Machina fleet topology + PacketWolf Network Brain (K8s/Hubble)"
      error={error}
      onErrorRetry={() => void load()}
      actions={<PlatformRefreshButton onClick={() => void load()} />}
      contentLoading={loading && !data}
      contentClassName="space-y-4"
    >
        {data?.packetwolf && (
          <p
            className={`text-xs px-3 py-2 rounded-lg border ${
              data.packetwolf.reachable ? statusBadgeClasses('ok') : statusBadgeClasses('warn')
            }`}
          >
            {data.packetwolf.summary}
            {data.packetwolf.discovery_source && (
              <span className="text-slate-500 block mt-0.5">Discovery: {data.packetwolf.discovery_source}</span>
            )}
          </p>
        )}

        {(mapStats || liveConnections != null) && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {mapStats && (
              <>
                <MacStatWidget label="K8s services" value={String(mapStats.services ?? svcNodes.length)} icon={<Network className="w-4 h-4" />} />
                <MacStatWidget label="Connections" value={String(mapStats.connections ?? svcEdges.length)} icon={<Activity className="w-4 h-4" />} />
                <MacStatWidget
                  label="Blocked edges"
                  value={String(mapStats.blocked ?? 0)}
                  icon={<ShieldAlert className="w-4 h-4" />}
                  tone={(mapStats.blocked ?? 0) > 0 ? 'warn' : 'ok'}
                />
              </>
            )}
            {liveConnections != null && (
              <MacStatWidget label="Live flows" value={String(liveConnections)} icon={<Activity className="w-4 h-4" />} tone="ok" />
            )}
            {dropRate != null && (
              <MacStatWidget label="Drop rate" value={`${(dropRate * 100).toFixed(1)}%`} icon={<ShieldAlert className="w-4 h-4" />} tone={dropRate > 0.05 ? 'warn' : 'ok'} />
            )}
            {(dropped > 0 || forwarded > 0) && (
              <>
                <MacStatWidget label="Forwarded" value={String(forwarded)} icon={<Activity className="w-4 h-4" />} tone="ok" />
                <MacStatWidget label="Dropped" value={String(dropped)} icon={<ShieldAlert className="w-4 h-4" />} tone={dropped > 0 ? 'warn' : 'ok'} />
              </>
            )}
          </div>
        )}

        {localAnomalies.length > 0 && (
          <MacGlassPanel title="Anomalies" subtitle="Machina topology warnings + PacketWolf detections">
            <ul className="text-xs text-amber-200/90 space-y-2">
              {localAnomalies.map((a) => (
                <li key={a} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{a}</span>
                  <Link to="/platform/zeus/security" className={`text-[10px] ${hubLinkClasses()}`}>Fabric health</Link>
                </li>
              ))}
            </ul>
          </MacGlassPanel>
        )}

        {threats.length > 0 && (
          <MacGlassPanel title="Threat pulse" subtitle="PacketWolf /api/v1/network/threats">
            <ul className="text-xs space-y-2">
              {threats.slice(0, 6).map((t, i) => {
                const threat = t as { title?: string; description?: string; severity?: string; summary?: string; kind?: string; host_id?: string; suggested_kind?: string; suggested_match?: string; port?: number }
                const title = threat.title ?? threat.kind ?? 'Threat'
                const detail = threat.summary ?? threat.description
                return (
                <li key={`${String(threat.host_id ?? '')}-${String(threat.kind ?? title)}-${i}`} className="border-b border-white/[0.04] pb-2 space-y-1">
                  <span className={statusToneClass(threat.severity === 'critical' ? 'error' : 'warn')}>{title}</span>
                  {detail && <p className="text-slate-500 mt-0.5">{detail}</p>}
                  <EbpfActionMenu
                    hostId={threat.host_id}
                    suggestedKind={threat.suggested_kind ?? 'deny_port'}
                    suggestedMatch={threat.suggested_match ?? (threat.port ? `${threat.port}/tcp` : '4444/tcp')}
                    huntQueryId="reverse-shell"
                    compact
                  />
                </li>
                )
              })}
            </ul>
          </MacGlassPanel>
        )}

        {svcNodes.length > 0 && (
          <MacGlassPanel title="Service map" subtitle="PacketWolf Hubble-derived workload graph">
            <NetworkServiceMapGraph nodes={svcNodes} edges={svcEdges} className="mb-4" />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 -mt-1 mb-4">
              {svcNodes.slice(0, 18).map((n: ServiceMapNode) => (
                <div key={`${n.namespace}/${n.name}`} className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-2 text-xs">
                  <p className={`font-medium ${nodeTone(n.status, n.risk)}`}>{n.name}</p>
                  <p className="text-slate-500">{n.namespace}</p>
                  <p className="text-slate-400 mt-1">
                    in {n.connections_in ?? 0} · out {n.connections_out ?? 0}
                    {(n.blocked_flows ?? 0) > 0 && <span className={statusToneClass('warn')}> · {n.blocked_flows} blocked</span>}
                  </p>
                </div>
              ))}
            </div>
            {svcEdges.length > 0 && (
              <>
                <h3 className="text-xs font-semibold text-slate-500 mb-2">Connections</h3>
                <ul className="text-xs space-y-1">
                  {svcEdges.map((e: ServiceMapEdge) => (
                    <li key={e.id} className={`truncate ${edgeTone(e.health)}`}>
                      {e.source} → {e.target}
                      {e.dropped_count != null && e.dropped_count > 0 && (
                        <>
                          <span className="text-slate-500"> ({e.dropped_count} dropped)</span>
                          {' '}
                          <Link
                            to={`/platform/zeus/security/enforcement?kind=deny_port&match=${encodeURIComponent('4444/tcp')}`}
                            className={hubLinkClasses()}
                          >
                            enforce
                          </Link>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {Array.isArray(topTalkers) && topTalkers.length > 0 && (
              <p className="text-xs text-slate-500 mt-3">
                Top talkers:{' '}
                {topTalkers
                  .slice(0, 5)
                  .map((t) => (typeof t === 'string' ? t : (t as { name?: string }).name))
                  .filter(Boolean)
                  .join(', ')}
              </p>
            )}
          </MacGlassPanel>
        )}

        {workloads.length > 0 && (
          <MacGlassPanel title="Workloads" subtitle="PacketWolf /api/v1/network/workloads">
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-xs">
              {workloads.slice(0, 18).map((w) => (
                <li key={`${w.namespace}/${w.name}`} className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-2">
                  <p className="font-medium text-slate-100">{w.name}</p>
                  <p className="text-slate-500">{w.namespace}</p>
                  {'connections_out' in w && (
                    <p className="text-slate-400 mt-1">out {(w as { connections_out?: number }).connections_out ?? 0}</p>
                  )}
                </li>
              ))}
            </ul>
          </MacGlassPanel>
        )}

        {timelineEvents.length > 0 && (
          <MacGlassPanel title="Fleet timeline" subtitle="PacketWolf network + correlation events">
            <ul className="text-xs space-y-2 max-h-48 overflow-y-auto">
              {timelineEvents.slice(0, 20).map((ev, i) => {
                const row = ev as { summary?: string; message?: string; severity?: string; timestamp?: string; kind?: string; type?: string }
                const label = row.summary ?? row.message ?? row.kind ?? row.type ?? 'Event'
                return (
                  <li key={`${row.timestamp ?? i}-${label}`} className="border-b border-white/[0.04] pb-2">
                    <span className={statusToneClass(row.severity === 'critical' || row.severity === 'high' ? 'error' : 'neutral')}>
                      {label}
                    </span>
                    {row.timestamp && <p className="text-slate-500 mt-0.5">{row.timestamp}</p>}
                  </li>
                )
              })}
            </ul>
          </MacGlassPanel>
        )}

        {k8sNodes.length > 0 && (
          <MacGlassPanel title="Kubernetes nodes" subtitle="PacketWolf kubectl-backed inventory">
            <ul className="flex flex-wrap gap-2 text-xs">
              {k8sNodes.slice(0, 12).map((n) => (
                <li key={n.name} className="px-2 py-1 rounded-lg border border-slate-700/60 text-slate-300 flex items-center gap-1">
                  <Server className="w-3 h-3 text-slate-500" />
                  {n.name}
                  <span className={statusToneClass(n.status === 'Ready' ? 'ok' : 'warn')}>{n.status}</span>
                  {n.pods_count != null && <span className="text-slate-500">({n.pods_count} pods)</span>}
                </li>
              ))}
            </ul>
          </MacGlassPanel>
        )}

        {flowEdges.length > 0 && (
          <MacGlassPanel title="Host flows" subtitle="PacketWolf eBPF / libvirt host plane">
            <ul className="grid gap-2 sm:grid-cols-2">
              {flowEdges.map((e) => (
                <li key={e.id} className="rounded-lg border border-slate-700/50 bg-slate-900/50 p-3 text-xs">
                  <span
                    className={`text-[10px] uppercase mr-2 ${
                      e.verdict === 'DROPPED' || e.verdict === 'blocked' ? statusToneClass('error') : statusToneClass('ok')
                    }`}
                  >
                    {e.verdict}
                  </span>
                  <p className="font-medium text-slate-100 mt-0.5">{e.label}</p>
                  {e.host && <p className="text-slate-500 mt-0.5">Host {e.host}</p>}
                  {e.summary && <p className="text-slate-400 mt-0.5 truncate">{e.summary}</p>}
                </li>
              ))}
            </ul>
          </MacGlassPanel>
        )}

        <MacGlassPanel title="Machina fleet topology" subtitle="Hosts, VMs, and networks from controller inventory">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {nodes.map((n) => (
              <div key={n.id} className="rounded-lg border border-slate-700/50 bg-slate-900/50 p-3 text-sm">
                <span className="text-[10px] uppercase text-slate-500">{n.kind}</span>
                <p className="font-medium text-slate-100">{n.label}</p>
                {n.detail && <p className="text-xs text-slate-400 mt-0.5">{n.detail}</p>}
              </div>
            ))}
          </div>
          {(data?.topology.edges?.length ?? 0) > 0 && (
            <ul className="text-xs text-slate-400 space-y-1 mt-3 max-h-32 overflow-y-auto">
              {data!.topology.edges.slice(0, 20).map((e) => (
                <li key={`${e.from}-${e.to}`}>
                  {e.from} → {e.to} ({e.label})
                </li>
              ))}
            </ul>
          )}
        </MacGlassPanel>

        <p className="text-xs text-slate-500">
          PacketWolf APIs: network overview, service-map, threats, nodes (via kubeconfig). Deep dive:{' '}
          <Link to="/platform/zeus/security" className={hubLinkClasses()}>
            Zeus Security
          </Link>
          {' · '}
          <Link to="/platform/zeus/security/firewall" className={hubLinkClasses()}>
            Zeus Firewall
          </Link>
          {' · '}
          <Link to="/platform/topology" className={hubLinkClasses()}>
            Topology map
          </Link>
        </p>
    </PlatformPageChrome>
  )
}
