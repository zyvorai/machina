// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Globe, Loader2, Network } from 'lucide-react'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import ErrorBanner from '../components/ErrorBanner'
import {
  getOpenStackNetworkTopology,
  type TopologyEdge,
  type TopologyNode,
} from '../api/openstackExtras'
import { formatUserError } from '../utils/apiError'
import { openStackErrorHints } from '../utils/openstackHints'

const KIND_COL: Record<string, number> = {
  'external-network': 40,
  network: 200,
  subnet: 360,
  router: 520,
  port: 680,
  'router-port': 680,
  'device-port': 680,
  'floating-ip': 840,
  instance: 840,
}

const KIND_COLOR: Record<string, string> = {
  'external-network': '#f59e0b',
  network: '#38bdf8',
  subnet: '#818cf8',
  router: '#34d399',
  port: '#94a3b8',
  'router-port': '#34d399',
  'device-port': '#a78bfa',
  'floating-ip': '#fb7185',
  instance: '#e879f9',
}

function layoutNodes(nodes: TopologyNode[]): (TopologyNode & { x: number; y: number })[] {
  const counters: Record<number, number> = {}
  return nodes.map((n) => {
    const col = KIND_COL[n.kind] ?? 400
    const idx = counters[col] ?? 0
    counters[col] = idx + 1
    return { ...n, x: col, y: 40 + idx * 72 }
  })
}

export default function OpenStackTopologyPage() {
  return (
    <OpenStackGate title="Network topology">
      <OpenStackTopologyContent />
    </OpenStackGate>
  )
}

function OpenStackTopologyContent() {
  const [nodes, setNodes] = useState<TopologyNode[]>([])
  const [edges, setEdges] = useState<TopologyEdge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { graph } = await getOpenStackNetworkTopology()
      setNodes(graph.nodes)
      setEdges(graph.edges)
    } catch (e: unknown) {
      setError(formatUserError(e))
      setNodes([])
      setEdges([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const laid = useMemo(() => layoutNodes(nodes), [nodes])
  const pos = useMemo(() => Object.fromEntries(laid.map((n) => [n.id, n])), [laid])
  const maxY = Math.max(200, ...laid.map((n) => n.y + 48))

  return (
    <div className="space-y-6">
      <OpenStackSubNav />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Globe className="w-7 h-7 text-sky-400" /> Neutron topology
        </h1>
        <Link to="/openstack/networking" className="text-sm text-sky-400 hover:underline inline-flex items-center gap-1">
          <Network className="w-4 h-4" /> Networking lab
        </Link>
      </div>
      {error && (
        <ErrorBanner title="Failed to load topology" headline={error} hints={openStackErrorHints(error)} tone="red" onRetry={() => void load()} />
      )}
      {loading ? (
        <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4 overflow-x-auto">
          <svg width="960" height={maxY} className="w-full min-w-[640px]" viewBox={`0 0 960 ${maxY}`}>
            {edges.map((e, i) => {
              const a = pos[e.from]
              const b = pos[e.to]
              if (!a || !b) return null
              return (
                <line key={`${e.from}-${e.to}-${i}`} x1={a.x + 90} y1={a.y + 24} x2={b.x + 90} y2={b.y + 24}
                  stroke="#475569" strokeWidth={1.5} strokeDasharray={e.label === 'member' ? '4 3' : undefined} />
              )
            })}
            {laid.map((n) => (
              <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
                <rect width={180} height={48} rx={8} fill="#0f172a" stroke={KIND_COLOR[n.kind] || '#64748b'} strokeWidth={1.5} />
                <text x={10} y={20} fill="#e2e8f0" fontSize={11} fontWeight={600}>{n.label.slice(0, 22)}</text>
                <text x={10} y={36} fill="#64748b" fontSize={9}>{n.kind}{n.status ? ` · ${n.status}` : ''}</text>
              </g>
            ))}
          </svg>
        </div>
      )}
      <OpenStackFooter />
    </div>
  )
}
