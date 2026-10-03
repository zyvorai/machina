// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useNavigate } from 'react-router'
import { usePlatformDesktopTier } from '../../hooks/usePlatformDesktopTier'
import { tasksHubHref } from '../../utils/platformHubLinks'
import {
  adoptPlatformVm,
  createVmBackup,
  installGuestTools,
  setVmHa,
  vmPower,
  type HealthIssue,
  type VmHealthReport,
} from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { statusToneClass } from '../../utils/semanticColors'

interface HealthCheckPanelProps {
  vmId: string
  report: VmHealthReport | null
  loading: boolean
  onRefresh: () => void
  onTab?: (tab: string) => void
}

export default function HealthCheckPanel({ vmId, report, loading, onRefresh, onTab }: HealthCheckPanelProps) {
  const toast = useToastContext()
  const navigate = useNavigate()
  const [tier] = usePlatformDesktopTier()

  const fix = async (issue: HealthIssue) => {
    try {
      switch (issue.fix_action) {
        case 'start_vm':
          await vmPower(vmId, 'start')
          toast.success('Start queued')
          break
        case 'adopt_vm':
          await adoptPlatformVm(vmId)
          toast.success('VM adopted')
          break
        case 'enable_ha':
          await setVmHa(vmId, { enabled: true })
          toast.success('HA enabled')
          break
        case 'create_backup':
          await createVmBackup(vmId)
          toast.success('Backup queued')
          break
        case 'open_snapshots':
          onTab?.('snapshots')
          break
        case 'install_guest_tools':
          await installGuestTools(vmId)
          toast.success('Guest tools install queued')
          break
        default:
          return
      }
      onRefresh()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Health check</h3>
        <button type="button" className="btn-secondary text-xs" disabled={loading} onClick={onRefresh}>
          {loading ? 'Checking…' : 'Run health check'}
        </button>
      </div>
      {report && (
        <>
          <p className={`text-sm font-medium capitalize ${statusToneClass(report.healthy ? 'ok' : 'warn')}`}>
            VM health: {report.score} · {report.checks_passed}/{report.checks_total} checks passed
          </p>
          {report.issues.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">All checks passed.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {report.issues.map((issue, i) => (
                <li key={`${issue.id}-${i}`} className="border border-[var(--apple-hairline)] rounded-lg p-3">
                  <p className={statusToneClass(issue.severity === 'warning' ? 'warn' : 'error')}>{issue.message}</p>
                  {issue.remediation && <p className="text-xs text-[var(--text-muted)] mt-1">{issue.remediation}</p>}
                  {issue.fix_label && issue.fix_action && (
                    <button type="button" className="btn-primary text-xs mt-2" onClick={() => void fix(issue)}>
                      {issue.fix_label}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {!report && !loading && (
        <button type="button" className="btn-secondary text-sm" onClick={() => navigate(tasksHubHref(tier))}>View tasks</button>
      )}
    </div>
  )
}
