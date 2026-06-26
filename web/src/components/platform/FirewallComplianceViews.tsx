// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { Link } from 'react-router'
import { asArray, asRecord } from './JsonInspector'
import { hubLinkClasses, statusBadgeClasses, statusSurfaceClasses, statusToneClass } from '../../utils/semanticColors'

export function ComplianceReportSummary({ report }: { report: Record<string, unknown> }) {
  const summary = typeof report.summary === 'string' ? report.summary : null
  const findings = asArray(report.findings ?? report.items ?? report.violations ?? report.results)
  const critical = report.critical_count ?? report.critical ?? findings.filter((f) => {
    const r = asRecord(f)
    return r?.severity === 'critical' || r?.risk === 'critical'
  }).length

  return (
    <div className="space-y-3">
      {summary && <p className="text-sm text-slate-300">{summary}</p>}
      <div className="flex flex-wrap gap-3 text-xs">
        <span className="px-2 py-1 rounded bg-slate-800 text-slate-300">{findings.length} finding(s)</span>
        {critical != null && Number(critical) > 0 && (
          <span className={`px-2 py-1 rounded ${statusBadgeClasses('error')}`}>{Number(critical)} critical</span>
        )}
      </div>
      {findings.length > 0 && (
        <ul className="space-y-2 max-h-64 overflow-y-auto">
          {findings.slice(0, 20).map((item, i) => {
            const row = asRecord(item) ?? { detail: String(item) }
            const title = String(row.title ?? row.rule ?? row.policy ?? row.name ?? `Finding ${i + 1}`)
            const detail = String(row.detail ?? row.message ?? row.description ?? '')
            const target = row.target_id ?? row.host_id
            return (
              <li key={title} className="rounded-lg border border-white/[0.06] bg-slate-950/30 px-3 py-2 text-sm">
                <p className="text-slate-200 font-medium">{title}</p>
                {detail && <p className="text-xs text-slate-500 mt-0.5">{detail}</p>}
                {target != null && target !== '' && (
                  <Link to={`/platform/zeus/security/firewall/${String(target)}`} className={`text-xs mt-1 inline-block ${hubLinkClasses()}`}>
                    Open firewall target →
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function PacketwolfAnomalySummary({ data }: { data: Record<string, unknown> }) {
  const summary = typeof data.summary === 'string' ? data.summary : null
  const anomalies = asArray(data.anomalies ?? data.items ?? data.results)

  return (
    <div className="space-y-3">
      {summary && <p className="text-sm text-slate-300">{summary}</p>}
      {anomalies.length === 0 ? (
        <p className="text-sm text-slate-400">No anomalies in the latest Packetwolf scan.</p>
      ) : (
        <ul className="space-y-2 max-h-64 overflow-y-auto">
          {anomalies.slice(0, 15).map((item, i) => {
            const row = asRecord(item) ?? { detail: String(item) }
            return (
              <li key={String(row.type ?? row.anomaly ?? row.title ?? i)} className={`rounded-lg px-3 py-2 text-sm ${statusSurfaceClasses('warn')}`}>
                <p className={statusToneClass('warn')}>{String(row.type ?? row.anomaly ?? row.title ?? `Anomaly ${i + 1}`)}</p>
                <p className={`text-xs mt-0.5 opacity-70 ${statusToneClass('warn')}`}>{String(row.detail ?? row.message ?? row.description ?? '')}</p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function SupportBundleSummary({ bundle }: { bundle: Record<string, unknown> }) {
  const rows = [
    { label: 'Generated', value: bundle.generated_at ?? bundle.timestamp },
    { label: 'Controller version', value: bundle.version ?? bundle.controller_version },
    { label: 'Hosts', value: bundle.host_count ?? (asArray(bundle.hosts).length || undefined) },
    { label: 'VMs', value: bundle.vm_count ?? (asArray(bundle.vms).length || undefined) },
    { label: 'Failed tasks (24h)', value: bundle.failed_tasks_24h ?? bundle.failed_tasks },
    { label: 'Cluster health', value: bundle.cluster_status ?? bundle.health },
  ].filter((r) => r.value != null && r.value !== '')

  return (
    <ul className="grid gap-2 sm:grid-cols-2 text-sm">
      {rows.map((r) => (
        <li key={r.label} className="rounded-lg border border-white/[0.06] bg-slate-950/30 px-3 py-2">
          <span className="text-xs text-slate-500 block">{r.label}</span>
          <span className="text-slate-200">{String(r.value)}</span>
        </li>
      ))}
    </ul>
  )
}
