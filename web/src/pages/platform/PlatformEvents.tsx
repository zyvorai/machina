// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, ScrollText, Terminal } from 'lucide-react'
import {
  MacGlassPanel,
  MacSectionTitle,
  MacStatWidget,
} from '../../components/platform/mac/PlatformMacUi'
import PageLayout from '../../components/PageLayout'
import { getFleetConsole, listAuditLogs, type AuditLog, type FleetConsoleEntry, type FleetConsoleOverview } from '../../api/platform'
import { formatUserError } from '../../utils/apiError'
import { statusBadgeClasses, statusBorderClass } from '../../utils/semanticColors'

type SourceFilter = 'all' | 'audit' | 'event' | 'task'

const SOURCE_FILTERS: { id: SourceFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'audit', label: 'Audit' },
  { id: 'event', label: 'Events' },
  { id: 'task', label: 'Tasks' },
]

function severityClass(severity: string) {
  const tone = severity === 'error' ? 'error' : severity === 'warn' ? 'warn' : 'neutral'
  return `border uppercase ${statusBadgeClasses(tone)} ${statusBorderClass(tone)}`
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function LogLine({ entry }: { entry: FleetConsoleEntry }) {
  return (
    <div className="flex gap-3 px-3 py-2 font-mono text-xs border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
      <time className="text-slate-500 shrink-0 w-36">{formatTime(entry.created_at)}</time>
      <span className={`shrink-0 px-1.5 py-0.5 rounded border uppercase text-[10px] tracking-wide ${severityClass(entry.severity)}`}>
        {entry.severity}
      </span>
      <span className="shrink-0 w-14 text-orange-300/90 capitalize">{entry.source}</span>
      <span className="text-slate-200 min-w-0 break-all">
        {entry.actor ? <span className="text-violet-300">{entry.actor} </span> : null}
        <span className="text-slate-400">{entry.action}</span>
        {' — '}
        {entry.message}
      </span>
    </div>
  )
}

export default function PlatformEvents({ embedded }: { embedded?: boolean } = {}) {
  const [fleet, setFleet] = useState<FleetConsoleOverview | null>(null)
  const [controllerAudit, setControllerAudit] = useState<AuditLog[]>([])
  const [source, setSource] = useState<SourceFilter>('all')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [console, audit] = await Promise.all([
        getFleetConsole(),
        listAuditLogs().catch(() => []),
      ])
      setFleet(console)
      setControllerAudit(audit)
    } catch (e: unknown) {
      setError(formatUserError(e))
      setFleet(null)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const entries = useMemo(() => {
    const rows = fleet?.entries ?? []
    const q = query.trim().toLowerCase()
    return rows.filter((e) => {
      if (source !== 'all' && e.source !== source) return false
      if (!q) return true
      return (
        e.message.toLowerCase().includes(q)
        || e.action.toLowerCase().includes(q)
        || (e.actor?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [fleet, source, query])

  return (
    <PageLayout hideHeader compact={embedded} error={error}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        {!embedded && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-orange-400/80">Console</p>
            <MacSectionTitle
              title="Logs & Audit"
              subtitle="Unified fleet log tail — audit trail, platform events, and task failures in one stream."
            />
          </div>
        )}
        <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void load()}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </header>

      {fleet && (
        <>
          <p className="text-sm text-slate-400">{fleet.summary}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MacStatWidget label="24h total" value={String(fleet.total_24h)} icon={<ScrollText className="w-4 h-4" />} />
            <MacStatWidget label="Audit (24h)" value={String(fleet.audit_24h)} icon={<Terminal className="w-4 h-4" />} />
            <MacStatWidget label="Events (24h)" value={String(fleet.events_24h)} icon={<ScrollText className="w-4 h-4" />} />
            <MacStatWidget
              label="Failed tasks (24h)"
              value={String(fleet.tasks_failed_24h)}
              icon={<AlertTriangle className="w-4 h-4" />}
              tone={fleet.tasks_failed_24h > 0 ? 'warn' : 'ok'}
            />
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {SOURCE_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setSource(f.id)}
            className={`px-3 py-1.5 rounded-full text-xs border capitalize ${
              source === f.id
                ? 'border-orange-400/50 bg-orange-500/10 text-orange-200'
                : 'border-white/[0.08] text-slate-400 hover:text-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
        <input
          className="input text-sm max-w-xs ml-auto font-mono"
          placeholder="Filter messages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <MacGlassPanel title="Log stream" subtitle="Newest first — merged audit, events, and tasks.">
        {!fleet ? (
          <p className="text-sm text-slate-400 py-8 text-center">Loading fleet console…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">No log entries match the current filter.</p>
        ) : (
          <div className="rounded-xl border border-white/[0.06] bg-slate-950/60 overflow-hidden -mx-1 max-h-[32rem] overflow-y-auto">
            {entries.map((e) => (
              <LogLine key={`${e.source}-${e.id}`} entry={e} />
            ))}
          </div>
        )}
      </MacGlassPanel>

      {controllerAudit.length > 0 && (
        <MacGlassPanel title="Controller audit log" subtitle={`GET /api/v1/audit — ${controllerAudit.length} entries`}>
          <div className="rounded-xl border border-white/[0.06] bg-slate-950/60 overflow-hidden -mx-1 max-h-64 overflow-y-auto">
            {controllerAudit.map((a) => (
              <div key={a.id} className="flex gap-3 px-3 py-2 font-mono text-xs border-b border-white/[0.04] last:border-0">
                <time className="text-slate-500 shrink-0">{formatTime(a.created_at)}</time>
                <span className="text-violet-300 shrink-0">{a.actor}</span>
                <span className="text-slate-400">{a.action}</span>
                {a.resource_type && <span className="text-slate-500">({a.resource_type})</span>}
              </div>
            ))}
          </div>
        </MacGlassPanel>
      )}
    </PageLayout>
  )
}
