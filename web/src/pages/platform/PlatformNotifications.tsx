// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Bell } from 'lucide-react'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { statusBadgeClasses, statusSurfaceClasses, statusToneClass } from '../../utils/semanticColors'
import { createVmBackup, listNotifications, markNotificationDelivered, markAllNotificationsDelivered, type NotificationRow } from '../../api/platform'
import { aiRunbook } from '../../api/ai'
import ExplainButton from '../../components/ai/ExplainButton'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { usePlatformDesktopTier } from '../../hooks/usePlatformDesktopTier'
import type { PlatformDesktopTier } from '../../utils/platformDesktopTier'
import { tasksHubHref } from '../../utils/platformHubLinks'

function actionForKind(
  kind: string,
  payload: Record<string, unknown>,
  tier: PlatformDesktopTier,
): { label: string; href?: string; action?: () => Promise<void> } | null {
  if (kind.includes('backup') && kind.includes('fail')) {
    const vmId = payload.vm_id as string | undefined
    return { label: 'Retry backup', action: vmId ? async () => { await createVmBackup(vmId) } : undefined }
  }
  if (kind.includes('migrate') && kind.includes('complete')) {
    const vmId = payload.vm_id as string | undefined
    return vmId ? { label: 'Open VM', href: `/platform/vms/${vmId}` } : null
  }
  if (kind.includes('task') && kind.includes('fail')) {
    return { label: 'View tasks', href: tasksHubHref(tier) }
  }
  return null
}

export default function PlatformNotifications() {
  const toast = useToastContext()
  const [tier] = usePlatformDesktopTier()
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [undeliveredOnly, setUndeliveredOnly] = useState(true)
  const [runbook, setRunbook] = useState<{ title: string; steps: string[] } | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { setRows(await listNotifications(undeliveredOnly)) } catch (e: unknown) { setError(formatUserError(e)) }
  }, [undeliveredOnly])

  useEffect(() => { void load() }, [load])

  const unread = rows.filter((n) => !n.delivered).length

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load()}
      prepend={<PlatformBackLink to="/platform/operations" label="Operations" />}
      title="Alerts"
      subtitle="Notification Center — actionable alerts, not just log lines."
      icon={<Bell className="w-6 h-6 text-slate-400" />}
      actions={
        <>
          {unread > 0 && (
            <>
              <span className={`px-3 py-1 rounded-full text-sm border ${statusBadgeClasses('warn')}`}>
                {unread} unread
              </span>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => void markAllNotificationsDelivered().then((n) => {
                  toast.success(`Marked ${n} notification(s) read`)
                  void load()
                }).catch((e: unknown) => toast.error(formatUserError(e)))}
              >
                Mark all read
              </button>
            </>
          )}
          <PlatformRefreshButton onClick={() => void load()} />
        </>
      }
      contentClassName="space-y-4"
    >
      <label className="flex items-center gap-2 text-sm text-slate-400">
        <input type="checkbox" checked={undeliveredOnly} onChange={(e) => setUndeliveredOnly(e.target.checked)} />
        Undelivered only
      </label>
      {rows.length === 0 && !error ? (
        <PlatformEmptyState title="No alerts" subtitle="You're all caught up — warnings and failures will appear here.">
          <Bell className="w-8 h-8 text-slate-600 mx-auto mt-2" />
        </PlatformEmptyState>
      ) : (
        <ul className="space-y-3">
          {rows.map((n) => {
            const act = actionForKind(n.kind, n.payload, tier)
            return (
              <li key={n.id} className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                n.delivered ? 'border-white/[0.04] bg-slate-900/30 opacity-70' : statusSurfaceClasses('warn')
              }`}>
                <div>
                  <span className={n.delivered ? 'text-slate-500' : `${statusToneClass('warn')} font-medium`}>{n.kind}</span>
                  <div className="text-xs text-slate-500 mt-1">{new Date(n.created_at).toLocaleString()}</div>
                  {typeof n.payload.message === 'string' && <p className="text-sm text-slate-400 mt-1">{n.payload.message}</p>}
                </div>
                <div className="flex gap-2 shrink-0 flex-wrap">
                  <ExplainButton screen="notification" objectRef={{ kind: n.kind, ...n.payload }} />
                  {(n.kind.includes('fail') || n.kind.includes('offline')) && (
                    <button type="button" className="btn-secondary text-xs" onClick={async () => {
                      try {
                        const incident = n.kind.includes('backup') ? 'backup_failed' : n.kind.includes('migrat') ? 'migration_failed' : n.kind.includes('host') ? 'host_offline' : 'vm_unreachable'
                        const r = await aiRunbook(incident, n.payload)
                        setRunbook({ title: r.title, steps: r.steps })
                      } catch (e: unknown) { toast.error(formatUserError(e)) }
                    }}>Runbook</button>
                  )}
                  {act?.href && <Link to={act.href} className="btn-primary text-xs">{act.label}</Link>}
                  {act?.action && (
                    <button type="button" className="btn-primary text-xs" onClick={async () => {
                      try { await act.action!(); toast.success('Action queued'); await load() } catch (e: unknown) { toast.error(formatUserError(e)) }
                    }}>{act.label}</button>
                  )}
                  {!n.delivered && (
                    <button type="button" className="btn-secondary text-xs" onClick={async () => {
                      try { await markNotificationDelivered(n.id); await load() } catch (e: unknown) { toast.error(formatUserError(e)) }
                    }}>Dismiss</button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {runbook && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" onClick={() => setRunbook(null)}>
          <div className="max-w-lg w-full rounded-2xl bg-slate-900 border border-white/10 p-5" role="dialog" aria-modal="true" aria-label={runbook.title} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">{runbook.title}</h3>
            <ol className="text-sm text-slate-300 space-y-2 list-decimal pl-5">{runbook.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            <button type="button" className="btn-secondary mt-4 w-full" onClick={() => setRunbook(null)}>Close</button>
          </div>
        </div>
      )}
    </PlatformPageChrome>
  )
}
