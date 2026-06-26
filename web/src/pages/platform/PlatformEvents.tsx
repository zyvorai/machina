// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, ScrollText, Terminal, X } from 'lucide-react'
import {
  MacGlassPanel,
  MacStatWidget,
} from '../../components/platform/mac/PlatformMacUi'
import DetailTabs from '../../components/platform/DetailTabs'
import OperatingSurfaceLayout from '../../components/platform/OperatingSurfaceLayout'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import PlatformPageChrome, { PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { getFleetConsole, listAuditLogs, listPlatformEvents, type AuditLog, type FleetConsoleEntry, type FleetConsoleOverview, type PlatformEvent } from '../../api/platform'
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
  const [platformEvents, setPlatformEvents] = useState<PlatformEvent[]>([])
  const [eventKind, setEventKind] = useState('')
  const [source, setSource] = useState<SourceFilter>('all')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [console, audit, events] = await Promise.all([
        getFleetConsole(),
        listAuditLogs().catch(() => []),
        listPlatformEvents(eventKind || undefined).catch(() => []),
      ])
      setFleet(console)
      setControllerAudit(audit)
      setPlatformEvents(events)
    } catch (e: unknown) {
      setError(formatUserError(e))
      setFleet(null)
    } finally {
      setLoading(false)
    }
  }, [eventKind])

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
    <PlatformPageChrome
      hideHeader={embedded}
      compact={embedded}
      loading={loading && !fleet && !error}
      error={error}
      onErrorRetry={() => void load()}
      title={embedded ? undefined : 'Logs & Audit'}
      subtitle={embedded ? undefined : 'Unified fleet log tail — audit trail, platform events, and task failures in one stream.'}
      icon={embedded ? undefined : <Terminal className="w-6 h-6 text-slate-400" />}
      actions={embedded ? undefined : <PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      <OperatingSurfaceLayout testId="platform-events-page">
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

      <DetailTabs
        primary={SOURCE_FILTERS.map((f) => ({ id: f.id, label: f.label }))}
        active={source}
        onChange={setSource}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs">
          <input
            className={`input text-sm w-full font-mono ${query ? 'pr-8' : ''}`}
            aria-label="Filter log messages"
            placeholder="Filter messages…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" aria-label="Clear filter" onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <MacGlassPanel title="Platform events" subtitle="GET /api/v1/events — controller event bus">
        <div className="flex flex-wrap gap-2 mb-3">
          <div className="relative max-w-xs">
            <input
              className={`input text-sm w-full font-mono ${eventKind ? 'pr-8' : ''}`}
              aria-label="Filter by event kind"
              placeholder="Filter by kind (e.g. host.sync)"
              value={eventKind}
              onChange={(e) => setEventKind(e.target.value)}
            />
            {eventKind && (
              <button type="button" aria-label="Clear kind filter" onClick={() => setEventKind('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button type="button" className="btn-secondary text-xs" onClick={() => void load()}>
            Apply
          </button>
        </div>
        {platformEvents.length === 0 ? (
          <PlatformEmptyState title="No platform events" subtitle="Events appear when controller operations occur — try clearing the kind filter." />
        ) : (
          <ul className="text-sm text-slate-300 space-y-2">
            {platformEvents.slice(0, 20).map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2 gap-y-1 border-b border-white/[0.04] pb-2 last:border-0">
                <time className="text-xs text-slate-500 shrink-0">{formatTime(e.created_at)}</time>
                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-white/[0.08] text-violet-300">{e.kind}</span>
                <span>{e.message}</span>
              </li>
            ))}
          </ul>
        )}
      </MacGlassPanel>

      <MacGlassPanel title="Log stream" subtitle="Newest first — merged audit, events, and tasks.">
        {!fleet ? (
          <p className="text-sm text-slate-400 py-8 text-center">Loading fleet console…</p>
        ) : entries.length === 0 ? (
          <PlatformEmptyState
            icon={ScrollText}
            title="No log entries match"
            subtitle="Adjust the source tab or message filter to broaden the stream."
          />
        ) : (
          <div className="rounded-xl border border-white/[0.06] bg-slate-950/60 overflow-hidden -mx-1">
            {entries.map((e) => (
              <LogLine key={`${e.source}-${e.id}`} entry={e} />
            ))}
          </div>
        )}
      </MacGlassPanel>

      {controllerAudit.length > 0 && (
        <MacGlassPanel title="Controller audit log" subtitle={`GET /api/v1/audit — ${controllerAudit.length} entries`}>
          <div className="rounded-xl border border-white/[0.06] bg-slate-950/60 overflow-hidden -mx-1">
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
      </OperatingSurfaceLayout>
    </PlatformPageChrome>
  )
}
