// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ListTodo, X, RefreshCw } from 'lucide-react'
import { listPlatformTasks, getControllerBase, type PlatformTask } from '../api/platform'
import { usePlatformDesktopTier } from '../hooks/usePlatformDesktopTier'
import { operationsHubHref } from '../utils/platformHubLinks'
import { statusActionLinkClasses, statusBadgeClasses, statusBgClass, taskStatusTone } from '../utils/semanticColors'

interface PlatformTaskDrawerProps {
  open: boolean
  onClose: () => void
}

export default function PlatformTaskDrawer({ open, onClose }: PlatformTaskDrawerProps) {
  const [tasks, setTasks] = useState<PlatformTask[]>([])
  const [loading, setLoading] = useState(false)
  const [tier] = usePlatformDesktopTier()
  const operationsHref = operationsHubHref(tier)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await listPlatformTasks()
      setTasks(rows.filter((t) => t.status === 'pending' || t.status === 'running').slice(0, 15))
    } catch {
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
    const id = window.setInterval(() => void load(), 5000)
    let es: EventSource | null = null
    try {
      es = new EventSource(`${getControllerBase()}/api/v1/events/stream`, { withCredentials: true })
      es.onmessage = () => { void load() }
    } catch {
      /* SSE optional */
    }
    return () => {
      window.clearInterval(id)
      es?.close()
    }
  }, [open, load])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[90] flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close task drawer" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-slate-950/95 backdrop-blur-xl border-l border-white/[0.08] shadow-xl flex flex-col" role="dialog" aria-modal="true" aria-label="Active tasks">
        <div className="flex items-center justify-between p-4 border-b border-white/[0.08]">
          <h2 className="font-semibold flex items-center gap-2">
            <ListTodo className="w-5 h-5" /> Active tasks
          </h2>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary p-2" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" className="btn-secondary p-2" onClick={onClose} aria-label="Close">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {tasks.length === 0 && (
            <p className="text-sm text-slate-500">
              No active tasks.{' '}
              <Link to={operationsHref} className={statusActionLinkClasses('info')} onClick={onClose}>
                Open Operations hub
              </Link>
            </p>
          )}
          {tasks.map((t) => (
            <div key={t.id} className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-mono text-xs text-slate-400">{t.operation}</span>
                <span className={`text-xs uppercase ${statusBadgeClasses(taskStatusTone(t.status))}`}>{t.status}</span>
              </div>
              <div className="mt-2 h-1.5 bg-slate-800 rounded overflow-hidden">
                <div className={`h-full ${statusBgClass('info')} transition-all`} style={{ width: `${t.progress}%` }} />
              </div>
              {t.message && <p className="mt-2 text-slate-400 text-xs">{t.message}</p>}
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-white/[0.08]">
          <Link to={operationsHref} className={`text-sm ${statusActionLinkClasses('info', 'hover:underline')}`} onClick={onClose}>
            Open Operations hub →
          </Link>
        </div>
      </aside>
    </div>
  )
}

export function PlatformTaskDrawerButton({ onClick, activeCount }: { onClick: () => void; activeCount?: number }) {
  return (
    <button type="button" className="btn-secondary text-xs flex items-center gap-1 relative" onClick={onClick} title="Platform tasks">
      <ListTodo className="w-4 h-4" />
      Tasks
      {activeCount != null && activeCount > 0 && (
        <span className={`absolute -top-1 -right-1 ${statusBgClass('info')} text-white text-[10px] rounded-full min-w-[1rem] h-4 px-1 flex items-center justify-center`}>
          {activeCount > 9 ? '9+' : activeCount}
        </span>
      )}
    </button>
  )
}
