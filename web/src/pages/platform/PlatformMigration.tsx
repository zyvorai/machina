// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useCallback, useEffect, useRef, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { Link, useNavigate } from 'react-router'
import { ArrowRightLeft, CheckCircle2, AlertTriangle, XCircle, ExternalLink, Play, Loader2 } from 'lucide-react'
import { MacGlassPanel, MacListRow } from '../../components/platform/mac/PlatformMacUi'
import DetailTabs from '../../components/platform/DetailTabs'
import PlatformPageChrome, { PlatformBackLink } from '../../components/platform/PlatformPageChrome'
import { usePlatformTabState } from '../../hooks/usePlatformTabState'
import { getHypersdkStatus, listHypersdkProviders, listHypersdkProviderVms, submitHypersdkMigration, hypersdkProxyGet, hypersdkProxyPost } from '../../api/hypersdk'
import { getGuestkitStatus, guestkitDoctor, guestkitMigratePlan, submitGuestkitInspectJob, getGuestkitJob, listGuestkitJobsDaemon, getGuestkitCapabilitiesDaemon, type GuestkitJobRow } from '../../api/guestkit'
import JsonInspector from '../../components/platform/JsonInspector'
import { getMigrationAdvisor, type MigrationAdvisorReport } from '../../api/ai'
import { usePlatformInfo } from '../../contexts/PlatformInfoContext'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import {hostStateTone, httpStatusTone, migrationReadinessTone, riskTone, statusBadgeClasses, statusPillClasses, statusSurfaceClasses, statusToneClass, taskStatusTone, webhookDeliveryTone, hubLinkClasses} from '../../utils/semanticColors'
import { usePlatformDesktopTier } from '../../hooks/usePlatformDesktopTier'
import { tasksHubHref } from '../../utils/platformHubLinks'
import PageSkeleton from '../../components/PageSkeleton'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'

const SOURCES = [
  { id: 'vcenter', label: 'VMware vCenter', desc: 'Scan via HyperSDK when enabled' },
  { id: 'esxi', label: 'ESXi Host', desc: 'Direct ESXi connection' },
  { id: 'ova', label: 'OVF / OVA File', desc: 'Upload and convert' },
  { id: 'vmdk', label: 'VMDK File', desc: 'Single disk import' },
  { id: 'cloud', label: 'Cloud Image', desc: 'Ubuntu/RHEL cloud images' },
]

type ScanVm = { name: string; status: string; os: string; note: string; provider?: string; advisor?: MigrationAdvisorReport }

type MigrationTab = 'radar' | 'jobs'

// Reused by several "enable this backend" call-to-action links on the page.
const INTEGRATIONS_ROUTE = '/platform/settings?section=integrations'

const MIGRATION_TABS = [
  { id: 'radar' as const, label: 'Scan & migrate' },
  { id: 'jobs' as const, label: 'GuestKit jobs' },
]

export default function PlatformMigration() {
  const { info } = usePlatformInfo()
  const [tier] = usePlatformDesktopTier()
  const navigate = useNavigate()
  const toast = useToastContext()
  const [tab, setTab] = usePlatformTabState<MigrationTab>(MIGRATION_TABS.map((t) => t.id), { defaultTab: 'radar' })
  const hypersdk = Boolean(info?.hypersdk?.enabled)
  const guestkit = Boolean(info?.guestkit?.enabled)
  const [gkStatus, setGkStatus] = useState<Awaited<ReturnType<typeof getGuestkitStatus>> | null>(null)
  const [diskPath, setDiskPath] = useState('')
  // Mirror diskPath into a ref so scanSource (a stable useCallback) reads the
  // latest typed value without re-subscribing its effects on every keystroke.
  const diskPathRef = useRef('')
  useEffect(() => { diskPathRef.current = diskPath }, [diskPath])
  const [gkSummary, setGkSummary] = useState<string | null>(null)
  const [status, setStatus] = useState<{ reachable?: boolean } | null>(null)
  const [scan, setScan] = useState<ScanVm[]>([])
  const [loading, setLoading] = useState(false)
  const [provider, setProvider] = useState('vmware')
  const [migrating, setMigrating] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<string | null>(null)
  const [planSummary, setPlanSummary] = useState<string | null>(null)
  const [jobPolling, setJobPolling] = useState(false)
  const [confirmMigration, setConfirmMigration] = useState<{ vm: ScanVm; force: boolean } | null>(null)
  const [gkJobs, setGkJobs] = useState<GuestkitJobRow[]>([])
  const [gkCaps, setGkCaps] = useState<string | null>(null)
  const [hsProxyPath, setHsProxyPath] = useState('/providers')
  const [hsProxyResult, setHsProxyResult] = useState<Record<string, unknown> | null>(null)

  const scanSource = useCallback(async (p: string) => {
    setLoading(true)
    setProvider(p)
    try {
      const vms = await listHypersdkProviderVms(p) as { vms?: Array<{ name: string; status?: string; id?: string }> }
      const list = await Promise.all((vms.vms ?? []).slice(0, 10).map(async (v) => {
        let advisor: MigrationAdvisorReport | undefined
        try {
          advisor = await getMigrationAdvisor(v.name, p, undefined, diskPathRef.current.trim() || undefined)
        } catch { /* optional */ }
        return {
          name: v.name,
          status: advisor && advisor.readiness_percent >= 70 ? 'ready' as const : advisor ? 'check' as const : 'ready' as const,
          os: 'Detected from source',
          note: advisor ? `Readiness ${advisor.readiness_percent}%` : (v.status ?? 'Ready for HyperSDK migration'),
          provider: p,
          advisor,
        }
      }))
      setScan(list.length ? list : [{ name: '(no VMs)', status: 'check', os: '—', note: 'No VMs returned from provider' }])
    } catch {
      setScan([{ name: 'Scan failed', status: 'unsupported', os: '—', note: 'Check HyperSDK connectivity' }])
    } finally {
      setLoading(false)
    }
  }, [])

  const migrateVm = async (vm: ScanVm, force = false) => {
    if (!hypersdk || vm.name.startsWith('(')) return
    if (!force && vm.status === 'check' && vm.advisor?.risks?.length) {
      setConfirmMigration({ vm, force: true })
      return
    }
    setMigrating(vm.name)
    try {
      const r = await submitHypersdkMigration({
        provider: vm.provider ?? provider,
        vm_name: vm.name,
        target: 'libvirt',
      })
      toast.success(`Migration submitted${r.job_id ? ` — job ${r.job_id}` : ''}`)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setMigrating(null)
    }
  }

  useEffect(() => {
    if (guestkit) {
      void getGuestkitStatus().then(setGkStatus).catch(() => {})
    }
  }, [guestkit])

  useEffect(() => {
    if (!hypersdk) return
    void (async () => {
      try {
        setStatus(await getHypersdkStatus())
        const prov = await listHypersdkProviders() as { providers?: Array<{ provider: string }> }
        const first = prov.providers?.[0]?.provider ?? 'vmware'
        await scanSource(first)
      } catch { /* optional */ }
    })()
  }, [hypersdk, scanSource])

  useEffect(() => {
    if (!jobId || !jobPolling) return
    const t = window.setInterval(() => {
      void getGuestkitJob(jobId).then((j) => {
        setJobStatus(j.summary ?? j.status)
        if (j.status === 'completed' || j.status === 'failed') setJobPolling(false)
      }).catch(() => setJobPolling(false))
    }, 2000)
    return () => window.clearInterval(t)
  }, [jobId, jobPolling])

  useEffect(() => {
    if (tab !== 'jobs' || !guestkit) return
    void listGuestkitJobsDaemon().then((rows) => setGkJobs(Array.isArray(rows) ? rows : [])).catch(() => setGkJobs([]))
    void getGuestkitCapabilitiesDaemon().then((c) => setGkCaps(c.summary ?? c.features?.join(', ') ?? null)).catch(() => setGkCaps(null))
  }, [tab, guestkit])

  return (
    <PlatformPageChrome
      eyebrow="Platform"
      prepend={<PlatformBackLink to="/platform/operations" label="Operations" />}
      title="Migration Radar"
      subtitle="Machina Migration Radar — HyperSDK scan + GuestKit offline assurance."
      icon={<ArrowRightLeft className="w-6 h-6 text-[var(--text-muted)]" />}
      className="w-full max-w-none"
      contentClassName="space-y-4"
    >
      <DetailTabs primary={MIGRATION_TABS} active={tab} onChange={setTab} />

      {tab === 'jobs' && (
        <MacGlassPanel title="GuestKit job queue">
          <div className="flex flex-wrap gap-2 items-end mb-4">
            <label className="block flex-1 min-w-[14rem]">
              <span className="text-xs text-[var(--text-muted)]">Disk path</span>
              <input className="input text-sm mt-1 w-full" value={diskPath} onChange={(e) => setDiskPath(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={!diskPath.trim() || !guestkit}
              onClick={async () => {
                try {
                  const r = await submitGuestkitInspectJob(diskPath.trim())
                  setJobId(r.job_id)
                  setJobStatus(r.summary)
                  setJobPolling(true)
                  toast.success(`Job ${r.job_id} submitted`)
                } catch (e: unknown) {
                  toast.error(formatUserError(e))
                }
              }}
            >
              Submit inspect job
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={!diskPath.trim() || !guestkit}
              onClick={async () => {
                try {
                  const r = await guestkitMigratePlan(diskPath.trim())
                  setPlanSummary(`${r.migration_score.toFixed(0)}% ready · ${r.summary}`)
                } catch (e: unknown) {
                  toast.error(formatUserError(e))
                }
              }}
            >
              Migrate plan
            </button>
          </div>
          {jobId && (
            <MacListRow
              title={`Job ${jobId}`}
              subtitle={jobStatus ?? 'Polling…'}
              badge={jobPolling ? <Loader2 className="w-4 h-4 animate-spin text-orange-400" /> : undefined}
            />
          )}
          {planSummary && <p className="text-xs text-[var(--text-muted)] mt-2">{planSummary}</p>}
          {gkCaps && <p className="text-xs text-orange-700/80 mt-3">Capabilities: {gkCaps}</p>}
          {gkJobs.length > 0 && (
            <ul className="mt-4 divide-y divide-white/[0.04]">
              {gkJobs.map((j) => (
                <MacListRow key={j.job_id} title={j.job_id} subtitle={`${j.status}${j.summary ? ` · ${j.summary}` : ''}`} />
              ))}
            </ul>
          )}
        </MacGlassPanel>
      )}

      {tab === 'radar' && (
      <>
      {loading && scan.length === 0 && <PageSkeleton />}
      <div className="grid gap-3 sm:grid-cols-3">
        {hypersdk && (
          <div className={`rounded-xl p-4 text-sm ${statusSurfaceClasses(status?.reachable ? 'ok' : 'warn')}`}>
            <p className="font-semibold">HyperSDK</p>
            <p className="text-xs mt-1 opacity-90">{status?.reachable ? 'Connected — scan VMware below.' : 'Enable connectivity in Integrations.'}</p>
          </div>
        )}
        {guestkit && (
          <>
            <Link to="/platform/migration?tab=jobs" className="rounded-xl border border-[var(--apple-hairline)] bg-orange-500/10 p-4 text-sm hover:border-orange-400/50 transition">
              <p className="font-semibold text-orange-800">GuestKit jobs</p>
              <p className="text-xs text-orange-700/70 mt-1">Offline disk inspect and migrate planning.</p>
            </Link>
            <Link to="/platform/vms/v1?tab=guestHealth&guestAction=migrate-plan" className="rounded-xl border border-[var(--apple-hairline)] bg-orange-500/10 p-4 text-sm hover:border-orange-400/50 transition">
              <p className="font-semibold text-orange-800">Platform VM migrate plan</p>
              <p className="text-xs text-orange-700/70 mt-1">Run GuestKit offline KVM migration scoring on an enrolled VM disk.</p>
            </Link>
          </>
        )}
      </div>

      {guestkit && gkStatus && (
        <div className="rounded-xl border border-[var(--apple-hairline)] bg-orange-500/10 p-4 text-sm text-orange-800 space-y-2">
          <p>GuestKit {gkStatus.library_version ?? 'linked'} — {gkStatus.summary}</p>
          <div className="flex flex-wrap gap-2 items-end">
            <label className="block flex-1 min-w-[14rem]">
              <span className="text-xs text-orange-700/70">Offline disk path (qcow2/vmdk)</span>
              <input className="input text-sm mt-1 w-full" placeholder="/var/lib/libvirt/images/vm.qcow2" value={diskPath} onChange={(e) => setDiskPath(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={!diskPath.trim()}
              onClick={async () => {
                try {
                  const r = await guestkitDoctor(diskPath.trim(), 'kvm', true)
                  setGkSummary(`${r.boot_score.toFixed(0)}% boot · ${r.summary}`)
                } catch (e: unknown) {
                  setGkSummary(formatUserError(e))
                }
              }}
            >
              GuestKit doctor
            </button>
          </div>
          {gkSummary && <p className="text-xs text-orange-700/80">{gkSummary}</p>}
        </div>
      )}

      {hypersdk && status?.reachable && (
        <MacGlassPanel title="HyperSDK proxy explorer" subtitle="Provider-specific API paths via HyperSDK proxy.">
          <div className="flex flex-wrap gap-2 items-end mb-3">
            <input aria-label="HyperSDK proxy path" className="input text-sm flex-1 min-w-[12rem]" value={hsProxyPath} onChange={(e) => setHsProxyPath(e.target.value)} placeholder="/providers" />
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={async () => {
                try {
                  setHsProxyResult(await hypersdkProxyGet(hsProxyPath))
                } catch (e: unknown) {
                  toast.error(formatUserError(e))
                }
              }}
            >
              GET proxy
            </button>
            <button
              type="button"
              data-testid="hypersdk-proxy-post"
              className="btn-secondary text-xs"
              onClick={async () => {
                try {
                  setHsProxyResult(await hypersdkProxyPost(hsProxyPath, { probe: true }))
                  toast.success('POST proxy OK')
                } catch (e: unknown) {
                  toast.error(formatUserError(e))
                }
              }}
            >
              POST proxy
            </button>
          </div>
          {hsProxyResult ? <JsonInspector data={hsProxyResult} /> : null}
        </MacGlassPanel>
      )}

      {hypersdk && status?.reachable && (
        <div className={`rounded-xl p-4 text-sm ${statusSurfaceClasses('ok')}`}>
          HyperSDK is connected. Select a VM and click Migrate to submit a conversion job.
        </div>
      )}

      <section>
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Where is your VM coming from?</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {SOURCES.map((s) => {
            const needsHypersdk = s.id === 'vcenter' || s.id === 'esxi'
            const disabled = loading || (needsHypersdk && !hypersdk)
            const hint = needsHypersdk && !hypersdk
              ? 'Enable HyperSDK in Integrations to scan VMware sources.'
              : null
            return (
              <button
                key={s.id}
                type="button"
                data-testid={s.id === 'esxi' ? 'migration-source-esxi' : undefined}
                disabled={disabled}
                onClick={() => {
                  if (s.id === 'vcenter') void scanSource('vmware')
                  else if (s.id === 'esxi') void scanSource('esxi')
                  else if (s.id === 'ova' || s.id === 'vmdk' || s.id === 'cloud') navigate('/import')
                }}
                className="text-left p-4 rounded-2xl border border-white/[0.08] bg-[var(--apple-surface)] hover:border-white/14 hover:bg-[var(--apple-surface)]/70 transition disabled:opacity-55 disabled:hover:border-white/[0.08]"
                title={hint ?? undefined}
              >
                <p className="font-semibold text-[var(--text-primary)]">{s.label}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">{hint ?? s.desc}</p>
              </button>
            )
          })}
        </div>
        {!hypersdk && !guestkit && (
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            No migration backends are enabled. Use OVF/OVA or cloud image import, or enable HyperSDK or GuestKit under{' '}
            <Link to={INTEGRATIONS_ROUTE} className={hubLinkClasses()}>Integrations</Link>.
          </p>
        )}
      </section>

      <section className="platform-mac-panel rounded-2xl border border-white/[0.06] p-5 space-y-4">
        <h2 className="font-semibold text-[var(--text-primary)]">Scan results</h2>
        {loading && <p className="text-sm text-[var(--text-muted)]">Scanning source…</p>}
        {!loading && scan.length === 0 && (
          <PlatformEmptyState
            icon={ArrowRightLeft}
            title="No scan yet"
            subtitle="Pick a source above to discover VMs, or use single-VM import for OVF/OVA and cloud images."
          >
            <Link to="/import" className="tahoe-btn-primary text-sm">Open import wizard</Link>
            <Link to={INTEGRATIONS_ROUTE} className={`tahoe-btn-ghost text-sm ${hubLinkClasses()}`}>Migration integrations</Link>
          </PlatformEmptyState>
        )}
        {scan.length > 0 && (
          <ul className="divide-y divide-[var(--apple-hairline)]">
            {scan.map((vm) => (
              <li key={vm.name} className="py-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.04] bg-[var(--apple-fill-tertiary)] px-3 mb-2">
                <div>
                  <p className="font-medium">{vm.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{vm.os} · {vm.note}</p>
                  {vm.advisor && (
                    <div className="mt-2 text-xs space-y-1">
                      <p className="text-[var(--text-muted)]">Readiness: <span className={statusToneClass('ok')}>{vm.advisor.readiness_percent}%</span></p>
                      {vm.advisor.guestkit_summary && (
                        <p className="text-orange-700/90">GuestKit: {vm.advisor.guestkit_summary}</p>
                      )}
                      {vm.advisor.firewall_migration_summary && (
                        <p className="text-[var(--accent)]">Firewall: {vm.advisor.firewall_migration_summary}</p>
                      )}
                      {(vm.advisor.risks ?? []).length > 0 && (
                        <ul className={`list-disc pl-4 ${statusToneClass('warn')}`}>{(vm.advisor.risks ?? []).slice(0, 3).map((r) => <li key={r}>{r}</li>)}</ul>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs flex items-center gap-1 ${statusToneClass(migrationReadinessTone(vm.status))}`}>
                    {vm.status === 'ready' ? <CheckCircle2 className="w-3 h-3" /> : vm.status === 'check' ? <AlertTriangle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {vm.status}
                  </span>
                  {hypersdk && vm.status === 'ready' && (
                    <button type="button" className="btn-primary text-xs flex items-center gap-1" disabled={migrating === vm.name} onClick={() => void migrateVm(vm, true)}>
                      <Play className="w-3 h-3" /> {migrating === vm.name ? 'Submitting…' : 'Migrate'}
                    </button>
                  )}
                  {hypersdk && vm.status === 'check' && (
                    <button type="button" className="btn-secondary text-xs flex items-center gap-1" disabled={migrating === vm.name} onClick={() => void migrateVm(vm)}>
                      <Play className="w-3 h-3" /> {migrating === vm.name ? 'Submitting…' : 'Migrate with warnings'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-[var(--text-faint)] flex flex-wrap gap-3">
          <Link to="/import" className={`inline-flex items-center gap-1 ${hubLinkClasses()}`}>Single-VM import <ExternalLink className="w-3 h-3" /></Link>
          <Link to={INTEGRATIONS_ROUTE} className={hubLinkClasses()}>All migration tools →</Link>
          <Link to={tasksHubHref(tier)} className={hubLinkClasses()}>View migration tasks →</Link>
        </p>
      </section>
      </>
      )}
      <ConfirmDialog
        open={confirmMigration !== null}
        title="Migration Advisor Warnings"
        message={`Migration advisor warnings:\n• ${(confirmMigration?.vm.advisor?.risks ?? []).slice(0, 5).join('\n• ')}\n\nContinue anyway?`}
        confirmLabel="Continue"
        variant="warning"
        onCancel={() => setConfirmMigration(null)}
        onConfirm={() => {
          const m = confirmMigration
          setConfirmMigration(null)
          if (m) void migrateVm(m.vm, true)
        }}
      />
    </PlatformPageChrome>
  )
}
