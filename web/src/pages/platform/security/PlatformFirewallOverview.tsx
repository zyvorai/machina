// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Cloud, GitBranch, HardDrive, Network, RefreshCw, Server, Shield, AlertTriangle, CheckCircle2 } from 'lucide-react'
import {
  LaunchpadAppIcon,
  MacGlassPanel,
  MacStatWidget,
  gradientForName,
} from '../../../components/platform/mac/PlatformMacUi'
import JsonInspector, { asRecord, recordEntries } from '../../../components/platform/JsonInspector'
import PlatformFilterPills from '../../../components/platform/PlatformFilterPills'
import PageLayout from '../../../components/PageLayout'
import {
  getFirewallOverview,
  getBaremetalFirewallOverview,
  getMultisiteOverview,
  getMultisiteDrift,
  getMultisiteConnectivityMatrix,
  getMultisiteTimeline,
  getOperatorSecurePlan,
  getOperatorThresholds,
  executeOperatorSecure,
  executeOperatorSecureBatch,
  syncMultisiteFirewall,
  getZeusFirewallStatus,
  getFirewallScore,
  requestFirewallApproval,
  type FirewallOverview,
  type FirewallScore,
  type FirewallTargetSummary,
  type FleetSecurePlan,
  type MultisiteOverview,
} from '../../../api/zeusFirewall'
import { useToastContext } from '../../../contexts/ToastContext'
import { formatUserError } from '../../../utils/apiError'
import { hubLinkClasses, riskTone, statusBgClass, statusPillClasses, statusToneClass } from '../../../utils/semanticColors'

type KindFilter = 'all' | 'host' | 'bare_metal'

export default function PlatformFirewallOverview() {
  const toast = useToastContext()
  const [overview, setOverview] = useState<FirewallOverview | null>(null)
  const [multisite, setMultisite] = useState<MultisiteOverview | null>(null)
  const [operatorPlan, setOperatorPlan] = useState<FleetSecurePlan | null>(null)
  const [statusLine, setStatusLine] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [error, setError] = useState<string | null>(null)
  const [operatorBusy, setOperatorBusy] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [applyProfiles, setApplyProfiles] = useState(true)
  const [includeLockdown, setIncludeLockdown] = useState(false)
  const [multisiteTab, setMultisiteTab] = useState<'overview' | 'drift' | 'connectivity' | 'timeline'>('overview')
  const [multisiteExtra, setMultisiteExtra] = useState<Record<string, unknown> | Array<Record<string, unknown>> | null>(null)
  const [thresholds, setThresholds] = useState<Record<string, unknown> | null>(null)
  const [baremetalFw, setBaremetalFw] = useState<Record<string, unknown> | null>(null)
  const [scoreBusy, setScoreBusy] = useState(false)
  const [scoreSample, setScoreSample] = useState<FirewallScore | null>(null)
  const [approvalBusy, setApprovalBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [ov, st, ms, op, th, bm] = await Promise.all([
        getFirewallOverview(),
        getZeusFirewallStatus(),
        getMultisiteOverview().catch(() => null),
        getOperatorSecurePlan().catch(() => null),
        getOperatorThresholds().catch(() => null),
        getBaremetalFirewallOverview().catch(() => null),
      ])
      setOverview(ov)
      setMultisite(ms)
      setOperatorPlan(op)
      setThresholds(th)
      setBaremetalFw(bm as Record<string, unknown> | null)
      const pw = st.packetwolf as { summary?: string }
      setStatusLine(pw?.summary || 'Zeus Firewall active')
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const targets = useMemo(
    () => (overview && !Array.isArray(overview) && Array.isArray(overview.targets) ? overview.targets : []),
    [overview],
  )

  const filtered = useMemo(() => {
    if (kindFilter === 'all') return targets
    return targets.filter((t) => t.kind === kindFilter)
  }, [kindFilter, targets])

  const metalCount = targets.filter((t) => t.kind === 'bare_metal').length
  const hostCount = targets.filter((t) => t.kind === 'host').length
  const scoreTarget = filtered.find((t) => t.risk === 'critical' || t.risk === 'high') ?? filtered[0]

  const loadScoreSample = async () => {
    if (!scoreTarget) return
    setScoreBusy(true)
    try {
      setScoreSample(await getFirewallScore(scoreTarget.id))
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setScoreBusy(false)
    }
  }

  const runRequestApproval = async () => {
    if (!scoreTarget) return
    setApprovalBusy(true)
    try {
      await requestFirewallApproval({
        target_id: scoreTarget.id,
        profile: scoreTarget.profile ?? undefined,
      })
      toast.success('Firewall change approval requested')
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setApprovalBusy(false)
    }
  }

  const runOperatorSecure = async (hostId: string, profile?: string, dryRun = true) => {
    setOperatorBusy(true)
    try {
      const r = await executeOperatorSecure({ host_id: hostId, profile, dry_run: dryRun })
      toast.success(r.message || (dryRun ? 'Dry-run complete' : 'Operator secure applied'))
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setOperatorBusy(false)
    }
  }

  const runOperatorBatch = async (dryRun: boolean) => {
    setOperatorBusy(true)
    try {
      const r = await executeOperatorSecureBatch({ dry_run: dryRun, auto_only: true })
      toast.success(r.summary)
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setOperatorBusy(false)
    }
  }

  const runMultisiteSync = async () => {
    setSyncBusy(true)
    try {
      const r = await syncMultisiteFirewall({
        source_site: 'primary-local',
        target_site: 'dr-replica',
        apply_profiles: applyProfiles,
        include_lockdown: includeLockdown,
      })
      toast.success(r.summary)
      if ((r.apply_errors ?? []).length > 0) {
        toast.warning(`${r.apply_errors.length} apply error(s) — check agent connectivity`)
      }
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setSyncBusy(false)
    }
  }

  return (
    <PageLayout
      compact
      error={error}
      prepend={
        <Link to="/platform/zeus/security" className={`text-sm inline-flex items-center gap-1 ${hubLinkClasses()}`}>
          <ArrowLeft className="w-4 h-4" /> Security Center
        </Link>
      }
      title="Zeus Firewall"
      subtitle={
        <span className="flex flex-wrap items-center gap-2 text-sm">
          {overview && !Array.isArray(overview) && (
            <>
              <span className={statusPillClasses(overview.critical_count > 0 ? 'error' : 'ok')}>
                {overview.critical_count} critical
              </span>
              <span className="text-slate-400">{targets.length} machines</span>
            </>
          )}
          {statusLine && <span className="text-slate-500">{statusLine}</span>}
        </span>
      }
      icon={<Shield className="w-6 h-6 text-slate-400" />}
      actions={
        <button type="button" className="btn-secondary" onClick={() => void load()} aria-label="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      }
      contentClassName="space-y-4"
    >
      {overview && targets.length > 0 && (
        <>
          <PlatformFilterPills
            value={kindFilter}
            onChange={(id) => setKindFilter(id as KindFilter)}
            options={[
              { id: 'all', label: 'All', count: targets.length },
              { id: 'host', label: 'Hosts', count: hostCount },
              { id: 'bare_metal', label: 'Bare metal', count: metalCount },
            ]}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MacStatWidget label="Machines" value={String(filtered.length)} icon={<Server className="w-5 h-5" />} />
            <MacStatWidget label="Critical" value={String(overview.critical_count)} icon={<AlertTriangle className="w-5 h-5" />} tone="warn" />
            <MacStatWidget
              label="Compliant"
              value={String(targets.filter((t) => t.risk === 'low').length)}
              icon={<CheckCircle2 className="w-5 h-5" />}
              tone="ok"
            />
          </div>
          {scoreTarget && (
            <MacGlassPanel title="Risk scoring & approvals" subtitle={`Sample target: ${scoreTarget.name} · POST /targets/{id}/score and /approvals`}>
              <div className="flex flex-wrap gap-2 mb-3">
                <button type="button" className="btn-secondary text-xs" disabled={scoreBusy} onClick={() => void loadScoreSample()}>
                  {scoreBusy ? 'Scoring…' : 'Score sample target'}
                </button>
                <button type="button" className="btn-primary text-xs" disabled={approvalBusy} onClick={() => void runRequestApproval()}>
                  {approvalBusy ? 'Requesting…' : 'Request approval'}
                </button>
              </div>
              {scoreSample && (
                <div className="text-sm text-slate-300 space-y-2">
                  <p>Score: <span className="font-semibold text-slate-100">{scoreSample.score}</span></p>
                  {(scoreSample.breakdown ?? []).slice(0, 3).map((b) => (
                    <p key={b.category} className="text-xs text-slate-400">{b.category}: {b.detail} ({b.points} pts)</p>
                  ))}
                </div>
              )}
            </MacGlassPanel>
          )}
          <MacGlassPanel title="Machines" subtitle={overview.summary}>
            <div className="platform-launchpad-grid grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-6">
              {filtered.map((t: FirewallTargetSummary) => (
                <Link key={t.id} to={`/platform/zeus/security/firewall/${t.id}`} className="relative">
                  <span className={`absolute top-0 right-6 w-2.5 h-2.5 rounded-full ${statusBgClass(riskTone(t.risk))} ring-2 ring-slate-950`} />
                  <LaunchpadAppIcon
                    name={t.name}
                    icon={t.kind === 'bare_metal' ? <HardDrive className="w-8 h-8" /> : <Shield className="w-8 h-8" />}
                    gradient={gradientForName(t.name)}
                    vmCount={t.open_ports}
                  />
                  {t.kind === 'bare_metal' && (
                    <p className="text-[10px] text-slate-500 text-center -mt-1">Bare metal</p>
                  )}
                </Link>
              ))}
            </div>
          </MacGlassPanel>
          {operatorPlan && (operatorPlan.previews?.length ?? 0) > 0 && (
            <MacGlassPanel title="AI operator" subtitle={operatorPlan.summary}>
              <div className="flex flex-wrap gap-2 mb-3">
                <button type="button" className="btn-secondary text-xs" disabled={operatorBusy} onClick={() => void runOperatorBatch(true)}>
                  Dry-run auto-eligible
                </button>
                <button type="button" className="btn-primary text-xs" disabled={operatorBusy || operatorPlan.auto_eligible === 0} onClick={() => void runOperatorBatch(false)}>
                  Apply auto-eligible ({operatorPlan.auto_eligible})
                </button>
              </div>
              <ul className="text-xs text-slate-400 space-y-1 max-h-32 overflow-y-auto">
                {operatorPlan.previews.slice(0, 6).map((p) => (
                  <li key={p.host_id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {p.hostname} → {p.target_profile}
                      {p.requires_approval ? ' · needs approval' : ' · auto-eligible'}
                    </span>
                    <button
                      type="button"
                      className="btn-secondary text-[10px] py-0.5 px-1.5"
                      disabled={operatorBusy}
                      data-testid={`operator-secure-${p.host_id}`}
                      onClick={() => void runOperatorSecure(p.host_id, p.target_profile, true)}
                    >
                      Dry-run host
                    </button>
                  </li>
                ))}
              </ul>
            </MacGlassPanel>
          )}
          {multisite && (
            <MacGlassPanel title="Multi-site federation" subtitle={multisite.summary}>
              <div className="flex flex-wrap gap-2 mb-3">
                {(['overview', 'drift', 'connectivity', 'timeline'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`text-xs px-2 py-1 rounded ${multisiteTab === t ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'}`}
                    onClick={() => {
                      setMultisiteTab(t)
                      if (t === 'drift') void getMultisiteDrift().then(setMultisiteExtra).catch(() => setMultisiteExtra(null))
                      if (t === 'connectivity') void getMultisiteConnectivityMatrix().then(setMultisiteExtra).catch(() => setMultisiteExtra(null))
                      if (t === 'timeline') void getMultisiteTimeline().then(setMultisiteExtra).catch(() => setMultisiteExtra(null))
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {multisiteTab === 'overview' && (
              <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 -mt-1">
                {multisite.sites.map((s) => (
                  <div key={s.id} className="rounded-xl border border-white/[0.06] bg-slate-950/40 px-3 py-2">
                    <p className="text-sm text-slate-200">{s.name} <span className="text-slate-500">({s.role})</span></p>
                    <p className="text-xs text-slate-500 mt-0.5">{s.gitops_namespace} · {s.target_count} targets · grade {(multisite.compliance_rollup?.sites ?? []).find((c) => c.site === s.name)?.grade ?? '—'}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={applyProfiles} onChange={(e) => setApplyProfiles(e.target.checked)} />
                  Apply synced profiles to online hosts
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={includeLockdown} onChange={(e) => setIncludeLockdown(e.target.checked)} />
                  DR lockdown profile
                </label>
                <button type="button" className="btn-secondary text-xs" disabled={syncBusy} onClick={() => void runMultisiteSync()}>
                  {syncBusy ? 'Syncing…' : 'Sync primary → DR'}
                </button>
              </div>
              {(multisite.policy_conflicts?.length ?? 0) > 0 && (
                <ul className={`mt-3 text-xs space-y-1 ${statusToneClass('warn')}`}>
                  {multisite.policy_conflicts.map((c) => (
                    <li key={c.id}>{c.policy_name}: {c.detail}</li>
                  ))}
                </ul>
              )}
              </>
              )}
              {multisiteTab !== 'overview' && multisiteExtra && (
                <JsonInspector data={multisiteExtra} className="mt-3" />
              )}
            </MacGlassPanel>
          )}
          {thresholds && (
            <MacGlassPanel title="Operator thresholds" subtitle={String(thresholds.summary ?? 'Auto-secure eligibility rules')}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 -mt-1">
                {recordEntries(asRecord(thresholds) ?? {}, 8).map(([k, v]) => (
                  <MacStatWidget key={k} label={k.replace(/_/g, ' ')} value={String(v)} icon={<Shield className="w-4 h-4" />} />
                ))}
              </div>
              <JsonInspector data={thresholds} className="mt-3" />
            </MacGlassPanel>
          )}
          {baremetalFw && (
            <MacGlassPanel title="Bare-metal firewall rollup" subtitle="BMC-attached servers under Zeus Firewall">
              <JsonInspector data={baremetalFw} />
            </MacGlassPanel>
          )}
          <MacGlassPanel title="Machine Security" subtitle="Open like macOS System Settings panes">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {[
                { to: '/platform/zeus?tab=baremetal', label: 'Bare Metal', icon: <HardDrive className="w-5 h-5" /> },
                { to: '/platform/zeus/security/ports', label: 'Open Ports', icon: <Network className="w-5 h-5" /> },
                { to: '/platform/zeus/security/services', label: 'Allowed Apps', icon: <Server className="w-5 h-5" /> },
                { to: '/platform/zeus/security/activity', label: 'Activity', icon: <Shield className="w-5 h-5" /> },
                { to: '/platform/zeus/security/compliance', label: 'Compliance', icon: <CheckCircle2 className="w-5 h-5" /> },
                { to: '/platform/zeus/security/policies', label: 'Policy Studio', icon: <Shield className="w-5 h-5" /> },
                { to: '/platform/zeus/security/k8s', label: 'Kubernetes', icon: <GitBranch className="w-5 h-5" /> },
                { to: '/platform/zeus/security/cloud', label: 'Cloud SGs', icon: <Cloud className="w-5 h-5" /> },
                { to: '/platform/zeus/security/connectivity', label: 'Connectivity', icon: <Network className="w-5 h-5" /> },
              ].map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-white/[0.06] bg-slate-950/40 hover:border-blue-500/30 transition text-center"
                >
                  <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-blue-300">
                    {item.icon}
                  </div>
                  <span className="text-xs text-slate-300">{item.label}</span>
                </Link>
              ))}
            </div>
          </MacGlassPanel>
        </>
      )}
    </PageLayout>
  )
}
