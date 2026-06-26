// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router'
import { listVMs, getMetrics, startVM, shutdownVM, VmInfo, VmMetrics, vmDetailRoute, vmConsoleRoute, vmScopeKey } from '../api/vm'
import { getHostVirtualization, getLibvirtSummary, getHealthProblems, type HealthProblemItem } from '../api/host'
import { listNetworks, NetworkInfo } from '../api/network'
import { listPools, StoragePoolInfo } from '../api/storage'
import { getNodeInfo, NodeInfo } from '../api/node'
import { getHostStats, HostStats } from '../api/extras'
import { getStateColor, getStateBadgeClasses } from '../utils/vm'
import { getRecentVMs } from '../utils/recentVMs'
import { timeAgo } from '../utils/time'
import { Activity, Cpu, HardDrive, Server, Network, Database, Camera, ArrowRight, MonitorPlay, ChevronRight, Clock, Gauge, Power, RotateCcw, Play, Terminal, Plus, Trash2, AlertTriangle, X, RefreshCw, Cloud, Boxes, Stethoscope } from 'lucide-react'
import { hostShutdown, hostReboot } from '../api/extras'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useWebSocketContext } from '../contexts/WebSocketContext'
import { useToastContext } from '../contexts/ToastContext'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import { useOpenStackConnection } from '../hooks/useOpenStackConnection'
import { useHypersdkConnection } from '../hooks/useHypersdkConnection'
import { getK8sEnvironment, getK8sOverview, type K8sEnvironment, type K8sOverview } from '../api/k8s'
import Hero from '../components/Hero'
import PageLayout from '../components/PageLayout'
import { formatUserError } from '../utils/apiError'
import { libvirtErrorHints } from '../utils/libvirtHints'
import { integrationPhaseTone, sessionBadgeClasses, statusActionLinkClasses, statusBadgeClasses, statusBgClass, statusBorderClass, statusSurfaceClasses, statusToneClass, utilizationTone } from '../utils/semanticColors'

interface MetricsPoint { time: string; memory: number }

/** Responsive metric grid: auto-fit columns from a minimum card width. */
const METRIC_GRID =
  'grid max-md:grid-cols-1 md:grid-cols-[repeat(auto-fit,minmax(15.625rem,1fr))] gap-4 md:gap-5 xl:gap-6'

export default function Dashboard() {
  const [vms, setVMs] = useState<VmInfo[]>([])
  const [networks, setNetworks] = useState<NetworkInfo[]>([])
  const [pools, setPools] = useState<StoragePoolInfo[]>([])
  const [node, setNode] = useState<NodeInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [hostStats, setHostStats] = useState<HostStats | null>(null)
  const [virtHost, setVirtHost] = useState<Awaited<ReturnType<typeof getHostVirtualization>> | null>(null)
  const [libSummary, setLibSummary] = useState<Awaited<ReturnType<typeof getLibvirtSummary>> | null>(null)
  const [virtBannerDismissed, setVirtBannerDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('machina_virt_banner_dismiss') === '1',
  )
  const [healthProblems, setHealthProblems] = useState<HealthProblemItem[]>([])
  const [metricsHistory, setMetricsHistory] = useState<MetricsPoint[]>([])
  const { subscribe, events } = useWebSocketContext()
  const toast = useToastContext()
  const { info, lastEvent, refreshKey } = usePlatformInfo()
  const { phase: osPhase, status: openstackStatus, testConnection: testOs } = useOpenStackConnection()
  const { phase: hsPhase } = useHypersdkConnection()
  const [k8sEnv, setK8sEnv] = useState<K8sEnvironment | null>(null)
  const [k8sOverview, setK8sOverview] = useState<K8sOverview | null>(null)
  const [k8sError, setK8sError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const platformEnabled = Boolean(info?.control_plane?.proxy_url)

  const vmAction = async (vm: VmInfo, fn: (n: string, c?: string | null) => Promise<void>, label: string) => {
    try { await fn(vm.name, vm.libvirt_connection); toast.success(`${label} '${vm.name}' OK`); loadData() }
    catch (e: unknown) { toast.error(`${label} '${vm.name}' failed: ${formatUserError(e)}`) }
  }

  const loadData = useCallback(async () => {
    const [vmR, netR, poolR, nodeR] = await Promise.allSettled([
      listVMs(),
      listNetworks(),
      listPools(),
      getNodeInfo(),
    ])
    if (vmR.status === 'fulfilled') {
      setVMs(vmR.value)
      setLoadError(null)
    } else {
      setLoadError(formatUserError(vmR.reason))
    }
    if (netR.status === 'fulfilled') setNetworks(netR.value)
    if (poolR.status === 'fulfilled') setPools(poolR.value)
    if (nodeR.status === 'fulfilled') setNode(nodeR.value)
    else if (import.meta.env.DEV) console.warn('Dashboard: getNodeInfo failed', nodeR.reason)

    try { setHostStats(await getHostStats()) } catch { /* optional */ }
    try { setVirtHost(await getHostVirtualization()) } catch { setVirtHost(null) }
    try { setLibSummary(await getLibvirtSummary()) } catch { setLibSummary(null) }
    try {
      const hp = await getHealthProblems()
      setHealthProblems(Array.isArray(hp.items) ? hp.items : [])
    } catch {
      setHealthProblems([])
    }
    try {
      const env = await getK8sEnvironment()
      setK8sEnv(env)
      if (env.kubectl_server_reachable) {
        setK8sOverview(await getK8sOverview())
        setK8sError(null)
      } else {
        setK8sOverview(null)
        setK8sError('kubectl cannot reach the API server — check kubeconfig on the host.')
      }
    } catch (e: unknown) {
      setK8sEnv(null)
      setK8sOverview(null)
      setK8sError(formatUserError(e))
    }
    setLoading(false)
  }, [])

  const loadMetrics = useCallback(async () => {
    try {
      const metrics = await getMetrics()
      const avgMem = metrics.length > 0
        ? metrics.reduce((sum: number, m: VmMetrics) => sum + m.memory_pct, 0) / metrics.length : 0
      setMetricsHistory((prev) => [
        ...prev.slice(-29),
        { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), memory: parseFloat(avgMem.toFixed(1)) },
      ])
    } catch { /* no metrics */ }
  }, [])

  useEffect(() => {
    loadData(); loadMetrics()
    const interval = setInterval(() => { loadData(); loadMetrics() }, 10000)
    return () => clearInterval(interval)
  }, [loadData, loadMetrics])

  // Re-fetch immediately when the daemon emits a relevant event (e.g. a fresh
  // KubeVirt qcow2 upload). Avoids waiting up to 10s for the polling tick.
  useEffect(() => {
    if (lastEvent && (lastEvent.kind.startsWith('kubevirt.') || lastEvent.kind.startsWith('openstack.instance'))) {
      loadData()
    }
  }, [refreshKey, lastEvent, loadData])

  useEffect(() => {
    const unsubscribe = subscribe(() => loadData())
    return () => unsubscribe()
  }, [subscribe, loadData])

  const [showShutdownConfirm, setShowShutdownConfirm] = useState(false)
  const [showRebootConfirm, setShowRebootConfirm] = useState(false)

  const handleHostShutdown = async () => {
    try { await hostShutdown() } catch (e: unknown) { toast.error(`Host shutdown failed: ${formatUserError(e)}`) }
    setShowShutdownConfirm(false)
  }

  const handleHostReboot = async () => {
    try { await hostReboot() } catch (e: unknown) { toast.error(`Host reboot failed: ${formatUserError(e)}`) }
    setShowRebootConfirm(false)
  }

  const running = vms.filter((v) => v.state === 'running').length
  const stopped = vms.filter((v) => v.state === 'shutoff').length
  const paused = vms.length - running - stopped
  const totalVcpus = vms.reduce((s, v) => s + v.vcpus, 0)
  const totalMemGB = (vms.reduce((s, v) => s + v.memory_mb, 0) / 1024).toFixed(1)
  const activeNets = networks.filter((n) => n.active).length
  const activePools = pools.filter((p) => p.state === 'running').length

  if (loading) return <DashboardSkeleton />

  return (
    <PageLayout
      hideHeader
      className="min-w-0"
      error={loadError}
      errorTitle="Could not load VMs"
      errorHints={loadError ? libvirtErrorHints(loadError) : undefined}
      onErrorRetry={loadData}
    >
      <Hero
        title={`Dashboard${node?.hostname ? ` · ${node.hostname}` : ''}`}
        subtitle="Live virtualization, network, storage, and KubeVirt status from this hypervisor."
        icon={<Activity className="w-6 h-6" />}
        actions={
          <Link
            to="/system-check"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-sky-500/40 bg-sky-600/20 text-sky-200 hover:bg-sky-600/30 text-sm font-medium transition"
          >
            <Stethoscope className="w-4 h-4" />
            System Check
          </Link>
        }
      />

      {platformEnabled && (
        <div className="rounded-xl border border-violet-500/30 bg-violet-950/20 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-violet-100">
            Multi-host platform controller is available via same-origin proxy.
          </p>
          <Link to="/platform" className="text-sm text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
            Open Platform <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      )}

      {healthProblems.length > 0 && (
        <div className={`rounded-xl px-4 py-3 space-y-2 ${statusSurfaceClasses('error')}`}>
          <div className={`flex items-center gap-2 text-sm font-medium ${statusToneClass('error')}`}>
            <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden />
            Host checklist ({healthProblems.length})
          </div>
          <ul className="space-y-2 text-sm">
            {healthProblems.map((p) => (
              <li key={p.id} className={`border-l-2 pl-3 ${statusBorderClass(p.severity === 'critical' ? 'error' : 'warn')}`}>
                <span className={`${statusToneClass(p.severity === 'critical' ? 'error' : 'warn')} font-medium`}>
                  {p.title}
                </span>
                {p.detail ? <p className={`text-xs mt-0.5 opacity-80 ${statusToneClass('error')}`}>{p.detail}</p> : null}
                {p.doc_url ? (
                  <a
                    href={p.doc_url}
                    target="_blank"
                    rel="noreferrer"
                    className={`text-xs hover:underline mt-0.5 inline-block ${statusActionLinkClasses('info')}`}
                  >
                    Documentation
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
          <Link
            to="/system-check"
            className="inline-flex items-center gap-1.5 text-sm text-sky-400 hover:text-sky-300 mt-2"
          >
            <Stethoscope className="w-4 h-4" />
            Run full system check
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      )}

      {!virtBannerDismissed && virtHost && (!virtHost.cpu_virt_supported || !virtHost.kvm_device_present || (!virtHost.libvirt_system_socket_present && !virtHost.libvirt_session_socket_present)) && (
        <div className={`rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 ${statusSurfaceClasses('warn')}`}>
          <div className="flex gap-3 min-w-0">
            <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${statusToneClass('warn')}`} aria-hidden />
            <div className="min-w-0 text-sm">
              <p className={`font-medium ${statusToneClass('warn')}`}>Virtualization readiness</p>
              <p className="mt-1 opacity-90">{virtHost.hint}</p>
              {libSummary?.dual_connection ? (
                <p className="mt-2 text-xs opacity-75">
                  Dual libvirt: system {libSummary.qemu_system_connected ? 'connected' : 'down'}, session {libSummary.qemu_session_connected ? 'connected' : 'down'} ({libSummary.configured_uri}).
                </p>
              ) : libSummary?.configured_uri ? (
                <p className="mt-2 text-xs opacity-75">
                  Libvirt URI: {libSummary.configured_uri}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              localStorage.setItem('machina_virt_banner_dismiss', '1')
              setVirtBannerDismissed(true)
            }}
            className={`shrink-0 self-start p-1.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--machina-status-warn)_20%,transparent)] ${statusToneClass('warn')}`}
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between min-w-0">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-slate-400 mt-0.5 break-words">
            {node
              ? `${node.hostname} — ${node.hypervisor} ${node.hypervisor_version} · hypervisor host (QEMU/KVM + libvirt)`
              : 'Host details unavailable — libvirt or the API may be reconnecting (e.g. after enabling a systemd unit). Wait a few seconds and refresh this page if needed.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void loadData().then(() => loadMetrics())}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600/40 rounded-lg text-sm font-medium text-slate-200 transition-all"
            title="Reload dashboard data"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => setShowRebootConfirm(true)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${statusBadgeClasses('warn')}`} title="Reboot host">
            <RotateCcw className="w-4 h-4" /> Reboot
          </button>
          <button onClick={() => setShowShutdownConfirm(true)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${statusBadgeClasses('error')}`} title="Shutdown host">
            <Power className="w-4 h-4" /> Shutdown
          </button>
          <Link to="/create" className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-lg text-sm font-medium shadow-lg shadow-blue-600/20 transition-all">
            <Server className="w-4 h-4" /> New VM
          </Link>
        </div>
      </div>

      {/* Stat cards — auto-fit minmax grid */}
      <div className={METRIC_GRID}>
        <StatCard gradient="stat-card-blue" icon={<Server className="w-6 h-6" />} iconColor={statusToneClass('info')} title="Guests" value={vms.length} badge={<span className={`text-xs px-2 py-0.5 rounded-full ${statusBadgeClasses('ok')}`}>{running} running</span>} />
        <StatCard gradient="stat-card-purple" icon={<Cpu className="w-6 h-6" />} iconColor="text-purple-400" title="Total vCPUs" value={totalVcpus} badge={node ? <span className="text-xs text-slate-500">{node.cpu_cores}c / {node.cpu_threads}t host</span> : undefined} />
        <StatCard gradient="stat-card-orange" icon={<HardDrive className="w-6 h-6" />} iconColor="text-orange-400" title="Allocated Memory" value={`${totalMemGB} GB`} badge={node ? <span className="text-xs text-slate-500">{(node.memory_mb / 1024).toFixed(0)} GB host</span> : undefined} />
        <StatCard gradient="stat-card-green" icon={<Network className="w-6 h-6" />} iconColor="text-[var(--machina-accent-network)]" title="Networks" value={networks.length} badge={<span className="text-xs text-slate-500">{activeNets} active</span>} />
      </div>

      {/* Host Resource Usage */}
      {hostStats && (
        <div className={METRIC_GRID}>
          <ResourceBar icon={<Gauge className={`w-4 h-4 shrink-0 ${statusToneClass('info')}`} />} label="Host CPU" value={hostStats.cpu_percent} extra={`Load: ${hostStats.load_1.toFixed(1)}`} />
          <ResourceBar icon={<HardDrive className={`w-4 h-4 shrink-0 ${statusToneClass('ok')}`} />} label="Host Memory" value={hostStats.memory_percent} extra={`${(hostStats.memory_used_mb / 1024).toFixed(1)} / ${(hostStats.memory_total_mb / 1024).toFixed(1)} GB`} />
          <ResourceBar icon={<Database className="w-4 h-4 text-orange-400 shrink-0" />} label="Host Disk" value={hostStats.disk_percent} extra={`${hostStats.disk_used_gb.toFixed(0)} / ${hostStats.disk_total_gb.toFixed(0)} GB`} />
          <MiniStat icon={<Clock className="w-4 h-4 text-purple-400" />} label="Uptime" value={formatUptime(hostStats.uptime_secs)} extra={`${hostStats.processes} procs`} />
        </div>
      )}

      {/* Secondary stats row */}
      <div className={METRIC_GRID}>
        <MiniStat icon={<Database className="w-4 h-4 text-cyan-400" />} label="Storage Pools" value={`${activePools}/${pools.length}`} />
        <MiniStat icon={<Camera className={`w-4 h-4 ${statusToneClass('warn')}`} />} label="Running" value={running} extra={stopped > 0 ? `${stopped} stopped` : undefined} />
        <MiniStat icon={<MonitorPlay className="w-4 h-4 text-pink-400" />} label="Paused" value={paused} />
        <MiniStat icon={<Activity className={`w-4 h-4 ${statusToneClass('ok')}`} />} label="libvirt" value={node ? `v${node.lib_version}` : '-'} />
      </div>

      {platformEnabled && (
        <div className="rounded-xl border border-orange-500/30 bg-orange-950/20 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-semibold text-slate-100">Platform desktop</h2>
            <p className="text-sm text-slate-400 mt-0.5">Manage your fleet with the macOS-style Machina desktop — Finder, Time Machine, Integrations hub.</p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Link to="/platform" className="px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm">Open Platform</Link>
            <Link to="/platform/integrations" className={`shrink-0 px-3 py-1.5 rounded-lg border text-sm ${statusBadgeClasses('info')}`}>Integrations</Link>
          </div>
        </div>
      )}

      {(osPhase === 'off' || osPhase === 'needsWire') && (
        <div className={`rounded-xl p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 ${statusSurfaceClasses('warn')}`}>
          <div className="flex items-start gap-3 min-w-0">
            <Cloud className={`w-6 h-6 shrink-0 mt-0.5 ${statusToneClass(integrationPhaseTone(osPhase === 'off' ? 'off' : 'needsWire'))}`} />
            <div>
              <h2 className="font-semibold text-slate-100">OpenStack not wired</h2>
              <p className="text-sm text-slate-400 mt-0.5 max-w-2xl">
                {osPhase === 'needsWire'
                  ? 'OpenStack is enabled in machina config but missing clouds.yaml or cloud_name.'
                  : 'Enable [openstack] in /etc/machina/config.toml, then wire Keystone on this host.'}
              </p>
            </div>
          </div>
          <Link
            to="/openstack"
            className={`shrink-0 px-3 py-1.5 rounded-lg border text-sm ${statusBadgeClasses('warn')}`}
          >
            Wire OpenStack
          </Link>
        </div>
      )}

      {osPhase === 'unreachable' && openstackStatus && (
        <div className={`rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${statusSurfaceClasses('error')}`}>
          <div className="flex items-start gap-3 min-w-0">
            <Cloud className={`w-6 h-6 shrink-0 mt-0.5 ${statusToneClass(integrationPhaseTone('unreachable'))}`} />
            <div>
              <h2 className="font-semibold text-slate-100">OpenStack unreachable</h2>
              <p className="text-sm text-slate-400 mt-0.5">
                Cloud <span className="text-slate-200">{openstackStatus.cloud_name || '—'}</span> is configured but Keystone/API is down.
              </p>
              {openstackStatus.error && (
                <p className={`text-xs mt-1 truncate max-w-xl ${statusToneClass('error')}`} title={openstackStatus.error}>
                  {openstackStatus.error}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void testOs().then((s) => toast.success(s.reachable ? 'OpenStack OK' : 'Still unreachable'))}
              className={`px-3 py-1.5 rounded-lg border text-sm ${statusBadgeClasses('error')}`}
            >
              Test
            </button>
            <Link to="/openstack" className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 text-sm">
              Diagnose
            </Link>
          </div>
        </div>
      )}

      {(k8sOverview || k8sError) && (
        <div
          className={`rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${
            k8sOverview
              ? 'border border-violet-500/30 bg-violet-950/20'
              : statusSurfaceClasses('warn')
          }`}
        >
          <div className="flex items-start gap-3 min-w-0">
            <Boxes className={`w-6 h-6 shrink-0 mt-0.5 ${k8sOverview ? 'text-violet-400' : statusToneClass('warn')}`} />
            <div>
              <h2 className="font-semibold text-slate-100">Kubernetes</h2>
              {k8sOverview ? (
                <p className="text-sm text-slate-400 mt-0.5">
                  {k8sOverview.distribution || 'cluster'} · {k8sOverview.ready_nodes}/{k8sOverview.nodes} nodes ready ·{' '}
                  {k8sOverview.pods} pods
                  {k8sEnv?.current_context ? (
                    <> · context <span className="text-slate-300 font-mono text-xs">{k8sEnv.current_context}</span></>
                  ) : null}
                </p>
              ) : (
                <p className="text-sm text-slate-400 mt-0.5 truncate max-w-xl" title={k8sError ?? undefined}>
                  {k8sError}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Link to="/k8s" className="px-3 py-1.5 rounded-lg border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 text-sm">
              Cluster
            </Link>
            <Link to="/k8s/workloads" className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm">
              Workloads
            </Link>
          </div>
        </div>
      )}

      {hsPhase === 'unreachable' && (
        <div className={`rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${statusSurfaceClasses(integrationPhaseTone('unreachable'))}`}>
          <div className="flex items-start gap-3 min-w-0">
            <Boxes className={`w-6 h-6 shrink-0 mt-0.5 ${statusToneClass(integrationPhaseTone('unreachable'))}`} />
            <div>
              <h2 className="font-semibold text-slate-100">HyperSDK unreachable</h2>
              <p className="text-sm text-slate-400 mt-0.5">
                Enabled in config but hypervisord is not responding — bulk migrations need HyperSDK.
              </p>
            </div>
          </div>
          <Link to="/openstack/migrations" className={`shrink-0 px-3 py-1.5 rounded-lg border text-sm ${statusBadgeClasses('warn')}`}>
            Migrations
          </Link>
        </div>
      )}

      {Boolean(info?.guestkit?.enabled) && (
        <div className="rounded-xl border border-orange-500/30 bg-orange-950/15 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <Stethoscope className="w-6 h-6 text-orange-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold text-slate-100">GuestKit</h2>
              <p className="text-sm text-slate-400 mt-0.5">Offline disk inspect and migrate planning for lift-and-shift assurance.</p>
            </div>
          </div>
          <Link to="/platform/migration?tab=jobs" className={`shrink-0 px-3 py-1.5 rounded-lg border text-sm ${statusBadgeClasses('warn')}`}>
            GuestKit jobs
          </Link>
        </div>
      )}

      {osPhase === 'live' && openstackStatus && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <Cloud className="w-6 h-6 text-sky-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold text-slate-100">OpenStack</h2>
              <p className="text-sm text-slate-400 mt-0.5">
                Cloud <span className="text-slate-200">{openstackStatus.cloud_name || '—'}</span>
                {openstackStatus.instance_count != null && (
                  <> · {openstackStatus.instance_count} instance{openstackStatus.instance_count === 1 ? '' : 's'}</>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Link to="/openstack/instances" className="px-3 py-1.5 rounded-lg border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 text-sm">
              Instances
            </Link>
            <Link to="/openstack/create" className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm">
              Create
            </Link>
            <Link to="/openstack/images" className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 text-sm">
              Images
            </Link>
          </div>
        </div>
      )}

      {/* Recently Viewed */}
      {(() => {
        const recent = getRecentVMs()
        if (recent.length === 0) return null
        return (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-slate-400">Recent:</span>
            {recent.map(name => (
              <Link key={name} to={`/vms/${name}`} className={`px-3 py-1.5 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm hover:border-slate-600/50 transition ${statusActionLinkClasses('info')}`}>
                {name}
              </Link>
            ))}
          </div>
        )
      })()}

      {/* Charts — isolate stacking so tooltips stay below sticky navbar */}
      <div className="grid grid-cols-1 gap-6 min-w-0 relative z-0">
        <ChartCard title="Memory Usage" icon={<HardDrive className={`w-4 h-4 ${statusToneClass('ok')}`} />} current={metricsHistory.length > 0 ? `${metricsHistory[metricsHistory.length - 1].memory}%` : '-'}>
          <div className="h-[220px] w-full min-w-0 isolate">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metricsHistory}>
                <defs>
                  <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" stroke="#475569" fontSize={11} tickLine={false} />
                <YAxis stroke="#475569" fontSize={11} domain={[0, 100]} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '0.75rem', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }} labelStyle={{ color: '#94a3b8' }} />
                <Area type="monotone" dataKey="memory" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#memGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* VM List */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Guests (libvirt domains)</h2>
          <Link to="/vms" className={`flex items-center gap-1 text-sm transition font-medium ${statusActionLinkClasses('info')}`}>
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="divide-y divide-slate-700/30">
          {vms.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Server className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">No guests on this host yet</p>
              <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">Define a QEMU/KVM guest in libvirt, or create one here. Optional KubeVirt flows live under each VM&apos;s details.</p>
              <Link to="/create" className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition">
                <Server className="w-4 h-4" /> Create VM
              </Link>
            </div>
          ) : (
            vms.slice(0, 10).map((vm) => (
              <div key={vmScopeKey(vm)} className="flex items-center justify-between px-6 py-3.5 table-row-hover group">
                <Link to={vmDetailRoute(vm.name, vm.libvirt_connection)} className="flex items-center gap-4 flex-1 min-w-0">
                  <div className={`shrink-0 ${getStateColor(vm.state)}`} />
                  <div className="min-w-0">
                    <div className="font-medium text-white group-hover:text-[var(--machina-status-info)] transition truncate flex items-center gap-2">
                      {vm.name}
                      {vm.libvirt_connection === 'session' && (
                        <span className={sessionBadgeClasses('font-normal')}>session</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{vm.vcpus} vCPU · {vm.memory_mb} MB</div>
                  </div>
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  {vm.state === 'running' && (
                    <>
                      <Link to={vmConsoleRoute(vm.name, vm.libvirt_connection)} className="p-1.5 hover:bg-slate-600/30 rounded transition" title="Console" aria-label="Console">
                        <Terminal className="w-3.5 h-3.5 text-slate-400" />
                      </Link>
                      <button onClick={() => vmAction(vm, shutdownVM, 'Shutdown')} className="p-1.5 hover:bg-yellow-600/20 rounded transition" title="Shutdown" aria-label="Shutdown">
                        <Power className={`w-3.5 h-3.5 ${statusToneClass('warn')}`} />
                      </button>
                    </>
                  )}
                  {vm.state === 'shutoff' && (
                    <button onClick={() => vmAction(vm, startVM, 'Start')} className="p-1.5 hover:bg-green-600/20 rounded transition" title="Start" aria-label="Start">
                      <Play className={`w-3.5 h-3.5 ${statusToneClass('ok')}`} />
                    </button>
                  )}
                  <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${getStateBadgeClasses(vm.state)}`}>{vm.state}</span>
                  <Link to={vmDetailRoute(vm.name, vm.libvirt_connection)} className="p-1">
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition" />
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Activity Feed */}
      {events.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700/50">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Activity className={`w-5 h-5 ${statusToneClass('ok')}`} /> Activity Feed
            </h2>
          </div>
          <div className="divide-y divide-slate-700/30 max-h-64 overflow-y-auto">
            {events.map((ev) => (
              <div key={`${ev.timestamp}-${ev.name}-${ev.event}`} className="px-6 py-2.5 flex items-center justify-between text-sm gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {ev.event === 'state_change' && <ArrowRight className={`w-3.5 h-3.5 shrink-0 ${statusToneClass('info')}`} />}
                  {ev.event === 'vm_added' && <Plus className={`w-3.5 h-3.5 shrink-0 ${statusToneClass('ok')}`} />}
                  {ev.event === 'vm_removed' && <Trash2 className={`w-3.5 h-3.5 shrink-0 ${statusToneClass('error')}`} />}
                  <span className="text-white font-medium truncate">{ev.name}</span>
                  {ev.event === 'state_change' && (
                    <span className="text-slate-400 shrink-0">{ev.old_state} → {ev.new_state}</span>
                  )}
                  {ev.event === 'vm_added' && <span className={`shrink-0 ${statusToneClass('ok')}`}>created</span>}
                  {ev.event === 'vm_removed' && <span className={`shrink-0 ${statusToneClass('error')}`}>removed</span>}
                </div>
                <span className="text-xs text-slate-500 shrink-0">{timeAgo(ev.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shutdown Confirmation */}
      {showShutdownConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center animate-fade-in" onClick={() => setShowShutdownConfirm(false)}>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">Confirm Host Shutdown</h3>
            <p className="text-sm text-slate-400 mb-6">Are you sure you want to shut down this host? All running VMs will be stopped and the system will power off.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowShutdownConfirm(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition">Cancel</button>
              <button onClick={handleHostShutdown} className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium transition">Shut Down</button>
            </div>
          </div>
        </div>
      )}

      {/* Reboot Confirmation */}
      {showRebootConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center animate-fade-in" onClick={() => setShowRebootConfirm(false)}>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">Confirm Host Reboot</h3>
            <p className="text-sm text-slate-400 mb-6">Are you sure you want to reboot this host? All running VMs will be stopped and the system will restart.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowRebootConfirm(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition">Cancel</button>
              <button onClick={handleHostReboot} className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-sm font-medium transition">Reboot</button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  )
}

function StatCard({ gradient, icon, iconColor, title, value, badge }: { gradient: string; icon: React.ReactNode; iconColor: string; title: string; value: string | number; badge?: React.ReactNode }) {
  return (
    <div className={`${gradient} rounded-xl p-5 border border-slate-700/30 shadow-lg hover:border-slate-600/50 transition-all duration-300 min-w-0`}>
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className={iconColor}>{icon}</div>
        {badge}
      </div>
      <div className="mt-3">
        <div className="text-2xl font-bold text-white">{value}</div>
        <div className="text-sm text-slate-400 mt-0.5">{title}</div>
      </div>
    </div>
  )
}

function ResourceBar({ icon, label, value, extra }: { icon: React.ReactNode; label: string; value: number; extra?: string }) {
  const color = statusBgClass(utilizationTone(value))
  return (
    <div className="bg-slate-800/40 rounded-xl px-4 py-3 border border-slate-700/30 min-w-0">
      <div className="flex items-center gap-2 mb-1.5 min-w-0">
        {icon}
        <span className="text-xs text-slate-500 flex-1 min-w-0 truncate">{label}</span>
        <span className="text-xs font-semibold text-white shrink-0 tabular-nums">{value.toFixed(1)}%</span>
      </div>
      <div className="w-full bg-slate-700 rounded-full h-1.5">
        <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      {extra && <div className="text-[10px] text-slate-500 mt-1">{extra}</div>}
    </div>
  )
}

function formatUptime(secs: number): string {
  const days = Math.floor(secs / 86400)
  const hours = Math.floor((secs % 86400) / 3600)
  if (days > 0) return `${days}d ${hours}h`
  const mins = Math.floor((secs % 3600) / 60)
  return `${hours}h ${mins}m`
}

function MiniStat({ icon, label, value, extra }: { icon: React.ReactNode; label: string; value: string | number; extra?: string }) {
  return (
    <div className="bg-slate-800/40 rounded-xl px-4 py-3 border border-slate-700/30 flex items-center gap-3 min-w-0">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-sm font-semibold text-white">{value}</div>
      </div>
      {extra && <span className="text-[10px] text-slate-500">{extra}</span>}
    </div>
  )
}

function ChartCard({ title, icon, current, children }: { title: string; icon: React.ReactNode; current: string; children: React.ReactNode }) {
  return (
    <div className="card p-5 hover:border-white/15 transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">{icon} {title}</h3>
        <span className="text-xs text-slate-400 font-mono">{current}</span>
      </div>
      {children}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 skeleton" />
      <div className={METRIC_GRID}>
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 skeleton" />)}
      </div>
      <div className="h-72 skeleton" />
      <div className="h-64 skeleton" />
    </div>
  )
}
