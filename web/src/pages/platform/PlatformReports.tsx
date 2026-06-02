// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { BookOpen, DollarSign, FolderKanban, PieChart } from 'lucide-react'
import ErrorBanner from '../../components/ErrorBanner'
import PageSkeleton from '../../components/PageSkeleton'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import DetailTabs from '../../components/platform/DetailTabs'
import { MacGlassPanel, MacStatWidget } from '../../components/platform/mac/PlatformMacUi'
import PlatformPageChrome, { PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { usePlatformTabState } from '../../hooks/usePlatformTabState'
import {
  getCapacityReport,
  getFinOpsReport,
  getOperationsOverview,
  getOpsShowback,
  listOpsRunbookExecutions,
  listOpsRunbooks,
  executeOpsRunbook,
  listProjects,
  type CapacityReport,
  type FinOpsReport,
  type OpsRunbookCatalogItem,
  type OpsRunbookExecution,
  type OpsShowbackOverview,
  type OperationsOverview,
  type ProjectRow,
} from '../../api/platform'
import { getAiCapacity, getAiCost, getAiCompliance, getAiComplianceExportUrl, getAiCompliancePdfUrl, getAiCostExportUrl, getAiCapacityExportUrl, getAiSecurity, getAutopilotHistory, getCostAttribution, getCostAttributionExportUrl, getCostBudget, type AutopilotHistoryEntry, type CapacityPlan, type CostAnalysis, type CostAttributionReport, type ComplianceReport, type CostBudgetReport, type SecurityReport } from '../../api/ai'
import { getFirewallExposureFinOps, getFirewallExposureFinOpsExportUrl, type ExposureFinOpsReport } from '../../api/zeusFirewall'
import { formatUserError } from '../../utils/apiError'
import { statusToneClass } from '../../utils/semanticColors'
import { useToastContext } from '../../contexts/ToastContext'

type TabId = 'reports' | 'runbooks' | 'showback'

const REPORT_TABS = [
  { id: 'reports' as const, label: 'Reports' },
  { id: 'runbooks' as const, label: 'Runbooks' },
  { id: 'showback' as const, label: 'Showback' },
]

export default function PlatformReports({ embedded }: { embedded?: boolean } = {}) {
  const toast = useToastContext()
  const [tab, setTab] = usePlatformTabState<TabId>(REPORT_TABS.map((t) => t.id), { defaultTab: 'reports' })

  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [cap, setCap] = useState<CapacityReport | null>(null)
  const [finops, setFinops] = useState<FinOpsReport | null>(null)
  const [cost, setCost] = useState<CostAnalysis | null>(null)
  const [aiCap, setAiCap] = useState<CapacityPlan | null>(null)
  const [security, setSecurity] = useState<SecurityReport | null>(null)
  const [compliance, setCompliance] = useState<ComplianceReport | null>(null)
  const [autopilotHistory, setAutopilotHistory] = useState<AutopilotHistoryEntry[]>([])
  const [attribution, setAttribution] = useState<CostAttributionReport | null>(null)
  const [budget, setBudget] = useState<CostBudgetReport | null>(null)
  const [exposureFinops, setExposureFinops] = useState<ExposureFinOpsReport | null>(null)
  const [opsOverview, setOpsOverview] = useState<OperationsOverview | null>(null)
  const [runbooks, setRunbooks] = useState<OpsRunbookCatalogItem[]>([])
  const [executions, setExecutions] = useState<OpsRunbookExecution[]>([])
  const [showback, setShowback] = useState<OpsShowbackOverview | null>(null)
  const [runbookBusy, setRunbookBusy] = useState<string | null>(null)
  const [runbookError, setRunbookError] = useState<{ label: string; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [p, c, f, costR, capR, secR, compR, hist, attrR, budgetR, expR] = await Promise.all([
        listProjects(),
        getCapacityReport(),
        getFinOpsReport(),
        getAiCost().catch(() => null),
        getAiCapacity().catch(() => null),
        getAiSecurity().catch(() => null),
        getAiCompliance().catch(() => null),
        getAutopilotHistory(10).catch(() => []),
        getCostAttribution().catch(() => null),
        getCostBudget().catch(() => null),
        getFirewallExposureFinOps().catch(() => null),
      ])
      setProjects(p)
      setCap(c)
      setFinops(f)
      setCost(costR)
      setAiCap(capR)
      setSecurity(secR)
      setCompliance(compR)
      setAutopilotHistory(hist)
      setAttribution(attrR)
      setBudget(budgetR)
      setExposureFinops(expR)
      if (tab === 'runbooks' || tab === 'showback') {
        const [ov, rb, ex, sb] = await Promise.all([
          getOperationsOverview().catch(() => null),
          listOpsRunbooks().catch(() => []),
          listOpsRunbookExecutions(15).catch(() => []),
          getOpsShowback().catch(() => null),
        ])
        setOpsOverview(ov)
        setRunbooks(rb)
        setExecutions(ex)
        setShowback(sb)
      }
    } catch (e: unknown) { setError(formatUserError(e)) }
    finally { setLoading(false) }
  }, [tab])

  useEffect(() => { void load() }, [load])

  const runRunbook = async (incident: string, title: string) => {
    setRunbookBusy(incident)
    setRunbookError(null)
    try {
      const r = await executeOpsRunbook(incident)
      toast.success(r.summary)
      await load()
    } catch (e: unknown) {
      const message = formatUserError(e)
      setRunbookError({ label: title, message })
      toast.error(message)
    } finally {
      setRunbookBusy(null)
    }
  }

  return (
    <PlatformPageChrome
      hideHeader={embedded}
      compact={embedded}
      error={error}
      onErrorRetry={() => void load()}
      title={embedded ? undefined : 'Reports'}
      subtitle={embedded ? undefined : 'Cost Guardian, FinOps, operations runbooks, and compliance showback.'}
      icon={embedded ? undefined : <PieChart className="w-6 h-6 text-slate-400" />}
      actions={embedded ? undefined : <PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      <DetailTabs primary={REPORT_TABS} active={tab} onChange={setTab} />
      {loading && <PageSkeleton />}

      {!loading && tab === 'runbooks' && (
        <>
          {runbookError && (
            <ErrorBanner
              title={`${runbookError.label} failed`}
              headline={runbookError.message}
              onDismiss={() => setRunbookError(null)}
            />
          )}
          {opsOverview && (
            <div className="grid gap-3 sm:grid-cols-3">
              <MacStatWidget label="Runbooks" value={String(opsOverview.runbook_count)} icon={<BookOpen className="w-4 h-4" />} />
              <MacStatWidget label="24h executions" value={String(opsOverview.executions_24h)} icon={<BookOpen className="w-4 h-4" />} />
              <MacStatWidget label="Fleet grade" value={opsOverview.compliance_grade} icon={<BookOpen className="w-4 h-4" />} tone="ok" />
            </div>
          )}
          <MacGlassPanel title="Runbook catalog" subtitle="Execute incident playbooks — records steps in execution history.">
            <ul className="space-y-2 text-sm">
              {runbooks.length === 0 ? (
                <PlatformEmptyState
                  title="No runbooks"
                  subtitle="Runbook catalog loads from the controller — check connectivity and retry."
                  action={
                    <button type="button" className="btn-secondary text-xs" onClick={() => void load()}>
                      Retry catalog
                    </button>
                  }
                />
              ) : runbooks.map((rb) => (
                <li key={rb.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.04] pb-2">
                  <div>
                    <p className="text-slate-200">{rb.title}</p>
                    <p className="text-xs text-slate-500">{rb.category} · {rb.severity}{rb.auto_trigger ? ` · trigger: ${rb.auto_trigger}` : ''}</p>
                  </div>
                  <button type="button" className="btn-secondary text-xs shrink-0" disabled={runbookBusy === rb.incident} onClick={() => void runRunbook(rb.incident, rb.title)}>
                    {runbookBusy === rb.incident ? 'Running…' : 'Execute'}
                  </button>
                </li>
              ))}
            </ul>
          </MacGlassPanel>
          {executions.length > 0 && (
            <MacGlassPanel title="Recent executions" subtitle="Operator runbook history.">
              <ul className="text-xs space-y-2 text-slate-400">
                {executions.map((ex) => (
                  <li key={ex.id} className="border-b border-white/[0.04] pb-2">
                    <span className="text-slate-300">{ex.incident}</span> — {ex.summary}
                    <span className="text-slate-600 block">{new Date(ex.created_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </MacGlassPanel>
          )}
        </>
      )}

      {!loading && tab === 'showback' && !showback && (
        <PlatformEmptyState
          title="Showback unavailable"
          subtitle="Compliance showback loads from the controller — check connectivity and retry."
          action={
            <button type="button" className="btn-secondary text-xs" onClick={() => void load()}>
              Retry showback
            </button>
          }
        />
      )}

      {!loading && tab === 'showback' && showback && (
        <>
          <MacGlassPanel title="Compliance showback" subtitle={showback.summary}>
            <p className={`text-2xl font-bold -mt-2 ${statusToneClass('ok')}`}>
              ${showback.total_cost_usd.toFixed(0)}<span className="text-sm font-normal text-slate-500"> / mo</span>
            </p>
            <p className="text-sm text-slate-400 mt-1">Fleet compliance grade: {showback.fleet_grade}</p>
            {compliance && (
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => window.open(getAiComplianceExportUrl(), '_blank', 'noopener')}
                >
                  Open compliance report
                </button>
                <a href={getAiCompliancePdfUrl()} className="btn-secondary text-xs inline-flex items-center" download="machina-compliance-report.pdf">
                  Download compliance PDF
                </a>
              </div>
            )}
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-white/[0.06]">
                    <th className="py-2 pr-2">Project</th>
                    <th className="py-2 pr-2">Cost</th>
                    <th className="py-2 pr-2">Grade</th>
                    <th className="py-2 pr-2">VMs</th>
                  </tr>
                </thead>
                <tbody>
                  {showback.lines.map((line) => (
                    <tr key={line.project_name} className="border-b border-white/[0.04] text-slate-200">
                      <td className="py-2 pr-2">{line.project_name}</td>
                      <td className="py-2 pr-2">${line.cost_usd.toFixed(0)}/mo</td>
                      <td className="py-2 pr-2">{line.compliance_grade}</td>
                      <td className="py-2 pr-2">{line.vm_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </MacGlassPanel>
        </>
      )}

      {!loading && tab === 'reports' && !error && !cap && (
        <PlatformEmptyState
          title="Reports unavailable"
          subtitle="Capacity and FinOps reports load from the controller — check connectivity and retry."
          action={
            <button type="button" className="btn-secondary text-xs" onClick={() => void load()}>
              Retry
            </button>
          }
        />
      )}

      {!loading && tab === 'reports' && cap && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MacStatWidget label="Online hosts" value={String(cap.hosts_online)} icon={<FolderKanban className="w-4 h-4" />} />
          <MacStatWidget label="Running VMs" value={String(cap.running_vms)} icon={<FolderKanban className="w-4 h-4" />} tone="ok" />
          <MacStatWidget label="Memory headroom" value={`${cap.memory_headroom_mib} MiB`} icon={<FolderKanban className="w-4 h-4" />} />
          <MacStatWidget label="Avg CPU" value={`${cap.avg_cpu_percent.toFixed(0)}%`} icon={<FolderKanban className="w-4 h-4" />} />
        </div>
      )}
      {!loading && tab === 'reports' && compliance && (
        <MacGlassPanel title="Machina Compliance" subtitle={`Grade ${compliance.grade} · ${compliance.score}/100`}>
          <p className="text-2xl font-bold text-slate-100 -mt-2">{compliance.score}/100</p>
          <p className="text-sm text-slate-400 mt-1">{compliance.summary}</p>
          <ul className="mt-3 text-xs space-y-1">
            {compliance.checks.map((c) => (
              <li key={c.id} className={statusToneClass(c.passed ? 'ok' : 'warn')}>
                {c.passed ? '✓' : '○'} {c.name} — {c.detail}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => {
                const blob = new Blob([compliance.markdown], { type: 'text/markdown' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = 'machina-compliance-report.md'
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              Download Markdown
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => window.open(getAiComplianceExportUrl(), '_blank', 'noopener')}
            >
              Open print / PDF view
            </button>
            <a
              href={getAiCompliancePdfUrl()}
              className="btn-secondary text-xs inline-flex items-center"
              download="machina-compliance-report.pdf"
            >
              Download PDF
            </a>
          </div>
        </MacGlassPanel>
      )}
      {!loading && tab === 'reports' && budget && (
        <MacGlassPanel title="FinOps budget guard" subtitle={budget.summary}>
          <p className="text-2xl font-bold text-slate-100 -mt-2">
            ${budget.current_spend_usd.toFixed(0)}
            <span className="text-sm font-normal text-slate-500"> / ${budget.monthly_budget_usd.toFixed(0)} budget ({budget.utilization_pct.toFixed(0)}%)</span>
          </p>
          <p className="text-sm text-slate-400 mt-1">Status: <span className={statusToneClass(budget.status === 'over_budget' ? 'error' : budget.status === 'watch' ? 'warn' : 'ok')}>{budget.status}</span></p>
          {budget.alerts.length > 0 && (
            <ul className="mt-3 text-xs space-y-1">
              {budget.alerts.map((a) => (
                <li key={a.id} className={statusToneClass(a.severity === 'critical' ? 'error' : a.severity === 'warning' ? 'warn' : 'neutral')}>
                  {a.message}
                </li>
              ))}
            </ul>
          )}
        </MacGlassPanel>
      )}
      {!loading && tab === 'reports' && exposureFinops && (
        <MacGlassPanel title="FinOps × Zeus Firewall" subtitle={exposureFinops.summary}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 -mt-2">
            <MacStatWidget label="Fleet exposure" value={`$${exposureFinops.fleet_exposure_monthly_usd.toFixed(0)}/mo`} icon={<DollarSign className="w-4 h-4" />} tone="warn" />
            <MacStatWidget label="Idle port waste" value={`$${exposureFinops.idle_port_waste_usd.toFixed(0)}/mo`} icon={<DollarSign className="w-4 h-4" />} />
            <MacStatWidget label="Cloud SG" value={`$${exposureFinops.cloud_sg_monthly_usd.toFixed(0)}/mo`} icon={<DollarSign className="w-4 h-4" />} />
            <MacStatWidget label="GPU / storage" value={`$${(exposureFinops.gpu_exposure_usd + exposureFinops.storage_exposure_usd).toFixed(0)}/mo`} icon={<DollarSign className="w-4 h-4" />} tone="ok" />
          </div>
          {exposureFinops.vm_idle_ranking.length > 0 && (
            <ul className="mt-4 text-xs space-y-1">
              {exposureFinops.vm_idle_ranking.slice(0, 5).map((v) => (
                <li key={v.vm_id} className="text-slate-400">
                  #{v.rank} {v.vm_name} — ${v.waste_usd.toFixed(0)}/mo ({v.idle_ports} idle ports)
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <a className="btn-secondary text-xs" href={getFirewallExposureFinOpsExportUrl()} download>
              Export exposure CSV
            </a>
          </div>
        </MacGlassPanel>
      )}
      {!loading && tab === 'reports' && cost && (
        <MacGlassPanel title="Machina Cost Guardian" subtitle="Idle, oversized, and snapshot-heavy VMs.">
          <p className={`text-2xl font-bold -mt-2 ${statusToneClass('ok')}`}>${cost.estimated_monthly_usd.toFixed(0)}<span className="text-sm font-normal text-slate-500"> est. / month</span></p>
          {cost.predicted_next_month_usd != null && (
            <p className="text-sm text-slate-400 mt-1">
              Predicted next month: <span className={`font-medium ${statusToneClass('ok')}`}>${cost.predicted_next_month_usd.toFixed(0)}</span>
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-3 text-sm text-slate-400 mt-3">
            <p>{cost.idle_vm_count} idle VMs</p>
            <p>{cost.oversized_vm_count} oversized</p>
            <p>{cost.snapshot_heavy_count} snapshot-heavy</p>
          </div>
          {cost.suggestions.length > 0 && (
            <ul className="mt-3 text-xs text-slate-400 space-y-1">{cost.suggestions.map((s, i) => <li key={i}>• {s}</li>)}</ul>
          )}
          <a href={getAiCostExportUrl()} className="btn-secondary text-xs inline-flex mt-3" download="machina-cost-guardian.csv">
            Download CFO CSV
          </a>
        </MacGlassPanel>
      )}
      {!loading && tab === 'reports' && attribution && attribution.teams.length > 0 && (
        <MacGlassPanel title="Team cost attribution" subtitle={attribution.summary}>
          <ul className="text-xs space-y-2 text-slate-400 mt-2">
            {attribution.teams.slice(0, 8).map((t) => (
              <li key={t.team} className="flex justify-between gap-2">
                <span>{t.team} ({t.vm_count} VMs)</span>
                <span className={statusToneClass('ok')}>${t.estimated_monthly_usd.toFixed(0)}/mo · {t.share_pct.toFixed(0)}%</span>
              </li>
            ))}
          </ul>
          <a href={getCostAttributionExportUrl()} className="btn-secondary text-xs inline-flex mt-3" download="machina-cost-attribution.csv">
            Download chargeback CSV
          </a>
        </MacGlassPanel>
      )}
      {!loading && tab === 'reports' && autopilotHistory.length > 0 && (
        <MacGlassPanel title="Autopilot history" subtitle="Recent audited auto-fix runs">
          <ul className="text-xs space-y-2 -mt-2">
            {autopilotHistory.map((h) => (
              <li key={h.id} className="flex justify-between gap-2 border-b border-white/[0.04] pb-2">
                <span className="text-slate-300">{h.action.replace('ai.autopilot.', '')}</span>
                <span className="text-slate-500 shrink-0">{new Date(h.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </MacGlassPanel>
      )}
      {!loading && tab === 'reports' && aiCap && (
        <MacGlassPanel title="Machina Capacity Planner" subtitle="Headroom and simple onboarding projections.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm -mt-2">
            <p>CPU headroom: <span className="text-slate-200">{aiCap.cpu_headroom_percent}%</span></p>
            <p>Memory headroom: <span className="text-slate-200">{aiCap.memory_headroom_mib} MiB</span></p>
            <p>Small VMs addable: <span className="text-slate-200">~{aiCap.estimated_small_vms_addable}</span></p>
            {aiCap.storage_runway_days != null && <p>Storage runway: <span className="text-slate-200">{aiCap.storage_runway_days} days</span></p>}
          </div>
          {aiCap.recommendations.length > 0 && (
            <ul className="mt-3 text-xs text-slate-400 space-y-1">{aiCap.recommendations.map((r, i) => <li key={i}>• {r}</li>)}</ul>
          )}
          <a href={getAiCapacityExportUrl()} className="btn-secondary text-xs inline-flex mt-3" download="machina-capacity-planner.csv">
            Download capacity CSV
          </a>
        </MacGlassPanel>
      )}
      {!loading && tab === 'reports' && security && security.findings.length > 0 && (
        <MacGlassPanel title="Machina Security Sentinel" subtitle={`Risk level: ${security.risk_level}`}>
          <ul className="text-sm space-y-2 -mt-2">
            {security.findings.slice(0, 8).map((f) => (
              <li key={f.id} className="border-b border-white/[0.04] pb-2">
                <span className={statusToneClass(f.severity === 'critical' ? 'error' : 'warn')}>{f.title}</span>
                <p className="text-xs text-slate-500 mt-0.5">{f.detail}</p>
              </li>
            ))}
          </ul>
        </MacGlassPanel>
      )}
      {!loading && tab === 'reports' && finops && (
        <MacGlassPanel title="FinOps estimate" subtitle="Rough monthly cost from vCPU and memory rates.">
          <p className={`text-3xl font-bold -mt-2 ${statusToneClass('ok')}`}>${finops.estimated_monthly_usd.toFixed(2)}<span className="text-sm font-normal text-slate-500"> / month</span></p>
          <div className="grid gap-3 sm:grid-cols-3 text-sm text-slate-400 mt-3">
            <p>{finops.total_vcpu} vCPU @ ${finops.vcpu_hour_usd}/hr</p>
            <p>{finops.total_memory_gib.toFixed(1)} GiB @ ${finops.gib_hour_usd}/hr</p>
            <p>{finops.vm_count} VMs ({finops.running_vms} running)</p>
          </div>
        </MacGlassPanel>
      )}
      {!loading && tab === 'reports' && (
      <MacGlassPanel title="Workspaces" subtitle="Project quotas and VM counts.">
        <ul className="text-sm space-y-2 -mt-2">{projects.map((p) => (
          <li key={p.name} className="flex justify-between border-b border-white/[0.04] pb-2"><span className="text-slate-200">{p.name}</span><span className="text-slate-500">{p.vm_count} VMs</span></li>
        ))}</ul>
      </MacGlassPanel>
      )}
    </PlatformPageChrome>
  )
}
