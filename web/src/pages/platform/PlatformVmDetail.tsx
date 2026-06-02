// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, Copy, Play, Square, RotateCcw, Trash2, Terminal, MoveRight, Archive, HardDrive, Activity, Shield, ExternalLink, Monitor } from 'lucide-react'
import PageLayout from '../../components/PageLayout'
import GuestToolsStrip from '../../components/platform/GuestToolsStrip'
import MachinaDoctorPanel from '../../components/platform/MachinaDoctorPanel'
import ExplainButton from '../../components/ai/ExplainButton'
import OsDiagnosePanel from '../../components/platform/OsDiagnosePanel'
import VmDetailTabs, { type VmDetailTab, isGuestRelatedTab } from '../../components/platform/VmDetailTabs'
import { MacGlassPanel, MacListRow } from '../../components/platform/mac/PlatformMacUi'
import JsonInspector from '../../components/platform/JsonInspector'
import { StructuredErrorBanner } from '../../components/StructuredErrorBanner'
import {
  createVmBackup,
  createVmSnapshot,
  deleteVmSnapshot,
  getPlatformVm,
  getPlatformVmSpec,
  getVmDisks,
  getPlatformVmMetrics,
  getVmMigrations,
  runVmHealthCheck,
  attachVmDisk,
  adoptPlatformVm,
  getVmHaPolicy,
  listPlatformHosts,
  listVmBackups,
  listVmSnapshots,
  migratePrecheck,
  patchVm,
  restoreVmBackup,
  revertVmSnapshot,
  setVmHa,
  vmClone,
  installGuestTools,
  vmDelete,
  vmMigrate,
  vmPower,
  type PlatformHost,
  type PlatformVm,
  type MigratePrecheckResult,
  type HaPolicy,
  type SnapshotRecord,
  type VmDiskRow,
  type VmMigrationRecord,
  type BackupRecord,
  type VmHealthReport,
  getVmGuestHealth,
  getVmGuestServices,
  diagnoseVm,
  getVmTopology,
  type TopologyGraph,
  type VmGuestHealthReport,
  type VmGuestServicesReport,
  type VmOsDiagnoseReport,
} from '../../api/platform'
import { getVmDoctor, type VmDoctorReport } from '../../api/ai'
import { getVmGuestFirewallPorts, type GuestPortReport } from '../../api/zeusFirewall'
import { useAi } from '../../contexts/AiContext'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import {hostStateTone, httpStatusTone, migrationReadinessTone, riskTone, statusBadgeClasses, statusPillClasses, statusToneClass, taskStatusTone, vmStateTone, webhookDeliveryTone, hubLinkClasses} from '../../utils/semanticColors'
import { vmErrorPresentation } from '../../utils/vmErrorPresentation'
import { isCenterPopoutMode, openCenterPopout } from '../../utils/platformCenterPopout'
import { PlatformOpenStackVmLink } from '../../components/platform/PlatformCrossLinks'
import { usePlatformDesktopTier } from '../../hooks/usePlatformDesktopTier'
import { tasksHubHref } from '../../utils/platformHubLinks'

export default function PlatformVmDetail() {
  const location = useLocation()
  const navigate = useNavigate()
  const isPopout = isCenterPopoutMode(location.search)
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const rawTab = tabParam === 'guestPorts' ? 'security' : tabParam
  const tab: VmDetailTab = (
    ['overview', 'doctor', 'console', 'performance', 'disks', 'network', 'guestHealth', 'guestServices', 'security', 'snapshots', 'backup', 'topology', 'events', 'settings'] as VmDetailTab[]
  ).includes(rawTab as VmDetailTab) ? (rawTab as VmDetailTab) : 'overview'
  const setTab = (next: VmDetailTab) => {
    if (next === 'console' && id) {
      navigate(`/platform/vms/${id}/console`)
      return
    }
    setSearchParams((p) => {
      const n = new URLSearchParams(p)
      if (next === 'overview') n.delete('tab')
      else n.set('tab', next)
      return n
    }, { replace: true })
  }
  const [tier] = usePlatformDesktopTier()
  const { setContextVmId, openCopilot } = useAi()
  const toast = useToastContext()
  const [vm, setVm] = useState<PlatformVm | null>(null)
  const [hosts, setHosts] = useState<PlatformHost[]>([])
  const [error, setError] = useState<string | null>(null)
  const [destHost, setDestHost] = useState('')
  const [cloneName, setCloneName] = useState('')
  const [precheck, setPrecheck] = useState<MigratePrecheckResult | null>(null)
  const [ha, setHa] = useState<HaPolicy>({ enabled: false, restart_attempts: 3, restart_priority: 'medium', fence_on_failure: false, anti_affinity: false })
  const [specJson, setSpecJson] = useState<string>('')
  const [specData, setSpecData] = useState<Record<string, unknown> | null>(null)
  const [snapName, setSnapName] = useState('snap-01')
  const [project, setProject] = useState('')
  const [tags, setTags] = useState('')
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([])
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [disks, setDisks] = useState<VmDiskRow[]>([])
  const [metrics, setMetrics] = useState<{ cpu_percent: number; memory_used_mib: number; updated_at: string } | null>(null)
  const [attachPath, setAttachPath] = useState('/var/lib/libvirt/images/data.qcow2')
  const [attachDev, setAttachDev] = useState('vdb')
  const [health, setHealth] = useState<VmHealthReport | null>(null)
  const [doctor, setDoctor] = useState<VmDoctorReport | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [doctorLoading, setDoctorLoading] = useState(false)
  const [guestInstalling, setGuestInstalling] = useState(false)
  const [guestPorts, setGuestPorts] = useState<GuestPortReport | null>(null)
  const [guestPortsLoading, setGuestPortsLoading] = useState(false)
  const [guestHealth, setGuestHealth] = useState<VmGuestHealthReport | null>(null)
  const [guestHealthLoading, setGuestHealthLoading] = useState(false)
  const [guestServices, setGuestServices] = useState<VmGuestServicesReport | null>(null)
  const [topology, setTopology] = useState<TopologyGraph | null>(null)
  const [guestServicesLoading, setGuestServicesLoading] = useState(false)
  const [vmDiagnose, setVmDiagnose] = useState<VmOsDiagnoseReport | null>(null)
  const [vmDiagnoseLoading, setVmDiagnoseLoading] = useState(false)
  const [migrations, setMigrations] = useState<VmMigrationRecord[]>([])

  const load = useCallback(async () => {
    if (!id) return
    setError(null)
    try {
      const [v, h, policy, spec, snaps, bks, dsk, mtr] = await Promise.all([
        getPlatformVm(id),
        listPlatformHosts(),
        getVmHaPolicy(id),
        getPlatformVmSpec(id),
        listVmSnapshots(id),
        listVmBackups(id),
        getVmDisks(id),
        getPlatformVmMetrics(id).catch(() => null),
      ])
      setVm(v)
      setHosts(h)
      setHa(policy)
      setSpecJson(JSON.stringify(spec, null, 2))
      setSpecData(spec as Record<string, unknown>)
      setProject(v.project || '')
      setTags((v.tags || []).join(', '))
      setSnapshots(snaps)
      setBackups(bks)
      setDisks(dsk)
      setMetrics(mtr)
      if (!destHost && h.length > 1) {
        setDestHost(h.find((x) => x.id !== v.host_id)?.id || h[0]?.id || '')
      }
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [id, destHost])

  useEffect(() => {
    if (tab !== 'topology' || !id) return
    void getVmTopology(id).then(setTopology).catch(() => setTopology(null))
  }, [tab, id])

  const runHealth = useCallback(async () => {
    if (!id) return
    setHealthLoading(true)
    try {
      setHealth(await runVmHealthCheck(id))
    } catch {
      setHealth(null)
    } finally {
      setHealthLoading(false)
    }
  }, [id])

  const runDoctor = useCallback(async () => {
    if (!id) return
    setDoctorLoading(true)
    try {
      setDoctor(await getVmDoctor(id))
    } catch {
      setDoctor(null)
    } finally {
      setDoctorLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  useEffect(() => { void runHealth() }, [runHealth])
  useEffect(() => { void runDoctor() }, [runDoctor])

  useEffect(() => {
    if (!id || tab !== 'events') return
    void getVmMigrations(id).then(setMigrations).catch(() => setMigrations([]))
  }, [id, tab])

  const loadGuestPorts = useCallback(async () => {
    if (!id) return
    setGuestPortsLoading(true)
    try {
      setGuestPorts(await getVmGuestFirewallPorts(id))
    } catch {
      setGuestPorts(null)
    } finally {
      setGuestPortsLoading(false)
    }
  }, [id])

  const loadGuestHealth = useCallback(async () => {
    if (!id) return
    setGuestHealthLoading(true)
    try {
      setGuestHealth(await getVmGuestHealth(id))
    } catch {
      setGuestHealth(null)
    } finally {
      setGuestHealthLoading(false)
    }
  }, [id])

  const loadGuestServices = useCallback(async () => {
    if (!id) return
    setGuestServicesLoading(true)
    try {
      setGuestServices(await getVmGuestServices(id))
    } catch {
      setGuestServices(null)
    } finally {
      setGuestServicesLoading(false)
    }
  }, [id])

  const runVmDiagnose = useCallback(async (query?: string) => {
    if (!id) return
    setVmDiagnoseLoading(true)
    try {
      setVmDiagnose(await diagnoseVm(id, query))
    } catch {
      setVmDiagnose(null)
    } finally {
      setVmDiagnoseLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (tab === 'security' && id) void loadGuestPorts()
    if (tab === 'guestHealth' && id) void loadGuestHealth()
    if (tab === 'guestServices' && id) void loadGuestServices()
  }, [tab, id, loadGuestPorts, loadGuestHealth, loadGuestServices])

  useEffect(() => {
    setContextVmId(id ?? null)
    return () => setContextVmId(null)
  }, [id, setContextVmId])

  const act = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn(); toast.success(label); await load() } catch (e: unknown) { toast.error(formatUserError(e)) }
  }

  const hostName = hosts.find((h) => h.id === vm?.host_id)?.hostname
  const stateTone = vm ? vmStateTone(vm.observed_state) : 'neutral'
  const lifecycleTone = vm?.lifecycle_phase === 'running' ? 'ok' : vm?.lifecycle_phase === 'error' ? 'error' : 'neutral'

  if (!id) return null

  const powerActions = vm && vm.inventory_source !== 'kubevirt' && vm.observed_state !== 'missing' ? (
    <>
      <button type="button" className="btn-primary text-sm" onClick={() => void act('Start queued', () => vmPower(id, 'start'))}><Play className="w-4 h-4" /> Start</button>
      <button type="button" className="btn-secondary text-sm" onClick={() => void act('Stop queued', () => vmPower(id, 'stop'))}><Square className="w-4 h-4" /> Stop</button>
      <button type="button" className="btn-secondary text-sm" onClick={() => void act('Reboot queued', () => vmPower(id, 'reboot'))}><RotateCcw className="w-4 h-4" /> Reboot</button>
    </>
  ) : null

  return (
    <PageLayout
      compact
      prepend={!isPopout ? (
        <Link to="/platform/vms" className={`text-sm inline-flex items-center gap-1 ${hubLinkClasses()}`}>
          <ArrowLeft className="w-4 h-4" /> Virtual Machines
        </Link>
      ) : undefined}
      title={vm?.name ?? 'Virtual machine'}
      subtitle={vm ? (
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className={statusPillClasses(stateTone)}>{vm.observed_state}</span>
          {vm.lifecycle_phase && vm.lifecycle_phase !== vm.observed_state && (
            <span className={statusPillClasses(lifecycleTone)}>{vm.lifecycle_phase}</span>
          )}
          <span className="text-slate-500">·</span>
          <span className="text-slate-400">{hostName || 'No host'}</span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-400">{vm.vcpus} vCPU · {Math.round(vm.memory_mib / 1024)} GiB</span>
          {vm.ha_enabled && <span className={statusPillClasses('info')}>HA</span>}
        </span>
      ) : undefined}
      icon={<Monitor className="w-6 h-6 text-slate-400" />}
      actions={vm ? (
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/platform/vms/${id}/console`} className="btn-primary text-sm inline-flex items-center gap-1">
            <Terminal className="w-4 h-4" /> Console
          </Link>
          {powerActions}
          {!isPopout && (
            <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1" onClick={() => openCenterPopout(`/platform/vms/${id}`)}>
              <ExternalLink className="w-4 h-4" /> Pop out
            </button>
          )}
          <button
            type="button"
            className="btn-danger text-sm"
            onClick={() => {
              if (!window.confirm('Delete this VM permanently?')) return
              void act('Delete queued', () => vmDelete(id, true))
            }}
          >
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </div>
      ) : undefined}
      error={error}
      contentLoading={!vm && !error}
    >
      {vm && (
        <>
          <PlatformOpenStackVmLink vm={vm} />
          {vm.inventory_source === 'kubevirt' && (
            <MacGlassPanel title="KubeVirt guest">
              <p className="text-sm text-slate-300">
                Namespace: <span className="font-mono text-sky-200">{vm.k8s_namespace ?? 'default'}</span>
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Link to="/platform/integrations?tab=k8s" className={`text-sm ${hubLinkClasses()}`}>K8s Workloads →</Link>
              </div>
            </MacGlassPanel>
          )}

          {vm.observed_state === 'missing' && (
            <MacGlassPanel title="Missing from inventory">
              <p className={`text-sm ${statusToneClass('warn')}`}>
                This VM is no longer reported by the last inventory scan. Sync hosts or remove the stale record.
              </p>
            </MacGlassPanel>
          )}
          {vm.managed === false && (
            <MacGlassPanel title="Discovered VM">
              <div className="flex items-center justify-between gap-3">
                <p className={`text-sm ${statusToneClass('warn')}`}>
                  {vm.inventory_source === 'kubevirt'
                    ? 'Discovered KubeVirt VM — adopt to track it in platform inventory.'
                    : 'Discovered on a host — adopt to manage lifecycle from the platform.'}
                </p>
                <button type="button" className="btn-primary" onClick={() => void act('VM adopted', () => adoptPlatformVm(id))}>Adopt VM</button>
              </div>
            </MacGlassPanel>
          )}
          {vm.last_error && (
            <StructuredErrorBanner error={vmErrorPresentation(vm.last_error)} />
          )}
          {(vm.observed_state === 'missing' || (vm.last_error && /nodomain|domain not found|no domain with matching name|domain_not_found|kubevirt_not_found/i.test(vm.last_error))) && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-danger text-sm"
                onClick={() => {
                  if (!window.confirm('Remove this stale VM record from the platform?')) return
                  void act('Stale VM removed', () => vmDelete(id, true))
                }}
              >
                <Trash2 className="w-4 h-4" /> Remove stale record
              </button>
              <Link to="/platform/hosts" className="btn-secondary text-sm inline-flex items-center">Sync hosts →</Link>
            </div>
          )}

          <VmDetailTabs active={tab} onChange={setTab} />

          {isGuestRelatedTab(tab) && (
            <GuestToolsStrip
              vmId={id}
              compact={tab !== 'overview'}
              status={health?.guest_tools_status}
              guestIp={health?.guest_ip}
              guestHostname={health?.guest_hostname}
              installing={guestInstalling}
              onInstall={() => {
                if (!id) return
                setGuestInstalling(true)
                void installGuestTools(id)
                  .then(() => { toast.success('Guest tools install queued'); return runHealth() })
                  .catch((e: unknown) => toast.error(formatUserError(e)))
                  .finally(() => setGuestInstalling(false))
              }}
            />
          )}

          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <InfoCard label="Desired state" value={vm.desired_state} />
                <InfoCard label="Lifecycle" value={vm.lifecycle_phase || 'idle'} />
                <InfoCard label="Project" value={project || 'default'} />
                <InfoCard label="Backup" value={backups.some((b) => b.status === 'completed') ? 'Protected' : 'Not configured'} />
              </div>
              {metrics && (
                <MacGlassPanel title="At a glance">
                  <div className="flex flex-wrap gap-6 text-sm text-slate-300">
                    <span className="flex items-center gap-2"><Activity className="w-4 h-4 text-slate-500" /> CPU {metrics.cpu_percent.toFixed(1)}%</span>
                    <span>Memory {metrics.memory_used_mib} MiB</span>
                    <button type="button" className={`text-xs ${hubLinkClasses()}`} onClick={() => setTab('performance')}>Performance details →</button>
                  </div>
                </MacGlassPanel>
              )}
              <MacGlassPanel title="Organization">
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Project</label>
                    <input className="input" value={project} onChange={(e) => setProject(e.target.value)} placeholder="default" />
                  </div>
                  <div className="flex-1 min-w-[12rem]">
                    <label className="text-xs text-slate-500 block mb-1">Tags</label>
                    <input className="input w-full" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="prod, web" />
                  </div>
                  <button type="button" className="btn-secondary" onClick={() => void act('Project updated', () => patchVm(id, { project, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }))}>Save</button>
                </div>
              </MacGlassPanel>
              {vm.host_id && (
                <div className="flex flex-wrap gap-3 text-sm">
                  <Link to={`/platform/zeus/security/firewall/${vm.host_id}`} className={`inline-flex items-center gap-1 ${hubLinkClasses()}`}>
                    <Shield className="w-4 h-4" /> Host firewall (Zeus)
                  </Link>
                  <button type="button" className={hubLinkClasses()} onClick={() => setTab('doctor')}>Run health doctor →</button>
                </div>
              )}
            </div>
          )}

          {tab === 'doctor' && (
            <div className="pt-2 space-y-3">
              <div className="flex justify-end">
                <ExplainButton screen="vm_doctor" objectRef={{ vm_id: id, score: doctor?.score_numeric }} />
              </div>
              <MachinaDoctorPanel
                vmId={id}
                report={doctor}
                loading={doctorLoading}
                onRefresh={() => void runDoctor()}
                onTab={(t) => setTab(t as VmDetailTab)}
              />
            </div>
          )}

          {tab === 'console' && (
            <MacGlassPanel title="Console">
              <p className="text-sm text-slate-400 mb-4">
                Opens a full-screen noVNC session in a dedicated view.
              </p>
              <Link to={`/platform/vms/${id}/console`} className="btn-primary inline-flex items-center gap-2">
                <Terminal className="w-4 h-4" /> Open graphical console
              </Link>
            </MacGlassPanel>
          )}

          {tab === 'performance' && (
            <MacGlassPanel title="Performance">
              {metrics ? (
                <>
                  <div className="flex flex-wrap gap-6 text-sm">
                    <span className="flex items-center gap-2"><Activity className="w-4 h-4" /> CPU {metrics.cpu_percent.toFixed(1)}%</span>
                    <span>Memory {metrics.memory_used_mib} MiB</span>
                    <span className="text-slate-500 text-xs">Updated {new Date(metrics.updated_at).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-slate-500">Guest tools will unlock richer CPU, disk latency, and noisy-neighbor insights.</p>
                </>
              ) : (
                <p className="text-slate-500 text-sm">Metrics appear after the next host inventory sync.</p>
              )}
            </MacGlassPanel>
          )}

          {tab === 'disks' && (
            <div className="space-y-4 pt-2">
              {disks.length > 0 && (
                <MacGlassPanel title="Attached disks">
                  <ul className="text-sm text-slate-400 space-y-2">{disks.map((d) => (
                    <li key={d.id}>{d.name} · {d.size_gib} GiB · {d.storage_class}{d.path ? ` · ${d.path}` : ''}</li>
                  ))}</ul>
                </MacGlassPanel>
              )}
              <MacGlassPanel title="Attach disk">
                <div className="flex flex-wrap gap-3 items-end">
                  <label className="text-xs text-slate-500">Path<input className="input mt-1 block min-w-[18rem]" value={attachPath} onChange={(e) => setAttachPath(e.target.value)} /></label>
                  <label className="text-xs text-slate-500">Target dev<input className="input mt-1 block w-24" value={attachDev} onChange={(e) => setAttachDev(e.target.value)} /></label>
                  <button type="button" className="btn-secondary" disabled={vm.managed === false} onClick={() => void act('Attach disk queued', () => attachVmDisk(id, { disk_path: attachPath, target_dev: attachDev }))}>Attach</button>
                </div>
              </MacGlassPanel>
            </div>
          )}

          {tab === 'network' && (
            <MacGlassPanel title="Network" className="pt-2">
              <p className="text-sm text-slate-400">Network configuration is defined in the VM spec. Use migration pre-check for cross-host network validation.</p>
              <Link to="/platform/networks" className={`text-sm mt-2 inline-block ${hubLinkClasses()}`}>Manage networks →</Link>
            </MacGlassPanel>
          )}

          {tab === 'guestHealth' && (
            <div className="space-y-4 pt-2">
              <MacGlassPanel title="Guest OS health" subtitle="QEMU guest agent · in-VM health signals">
                {guestHealthLoading && <p className="text-sm text-slate-500">Loading…</p>}
                {!guestHealthLoading && guestHealth && (
                  <>
                    <p className="text-xs text-slate-500 mb-3">{guestHealth.summary}</p>
                    <div className="grid gap-2 text-sm md:grid-cols-2 mb-3">
                      <div>OS: {guestHealth.os_pretty_name || '—'}</div>
                      <div>IP: {guestHealth.guest_ip || '—'}</div>
                      <div>Hostname: {guestHealth.guest_hostname || '—'}</div>
                      <div className={statusToneClass(guestHealth.healthy ? 'ok' : 'warn')}>
                        {guestHealth.healthy ? 'Healthy' : 'Needs attention'}
                      </div>
                    </div>
                    {guestHealth.issues.length > 0 && (
                      <ul className={`text-sm space-y-1 ${statusToneClass('warn')}`}>
                        {guestHealth.issues.map((issue) => (
                          <li key={issue}>• {issue}</li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                <button type="button" className="btn-secondary text-xs mt-3" onClick={() => void loadGuestHealth()}>Refresh</button>
                <OsDiagnosePanel
                  resourceId={id!}
                  resourceKind="vm"
                  defaultQuery="guest health and agent connectivity"
                  loading={vmDiagnoseLoading}
                  report={vmDiagnose}
                  onRun={(q) => void runVmDiagnose(q)}
                  onAskCopilot={openCopilot}
                />
              </MacGlassPanel>
            </div>
          )}

          {tab === 'guestServices' && (
            <div className="space-y-4 pt-2">
              <MacGlassPanel title="Guest services" subtitle="Agent + listening process inventory (v1)">
                {guestServicesLoading && <p className="text-sm text-slate-500">Loading…</p>}
                {!guestServicesLoading && guestServices && (
                  <>
                    <p className="text-xs text-slate-500 mb-3">{guestServices.summary}</p>
                    {guestServices.services.length === 0 ? (
                      <p className="text-sm text-slate-500">No guest services reported.</p>
                    ) : (
                      guestServices.services.map((s, i) => (
                        <MacListRow key={`${s.name}-${i}`} title={s.name} subtitle={`${s.status} · ${s.detail}`} />
                      ))
                    )}
                  </>
                )}
                <button type="button" className="btn-secondary text-xs mt-3" onClick={() => void loadGuestServices()}>Refresh</button>
                <OsDiagnosePanel
                  resourceId={id!}
                  resourceKind="vm"
                  defaultQuery="guest services and exposed ports"
                  loading={vmDiagnoseLoading}
                  report={vmDiagnose}
                  onRun={(q) => void runVmDiagnose(q)}
                  onAskCopilot={openCopilot}
                />
              </MacGlassPanel>
            </div>
          )}

          {tab === 'security' && (
            <div className="space-y-4 pt-2">
              <div className="flex justify-end">
                <ExplainButton screen="guest_ports" objectRef={{ vm_id: id }} />
              </div>
              <MacGlassPanel
                title="Security"
                subtitle="In-guest listening ports via QEMU guest agent · host firewall on parent machine"
              >
                {vm.host_id && (
                  <Link to={`/platform/zeus/security/firewall/${vm.host_id}`} className={`text-sm inline-flex items-center gap-1 mb-4 ${hubLinkClasses()}`}>
                    <Shield className="w-4 h-4" /> Host firewall (Zeus) →
                  </Link>
                )}
                {guestPortsLoading && <p className="text-sm text-slate-500">Loading guest ports…</p>}
                {!guestPortsLoading && guestPorts && (
                  <>
                    <p className="text-xs text-slate-500 mb-3">
                      {guestPorts.summary}
                      {!guestPorts.agent_reachable && ' · Guest agent unreachable — install Guest Tools'}
                    </p>
                    {guestPorts.ports.length === 0 ? (
                      <p className="text-sm text-slate-500">No listening ports reported inside the guest.</p>
                    ) : (
                      <div className="space-y-1">
                        {guestPorts.ports.map((p) => (
                          <MacListRow
                            key={`${p.port}-${p.protocol}`}
                            title={`${p.port}/${p.protocol}`}
                            subtitle={[p.service_name || p.process, String(p.risk)].filter(Boolean).join(' · ')}
                            badge={
                              (p.risk === 'Critical' || p.risk === 'critical') ? (
                                <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusBadgeClasses('error')}`}>critical</span>
                              ) : (p.risk === 'Warning' || p.risk === 'warning') ? (
                                <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusBadgeClasses('warn')}`}>warning</span>
                              ) : undefined
                            }
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
                {!guestPortsLoading && !guestPorts && (
                  <p className="text-sm text-slate-500">Could not load guest firewall ports. Ensure Guest Tools are installed and the VM is running.</p>
                )}
                <button type="button" className="btn-secondary text-xs mt-3" onClick={() => void loadGuestPorts()}>Refresh</button>
              </MacGlassPanel>
            </div>
          )}

          {tab === 'snapshots' && (
            <MacGlassPanel title="Snapshots" className="pt-2">
              <input className="input w-full max-w-xs" value={snapName} onChange={(e) => setSnapName(e.target.value)} />
              <div className="flex gap-2">
                <button type="button" className="btn-secondary text-xs" onClick={() => void act('Snapshot queued', () => createVmSnapshot(id, snapName))}>Create snapshot</button>
              </div>
              <ul className="text-xs space-y-2">
                {snapshots.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-slate-400">
                    <span>{s.name} ({s.status})</span>
                    <span className="flex gap-1">
                      <button type="button" className="btn-secondary text-xs" onClick={() => void act('Revert queued', () => revertVmSnapshot(id, s.name))}>Revert</button>
                      <button type="button" className="btn-secondary text-xs" onClick={() => void act('Delete queued', () => deleteVmSnapshot(id, s.name))}>Delete</button>
                    </span>
                  </li>
                ))}
              </ul>
            </MacGlassPanel>
          )}

          {tab === 'backup' && (
            <MacGlassPanel title="Backup" className="pt-2">
              <p className="text-xs text-slate-500">Restore will not overwrite the current VM unless you choose restore in place.</p>
              <button type="button" className="btn-secondary text-xs" onClick={() => void act('Backup queued', () => createVmBackup(id))}><Archive className="w-3 h-3 inline" /> Backup now</button>
              <ul className="text-xs space-y-2">
                {backups.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 text-slate-400">
                    <span>{b.backup_type} ({b.status})</span>
                    {b.status === 'completed' && (
                      <button type="button" className="btn-secondary text-xs" onClick={() => void act('Restore queued', () => restoreVmBackup(id, b.id))}>Restore</button>
                    )}
                  </li>
                ))}
              </ul>
            </MacGlassPanel>
          )}

          {tab === 'topology' && (
            <MacGlassPanel title="VM topology" className="pt-2">
              {!topology ? (
                <p className="text-sm text-slate-400">Loading topology…</p>
              ) : (
                <div className="space-y-3 text-sm">
                  <p className="text-slate-400">{topology.nodes.length} nodes · {topology.edges.length} edges</p>
                  <ul className="divide-y divide-white/[0.04] max-h-64 overflow-y-auto">
                    {topology.nodes.map((n) => (
                      <li key={n.id} className="py-2 flex justify-between gap-2">
                        <span className="text-slate-200">{n.name}</span>
                        <span className="text-xs text-slate-500 uppercase">{n.kind}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to="/platform/topology" className={`text-xs ${hubLinkClasses()}`}>Open fleet topology →</Link>
                </div>
              )}
            </MacGlassPanel>
          )}

          {tab === 'events' && (
            <div className="space-y-4 pt-2">
              <MacGlassPanel title="Migration history">
                {migrations.length === 0 ? (
                  <p className="text-sm text-slate-400">No migration records for this VM.</p>
                ) : (
                  <ul className="divide-y divide-white/[0.04] -mx-1">
                    {migrations.map((m) => (
                      <MacListRow
                        key={m.id}
                        title={`${m.source_host} → ${m.dest_host}`}
                        subtitle={`${m.status} · ${new Date(m.started_at).toLocaleString()}`}
                      />
                    ))}
                  </ul>
                )}
              </MacGlassPanel>
              <MacGlassPanel title="Events">
                <Link to={tasksHubHref(tier)} className={hubLinkClasses()}>View task history →</Link>
              </MacGlassPanel>
            </div>
          )}

          {tab === 'settings' && (
            <div className="space-y-4">
              <MacGlassPanel title="High availability">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ha.enabled} onChange={(e) => setHa({ ...ha, enabled: e.target.checked })} /> Restart on host failure</label>
                <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={ha.fence_on_failure} onChange={(e) => setHa({ ...ha, fence_on_failure: e.target.checked })} /> Fence host on failure</label>
                <button type="button" className="btn-secondary mt-2" onClick={() => void act('HA policy updated', () => setVmHa(id, ha))}>Save HA policy</button>
              </MacGlassPanel>
              <MacGlassPanel title="Live migrate & clone">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <h3 className="font-semibold mb-2 flex items-center gap-2 text-sm"><MoveRight className="w-4 h-4" /> Live migrate</h3>
                    <select className="input w-full mb-2" value={destHost} onChange={(e) => setDestHost(e.target.value)}>
                      {hosts.map((h) => <option key={h.id} value={h.id}>{h.hostname}</option>)}
                    </select>
                    <div className="flex gap-2">
                      <button type="button" className="btn-secondary text-sm" disabled={!destHost} onClick={async () => {
                        try { setPrecheck(await migratePrecheck(id, destHost)) } catch (e: unknown) { toast.error(formatUserError(e)) }
                      }}>Pre-check</button>
                      <button type="button" className="btn-secondary text-sm" disabled={!destHost} onClick={() => void act('Migration queued', () => vmMigrate(id, destHost))}>Migrate</button>
                    </div>
                    {precheck && (
                      <ul className="text-xs mt-2 space-y-1">{precheck.checks.map((c) => (
                        <li key={c.name} className={statusToneClass(c.passed ? 'ok' : 'error')}>
                          {c.name}: {c.message}
                          {c.remediation && !c.passed && (
                            <p className="text-slate-400 pl-2 mt-1">
                              Fix: {c.remediation}
                              {!c.passed && c.name.toLowerCase().includes('network') && (
                                <button type="button" className="btn-secondary text-[10px] ml-2" onClick={() => setTab('network')}>Choose network</button>
                              )}
                            </p>
                          )}
                        </li>
                      ))}</ul>
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2 flex items-center gap-2 text-sm"><Copy className="w-4 h-4" /> Clone</h3>
                    <input className="input w-full mb-2" placeholder="new-vm-name" value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
                    <button type="button" className="btn-secondary text-sm" disabled={!cloneName} onClick={() => void act('Clone queued', () => vmClone(id, cloneName))}>Clone</button>
                  </div>
                </div>
              </MacGlassPanel>
              <MacGlassPanel title="VM spec">
                {specData ? <JsonInspector data={specData} /> : <p className="text-sm text-slate-500">Spec unavailable</p>}
              </MacGlassPanel>
            </div>
          )}
        </>
      )}
    </PageLayout>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="font-medium text-slate-100 mt-0.5 capitalize">{value}</p>
    </div>
  )
}
