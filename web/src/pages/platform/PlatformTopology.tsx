// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Cable, GitBranch, Layers } from 'lucide-react'
import { MacGlassPanel } from '../../components/platform/mac/PlatformMacUi'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import { formatUserError } from '../../utils/apiError'
import { statusSurfaceClasses, statusToneClass, hubLinkClasses } from '../../utils/semanticColors'
import MachinaNetworkLens from '../../components/ai/MachinaNetworkLens'
import MachinaDigitalTwin from '../../components/ai/MachinaDigitalTwin'
import { getClusterTopology, type TopologyGraph } from '../../api/platform'
import { getSimilarIncidents } from '../../api/ai'
import { getZeusAssetInventory } from '../../api/zeusSecurity'

type LldpStripEntry = {
  hostId: string
  hostname: string
  neighbors: Array<{ local_interface: string; system_name: string; chassis_id: string; port_id: string }>
  source?: string
}

export default function PlatformTopology() {
  const [graph, setGraph] = useState<TopologyGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [incidentQuery, setIncidentQuery] = useState('network partition host offline')
  const [similarIncidents, setSimilarIncidents] = useState<Array<{ label: string; score: number; summary: string }>>([])
  const [trafficHosts, setTrafficHosts] = useState<Array<Record<string, unknown>>>([])

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [topo, inv] = await Promise.all([
        getClusterTopology(),
        getZeusAssetInventory().catch(() => ({ hosts: [] })),
      ])
      setGraph(topo)
      setTrafficHosts((inv.hosts as Array<Record<string, unknown>>) ?? [])
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const segmentLegend = useMemo(
    () => graph?.nodes.filter((n) => n.kind === 'segment') ?? [],
    [graph],
  )

  const uplinkEdges = useMemo(
    () => graph?.edges.filter((e) => e.label === 'uplink') ?? [],
    [graph],
  )

  const lldpStrip = useMemo((): LldpStripEntry[] => {
    if (!graph) return []
    const hosts = graph.nodes.filter((n) => n.kind === 'host')
    const switches = new Map(graph.nodes.filter((n) => n.kind === 'switch').map((n) => [n.id, n]))
    return hosts
      .map((host) => {
        const uplinks = graph.edges.filter((e) => e.from === host.id && e.label === 'uplink')
        const neighbors = uplinks.map((e) => {
          const sw = switches.get(e.to)
          return {
            local_interface: 'uplink',
            system_name: sw?.name ?? 'switch',
            chassis_id: sw?.id ?? e.to,
            port_id: '',
          }
        })
        const source = switches.get(uplinks[0]?.to ?? '')?.state ?? undefined
        return { hostId: host.id, hostname: host.name, neighbors, source }
      })
      .filter((entry) => entry.neighbors.length > 0)
  }, [graph])

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load()}
      prepend={<PlatformBackLink to="/platform/operations" label="Operations" />}
      title="Topology"
      subtitle="Digital twin graph — hosts, VMs, overlay segments, and LLDP uplinks"
      icon={<GitBranch className="w-6 h-6 text-slate-400" />}
      actions={<PlatformRefreshButton onClick={() => void load()} label="Refresh LLDP" />}
      contentLoading={loading && !graph}
      contentClassName="space-y-4"
    >
      {graph && graph.nodes.length === 0 && (
        <PlatformEmptyState
          icon={GitBranch}
          title="Topology is empty"
          subtitle="Enroll hosts and import networks to build the cluster digital twin."
          action={<Link to="/platform/enroll" className="btn-primary text-sm">Enroll a host</Link>}
        />
      )}
      <MacGlassPanel title="Similar incidents" subtitle="GET /api/v1/ai/memory/similar">
        <div className="flex flex-wrap gap-2 mb-3">
          <input className="input text-sm flex-1 min-w-[12rem]" aria-label="Incident search query" value={incidentQuery} onChange={(e) => setIncidentQuery(e.target.value)} />
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => void getSimilarIncidents(incidentQuery).then((r) => {
              setSimilarIncidents((r.incidents ?? []).map((i) => ({
                label: i.kind,
                score: i.similarity ?? 0,
                summary: i.summary ?? '',
              })))
            }).catch(() => setSimilarIncidents([]))}
          >
            Search memory
          </button>
        </div>
        {similarIncidents.length > 0 && (
          <ul className="text-xs text-slate-400 space-y-1">
            {similarIncidents.map((i) => (
              <li key={i.label}>{i.label} ({i.score.toFixed(2)}) — {i.summary}</li>
            ))}
          </ul>
        )}
      </MacGlassPanel>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link to="/platform/zeus?tab=brain" className={`inline-flex items-center gap-1 ${hubLinkClasses()}`}>
          <GitBranch className="w-4 h-4" /> Infrastructure Graph Brain
        </Link>
        <Link to="/platform/zeus/incidents" className={hubLinkClasses()}>Incident Commander →</Link>
      </div>
      <MachinaDigitalTwin />
      {trafficHosts.length > 0 && (
        <MacGlassPanel title="Live traffic overlay" subtitle="Observed connections from PacketWolf asset inventory">
          <ul className="text-sm text-slate-300 space-y-1">
            {trafficHosts.flatMap((h) => {
              const conns = (h.connections as Array<{ from?: string; to?: string }>) ?? []
              return conns.slice(0, 6).map((c, i) => (
                <li key={`${h.host_id}-${i}`}>
                  <span className="text-slate-500">{String(h.host_id)}</span> · {c.from} → {c.to}
                </li>
              ))
            })}
          </ul>
          <Link to="/platform/zeus/security" className={`text-xs mt-2 inline-block ${hubLinkClasses()}`}>Security Center</Link>
        </MacGlassPanel>
      )}
      <MachinaNetworkLens vmNames={graph?.nodes.filter((n) => n.kind === 'vm').map((n) => n.name) ?? []} />

      {(segmentLegend.length > 0 || uplinkEdges.length > 0) && (
        <MacGlassPanel title="Overlay legend" subtitle="Segment nodes and LLDP uplink edges from cached cluster topology.">
          <div className="flex flex-wrap gap-4 text-sm">
            {segmentLegend.map((s) => (
              <span key={s.id} className="flex items-center gap-2 text-violet-300">
                <Layers className="w-4 h-4" /> {s.name}
              </span>
            ))}
            {uplinkEdges.length > 0 && (
              <span className="flex items-center gap-2 text-cyan-300">
                <Cable className="w-4 h-4" /> {uplinkEdges.length} LLDP uplink(s) in graph
              </span>
            )}
          </div>
        </MacGlassPanel>
      )}

      {lldpStrip.length > 0 && (
        <MacGlassPanel title="LLDP uplink strip" subtitle="Switch neighbors from topology cache (deduped chassis IDs).">
          <div className="space-y-3">
            {lldpStrip.map((entry) => (
              <div key={entry.hostId} className="rounded-xl border border-white/[0.06] bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <Link to={`/platform/hosts/${entry.hostId}`} className={`text-sm font-medium hover:underline ${hubLinkClasses()}`}>
                    {entry.hostname}
                  </Link>
                  {entry.source && (
                    <span className="text-xs text-slate-500">{entry.source.replace(/_/g, ' ')}</span>
                  )}
                </div>
                <ul className="text-xs font-mono space-y-1 text-slate-300">
                  {entry.neighbors.map((n) => (
                    <li key={`${n.local_interface}-${n.system_name ?? n.chassis_id}`} className="flex flex-wrap gap-x-3">
                      <span className="text-cyan-400/90">{n.local_interface}</span>
                      <span>→</span>
                      <span>{n.system_name || n.chassis_id || 'switch'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </MacGlassPanel>
      )}

      {graph?.warnings?.map((w) => (
        <div key={w.message} className={`rounded-xl p-3 text-sm ${statusSurfaceClasses('warn')}`}>
          {w.message}
        </div>
      ))}
      <MacGlassPanel title="Cluster graph">
        <div className="space-y-4 font-mono text-xs overflow-x-auto">
        {graph?.nodes.filter((n) => n.kind === 'cluster').map((c) => (
          <div key={c.id}>
            <p className="text-slate-300 font-semibold">▸ {c.name}</p>
            {graph.nodes.filter((n) => n.kind === 'segment').map((seg) => (
              <p key={seg.id} className="ml-4 mt-1 text-violet-400/90">
                ◆ {seg.name}
              </p>
            ))}
            {graph.nodes.filter((n) => n.kind === 'host').map((h) => (
              <div key={h.id} className="ml-4 mt-2">
                <p className={hubLinkClasses()}>└ {h.name} <span className="text-slate-600">({h.state})</span></p>
                {graph.edges.filter((e) => e.from === h.id && e.label === 'uplink').map((e) => {
                  const sw = graph.nodes.find((n) => n.id === e.to)
                  return sw ? (
                    <p key={e.to} className="ml-6 text-cyan-400/80">
                      ⇄ {sw.name} <span className="text-slate-600">(uplink)</span>
                    </p>
                  ) : null
                })}
                {graph.edges.filter((e) => e.from === h.id && e.label === 'runs').map((e) => {
                  const vm = graph.nodes.find((n) => n.id === e.to)
                  return vm ? (
                    <p key={e.to} className={`ml-6 ${statusToneClass('ok')} opacity-90`}>
                      → <Link to={`/platform/vms/${vm.id}`} className="hover:underline">{vm.name}</Link>
                      <span className="text-slate-600"> ({vm.state})</span>
                    </p>
                  ) : null
                })}
              </div>
            ))}
          </div>
        ))}
        {!graph && (
          <p className="text-slate-500 flex items-center gap-2"><GitBranch className="w-4 h-4" /> Loading graph…</p>
        )}
        </div>
      </MacGlassPanel>
    </PlatformPageChrome>
  )
}
