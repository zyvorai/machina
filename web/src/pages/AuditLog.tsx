// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useEffect, useState, useCallback } from 'react'
import { getAuditLog, exportAuditNdjson, AuditEvent } from '../api/extras'
import { useTranslation } from 'react-i18next'
import { useToastContext } from '../contexts/ToastContext'
import { FileText, RefreshCw, Search, CheckCircle, XCircle, Download, X } from 'lucide-react'
import { downloadJSON, downloadCSV } from '../utils/export'
import { formatUserError } from '../utils/apiError'
import { statusToneClass } from '../utils/semanticColors'
import PageLayout from '../components/PageLayout'

export default function AuditLogPage() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionInp, setActionInp] = useState('')
  const [actorInp, setActorInp] = useState('')
  const [qInp, setQInp] = useState('')
  const toast = useToastContext()
  const { t } = useTranslation()

  const fetchLog = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError(null)
      setEvents(
        await getAuditLog({
          action: actionInp.trim() || undefined,
          actor: actorInp.trim() || undefined,
          q: qInp.trim() || undefined,
          limit: 8000,
        }),
      )
    } catch (e: unknown) {
      const msg = formatUserError(e)
      setLoadError(msg)
      toast.error(`Failed to load audit log: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [toast, actionInp, actorInp, qInp])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void fetchLog()
    }, 450)
    return () => clearTimeout(t)
  }, [fetchLog])

  return (
    <PageLayout
      title="Audit Log"
      icon={<FileText className={`w-6 h-6 ${statusToneClass('info')}`} />}
      subtitle={`${events.length} events (server-filtered)`}
      actions={
        <>
          <button type="button" onClick={() => { setActionInp('openstack'); setQInp('') }}
            className="px-3 py-1.5 text-xs rounded-lg border border-sky-600/50 text-sky-300 hover:bg-sky-950/40">
            OpenStack only
          </button>
          <button type="button" onClick={() => void fetchLog()} className="px-3 py-1.5 text-xs rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-200 transition flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh now
          </button>
          <button type="button" onClick={() => downloadJSON(events, 'audit-log.json')} className="p-2 hover:bg-slate-700 rounded-lg transition" title="Export JSON" aria-label="Export JSON"><Download className="w-4 h-4" /></button>
          <button type="button" onClick={() => downloadCSV(events as unknown as Record<string, unknown>[], 'audit-log.csv')} className="p-2 hover:bg-slate-700 rounded-lg transition" title="Export CSV" aria-label="Export CSV"><Download className={`w-4 h-4 ${statusToneClass('ok')}`} /></button>
          <button type="button" onClick={() => void exportAuditNdjson()} className="px-3 py-1.5 text-xs rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-200" title={t('audit.exportNdjson')}>
            {t('audit.exportNdjson')}
          </button>
        </>
      }
      error={loadError}
      errorTitle="Could not load audit log"
      onErrorRetry={() => void fetchLog()}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            aria-label="Filter by action"
            placeholder="Action contains…"
            value={actionInp}
            onChange={(e) => setActionInp(e.target.value)}
            className={`w-full pl-10 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500 ${actionInp ? 'pr-8' : 'pr-4'}`}
          />
          {actionInp && (
            <button type="button" aria-label="Clear action filter" onClick={() => setActionInp('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            aria-label="Filter by actor"
            placeholder="Actor contains…"
            value={actorInp}
            onChange={(e) => setActorInp(e.target.value)}
            className={`w-full pl-10 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500 ${actorInp ? 'pr-8' : 'pr-4'}`}
          />
          {actorInp && (
            <button type="button" aria-label="Clear actor filter" onClick={() => setActorInp('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            aria-label="Search all fields"
            placeholder="Any field (action, target, result, actor)…"
            value={qInp}
            onChange={(e) => setQInp(e.target.value)}
            className={`w-full pl-10 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500 ${qInp ? 'pr-8' : 'pr-4'}`}
          />
          {qInp && (
            <button type="button" aria-label="Clear search" onClick={() => setQInp('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500">Filters reload after a short pause (debounced).</p>

      {loading ? (
        <div className="flex items-center justify-center h-32" aria-busy="true" aria-label="Loading audit log">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[56rem]" aria-label="Audit log">
            <thead><tr className="border-b border-slate-700/50 text-left text-sm text-slate-400"><th className="px-6 py-3">Time</th><th className="px-6 py-3">Action</th><th className="px-6 py-3">Target</th><th className="px-6 py-3">Actor</th><th className="px-6 py-3">Result</th></tr></thead>
            <tbody className="divide-y divide-slate-700/30">
              {events.map((e) => (
                <tr key={`${e.timestamp}-${e.action}-${e.target}`} className="table-row-hover">
                  <td className="px-6 py-2 text-xs text-slate-400 font-mono whitespace-nowrap">{e.timestamp}</td>
                  <td className="px-6 py-2 text-sm font-medium">{e.action}</td>
                  <td className="px-6 py-2 text-sm text-slate-300">{e.target}</td>
                  <td className="px-6 py-2 text-sm text-slate-400 font-mono">{e.actor?.trim() ? e.actor : '—'}</td>
                  <td className="px-6 py-2 text-sm">
                    {e.result.includes('ok') || e.result.includes('success')
                      ? <span className={`flex items-center gap-1 ${statusToneClass('ok')}`}><CheckCircle className="w-3 h-3" />{e.result}</span>
                      : <span className={`flex items-center gap-1 ${statusToneClass('error')}`}><XCircle className="w-3 h-3" />{e.result}</span>
                    }
                  </td>
                </tr>
              ))}
              {events.length === 0 && <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">No audit events match these filters</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </PageLayout>
  )
}
