// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import PageLayout from '../../components/PageLayout'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Bot, Radar } from 'lucide-react'
import {
  MacGlassPanel,
  MacListRow,
} from '../../components/platform/mac/PlatformMacUi'
import PageSkeleton from '../../components/PageSkeleton'
import ProcessGraphCanvas from '../../components/platform/ProcessGraphCanvas'
import ContainerHierarchyPanel from '../../components/platform/ContainerHierarchyPanel'
import JsonInspector from '../../components/platform/JsonInspector'
import {
  explainSecurityEvent,
  getHostConnections,
  getHostContainers,
  getHostDns,
  getHostProcessGraph,
  getHostProcesses,
  getHostSecurityFiles,
  getHostSecurityPorts,
  getHostSecuritySummary,
  getHostSecurityTimeline,
  getHostFabricStatus,
  installTetragonSensor,
  type HostFabricStatusResponse,
  reconstructAttack,
  type SecurityEvent,
} from '../../api/zeusSecurity'
import { formatUserError } from '../../utils/apiError'
import { useToastContext } from '../../contexts/ToastContext'
import { useAi } from '../../contexts/AiContext'
import DetailTabs from '../../components/platform/DetailTabs'
import { statusPillClasses, hubLinkClasses } from '../../utils/semanticColors'

type TabId = 'processes' | 'connections' | 'dns' | 'ports' | 'files' | 'events' | 'containers' | 'users' | 'graph'

const PRIMARY_TABS: Array<{ id: TabId; label: string }> = [
  { id: 'processes', label: 'Processes' },
  { id: 'connections', label: 'Connections' },
  { id: 'events', label: 'Events' },
  { id: 'graph', label: 'Graph' },
]

const MORE_TABS: Array<{ id: TabId; label: string; group?: string }> = [
  { id: 'dns', label: 'DNS', group: 'Network' },
  { id: 'ports', label: 'Open ports', group: 'Network' },
  { id: 'files', label: 'Files', group: 'Artifacts' },
  { id: 'containers', label: 'Containers', group: 'Runtime' },
  { id: 'users', label: 'Users', group: 'Runtime' },
]

function eventRow(e: SecurityEvent) {
  return e.summary || e.process?.binary || e.kind || 'event'
}

function eventSub(e: SecurityEvent) {
  const parts = [e.process?.user, e.process?.binary, e.timestamp].filter(Boolean)
  return parts.join(' · ')
}

export default function PlatformMachineSecurity() {
  const { hostId } = useParams<{ hostId: string }>()
  const toast = useToastContext()
  const { openCopilot } = useAi()
  const [tab, setTab] = useState<TabId>('processes')
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null)
  const [items, setItems] = useState<SecurityEvent[]>([])
  const [ports, setPorts] = useState<Array<Record<string, unknown>>>([])
  const [graph, setGraph] = useState<Record<string, unknown> | null>(null)
  const [containers, setContainers] = useState<Record<string, unknown> | null>(null)
  const [timeline, setTimeline] = useState<SecurityEvent[]>([])
  const [attackChain, setAttackChain] = useState<string[] | null>(null)
  const [fabricStatus, setFabricStatus] = useState<HostFabricStatusResponse | null>(null)
  const [explain, setExplain] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!hostId) return
    setError(null)
    setLoading(true)
    try {
      const sum = await getHostSecuritySummary(hostId)
      setSummary(sum)
      void getHostFabricStatus(hostId)
        .then(setFabricStatus)
        .catch(() => setFabricStatus(null))
      if (tab === 'processes') {
        const r = await getHostProcesses(hostId)
        setItems(r.processes ?? [])
      } else if (tab === 'connections') {
        const r = await getHostConnections(hostId)
        setItems(r.connections ?? [])
      } else if (tab === 'dns') {
        const r = await getHostDns(hostId)
        setItems(r.dns ?? [])
      } else if (tab === 'files') {
        const r = await getHostSecurityFiles(hostId)
        setItems(r.files ?? [])
      } else if (tab === 'ports') {
        const r = await getHostSecurityPorts(hostId)
        setPorts(r.ports ?? [])
        setItems([])
      } else if (tab === 'events') {
        const r = await getHostSecurityTimeline(hostId)
        setTimeline(r.events ?? [])
        setItems(r.events ?? [])
      } else if (tab === 'containers') {
        const r = await getHostContainers(hostId)
        setContainers(r as Record<string, unknown>)
        setItems([])
      } else {
        setItems([])
      }
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [hostId, tab])

  useEffect(() => { void load() }, [hostId, tab])

  useEffect(() => {
    if (tab === 'graph' && hostId) {
      void getHostProcessGraph(hostId).then(setGraph).catch(() => setGraph(null))
    }
  }, [tab, hostId])

  if (!hostId) return null

  const sensor = (summary?.sensor as Record<string, unknown>) ?? {}
  const threatScore = summary?.threat_score ?? '—'
  const policyCount = fabricStatus?.fabric?.policy_files?.length ?? 0
  const tetragonRunning = fabricStatus?.fabric?.tetragon_service_active === true
  const exportActive = fabricStatus?.fabric?.tetragon_export_timer_active === true
  const fabricLine = fabricStatus?.agent_reachable
    ? `${policyCount} TracingPolicy file(s) on agent · ${
        tetragonRunning
          ? exportActive
            ? 'Tetragon running · exporting to PacketWolf'
            : 'Tetragon running · export pending'
          : fabricStatus?.fabric?.tetragon_binary_found
            ? 'Tetragon installed · service stopped'
            : 'Tetragon pending install'
      }`
    : 'Agent fabric status unavailable'

  const threatTone = typeof threatScore === 'number' && threatScore > 70 ? 'error' : typeof threatScore === 'number' && threatScore > 40 ? 'warn' : 'ok'

  return (
    <PageLayout
      compact
      contentLoading={loading && !summary}
      error={error}
      prepend={
        <Link to="/platform/zeus/security" className={`text-sm inline-flex items-center gap-1 ${hubLinkClasses()}`}>
          <ArrowLeft className="w-4 h-4" /> Security Center
        </Link>
      }
      title={`Machine security`}
      subtitle={
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className={statusPillClasses(threatTone)}>Threat {String(threatScore)}</span>
          <span className="text-slate-400">Sensor {String(sensor.status ?? 'unknown')}</span>
          <span className="text-slate-500 text-xs">{fabricLine}</span>
        </span>
      }
      actions={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary text-sm inline-flex items-center gap-1"
            onClick={() => void installTetragonSensor(hostId).then((r) => toast.success(r.summary)).catch((e: unknown) => toast.error(formatUserError(e)))}
          >
            <Radar className="w-4 h-4" /> Install Tetragon
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => void reconstructAttack(hostId).then((r) => setAttackChain(r.attack_chain)).catch((e: unknown) => toast.error(formatUserError(e)))}
          >
            Attack chain
          </button>
          <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1" onClick={() => openCopilot()}>
            <Bot className="w-4 h-4" /> Copilot
          </button>
        </div>
      }
      contentClassName="space-y-4"
    >
      {loading && !summary && <PageSkeleton />}

      <DetailTabs primary={PRIMARY_TABS} more={MORE_TABS} active={tab} onChange={setTab} />

      <MacGlassPanel title={PRIMARY_TABS.find((t) => t.id === tab)?.label ?? MORE_TABS.find((t) => t.id === tab)?.label ?? 'Security'}>
        {tab === 'ports' ? (
          ports.length === 0 ? (
            <p className="text-sm text-slate-500 p-3">No open ports reported.</p>
          ) : (
            ports.map((p, i) => (
              <MacListRow
                key={i}
                title={`${p.port} ${p.service ?? p.protocol}`}
                subtitle={[p.process, p.user, p.bind].filter(Boolean).map(String).join(' · ')}
              />
            ))
          )
        ) : tab === 'graph' ? (
          <MacGlassPanel title="Process ancestry" subtitle="Powered by PacketWolf eBPF">
            <ProcessGraphCanvas data={graph as Parameters<typeof ProcessGraphCanvas>[0]['data']} />
          </MacGlassPanel>
        ) : tab === 'containers' ? (
          <ContainerHierarchyPanel data={containers as Parameters<typeof ContainerHierarchyPanel>[0]['data']} />
        ) : tab === 'users' ? (
          <p className="text-sm text-slate-500 p-3">
            User session events correlate from process exec and privilege escalation timelines.
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500 p-3">No events in this category. Enable PacketWolf + Tetragon sensor.</p>
        ) : (
          <>
            {items.slice(0, 30).map((e, i) => (
              <MacListRow
                key={e.id ?? i}
                title={eventRow(e)}
                subtitle={eventSub(e)}
                onClick={() => void explainSecurityEvent(e, hostId).then((r) => setExplain(r.explanation)).catch(() => setExplain(null))}
              />
            ))}
            {explain && (
              <div className="p-3 text-sm text-slate-300 border-t border-white/[0.06]">{explain}</div>
            )}
            <JsonInspector data={items.slice(0, 5)} />
          </>
        )}
      </MacGlassPanel>

      {attackChain && attackChain.length > 0 && (
        <MacGlassPanel title="Attack reconstruction" subtitle="AI timeline analysis">
          <ol className="list-decimal pl-5 text-sm text-slate-300 space-y-1">
            {attackChain.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </MacGlassPanel>
      )}

      {tab === 'events' && timeline.length > 0 && (
        <MacGlassPanel title="Security timeline" subtitle="Flight recorder">
          {timeline.slice(0, 15).map((e, i) => (
            <MacListRow key={i} title={eventRow(e)} subtitle={String(e.timestamp ?? '')} />
          ))}
        </MacGlassPanel>
      )}
    </PageLayout>
  )
}
