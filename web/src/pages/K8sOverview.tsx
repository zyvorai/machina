// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useMemo, useState } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'
import { Link } from 'react-router'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import CollapsibleCodeBlock from '../components/CollapsibleCodeBlock'
import JsonInspector, { asArray, asRecord } from '../components/platform/JsonInspector'
import { AlertTriangle, CheckCircle2, Download, LayoutGrid, Loader2, Puzzle, RefreshCw, ShieldAlert, Server, Package,
} from 'lucide-react'
import PageLayout from '../components/PageLayout'
import PageSkeleton from '../components/PageSkeleton'
import K8sConnectionErrorBanner from '../components/K8sConnectionErrorBanner'
import EmptyState from '../components/EmptyState'
import { summarizeK8sClientError } from '../utils/k8sErrors'
import { k8sPhaseTone, statusBadgeClasses, statusBorderClass, statusPillClasses, statusSurfaceClasses, statusToneClass } from '../utils/semanticColors'
import {
  buildK8sAuditBundleJson,
  downloadTextAsFile,
  getK8sEnvironment,
  getK8sClusterInventory,
  getK8sClusterInventoryHistory,
  getK8sMetrics,
  getK8sNodes,
  getK8sOverview,
  K8sMetricsResponse,
  K8sClusterInventoryHistoryResponse,
  K8sClusterInventoryResponse,
  K8sEnvironment,
  K8sExtendedClusterInsights,
  K8sNodeInfo,
  K8sPlaneRollup,
  type ClusterBootstrapPhase,
  postK8sClusterBootstrap,
  postK8sK3sInstall,
  postK8sK3sUninstall,
  runK8sAction,
} from '../api/k8s'
import { useK8sContext } from '../hooks/useK8sContext'
import { formatBytes } from '../utils/vm'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'

type NodeAction = 'node_cordon' | 'node_uncordon' | 'node_drain'

function fmtMilliCpu(mc: number | null | undefined): string {
  if (mc == null || !Number.isFinite(mc)) return '—'
  const cores = mc / 1000
  return `${cores % 1 === 0 ? cores.toFixed(0) : cores.toFixed(1)} cores`
}

function topologyHintText(h: Record<string, string> | undefined): string {
  if (!h || Object.keys(h).length === 0) return '—'
  const inst =
    h['node.kubernetes.io/instance-type'] ?? h['beta.kubernetes.io/instance-type']
  if (inst) return inst
  const zone = h['topology.kubernetes.io/zone']
  if (zone) return zone
  const first = Object.entries(h)[0]
  return first ? `${first[0]}=${first[1]}` : '—'
}

/** Maps API `plane` to operator-facing control vs data plane language. */
function nodePlaneUi(plane: string | undefined): { label: string; title: string; className: string } {
  switch (plane) {
    case 'control_plane':
      return {
        label: 'Control plane',
        title:
          'Has node-role.kubernetes.io/control-plane or /master (API/etcd scheduling).',
        className: 'bg-violet-500/20 text-violet-100 border-violet-500/40',
      }
    case 'worker':
      return {
        label: 'Data plane',
        title: 'Worker role only — primary workload / pod scheduling pool.',
        className: 'bg-cyan-500/15 text-cyan-100 border-cyan-500/35',
      }
    case 'mixed':
      return {
        label: 'Mixed',
        title:
          'Both control-plane and worker roles (e.g. k3s server). Contributes to control- and data-plane rollups below.',
        className: `${statusBadgeClasses('warn')} border ${statusBorderClass('warn')}`,
      }
    default:
      return {
        label: 'Unknown',
        title: 'Could not infer from node-role labels (expect control-plane, master, or worker).',
        className: 'bg-slate-600/50 text-slate-200 border-slate-500/40',
      }
  }
}

function NodePlaneBadge({ plane }: { plane: string | undefined }) {
  const ui = nodePlaneUi(plane)
  return (
    <span
      title={ui.title}
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border max-w-full ${ui.className}`}
    >
      {ui.label}
    </span>
  )
}

function planeSegmentRollupTitle(plane: string): string {
  switch (plane) {
    case 'control_plane':
      return 'Control plane nodes'
    case 'worker':
      return 'Data plane nodes'
    case 'mixed':
      return 'Mixed (control + data plane)'
    default:
      return plane
  }
}

function zoneFromHints(h: Record<string, string> | undefined): string {
  if (!h) return ''
  return (
    h['topology.kubernetes.io/zone'] ??
    h['failure-domain.beta.kubernetes.io/zone'] ??
    ''
  )
}

function instanceFromHints(h: Record<string, string> | undefined): string {
  if (!h) return ''
  return h['node.kubernetes.io/instance-type'] ?? h['beta.kubernetes.io/instance-type'] ?? ''
}

function csvEscapeCell(v: string | number | boolean | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function buildNodesInventoryCsv(nodes: K8sNodeInfo[]): string {
  const headers = [
    'name',
    'roles',
    'plane',
    'ready',
    'cordoned',
    'memory_pressure',
    'disk_pressure',
    'pid_pressure',
    'network_unavailable',
    'kubelet_matches_apiserver_minor',
    'taints',
    'zone',
    'instance_type',
    'kubelet_version',
    'cpu_capacity_millicores',
    'cpu_allocatable_millicores',
    'memory_capacity_bytes',
    'memory_allocatable_bytes',
    'daemon_matches_this_machine',
  ]
  const lines = [headers.join(',')]
  for (const n of nodes) {
    const taintStr =
      n.taints?.map((t) => `${t.key}${t.value != null ? `=${t.value}` : ''}:${t.effect}`).join('; ') ??
      ''
    lines.push(
      [
        csvEscapeCell(n.name),
        csvEscapeCell(n.roles.join(';')),
        csvEscapeCell(n.plane ?? ''),
        csvEscapeCell(n.ready),
        csvEscapeCell(Boolean(n.unschedulable)),
        csvEscapeCell(Boolean(n.memory_pressure)),
        csvEscapeCell(Boolean(n.disk_pressure)),
        csvEscapeCell(Boolean(n.pid_pressure)),
        csvEscapeCell(Boolean(n.network_unavailable)),
        csvEscapeCell(
          n.kubelet_minor_matches_apiserver === null || n.kubelet_minor_matches_apiserver === undefined
            ? ''
            : n.kubelet_minor_matches_apiserver,
        ),
        csvEscapeCell(taintStr),
        csvEscapeCell(zoneFromHints(n.topology_hints)),
        csvEscapeCell(instanceFromHints(n.topology_hints)),
        csvEscapeCell(n.kubelet_version),
        csvEscapeCell(n.cpu_capacity_millicores ?? ''),
        csvEscapeCell(n.cpu_allocatable_millicores ?? ''),
        csvEscapeCell(n.memory_capacity_bytes ?? ''),
        csvEscapeCell(n.memory_allocatable_bytes ?? ''),
        csvEscapeCell(
          n.daemon_matches_this_machine === null || n.daemon_matches_this_machine === undefined
            ? ''
            : n.daemon_matches_this_machine,
        ),
      ].join(','),
    )
  }
  return lines.join('\n')
}

function extendedInsightsHasContent(ext: K8sExtendedClusterInsights | undefined): boolean {
  if (!ext) return false
  return (
    (ext.validating_webhooks?.length ?? 0) > 0 ||
    (ext.mutating_webhooks?.length ?? 0) > 0 ||
    (ext.addon_daemonsets?.length ?? 0) > 0 ||
    (ext.gpu_allocatable_cluster_totals && Object.keys(ext.gpu_allocatable_cluster_totals).length > 0) ||
    (ext.daemon_machine_product_uuid != null && ext.daemon_machine_product_uuid !== '') ||
    (ext.etcd_member_list_stdout != null && ext.etcd_member_list_stdout !== '') ||
    (ext.etcd_member_list_stderr != null && ext.etcd_member_list_stderr !== '') ||
    (ext.operator_alerts?.length ?? 0) > 0
  )
}

function downloadTextFile(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function PressureChips({ n }: { n: K8sNodeInfo }) {
  const chips: { k: string; on: boolean; title: string }[] = [
    { k: 'M', on: Boolean(n.memory_pressure), title: 'MemoryPressure' },
    { k: 'D', on: Boolean(n.disk_pressure), title: 'DiskPressure' },
    { k: 'P', on: Boolean(n.pid_pressure), title: 'PIDPressure' },
    { k: 'N', on: Boolean(n.network_unavailable), title: 'NetworkUnavailable' },
  ]
  return (
    <div className="flex flex-wrap gap-1" title="Condition is True (resource pressure or unavailable)">
      {chips.map((c) => (
        <span
          key={c.k}
          title={c.title}
          className={`px-1 rounded text-[10px] font-bold border ${
            c.on
              ? `${statusBadgeClasses('error')} ${statusBorderClass('error')}`
              : 'bg-slate-800/80 text-slate-500 border-slate-600/50'
          }`}
        >
          {c.k}
        </span>
      ))}
    </div>
  )
}

function RollupStrip({ title, r }: { title: string; r: K8sPlaneRollup }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 px-4 py-3">
      <div className="text-xs text-slate-500 mb-2">{title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
        <div>
          <span className="text-slate-500 text-xs">Nodes</span>
          <div className="font-semibold text-white">{r.node_count}</div>
          <div className="text-[10px] text-slate-500">{r.ready_node_count} ready</div>
        </div>
        <div>
          <span className="text-slate-500 text-xs">CPU cap / alloc</span>
          <div className="text-slate-200 font-mono text-xs">
            {fmtMilliCpu(r.cpu_capacity_millicores)} / {fmtMilliCpu(r.cpu_allocatable_millicores)}
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <span className="text-slate-500 text-xs">Memory cap / alloc</span>
          <div className="text-slate-200 font-mono text-xs">
            {formatBytes(Math.max(0, r.memory_capacity_bytes))} /{' '}
            {formatBytes(Math.max(0, r.memory_allocatable_bytes))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function K8sOverviewPage() {
  const { info } = usePlatformInfo()
  const fleetMode = Boolean(info?.control_plane?.proxy_url)
  const toast = useToastContext()
  const { context, setContext, choices: contextChoices, ctxTrim } = useK8sContext()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof getK8sOverview>> | null>(null)
  const [environment, setEnvironment] = useState<K8sEnvironment | null>(null)
  const [nodes, setNodes] = useState<K8sNodeInfo[]>([])
  const [clusterInventory, setClusterInventory] = useState<K8sClusterInventoryResponse | null>(null)
  const [k8sMetrics, setK8sMetrics] = useState<K8sMetricsResponse | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  const [lastCommand, setLastCommand] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filterPlane, setFilterPlane] = useState<string>('all')
  const [filterReady, setFilterReady] = useState<'all' | 'ready' | 'not_ready'>('all')
  const [filterZone, setFilterZone] = useState<string>('all')
  const [filterInstance, setFilterInstance] = useState<string>('all')
  const [invHist, setInvHist] = useState<K8sClusterInventoryHistoryResponse | null>(null)
  const [invHistLoading, setInvHistLoading] = useState(false)
  const [invHistErr, setInvHistErr] = useState<string | null>(null)
  const [k3sInstallExec, setK3sInstallExec] = useState('')
  const [k3sInstallVersion, setK3sInstallVersion] = useState('')
  const [k3sBusy, setK3sBusy] = useState<'install' | 'uninstall' | null>(null)
  const [bootstrapServerIp, setBootstrapServerIp] = useState('')
  const [bootstrapSkipKv, setBootstrapSkipKv] = useState(false)
  const [bootstrapInstallMetrics, setBootstrapInstallMetrics] = useState(true)
  const [bootstrapBusy, setBootstrapBusy] = useState<ClusterBootstrapPhase | null>(null)
  const [k3sConfirmOp, setK3sConfirmOp] = useState<'install' | 'uninstall' | null>(null)
  const [bootstrapConfirmPhase, setBootstrapConfirmPhase] = useState<ClusterBootstrapPhase | null>(null)
  const [bootstrapLastLog, setBootstrapLastLog] = useState('')
  const [liveNodesCount, setLiveNodesCount] = useState<number | null>(null)

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true)
    try {
      const [ov, inv, metrics, liveNodes] = await Promise.all([
        getK8sOverview(ctxTrim),
        getK8sClusterInventory(ctxTrim),
        getK8sMetrics(ctxTrim).catch(() => null),
        getK8sNodes(ctxTrim).catch(() => [] as K8sNodeInfo[]),
      ])
      setOverview(ov)
      setClusterInventory(inv)
      setK8sMetrics(metrics)
      setLiveNodesCount(liveNodes.length)
      setNodes((inv.nodes?.length ?? 0) > 0 ? inv.nodes : liveNodes)
      setLoadError(null)
      try {
        setEnvironment(await getK8sEnvironment())
      } catch {
        setEnvironment(null)
      }
    } catch (e: unknown) {
      const msg = formatUserError(e)
      setLoadError(msg)
      setOverview(null)
      setClusterInventory(null)
      setNodes([])
      try {
        setEnvironment(await getK8sEnvironment())
      } catch {
        setEnvironment(null)
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [ctxTrim])

  useEffect(() => {
    setInvHist(null)
    setInvHistErr(null)
  }, [ctxTrim])

  useEffect(() => {
    void load()
  }, [load])

  const loadInventoryHistory = useCallback(async () => {
    setInvHistLoading(true)
    setInvHistErr(null)
    try {
      const r = await getK8sClusterInventoryHistory(100, ctxTrim)
      setInvHist(r)
    } catch (e: unknown) {
      setInvHist(null)
      setInvHistErr(formatUserError(e))
    } finally {
      setInvHistLoading(false)
    }
  }, [ctxTrim])

  const runNodeAction = useCallback(async (name: string, action: NodeAction) => {
    setActing(`${action}:${name}`)
    try {
      const result = await runK8sAction({ action, name, context: ctxTrim })
      setLastCommand(result.command)
      toast.success(result.stdout.trim() || `${action} succeeded for ${name}`)
      await load(true)
    } catch (e: unknown) {
      const raw = formatUserError(e)
      toast.error(`Action failed: ${summarizeK8sClientError(raw).headline}`)
    } finally {
      setActing(null)
    }
  }, [load, toast, ctxTrim])

  const zoneOptions = useMemo(() => {
    const z = new Set<string>()
    for (const n of nodes) {
      const zz = zoneFromHints(n.topology_hints)
      if (zz) z.add(zz)
    }
    return Array.from(z).sort()
  }, [nodes])

  const instanceOptions = useMemo(() => {
    const z = new Set<string>()
    for (const n of nodes) {
      const ii = instanceFromHints(n.topology_hints)
      if (ii) z.add(ii)
    }
    return Array.from(z).sort()
  }, [nodes])

  const filteredNodes = useMemo(() => {
    return nodes.filter((n) => {
      if (filterPlane !== 'all' && (n.plane ?? 'unknown') !== filterPlane) return false
      if (filterReady === 'ready' && !n.ready) return false
      if (filterReady === 'not_ready' && n.ready) return false
      if (filterZone !== 'all' && zoneFromHints(n.topology_hints) !== filterZone) return false
      if (filterInstance !== 'all' && instanceFromHints(n.topology_hints) !== filterInstance)
        return false
      return true
    })
  }, [nodes, filterPlane, filterReady, filterZone, filterInstance])

  const exportCsv = useCallback(() => {
    const csv = buildNodesInventoryCsv(filteredNodes)
    const stamp = clusterInventory?.collected_at_rfc3339?.replace(/[:.]/g, '-') ?? 'export'
    downloadTextFile(`machina-k8s-nodes-${stamp}.csv`, csv, 'text/csv;charset=utf-8')
    toast.success(`Exported ${filteredNodes.length} row(s)`)
  }, [filteredNodes, clusterInventory?.collected_at_rfc3339, toast])

  const exportAuditJson = useCallback(async () => {
    try {
      const j = await buildK8sAuditBundleJson(ctxTrim)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      downloadTextAsFile(`machina-k8s-audit-${stamp}.json`, j, 'application/json')
      toast.success('Audit bundle downloaded')
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }, [ctxTrim, toast])

  const runHostK3sInstall = useCallback(() => {
    setK3sConfirmOp('install')
  }, [])

  const doRunHostK3sInstall = useCallback(async () => {
    setK3sBusy('install')
    try {
      const exec = k3sInstallExec.trim()
      const ver = k3sInstallVersion.trim()
      const result = await postK8sK3sInstall({
        ...(exec ? { install_k3s_exec: exec } : {}),
        ...(ver ? { install_k3s_version: ver } : {}),
      })
      setLastCommand(result.command)
      const tail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      toast.success(tail || 'k3s install finished')
      await load(true)
    } catch (e: unknown) {
      const raw = formatUserError(e)
      toast.error(`k3s install failed: ${summarizeK8sClientError(raw).headline}`)
    } finally {
      setK3sBusy(null)
    }
  }, [k3sInstallExec, k3sInstallVersion, load, toast])

  const runHostK3sUninstall = useCallback(() => {
    setK3sConfirmOp('uninstall')
  }, [])

  const doRunHostK3sUninstall = useCallback(async () => {
    setK3sBusy('uninstall')
    try {
      const result = await postK8sK3sUninstall({ role: 'auto' })
      setLastCommand(result.command)
      const tail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      toast.success(tail || 'k3s uninstall finished')
      await load(true)
    } catch (e: unknown) {
      const raw = formatUserError(e)
      toast.error(`k3s uninstall failed: ${summarizeK8sClientError(raw).headline}`)
    } finally {
      setK3sBusy(null)
    }
  }, [load, toast])

  const hostSetupBusy = k3sBusy !== null || bootstrapBusy !== null

  const runClusterBootstrap = useCallback(
    (phase: ClusterBootstrapPhase) => {
      setBootstrapConfirmPhase(phase)
    },
    [],
  )

  const doRunClusterBootstrap = useCallback(
    async (phase: ClusterBootstrapPhase) => {
      setBootstrapBusy(phase)
      try {
        const ip = bootstrapServerIp.trim()
        const result = await postK8sClusterBootstrap({
          phase,
          ...(ip ? { server_ip: ip } : {}),
          ...(phase === 'full' && bootstrapSkipKv ? { skip_kubevirt_cdi: true } : {}),
          install_metrics_server: bootstrapInstallMetrics,
        })
        setLastCommand(result.command)
        const log = [result.stdout, result.stderr].filter(Boolean).join('\n--- stderr ---\n')
        setBootstrapLastLog(log.length > 120_000 ? `${log.slice(0, 120_000)}\n… [truncated]` : log)
        toast.success(phase === 'full' ? 'Cluster bootstrap finished' : `Phase “${phase}” finished`)
        await load(true)
      } catch (e: unknown) {
        const raw = formatUserError(e)
        toast.error(`Bootstrap failed: ${summarizeK8sClientError(raw).headline}`)
      } finally {
        setBootstrapBusy(null)
      }
    },
    [
      bootstrapInstallMetrics,
      bootstrapServerIp,
      bootstrapSkipKv,
      load,
      toast,
    ],
  )

  const counts = useMemo(() => {
    const extra = overview?.extra_resource_counts ?? {}
    const base = [
      { label: 'Nodes', value: overview?.nodes ?? 0 },
      { label: 'Live API nodes', value: liveNodesCount ?? '—' },
      { label: 'Ready nodes', value: overview?.ready_nodes ?? 0 },
      { label: 'Namespaces', value: overview?.namespaces ?? 0 },
      { label: 'Pods', value: overview?.pods ?? 0 },
      { label: 'Deployments', value: overview?.deployments ?? 0 },
      { label: 'Services', value: overview?.services ?? 0 },
    ]
    const tail = [
      { label: 'StatefulSets', value: extra.statefulsets ?? 0 },
      { label: 'DaemonSets', value: extra.daemonsets ?? 0 },
      { label: 'CronJobs', value: extra.cronjobs ?? 0 },
      { label: 'Jobs', value: extra.jobs ?? 0 },
      { label: 'PVs', value: extra.persistentvolumes ?? 0 },
      { label: 'PVCs', value: extra.persistentvolumeclaims ?? 0 },
      { label: 'StorageClasses', value: extra.storageclasses ?? 0 },
      { label: 'Ingresses', value: extra.ingresses ?? 0 },
      { label: 'APIServices', value: extra.apiservices ?? 0 },
      { label: 'KubeVirt VMs', value: extra.kubevirt_virtualmachines ?? 0 },
    ]
    return [...base, ...tail]
  }, [overview, liveNodesCount])

  if (loading) {
    return <PageSkeleton />
  }

  return (
    <PageLayout
      title="Kubernetes Cluster"
      subtitle="Auto-detects distro (k3s, RKE2, cloud, kind, …), host agents, and expands resource counts. Safe kubectl node actions below."
      icon={<Server className={`w-6 h-6 ${statusToneClass('info')}`} />}
      actions={
        <>
          {fleetMode && (
            <>
              <Link to="/platform" className="px-3 py-2 rounded-lg text-xs font-medium border border-orange-500/40 text-orange-200 hover:bg-orange-500/10 inline-flex items-center gap-1.5">
                <LayoutGrid className="w-3.5 h-3.5" /> Platform
              </Link>
              <Link to="/platform/integrations" className="px-3 py-2 rounded-lg text-xs font-medium border border-slate-600 text-slate-300 hover:bg-slate-800 inline-flex items-center gap-1.5">
                <Puzzle className="w-3.5 h-3.5" /> Integrations
              </Link>
            </>
          )}
          <select
            aria-label="kubectl context"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 max-w-[18rem]"
            title="kubectl --context"
          >
            <option value="">Default kubeconfig context</option>
            {contextChoices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void exportAuditJson()}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-700/80 border border-slate-600 text-slate-100 hover:bg-slate-600/80"
          >
            Audit JSON
          </button>
          <button onClick={() => void load(true)} className="p-2 hover:bg-slate-700 rounded-lg transition" aria-label="Refresh">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </>
      }
    >
      {loadError && (
        <div className="sticky top-2 z-30">
          <K8sConnectionErrorBanner
            title="Could not load cluster overview"
            message={loadError}
            onDismiss={() => setLoadError(null)}
          />
        </div>
      )}

      <div className="rounded-xl border border-violet-500/25 bg-violet-950/20 px-4 py-3 text-sm text-violet-100/90">
        Tetragon + PacketWolf sensors enrich K8s node events with namespace/pod/container metadata.{' '}
        <Link to="/platform/zeus/security" className="text-violet-300 underline">Open Security Center</Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {counts.map((c) => (
          <div
            key={c.label}
            className="bg-slate-800/50 border border-slate-700/50 rounded-xl px-4 py-3"
            data-testid={c.label === 'Live API nodes' ? 'k8s-live-nodes-stat' : undefined}
          >
            <div className="text-xs text-slate-400">{c.label}</div>
            <div className="text-2xl font-semibold text-white">{c.value}</div>
          </div>
        ))}
      </div>

      {k8sMetrics && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Live utilization (metrics-server)</h2>
            <p className="text-xs text-slate-400 mt-1">
              From <code className="text-slate-300">kubectl top</code>. Install metrics-server if empty.
            </p>
          </div>
          {!k8sMetrics.metrics_available && (
            <p className={`text-sm ${statusToneClass('warn')}`}>
              {k8sMetrics.nodes_error || k8sMetrics.pods_error || k8sMetrics.metrics_server_hint || 'No metrics yet.'}
            </p>
          )}
          {k8sMetrics.metrics_available && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm">
              <div>
                <h3 className="text-xs font-medium text-slate-400 uppercase mb-2">Nodes</h3>
                <ul className="space-y-1 text-slate-200">
                  {k8sMetrics.nodes_top.slice(0, 12).map((row) => (
                    <li key={row.name} className="flex justify-between gap-2 font-mono text-xs">
                      <span>{row.name}</span>
                      <span className="text-slate-400">
                        {row.cpu} ({row.cpu_percent}) · {row.memory} ({row.memory_percent})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-medium text-slate-400 uppercase mb-2">Pods (top 12)</h3>
                <ul className="space-y-1 text-slate-200">
                  {k8sMetrics.pods_top.slice(0, 12).map((row) => (
                    <li key={row.name} className="flex justify-between gap-2 font-mono text-xs">
                      <span className="truncate">{row.name}</span>
                      <span className="text-slate-400 shrink-0">
                        {row.cpu} · {row.memory}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {clusterInventory && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Cluster hardware inventory</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">{clusterInventory.disclaimer}</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <RollupStrip title="All nodes (each counted once)" r={clusterInventory.totals_all_nodes} />
            <RollupStrip
              title="Control plane capacity (control-plane + mixed nodes)"
              r={clusterInventory.combined_control_plane_and_mixed}
            />
            <RollupStrip
              title="Data plane capacity (workers + mixed nodes)"
              r={clusterInventory.combined_worker_dataplane_and_mixed}
            />
          </div>
          {Object.keys(clusterInventory.by_plane).length > 0 && (
            <details className="rounded-lg border border-slate-700/40 bg-slate-900/30">
              <summary className="cursor-pointer px-3 py-2 text-xs text-slate-400 hover:text-slate-300">
                By segment (each node appears in exactly one bucket)
              </summary>
              <div className="px-3 pb-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                {Object.entries(clusterInventory.by_plane).map(([plane, r]) => (
                  <RollupStrip key={plane} title={planeSegmentRollupTitle(plane)} r={r} />
                ))}
              </div>
            </details>
          )}

          <div className="rounded-xl border border-slate-700/40 bg-slate-900/35 px-4 py-3 space-y-2">
              <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                API server &amp; control-plane health probes
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span
                  className={`px-2 py-1 rounded-md border ${statusBadgeClasses(clusterInventory?.cluster_livez_ok ? 'ok' : 'error')} ${statusBorderClass(clusterInventory?.cluster_livez_ok ? 'ok' : 'error')}`}
                  title="kubectl get --raw /livez"
                >
                  livez {clusterInventory?.cluster_livez_ok ? 'ok' : 'fail'}
                </span>
                <span
                  className={`px-2 py-1 rounded-md border ${statusBadgeClasses(clusterInventory?.cluster_readyz_ok ? 'ok' : 'error')} ${statusBorderClass(clusterInventory?.cluster_readyz_ok ? 'ok' : 'error')}`}
                  title="kubectl get --raw /readyz"
                >
                  readyz {clusterInventory?.cluster_readyz_ok ? 'ok' : 'fail'}
                </span>
                {clusterInventory?.apiserver_git_version && (
                  <span className="px-2 py-1 rounded-md bg-slate-800 border border-slate-600 text-slate-200">
                    API {clusterInventory.apiserver_major_minor || '—'} ({clusterInventory.apiserver_git_version})
                  </span>
                )}
                {(clusterInventory?.nodes_with_kubelet_minor_skew ?? 0) > 0 && (
                  <span
                    className={`px-2 py-1 rounded-md border inline-flex items-center gap-1 ${statusBadgeClasses('warn')} ${statusBorderClass('warn')}`}
                    title="Kubelet minor version differs from API server minor (patch skew still allowed)"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
                    Kubelet minor skew: {clusterInventory?.nodes_with_kubelet_minor_skew} node(s)
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                livez/readyz use aggregated API health checks (RBAC or endpoint availability may show fail even when workloads run).
                Version skew compares kubelet vs API server minor only.
              </p>
              {(clusterInventory?.cluster_health_notes?.length ?? 0) > 0 && (
                <ul className="text-[11px] text-slate-400 list-disc pl-5 space-y-0.5">
                  {clusterInventory?.cluster_health_notes?.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
          </div>

          {clusterInventory &&
            ((clusterInventory.topology_nodes_by_zone &&
              Object.keys(clusterInventory.topology_nodes_by_zone).length > 0) ||
              (clusterInventory.topology_nodes_by_region &&
                Object.keys(clusterInventory.topology_nodes_by_region).length > 0)) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {clusterInventory.topology_nodes_by_zone &&
                  Object.keys(clusterInventory.topology_nodes_by_zone).length > 0 && (
                    <div className="rounded-xl border border-slate-700/40 bg-slate-900/30 px-3 py-2">
                      <div className="text-xs text-slate-500 mb-2">Nodes by zone</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(clusterInventory.topology_nodes_by_zone).map(([z, c]) => (
                          <span
                            key={z}
                            className="text-[11px] px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-600/50 text-slate-200"
                          >
                            {z}: <span className="font-semibold text-white">{c}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {clusterInventory.topology_nodes_by_region &&
                  Object.keys(clusterInventory.topology_nodes_by_region).length > 0 && (
                    <div className="rounded-xl border border-slate-700/40 bg-slate-900/30 px-3 py-2">
                      <div className="text-xs text-slate-500 mb-2">Nodes by region</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(clusterInventory.topology_nodes_by_region).map(([r, c]) => (
                          <span
                            key={r}
                            className="text-[11px] px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-600/50 text-slate-200"
                          >
                            {r}: <span className="font-semibold text-white">{c}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )}

          {clusterInventory?.taints_by_plane && Object.keys(clusterInventory.taints_by_plane).length > 0 && (
            <div className="rounded-xl border border-slate-700/40 bg-slate-900/30 px-3 py-3">
              <div className="text-xs text-slate-500 mb-2">
                Taints (NoSchedule / NoExecute) footprint by plane segment
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {Object.entries(clusterInventory.taints_by_plane).map(([plane, t]) => (
                  <div
                    key={plane}
                    className="rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-2 text-xs"
                  >
                    <div className="text-slate-400 capitalize mb-1">{plane.replace(/_/g, ' ')}</div>
                    <div className="text-slate-200">
                      <span className="text-slate-500">nodes </span>
                      {t.nodes_total}
                      <span className="text-slate-500"> · with harsh taints </span>
                      <span className={statusToneClass('warn')}>{t.nodes_with_scheduling_taints}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {clusterInventory &&
            ((clusterInventory.running_pods_total ?? 0) > 0 ||
              (clusterInventory.pending_pods_unscheduled ?? 0) > 0) && (
              <div className="rounded-xl border border-slate-700/40 bg-slate-900/30 px-3 py-3 space-y-2">
                <div className="text-xs text-slate-500">
                  Running pods by plane (assigned node&apos;s role segment){' '}
                  <span className="text-slate-600">
                    · total running {clusterInventory.running_pods_total ?? 0}
                    {(clusterInventory.pending_pods_unscheduled ?? 0) > 0 && (
                      <>
                        {' '}
                        · Pending (no node) {clusterInventory.pending_pods_unscheduled}
                      </>
                    )}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {clusterInventory.running_pods_by_plane &&
                    Object.entries(clusterInventory.running_pods_by_plane).map(([plane, c]) => (
                      <span
                        key={plane}
                        className="text-[11px] px-2 py-0.5 rounded-md bg-cyan-950/40 border border-cyan-800/40 text-cyan-100"
                      >
                        {planeSegmentRollupTitle(plane)}: <span className="font-semibold">{c}</span>
                      </span>
                    ))}
                </div>
              </div>
            )}

          <div className="rounded-xl border border-violet-700/35 bg-violet-950/20 px-4 py-4 space-y-3">
              <h3 className="text-sm font-semibold text-violet-100">Upgrade windows &amp; version skew</h3>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {clusterInventory.upgrade_insights?.disclaimer ??
                  'Version skew and etcd visibility depend on cluster style (stacked kubeadm vs managed vs embedded etcd).'}
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                {(clusterInventory.upgrade_insights?.inferred_etcd_member_pods_running ?? 0) > 0 && (
                  <span className="px-2 py-1 rounded-md bg-violet-500/15 border border-violet-500/35 text-violet-100">
                    etcd-like pods running:{' '}
                    {clusterInventory.upgrade_insights?.inferred_etcd_member_pods_running}
                  </span>
                )}
                {clusterInventory.upgrade_insights?.max_kubelet_minor_lag_behind_apiserver != null && (
                  <span className="px-2 py-1 rounded-md bg-slate-800 border border-slate-600 text-slate-200">
                    max kubelet minor lag (behind API):{' '}
                    {clusterInventory.upgrade_insights.max_kubelet_minor_lag_behind_apiserver}
                  </span>
                )}
                {(clusterInventory.upgrade_insights?.kube_apiserver_pod_image_minors?.length ?? 0) > 0 && (
                  <span className="px-2 py-1 rounded-md bg-slate-800 border border-slate-600 text-slate-200 font-mono text-[11px]">
                    apiserver image minor(s):{' '}
                    {clusterInventory.upgrade_insights?.kube_apiserver_pod_image_minors?.join(', ')}
                  </span>
                )}
                {(clusterInventory.upgrade_insights?.etcd_pod_image_minors?.length ?? 0) > 0 && (
                  <span className="px-2 py-1 rounded-md bg-slate-800 border border-slate-600 text-slate-200 font-mono text-[11px]">
                    etcd image minor(s):{' '}
                    {clusterInventory.upgrade_insights?.etcd_pod_image_minors?.join(', ')}
                  </span>
                )}
              </div>
              {(clusterInventory.upgrade_insights?.nodes_kubelet_newer_than_apiserver?.length ?? 0) > 0 && (
                <div className="text-xs">
                  <span className={statusToneClass('error')}>Kubelet newer than API server (unsupported): </span>
                  <span className="text-slate-300 font-mono">
                    {clusterInventory.upgrade_insights?.nodes_kubelet_newer_than_apiserver?.join(', ')}
                  </span>
                </div>
              )}
              {(clusterInventory.upgrade_insights?.nodes_kubelet_minor_lag_exceeds_policy?.length ?? 0) > 0 && (
                <div className="text-xs">
                  <span className={statusToneClass('warn')}>
                    Same major, kubelet minor lag exceeds supported skew (3 minors):{' '}
                  </span>
                  <span className="text-slate-300 font-mono">
                    {clusterInventory.upgrade_insights?.nodes_kubelet_minor_lag_exceeds_policy?.join(', ')}
                  </span>
                </div>
              )}
              {(clusterInventory.upgrade_insights?.nodes_kubelet_major_behind_apiserver?.length ?? 0) > 0 && (
                <div className="text-xs">
                  <span className={statusToneClass('error')}>Kubelet major older than API server: </span>
                  <span className="text-slate-300 font-mono text-[11px] break-words">
                    {clusterInventory.upgrade_insights?.nodes_kubelet_major_behind_apiserver?.join(' · ')}
                  </span>
                </div>
              )}
              {(clusterInventory.upgrade_insights?.upgrade_warnings?.length ?? 0) > 0 && (
                <ul className={`text-[11px] list-disc pl-5 space-y-1 ${statusToneClass('warn')}`}>
                  {clusterInventory.upgrade_insights?.upgrade_warnings?.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {(clusterInventory.upgrade_insights?.suggested_upgrade_order?.length ?? 0) > 0 && (
                <details className="rounded-lg border border-slate-700/50 bg-slate-900/40">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-slate-400 hover:text-slate-300">
                    Suggested upgrade order (generic)
                  </summary>
                  <ol className="list-decimal pl-8 pr-3 pb-3 text-[11px] text-slate-400 space-y-1">
                    {clusterInventory.upgrade_insights?.suggested_upgrade_order?.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ol>
                </details>
              )}
          </div>

          {(clusterInventory?.etcd_placement_pods?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-slate-700/40 bg-slate-900/25 overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-700/40 text-xs text-slate-500">
                etcd placement (inferred from pods — not Raft membership API)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" aria-label="etcd pods">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-700/40">
                      <th className="px-3 py-2">Pod</th>
                      <th className="px-3 py-2">Node</th>
                      <th className="px-3 py-2">Plane</th>
                      <th className="px-3 py-2">Phase</th>
                      <th className="px-3 py-2">Tag</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/30 text-slate-300">
                    {clusterInventory.etcd_placement_pods?.map((p) => (
                      <tr key={`${p.namespace}/${p.name}`}>
                        <td className="px-3 py-2 font-mono">
                          {p.namespace}/{p.name}
                        </td>
                        <td className="px-3 py-2">{p.node_name ?? '—'}</td>
                        <td className="px-3 py-2 capitalize">{p.node_plane?.replace(/_/g, ' ') ?? '—'}</td>
                        <td className="px-3 py-2">{p.phase}</td>
                        <td className="px-3 py-2 font-mono text-[10px]">{p.inferred_k8s_semver_tag ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(clusterInventory?.control_plane_stack_pods?.length ?? 0) > 0 && (
            <details className="rounded-xl border border-slate-700/40 bg-slate-900/25">
              <summary className="cursor-pointer px-3 py-2 text-xs text-slate-400 hover:text-slate-300">
                Control plane static pods ({clusterInventory.control_plane_stack_pods?.length})
              </summary>
              <div className="overflow-x-auto border-t border-slate-700/40">
                <table className="w-full text-xs" aria-label="Control plane pods">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-700/40">
                      <th className="px-3 py-2">Component</th>
                      <th className="px-3 py-2">Pod</th>
                      <th className="px-3 py-2">Node</th>
                      <th className="px-3 py-2">Phase</th>
                      <th className="px-3 py-2">Tag</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/30 text-slate-300">
                    {clusterInventory.control_plane_stack_pods?.map((p) => (
                      <tr key={`${p.namespace}/${p.name}`}>
                        <td className="px-3 py-2">{p.component}</td>
                        <td className="px-3 py-2 font-mono">
                          {p.namespace}/{p.name}
                        </td>
                        <td className="px-3 py-2">{p.node_name ?? '—'}</td>
                        <td className="px-3 py-2">{p.phase}</td>
                        <td className="px-3 py-2 font-mono text-[10px]">{p.inferred_k8s_semver_tag ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {extendedInsightsHasContent(clusterInventory.extended) && (
            <details
              open
              className="rounded-xl border border-cyan-800/35 bg-slate-900/25"
            >
              <summary className="cursor-pointer px-3 py-2 text-xs text-cyan-200/90 hover:text-cyan-100">
                Admission webhooks, addons, GPUs, etcd snapshot, operator alerts
              </summary>
              <div className="border-t border-cyan-900/30 p-3 space-y-4 text-xs text-slate-300">
                {clusterInventory.extended?.daemon_machine_product_uuid != null &&
                  clusterInventory.extended.daemon_machine_product_uuid !== '' && (
                    <div>
                      <div className="text-[11px] text-slate-500 mb-1">Machina host product UUID (DMI)</div>
                      <code className="text-[11px] bg-slate-950/80 px-2 py-1 rounded border border-slate-700/60 break-all">
                        {clusterInventory.extended.daemon_machine_product_uuid}
                      </code>
                    </div>
                  )}
                {(clusterInventory.extended?.validating_webhooks?.length ?? 0) > 0 && (
                  <div>
                    <div className="text-[11px] text-slate-500 mb-2">ValidatingWebhookConfiguration (summary)</div>
                    <div className="overflow-x-auto rounded-lg border border-slate-700/40">
                      <table className="w-full text-xs" aria-label="Validating webhook configurations">
                        <thead>
                          <tr className="text-left text-slate-500 border-b border-slate-700/40">
                            <th className="px-3 py-2">Name</th>
                            <th className="px-3 py-2">Webhook rules</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/30">
                          {clusterInventory.extended?.validating_webhooks?.map((w) => (
                            <tr key={w.name}>
                              <td className="px-3 py-2 font-mono">{w.name}</td>
                              <td className="px-3 py-2">{w.webhook_rules_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {(clusterInventory.extended?.mutating_webhooks?.length ?? 0) > 0 && (
                  <div>
                    <div className="text-[11px] text-slate-500 mb-2">MutatingWebhookConfiguration (summary)</div>
                    <div className="overflow-x-auto rounded-lg border border-slate-700/40">
                      <table className="w-full text-xs" aria-label="Mutating webhook configurations">
                        <thead>
                          <tr className="text-left text-slate-500 border-b border-slate-700/40">
                            <th className="px-3 py-2">Name</th>
                            <th className="px-3 py-2">Webhook rules</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/30">
                          {clusterInventory.extended?.mutating_webhooks?.map((w) => (
                            <tr key={w.name}>
                              <td className="px-3 py-2 font-mono">{w.name}</td>
                              <td className="px-3 py-2">{w.webhook_rules_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {(clusterInventory.extended?.addon_daemonsets?.length ?? 0) > 0 && (
                  <div>
                    <div className="text-[11px] text-slate-500 mb-2">Notable addon DaemonSets</div>
                    <div className="overflow-x-auto rounded-lg border border-slate-700/40">
                      <table className="w-full text-xs" aria-label="Addon DaemonSets">
                        <thead>
                          <tr className="text-left text-slate-500 border-b border-slate-700/40">
                            <th className="px-3 py-2">Namespace</th>
                            <th className="px-3 py-2">Name</th>
                            <th className="px-3 py-2">Primary image</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/30">
                          {clusterInventory.extended?.addon_daemonsets?.map((d) => (
                            <tr key={`${d.namespace}/${d.name}`}>
                              <td className="px-3 py-2 font-mono">{d.namespace}</td>
                              <td className="px-3 py-2 font-mono">{d.name}</td>
                              <td className="px-3 py-2 font-mono text-[10px] break-all">{d.primary_image}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {clusterInventory.extended?.gpu_allocatable_cluster_totals &&
                  Object.keys(clusterInventory.extended.gpu_allocatable_cluster_totals).length > 0 && (
                    <div>
                      <div className="text-[11px] text-slate-500 mb-2">GPU allocatable (cluster rollup)</div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(clusterInventory.extended.gpu_allocatable_cluster_totals).map(([k, v]) => (
                          <span
                            key={k}
                            className="text-[11px] px-2 py-1 rounded-md bg-indigo-950/50 border border-indigo-800/40 text-indigo-100 font-mono"
                          >
                            {k}: {v}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                {(clusterInventory.extended?.etcd_member_list_stdout != null &&
                  clusterInventory.extended.etcd_member_list_stdout !== '') ||
                (clusterInventory.extended?.etcd_member_list_stderr != null &&
                  clusterInventory.extended.etcd_member_list_stderr !== '') ? (
                  <CollapsibleCodeBlock
                    title="etcdctl member list (from etcd pod exec, when available)"
                    content={[
                      clusterInventory.extended?.etcd_member_list_stderr?.trim()
                        ? `stderr:\n${clusterInventory.extended.etcd_member_list_stderr}`
                        : '',
                      clusterInventory.extended?.etcd_member_list_stdout?.trim()
                        ? `stdout:\n${clusterInventory.extended.etcd_member_list_stdout}`
                        : '',
                    ].filter(Boolean).join('\n\n') || '—'}
                  />
                ) : null}
                {(clusterInventory.extended?.operator_alerts?.length ?? 0) > 0 && (
                  <div>
                    <div className="text-[11px] text-slate-500 mb-1">Operator-style alerts</div>
                    <ul className={`text-[11px] list-disc pl-5 space-y-1 ${statusToneClass('warn')}`}>
                      {clusterInventory.extended?.operator_alerts?.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          )}

          <details className="rounded-xl border border-slate-700/40 bg-slate-900/20">
            <summary className="cursor-pointer px-3 py-2 text-xs text-slate-400 hover:text-slate-300">
              Cluster inventory history (JSONL on daemon host)
            </summary>
            <div className="border-t border-slate-700/40 p-3 space-y-2">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Requires <code className="text-slate-400">[k8s_inventory_history]</code> with{' '}
                <code className="text-slate-400">enabled = true</code> in machina config; reads append-only lines from the daemon.
              </p>
              <button
                type="button"
                disabled={invHistLoading}
                onClick={() => void loadInventoryHistory()}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-slate-700/80 border border-slate-600 text-slate-100 hover:bg-slate-600/80 disabled:opacity-50"
              >
                {invHistLoading ? 'Loading…' : 'Load recent snapshots'}
              </button>
              {invHistErr && <div className={`text-[11px] ${statusToneClass('error')}`}>{invHistErr}</div>}
              {invHist && (
                <div className="space-y-2">
                  <div className="text-[11px] text-slate-500">
                    Path: <code className="text-slate-400 break-all">{invHist.path}</code>
                  </div>
                  <div className="text-[11px] text-slate-400">{invHist.entries.length} snapshot(s)</div>
                  <div className="overflow-x-auto rounded-lg border border-slate-700/50">
                    <table className="w-full text-[11px] text-left" aria-label="Node inventory snapshots">
                      <thead className="text-slate-500 border-b border-slate-700/50">
                        <tr>
                          <th className="px-3 py-2">Snapshot</th>
                          <th className="px-3 py-2">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {asArray(invHist.entries).slice(0, 12).map((entry, i) => {
                          const row = asRecord(entry) ?? {}
                          return (
                            <tr key={String(row.id ?? row.name ?? i)} className="border-b border-slate-800/60">
                              <td className="px-3 py-2 text-slate-300">{String(row.id ?? row.name ?? i + 1)}</td>
                              <td className="px-3 py-2 text-slate-500">{String(row.timestamp ?? row.created_at ?? '—')}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <JsonInspector data={invHist.entries} />
                </div>
              )}
            </div>
          </details>
        </div>
      )}

      {environment && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-semibold text-white">Detection &amp; host</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={statusPillClasses(environment.kubectl_on_path ? 'ok' : 'warn')}>
              kubectl {environment.kubectl_on_path ? 'available' : 'missing / failing'}
            </span>
            <span className={statusPillClasses(environment.kubectl_server_reachable ? 'ok' : 'neutral')}>
              API {environment.kubectl_server_reachable ? 'reachable' : 'unreachable'}
            </span>
            <span className="px-2 py-1 rounded-md bg-blue-500/15 border border-blue-500/40 text-blue-200">
              cluster: <span className="font-mono">{environment.cluster_distribution}</span>
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-300">
            <div className="space-y-1">
              <div><span className="text-slate-500">kubectl client:</span> {environment.kubectl_client_version ?? '—'}</div>
              <div><span className="text-slate-500">Current context:</span> {environment.current_context ?? '—'}</div>
              <div><span className="text-slate-500">Kubeconfig:</span> {environment.kubeconfig_hint ?? '—'}{environment.kubeconfig_from_env ? ' (KUBECONFIG)' : ''}</div>
              {environment.kubeconfig_auto_selected && (
                <div className={statusToneClass('ok')}>
                  <span className="text-slate-500">Machina auto-selected:</span>{' '}
                  <code className="text-xs bg-slate-900/80 px-1 rounded break-all">{environment.kubeconfig_auto_selected}</code>
                  <span className="text-slate-500 text-xs"> (used because default config did not reach the API)</span>
                </div>
              )}
            </div>
            <div className="space-y-1 text-xs">
              <div className="text-slate-400 font-medium">k3s / RKE2 on this host</div>
              <div>k3s config / data: {environment.host.k3s_config_present ? 'yes' : 'no'} / {environment.host.k3s_data_dir_present ? 'yes' : 'no'} · systemd k3s: <span className="font-mono">{environment.host.k3s_systemd}</span> · agent: <span className="font-mono">{environment.host.k3s_agent_systemd}</span></div>
              <div>RKE2 config / data: {environment.host.rke2_config_present ? 'yes' : 'no'} / {environment.host.rke2_data_dir_present ? 'yes' : 'no'} · server: <span className="font-mono">{environment.host.rke2_server_systemd}</span></div>
              <div>k3s binary: {environment.host.k3s_binary_version ?? '—'} · rke2 binary: {environment.host.rke2_binary_version ?? '—'}</div>
              <div>helm: {environment.host.helm_version ?? '—'} · crictl: {environment.host.crictl_version ?? '—'}</div>
              <details className={`group mt-2 rounded-lg border bg-slate-950/50 ${statusBorderClass('warn')}`}>
                <summary className={`cursor-pointer list-none px-2 py-1.5 text-[11px] hover:bg-slate-900/60 rounded-md ${statusToneClass('warn')}`}>
                  <span className="font-medium">Host:</span> install / uninstall k3s (get.k3s.io and upstream scripts)
                </summary>
                <div className="px-2 pb-3 pt-1 space-y-2 text-[11px] text-slate-400">
                  <p>
                    Runs on the machine where <code className="text-slate-300">machina-daemon</code> executes (stock unit is root).
                    Optional <code className="text-slate-300">INSTALL_K3S_EXEC</code> flags — e.g. disable bundled networking for Cilium:{' '}
                    <code className="break-all text-slate-500">
                      --disable=traefik --flannel-backend=none --disable-network-policy --disable-kube-proxy
                    </code>
                  </p>
                  <label className="block space-y-1">
                    <span className="text-slate-500">INSTALL_K3S_VERSION (optional)</span>
                    <input
                      type="text"
                      value={k3sInstallVersion}
                      onChange={(e) => setK3sInstallVersion(e.target.value)}
                      placeholder="e.g. v1.30.3+k3s1"
                      className="w-full font-mono text-xs bg-slate-900 border border-slate-600 rounded-md px-2 py-1.5 text-slate-200 placeholder:text-slate-600"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-slate-500">INSTALL_K3S_EXEC (optional)</span>
                    <textarea
                      value={k3sInstallExec}
                      onChange={(e) => setK3sInstallExec(e.target.value)}
                      rows={2}
                      placeholder="--disable=traefik …"
                      className="w-full font-mono text-xs bg-slate-900 border border-slate-600 rounded-md px-2 py-1.5 text-slate-200 placeholder:text-slate-600"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={hostSetupBusy}
                      onClick={() => void runHostK3sInstall()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-emerald-600/90 text-white text-xs font-medium hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {k3sBusy === 'install' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                      ) : null}
                      Install k3s
                    </button>
                    <button
                      type="button"
                      disabled={hostSetupBusy}
                      onClick={() => void runHostK3sUninstall()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-rose-700/90 text-white text-xs font-medium hover:bg-rose-600 disabled:opacity-50"
                    >
                      {k3sBusy === 'uninstall' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                      ) : null}
                      Uninstall k3s
                    </button>
                  </div>
                </div>
              </details>
              <details className="group mt-2 rounded-lg border border-cyan-500/25 bg-slate-950/50">
                <summary className="cursor-pointer list-none px-2 py-1.5 text-[11px] text-cyan-100/90 hover:bg-slate-900/60 rounded-md">
                  <span className="font-medium">Cluster bootstrap:</span> k3s → Cilium → metrics → KubeVirt/CDI (daemon, phased)
                </summary>
                <div className="px-2 pb-3 pt-1 space-y-3 text-[11px] text-slate-400">
                  <p>
                    Executes in <code className="text-slate-300">machina-daemon</code> (
                    <code className="text-slate-300">cluster_bootstrap.rs</code>) on this host — same steps as the legacy shell recipe.
                    Long-running; use phased buttons if you install manually between steps. Requires outbound HTTPS.
                  </p>
                  <label className="block space-y-1">
                    <span className="text-slate-500">SERVER_IP / API address (optional)</span>
                    <input
                      type="text"
                      value={bootstrapServerIp}
                      onChange={(e) => setBootstrapServerIp(e.target.value)}
                      placeholder="Default: first address from hostname -I"
                      className="w-full font-mono text-xs bg-slate-900 border border-slate-600 rounded-md px-2 py-1.5 text-slate-200 placeholder:text-slate-600"
                    />
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bootstrapInstallMetrics}
                      onChange={(e) => setBootstrapInstallMetrics(e.target.checked)}
                      className="rounded border-slate-600"
                    />
                    <span>Install metrics-server on full pipeline (recommended for k3s labs)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bootstrapSkipKv}
                      onChange={(e) => setBootstrapSkipKv(e.target.checked)}
                      className="rounded border-slate-600"
                    />
                    <span>Full pipeline only: skip KubeVirt / CDI / virtctl (stop after Cilium + metrics)</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ['full', 'Full pipeline', true],
                        ['k3s', '1 · k3s + kubeconfig', false],
                        ['cilium', '2 · Cilium + Hubble', false],
                        ['metrics', '3 · metrics-server', false],
                        ['kubevirt_cdi', '4 · KubeVirt + CDI + virtctl', false],
                      ] as const
                    ).map(([phase, label, primary]) => (
                      <button
                        key={phase}
                        type="button"
                        disabled={hostSetupBusy}
                        onClick={() => void runClusterBootstrap(phase)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium disabled:opacity-50 ${
                          primary
                            ? 'bg-cyan-700/90 text-white hover:bg-cyan-600'
                            : 'bg-slate-700/80 border border-slate-600 text-slate-100 hover:bg-slate-600/80'
                        }`}
                      >
                        {bootstrapBusy === phase ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden />
                        ) : null}
                        {label}
                      </button>
                    ))}
                  </div>
                  {bootstrapLastLog ? (
                    <details className="rounded-md border border-slate-700/60 bg-slate-900/40">
                      <summary className="cursor-pointer px-2 py-1.5 text-slate-400">Last bootstrap output</summary>
                      <pre className="px-2 pb-2 text-[10px] text-slate-500 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                        {bootstrapLastLog}
                      </pre>
                    </details>
                  ) : null}
                </div>
              </details>
            </div>
          </div>
          {(environment.cluster_distribution_hints?.length ?? 0) > 0 && (
            <div>
              <div className="text-xs text-slate-500 mb-1">Detection hints</div>
              <ul className="text-xs text-slate-400 list-disc pl-5 space-y-0.5">
                {environment.cluster_distribution_hints.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          )}
          {Object.keys(environment.snippets).length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-slate-500">kubectl snippets (truncated)</div>
              <div className="space-y-2 max-h-[28rem] overflow-y-auto">
                {Object.entries(environment.snippets).map(([key, text]) => (
                  <details key={key} className="group border border-slate-700/60 rounded-lg bg-slate-900/40">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-mono text-slate-300 hover:bg-slate-800/60 rounded-lg">{key}</summary>
                    <pre className="px-3 pb-3 text-[11px] text-slate-400 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">{text}</pre>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-300">API server version: <span className={`font-medium ${statusToneClass('ok')}`}>{overview?.version || 'unknown'}</span></span>
        {overview?.distribution && (
          <span className="text-sm text-slate-400">Detected: <span className="font-mono text-slate-200">{overview.distribution}</span></span>
        )}
        <Link to="/k8s/workloads" className="text-sm text-blue-300 hover:text-blue-200 underline underline-offset-4">
          Open workloads view
        </Link>
        <Link
          to="/k8s/kata"
          className="text-sm text-cyan-300 hover:text-cyan-200 underline underline-offset-4 inline-flex items-center gap-1"
        >
          <Package className="w-3.5 h-3.5" aria-hidden />
          Kata Containers / Cloud Hypervisor
        </Link>
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700/50 space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Nodes</h2>
              <p className="text-xs text-slate-500 mt-1">
                <span className="text-slate-400">Control vs data plane</span> is inferred from{' '}
                <code className="text-[10px] bg-slate-900/80 px-1 rounded">node-role.kubernetes.io/*</code>{' '}
                labels. Pressure chips use Node conditions (M/D/P/N). Actions: cordon, uncordon, drain.
              </p>
            </div>
            <button
              type="button"
              onClick={() => exportCsv()}
              className="inline-flex items-center gap-2 self-start px-3 py-2 rounded-lg text-xs font-medium bg-slate-700/80 border border-slate-600 text-slate-100 hover:bg-slate-600/80"
            >
              <Download className="w-4 h-4" aria-hidden />
              Export CSV ({filteredNodes.length})
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Filters</span>
            <select
              aria-label="Filter by plane"
              value={filterPlane}
              onChange={(e) => setFilterPlane(e.target.value)}
              className="bg-slate-900 border border-slate-600 rounded-md px-2 py-1.5 text-slate-200"
            >
              <option value="all">All planes</option>
              <option value="control_plane">Control plane</option>
              <option value="worker">Data plane</option>
              <option value="mixed">Mixed</option>
              <option value="unknown">Unknown</option>
            </select>
            <select
              aria-label="Filter by readiness"
              value={filterReady}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'ready' || v === 'not_ready' || v === 'all') setFilterReady(v)
              }}
              className="bg-slate-900 border border-slate-600 rounded-md px-2 py-1.5 text-slate-200"
            >
              <option value="all">Ready: any</option>
              <option value="ready">Ready only</option>
              <option value="not_ready">Not ready</option>
            </select>
            <select
              aria-label="Filter by zone"
              value={filterZone}
              onChange={(e) => setFilterZone(e.target.value)}
              className="bg-slate-900 border border-slate-600 rounded-md px-2 py-1.5 text-slate-200 max-w-[12rem]"
            >
              <option value="all">Zone: any</option>
              {zoneOptions.map((z) => (
                <option key={z} value={z}>
                  Zone: {z}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by instance type"
              value={filterInstance}
              onChange={(e) => setFilterInstance(e.target.value)}
              className="bg-slate-900 border border-slate-600 rounded-md px-2 py-1.5 text-slate-200 max-w-[14rem]"
            >
              <option value="all">Instance type: any</option>
              {instanceOptions.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Cluster nodes">
            <thead>
              <tr className="border-b border-slate-700/50 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Node</th>
                <th
                  className="text-left px-4 py-3 hidden md:table-cell"
                  title="Machina daemon host system UUID matches this node"
                >
                  This host
                </th>
                <th className="text-left px-4 py-3">Role</th>
                <th
                  className="text-left px-4 py-3 min-w-[9rem]"
                  title="Control plane (API/etcd) vs data plane (workloads), from node-role labels"
                >
                  Control / data plane
                </th>
                <th className="text-left px-4 py-3 hidden md:table-cell">CPU cap / alloc</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Mem cap / alloc</th>
                <th className="text-left px-4 py-3 hidden xl:table-cell">Topology hints</th>
                <th
                  className="text-left px-4 py-3 hidden lg:table-cell min-w-[5rem]"
                  title="Memory / Disk / PID pressure &amp; NetworkUnavailable"
                >
                  Pressure
                </th>
                <th className="text-left px-4 py-3 hidden md:table-cell" title="spec.unschedulable (cordon)">
                  Schedule
                </th>
                <th className="text-left px-4 py-3 hidden xl:table-cell" title="Kubelet minor vs API server minor">
                  Ver skew
                </th>
                <th className="text-left px-4 py-3 hidden 2xl:table-cell max-w-[14rem]">Taints</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Kubelet</th>
                <th className="text-left px-4 py-3 hidden 2xl:table-cell">OS</th>
                <th className="text-center px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {filteredNodes.map((n) => (
                <tr key={n.name} className="hover:bg-slate-700/30">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{n.name}</div>
                    <div className="mt-1.5 sm:hidden">
                      <NodePlaneBadge plane={n.plane} />
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-xs">
                    {n.daemon_matches_this_machine === true ? (
                      <span className={`${statusToneClass('ok')} font-medium`} title="Node system UUID matches this Machina host">
                        Match
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{n.roles.join(', ')}</td>
                  <td className="px-4 py-3 align-top hidden sm:table-cell">
                    <NodePlaneBadge plane={n.plane} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 font-mono hidden md:table-cell">
                    {fmtMilliCpu(n.cpu_capacity_millicores)} / {fmtMilliCpu(n.cpu_allocatable_millicores)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 font-mono hidden lg:table-cell">
                    {n.memory_capacity_bytes != null ? formatBytes(n.memory_capacity_bytes) : '—'} /{' '}
                    {n.memory_allocatable_bytes != null ? formatBytes(n.memory_allocatable_bytes) : '—'}
                  </td>
                  <td
                    className="px-4 py-3 text-xs text-slate-400 max-w-[12rem] truncate hidden xl:table-cell"
                    title={topologyHintText(n.topology_hints)}
                  >
                    {topologyHintText(n.topology_hints)}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell align-top">
                    <PressureChips n={n} />
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-xs">
                    {n.unschedulable ? (
                      <span className={statusToneClass('warn')} title="Cordoned (unschedulable)">
                        Cordoned
                      </span>
                    ) : (
                      <span className="text-slate-500">Schedulable</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell text-xs">
                    {n.kubelet_minor_matches_apiserver === false ? (
                      <span
                        className={`inline-flex items-center gap-1 ${statusToneClass('warn')}`}
                        title="Kubelet minor differs from API server minor"
                      >
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
                        Skew
                      </span>
                    ) : n.kubelet_minor_matches_apiserver === true ? (
                      <span className={`${statusToneClass('ok')}`}>Match</span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td
                    className="px-4 py-3 text-[11px] text-slate-400 font-mono max-w-[14rem] truncate hidden 2xl:table-cell"
                    title={
                      n.taints?.length
                        ? n.taints.map((t) => `${t.key}${t.value != null ? `=${t.value}` : ''}:${t.effect}`).join('; ')
                        : ''
                    }
                  >
                    {n.taints?.length
                      ? n.taints.map((t) => `${t.key}:${t.effect}`).join(', ')
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 ${statusToneClass(k8sPhaseTone(n.ready ? 'Running' : 'Pending'))}`}>
                      {n.ready ? <CheckCircle2 className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                      {n.ready ? 'Ready' : 'Not ready'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 hidden lg:table-cell">{n.kubelet_version}</td>
                  <td className="px-4 py-3 text-slate-400 hidden 2xl:table-cell">{n.os_image}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        className={`text-xs disabled:opacity-50 hover:bg-[color-mix(in_srgb,var(--machina-status-warn)_30%,transparent)] ${statusPillClasses('warn')}`}
                        onClick={() => void runNodeAction(n.name, 'node_cordon')}
                        disabled={acting !== null}
                      >
                        Cordon
                      </button>
                      <button
                        className={`text-xs disabled:opacity-50 hover:bg-[color-mix(in_srgb,var(--machina-status-ok)_30%,transparent)] ${statusPillClasses('ok')}`}
                        onClick={() => void runNodeAction(n.name, 'node_uncordon')}
                        disabled={acting !== null}
                      >
                        Uncordon
                      </button>
                      <button
                        className={`text-xs disabled:opacity-50 hover:bg-[color-mix(in_srgb,var(--machina-status-error)_30%,transparent)] ${statusPillClasses('error')}`}
                        onClick={() => void runNodeAction(n.name, 'node_drain')}
                        disabled={acting !== null}
                      >
                        Drain
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {nodes.length === 0 && (
          <EmptyState
            title="No cluster nodes"
            description="Install k3s/rke2 on this host or configure kubectl context in daemon settings."
            primaryAction={<Link to="/k8s" className="btn-primary text-sm">Review bootstrap</Link>}
          />
        )}
        {nodes.length > 0 && filteredNodes.length === 0 && (
          <div className="p-8 text-center text-slate-500">No nodes match filters</div>
        )}
      </div>

      {lastCommand && (
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Last executed command</div>
          <code className={`text-xs break-all ${statusToneClass('ok')}`}>{lastCommand}</code>
        </div>
      )}
      <ConfirmDialog
        open={k3sConfirmOp === 'install'}
        title="Install k3s"
        message="Install k3s on this machine using https://get.k3s.io? This runs as root on the Machina daemon host."
        confirmLabel="Install"
        variant="warning"
        onCancel={() => setK3sConfirmOp(null)}
        onConfirm={() => { setK3sConfirmOp(null); void doRunHostK3sInstall() }}
      />
      <ConfirmDialog
        open={k3sConfirmOp === 'uninstall'}
        title="Remove k3s"
        message="Remove k3s from this host using the upstream uninstall script? This destroys the local cluster and runs as root."
        confirmLabel="Uninstall"
        variant="danger"
        onCancel={() => setK3sConfirmOp(null)}
        onConfirm={() => { setK3sConfirmOp(null); void doRunHostK3sUninstall() }}
      />
      <ConfirmDialog
        open={bootstrapConfirmPhase !== null}
        title={bootstrapConfirmPhase === 'full' ? 'Run full cluster bootstrap' : `Run bootstrap phase "${bootstrapConfirmPhase}"`}
        message={
          bootstrapConfirmPhase === 'full'
            ? 'Run the full install-k3s-cilium.sh pipeline on this host (can take 30+ minutes: k3s → Cilium → metrics → KubeVirt/CDI)?'
            : `Run bootstrap phase "${bootstrapConfirmPhase}" on the Machina daemon host? Later phases assume earlier steps already succeeded.`
        }
        confirmLabel="Run"
        variant="warning"
        onCancel={() => setBootstrapConfirmPhase(null)}
        onConfirm={() => {
          const phase = bootstrapConfirmPhase
          setBootstrapConfirmPhase(null)
          if (phase) void doRunClusterBootstrap(phase)
        }}
      />
    </PageLayout>
  )
}
