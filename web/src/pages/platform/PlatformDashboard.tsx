// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  Boxes,
  Plus,
  Server,
  Bell,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Shield,
  Sparkles,
  LayoutGrid,
  FolderOpen,
  Wrench,
} from 'lucide-react'
import PageLayout from '../../components/PageLayout'
import ActionCard from '../../components/platform/ActionCard'
import PlatformAboutHelp from '../../components/platform/PlatformAboutHelp'
import PlatformJarvisBriefing from '../../components/platform/PlatformJarvisBriefing'
import ZeusApprovalQueue from '../../components/ai/ZeusApprovalQueue'
import RemediateChips from '../../components/platform/RemediateChips'
import PlatformWelcome from '../../components/platform/PlatformWelcome'
import InfrastructureDnaStrip from '../../components/platform/InfrastructureDnaStrip'
import EnterpriseSecurityStrip from '../../components/platform/EnterpriseSecurityStrip'
import PlatformTahoeHero from '../../components/platform/tahoe/PlatformTahoeHero'
import PlatformTahoeEmptyState from '../../components/platform/tahoe/PlatformTahoeEmptyState'
import { MacGlassPanel } from '../../components/platform/mac/PlatformMacUi'
import SimpleCreateVmWizard, { sizeToSpec } from '../../components/platform/SimpleCreateVmWizard'
import {
  createPlatformVm,
  getCapacityReport,
  getClusterSummary,
  listPlatformHosts,
  listPlatformTasks,
  listPlatformVms,
  type CapacityReport,
  type ClusterSummary,
  type CreatePlatformVmBody,
  type PlatformHost,
  type PlatformTask,
} from '../../api/platform'
import { getAiSecurity, getAiSettings, getZeusSummary, runAutopilotSafe, type AiSettings, type SecurityReport } from '../../api/ai'
import { useAi } from '../../contexts/AiContext'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import {hostStateTone, httpStatusTone, migrationReadinessTone, riskTone, statusBadgeClasses, statusPillClasses, statusSurfaceClasses, statusToneClass, taskStatusTone, webhookDeliveryTone, hubLinkClasses} from '../../utils/semanticColors'
import { loadJarvisShell } from '../../utils/platformJarvisShell'
import { usePlatformDesktopTier } from '../../hooks/usePlatformDesktopTier'
import { tierAtLeast } from '../../utils/platformDesktopTier'
import { hubTilesForTier, showPlatformHubsForTier, DOCK_PREVIEW_HUB_PATHS } from '../../utils/platformHubZones'
import { operationsHubHref } from '../../utils/platformHubLinks'
import { unlockDockPreviewPath } from '../../utils/platformDockPins'

export default function PlatformDashboard() {
  const toast = useToastContext()
  const navigate = useNavigate()
  const { mode } = useAi()
  const [tier] = usePlatformDesktopTier()
  const showPower = tierAtLeast(tier, 'power')
  const showAdvanced = tier === 'advanced'
  const jarvisShell = loadJarvisShell(tier)
  const jarvisLanding = jarvisShell && !showPower
  const [autopilotBusy, setAutopilotBusy] = useState(false)
  const [hosts, setHosts] = useState<PlatformHost[]>([])
  const [vms, setVms] = useState<{ observed_state: string }[]>([])
  const [tasks, setTasks] = useState<PlatformTask[]>([])
  const [cluster, setCluster] = useState<ClusterSummary | null>(null)
  const [capacity, setCapacity] = useState<CapacityReport | null>(null)
  const [security, setSecurity] = useState<SecurityReport | null>(null)
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [zeusStrip, setZeusStrip] = useState<{
    status: string
    tagline: string
    firewallCritical: number
    firewallDrift: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [hosts, v, t, c, cap, sec, ai] = await Promise.all([
        listPlatformHosts(),
        listPlatformVms(),
        listPlatformTasks(),
        getClusterSummary(),
        getCapacityReport().catch(() => null),
        getAiSecurity().catch(() => null),
        getAiSettings().catch(() => null),
      ])
      setHosts(hosts)
      setVms(v)
      setTasks(t)
      setCluster(c)
      setCapacity(cap)
      setSecurity(sec)
      setAiSettings(ai)
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    void getZeusSummary()
      .then((z) => setZeusStrip({
        status: z.status,
        tagline: z.tagline,
        firewallCritical: z.firewall_critical_hosts ?? 0,
        firewallDrift: z.firewall_drift_hosts ?? 0,
      }))
      .catch(() => {})
  }, [])

  const running = vms.filter((v) => v.observed_state === 'running').length
  const onlineHosts = hosts.filter((h) => h.state !== 'offline').length
  const failedTasks = tasks.filter((t) => t.status === 'failed').length
  const warnings = failedTasks + (cluster?.offline_hosts || 0)
  const storagePct = capacity && capacity.memory_total_mib > 0
    ? (capacity.memory_used_mib / capacity.memory_total_mib) * 100
    : null
  const healthy = warnings === 0 && onlineHosts === hosts.length
  const securityFindings = security?.findings?.length ?? 0
  const hubTiles = hubTilesForTier(tier)
  const previewHubTiles = hubTilesForTier('power').filter((hub) => DOCK_PREVIEW_HUB_PATHS.includes(hub.href))

  const hubActionIcon = (id: string) => {
    switch (id) {
      case 'integrations':
        return <Boxes className="w-5 h-5" />
      case 'resources':
        return <FolderOpen className="w-5 h-5" />
      case 'operations':
        return <Wrench className="w-5 h-5" />
      case 'security':
        return <Shield className="w-5 h-5" />
      default:
        return <Boxes className="w-5 h-5" />
    }
  }

  const handleCreate = async ({ name, os, size, network }: { name: string; os: string; size: string; network: string }) => {
    const spec = sizeToSpec(size)
    const body: CreatePlatformVmBody = {
      api_version: 'virt.zyvor.dev/v1',
      kind: 'VirtualMachine',
      metadata: { name },
      tags: [os, network],
      spec: {
        cpu: { sockets: 1, cores: spec.cores },
        memory: spec.memory,
        storage: [{ name: 'root', size: spec.disk, class: 'silver' }],
        network: [{ network, ip_mode: 'dhcp' }],
      },
    }
    await createPlatformVm(body)
    toast.success('Create task queued')
    await load()
  }

  return (
    <PageLayout hideHeader error={error}>
      <PlatformJarvisBriefing />
      <ZeusApprovalQueue />
      {showPower && <RemediateChips compact />}

      {!jarvisLanding && (
      <PlatformTahoeHero
        compact
        eyebrow="Zyvor Platform"
        title={cluster?.name || 'Production Cluster'}
        subtitle="Control your KVM datacenter — fleet health, VMs, and integrations in one desktop."
        icon={LayoutGrid}
        badge={
          <span className={`tahoe-health-badge ${healthy ? 'tahoe-health-badge-ok' : 'tahoe-health-badge-warn'}`}>
            {healthy ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            {healthy ? 'Healthy' : `${warnings} warning${warnings === 1 ? '' : 's'}`}
          </span>
        }
        actions={
          <button type="button" onClick={() => void load()} className="tahoe-btn-ghost">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
        stats={[
          { label: 'VMs running', value: String(running), tone: running > 0 ? 'emerald' : 'sky' },
          { label: 'Hosts online', value: `${onlineHosts} / ${hosts.length}`, tone: onlineHosts === hosts.length ? 'emerald' : 'amber' },
          { label: 'Memory used', value: storagePct != null ? `${Math.round(storagePct)}%` : '—', tone: 'violet' },
          { label: 'Alerts', value: warnings ? String(warnings) : 'None', tone: warnings ? 'amber' : 'emerald' },
        ]}
      />
      )}

      <div className="tahoe-content space-y-4">
      {hosts.length === 0 && (
        <PlatformTahoeEmptyState
          icon={Server}
          title="Get started"
          description="Enroll your first hypervisor to import storage, networks, and VMs."
        >
          <Link to="/platform/enroll" className="tahoe-btn-primary text-sm">Add host</Link>
          <Link to="/platform/integrations" className="tahoe-btn-ghost text-sm">Apps &amp; Integrations</Link>
        </PlatformTahoeEmptyState>
      )}

      {showPower && <InfrastructureDnaStrip />}

      {showAdvanced && <EnterpriseSecurityStrip />}

      {showPower && zeusStrip && (
        <MacGlassPanel title="Posture" subtitle={zeusStrip.tagline}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 -mt-1">
            <div className="space-y-2">
              <span className="inline-flex items-center gap-1.5 text-sm text-orange-200/90">
                <Sparkles className="w-4 h-4 text-orange-400" />
                {zeusStrip.status}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/platform/zeus/security/firewall"
                  className={`${statusSurfaceClasses(
                    zeusStrip.firewallCritical > 0 ? 'error' : zeusStrip.firewallDrift > 0 ? 'warn' : 'ok',
                    'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition',
                  )}`}
                >
                  <Shield className="w-3 h-3" />
                  {zeusStrip.firewallCritical > 0
                    ? `${zeusStrip.firewallCritical} critical firewall host(s)`
                    : zeusStrip.firewallDrift > 0
                      ? `${zeusStrip.firewallDrift} host(s) with drift`
                      : 'Zeus Firewall OK'}
                </Link>
                {securityFindings > 0 && (
                  <Link
                    to="/platform/zeus/security"
                    className={`${statusSurfaceClasses('warn', 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border')}`}
                  >
                    <Shield className="w-3 h-3" />
                    {securityFindings} finding{securityFindings === 1 ? '' : 's'}
                  </Link>
                )}
              </div>
            </div>
            <Link to="/platform/zeus/security" className="tahoe-btn-primary text-sm shrink-0">
              Open Security Center
            </Link>
          </div>
        </MacGlassPanel>
      )}

      {showAdvanced && mode === 'autopilot' && (
        <MacGlassPanel title="Machina Autopilot" subtitle={`Runs up to ${aiSettings?.autopilot_max_actions ?? 5} low-risk fixes per batch — audited`}>
          <p className="text-sm text-slate-400 -mt-2">Backups, HA enable, and guest tools installs only. Destructive actions always require manual review.</p>
          {aiSettings && aiSettings.autopilot_interval_secs > 0 && (
            <p className="text-xs text-slate-500 mt-2">
              Scheduled every {aiSettings.autopilot_interval_secs}s
              {aiSettings.autopilot_last_run
                ? ` · last run ${new Date(aiSettings.autopilot_last_run).toLocaleString()}`
                : ' · no runs yet'}
            </p>
          )}
          <button
            type="button"
            className="btn-primary text-sm mt-3"
            disabled={autopilotBusy}
            onClick={async () => {
              setAutopilotBusy(true)
              try {
                const r = await runAutopilotSafe(undefined, aiSettings?.autopilot_max_actions ?? 5)
                toast.success(`Autopilot ran ${r.executed_count} action(s), skipped ${r.skipped_count}`)
              } catch (e: unknown) {
                toast.error(formatUserError(e))
              } finally {
                setAutopilotBusy(false)
              }
            }}
          >
            {autopilotBusy ? 'Running…' : 'Run safe fixes now'}
          </button>
        </MacGlassPanel>
      )}

      {showAdvanced && <PlatformAboutHelp compact />}

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-400 mb-1">Quick actions</h2>
          <p className="text-xs text-slate-500">Create workloads or open a desktop hub — no duplicate app lists.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionCard icon={<Plus className="w-5 h-5" />} title="Create VM" subtitle="Simple wizard — OS, size, network" onClick={() => setWizardOpen(true)} />
          {!showPlatformHubsForTier(tier) && (
            <>
              <ActionCard icon={<Boxes className="w-5 h-5" />} title="Apps & Integrations" subtitle="OpenStack, K8s, classic tools" to="/platform/integrations" />
              <ActionCard icon={<Server className="w-5 h-5" />} title="Add Host" subtitle="Enroll a hypervisor" to="/platform/enroll" />
              <ActionCard icon={<Bell className="w-5 h-5" />} title="Alerts" subtitle={`${warnings} need attention`} to={operationsHubHref(tier)} />
            </>
          )}
        </div>
        {tier === 'normal' && previewHubTiles.length > 0 && (
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Hub previews · Power user</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {previewHubTiles.map((hub) => (
                <button
                  key={hub.id}
                  type="button"
                  className="platform-action-card tahoe-hub-preview-card flex flex-col items-start gap-3 p-5 rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] transition-all text-left w-full"
                  onClick={() => {
                    if (unlockDockPreviewPath(hub.href)) {
                      toast.success('Switched to Power user — hub unlocked')
                      navigate(hub.href)
                    }
                  }}
                >
                  <div className="p-2.5 rounded-xl bg-slate-800/60 text-slate-300">{hubActionIcon(hub.id)}</div>
                  <div>
                    <p className="font-semibold text-slate-200">{hub.label}</p>
                    <p className="text-xs text-slate-500 mt-1">{hub.description}</p>
                    <p className="text-[10px] text-sky-400/80 mt-2">Tap to unlock Power user</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        {showPlatformHubsForTier(tier) && hubTiles.length > 0 && (
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Platform hubs</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {hubTiles.map((hub) => (
                <ActionCard
                  key={hub.id}
                  icon={hubActionIcon(hub.id)}
                  title={hub.label}
                  subtitle={hub.description}
                  to={hub.href}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {showPower && (
        <MacGlassPanel
          title={showAdvanced ? 'Recent tasks' : 'Hosts'}
          subtitle={showAdvanced ? 'Activity Monitor preview' : 'Hypervisors in this cluster'}
          action={
            <Link to={showAdvanced ? operationsHubHref(tier) : '/platform/hosts'} className={`text-xs ${hubLinkClasses()}`}>
              View all
            </Link>
          }
        >
          {showAdvanced ? (
            <ul className="space-y-2 text-sm -mt-2">
              {tasks.slice(0, 6).map((t) => (
                <li key={t.id} className="flex justify-between border-b border-white/[0.04] pb-2 last:border-0">
                  <span className="text-slate-300">{t.operation}</span>
                  <span className={statusToneClass(t.status === 'failed' ? 'error' : 'neutral')}>{t.status} {t.progress}%</span>
                </li>
              ))}
              {tasks.length === 0 && (
                <li className="text-slate-500 text-sm py-2">No tasks yet — lifecycle actions appear here.</li>
              )}
            </ul>
          ) : (
            <ul className="space-y-2 text-sm -mt-2">
              {hosts.slice(0, 6).map((h) => (
                <li key={h.id} className="flex justify-between items-center">
                  <Link to={`/platform/hosts/${h.id}`} className={`hover:underline ${hubLinkClasses()}`}>{h.hostname}</Link>
                  <span className={`text-xs capitalize ${statusToneClass(hostStateTone(h.state))}`}>{h.state} · {h.vm_count} VMs</span>
                </li>
              ))}
              {hosts.length === 0 && (
                <li className="text-slate-500 text-sm">
                  No hosts enrolled — <Link to="/platform/enroll" className={hubLinkClasses()}>Add Host</Link>
                </li>
              )}
            </ul>
          )}
        </MacGlassPanel>
      )}

      </div>

      <SimpleCreateVmWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreate={handleCreate} />
      <PlatformWelcome vmCount={vms.length} onCreateVm={() => setWizardOpen(true)} onDone={() => void load()} />
    </PageLayout>
  )
}
