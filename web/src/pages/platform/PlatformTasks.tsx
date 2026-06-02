// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import ExplainButton from '../../components/ai/ExplainButton'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import PlatformFilterPills from '../../components/platform/PlatformFilterPills'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { statusBgClass, taskStatusTone } from '../../utils/semanticColors'
import { cancelTask, listPlatformTasks, retryTask, type PlatformTask } from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'

function statusColor(status: string) {
  return statusBgClass(taskStatusTone(status))
}

export default function PlatformTasks() {
  const toast = useToastContext()
  const [rows, setRows] = useState<PlatformTask[]>([])
  const [filter, setFilter] = useState('')
  const [opFilter, setOpFilter] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setRows(await listPlatformTasks({ status: filter || undefined, operation: opFilter || undefined }))
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [filter, opFilter])

  useEffect(() => { void load() }, [load])

  const statusCounts = {
    '': rows.length,
    pending: rows.filter((t) => t.status === 'pending').length,
    running: rows.filter((t) => t.status === 'running').length,
    completed: rows.filter((t) => t.status === 'completed' || t.status === 'succeeded').length,
    failed: rows.filter((t) => t.status === 'failed').length,
  }

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load()}
      prepend={<PlatformBackLink to="/platform/operations" label="Operations" />}
      title="Tasks"
      subtitle="Orchestration queue — like Activity Monitor for your datacenter."
      icon={<ClipboardList className="w-6 h-6 text-slate-400" />}
      actions={<PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      <PlatformFilterPills
        value={filter}
        onChange={setFilter}
        options={[
          { id: '', label: 'All' },
          { id: 'pending', label: 'Pending' },
          { id: 'running', label: 'Running' },
          { id: 'completed', label: 'Completed' },
          { id: 'failed', label: 'Failed' },
        ]}
      />
      <input className="input max-w-xs" placeholder="Filter by operation" value={opFilter} onChange={(e) => setOpFilter(e.target.value)} />
      {rows.length === 0 && !error ? (
        <PlatformEmptyState title="No tasks" subtitle="Operations like VM create, migrate, and backup appear here." />
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => (
            <li key={t.id} className="platform-mac-stat rounded-xl border border-white/[0.06] bg-slate-900/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <div>
                  <p className="font-medium text-slate-200">{t.operation}</p>
                  <p className="text-xs text-slate-500 font-mono">{t.id.slice(0, 8)}</p>
                </div>
                <span className="text-xs capitalize text-slate-400">{t.status}</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden mb-2">
                <div className={`h-full rounded-full transition-all ${statusColor(t.status)}`} style={{ width: `${Math.min(100, t.progress)}%` }} />
              </div>
              <div className="flex justify-between items-center text-xs text-slate-500">
                <span>{t.progress}% {t.message || ''}</span>
                <div className="flex gap-2">
                  {t.status === 'pending' && (
                    <button type="button" className="btn-secondary text-xs" onClick={async () => {
                      try { await cancelTask(t.id); toast.success('Cancelled'); await load() } catch (e: unknown) { toast.error(formatUserError(e)) }
                    }}>Cancel</button>
                  )}
                  {t.status === 'failed' && (
                    <>
                      <ExplainButton screen="failed_task" objectRef={{ task_id: t.id, operation: t.operation, message: t.message }} />
                      <button type="button" className="btn-secondary text-xs" onClick={async () => {
                      try { await retryTask(t.id); toast.success('Retry queued'); await load() } catch (e: unknown) { toast.error(formatUserError(e)) }
                    }}>Retry</button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PlatformPageChrome>
  )
}
