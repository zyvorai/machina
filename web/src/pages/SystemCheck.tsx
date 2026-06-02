// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  XCircle,
  MinusCircle,
  RefreshCw,
  Copy,
  Stethoscope,
  Zap,
} from 'lucide-react'
import { useWebSocketContext } from '../contexts/WebSocketContext'
import { useToastContext } from '../contexts/ToastContext'
import { useOpenStackConnection } from '../hooks/useOpenStackConnection'
import ConfirmDialog from '../components/ConfirmDialog'
import ErrorBanner from '../components/ErrorBanner'
import PageLayout from '../components/PageLayout'
import { openStackErrorHints } from '../utils/openstackHints'
import { libvirtErrorHints } from '../utils/libvirtHints'
import {
  CHECK_CATEGORY_LABELS,
  CHECK_CATEGORY_ORDER,
  type CheckCategory,
  type CheckResult,
  type CheckStatus,
  formatCheckReportMarkdown,
  resultsByCategory,
  runOpenStackDeepSmoke,
  runSystemCheckSuite,
  summarizeCheckResults,
} from '../lib/systemCheckSuite'
import type { PlatformInfo } from '../api/system'
import { checkStatusTone, statusSurfaceClasses, statusToneClass } from '../utils/semanticColors'

function statusIcon(status: CheckStatus) {
  switch (status) {
    case 'pass':
      return <CheckCircle2 className={`w-4 h-4 shrink-0 ${statusToneClass('ok')}`} />
    case 'warn':
      return <AlertTriangle className={`w-4 h-4 shrink-0 ${statusToneClass('warn')}`} />
    case 'fail':
      return <XCircle className={`w-4 h-4 shrink-0 ${statusToneClass('error')}`} />
    case 'skip':
      return <MinusCircle className="w-4 h-4 text-slate-500 shrink-0" />
  }
}

function overallBadgeClass(overall: 'pass' | 'warn' | 'fail') {
  const tone = checkStatusTone(overall)
  return statusSurfaceClasses(tone, 'px-4 py-4 rounded-xl border')
}

function rowClass(status: CheckStatus) {
  if (status === 'skip') return 'opacity-60'
  return ''
}

function categoryHints(category: CheckCategory, failedMessages: string): string[] {
  const msg = failedMessages.toLowerCase()
  if (category === 'openstack') return openStackErrorHints(msg)
  if (category === 'host' || category === 'libvirt' || category === 'services') {
    return libvirtErrorHints(msg)
  }
  return []
}

function CheckRow({ result }: { result: CheckResult }) {
  const [open, setOpen] = useState(false)
  const hasDetail = result.detail !== undefined && result.detail !== null

  return (
    <div className={`border-b border-slate-700/40 last:border-0 ${rowClass(result.status)}`}>
      <button
        type="button"
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-800/40 transition"
        onClick={() => hasDetail && setOpen((o) => !o)}
        disabled={!hasDetail}
      >
        {statusIcon(result.status)}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-200 text-sm">{result.label}</span>
            <span className="text-xs text-slate-500 font-mono uppercase">{result.status}</span>
            {result.durationMs > 0 && (
              <span className="text-xs text-slate-600">{result.durationMs}ms</span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-0.5">{result.message}</p>
        </div>
        {hasDetail && (
          <span className="text-slate-500 mt-0.5">
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>
        )}
      </button>
      {open && hasDetail && (
        <pre className="mx-4 mb-3 p-3 rounded-lg bg-slate-950/80 border border-slate-700/50 text-xs text-slate-400 overflow-x-auto max-h-48">
          {JSON.stringify(result.detail, null, 2)}
        </pre>
      )}
    </div>
  )
}

function CategorySection({
  category,
  rows,
  defaultOpen,
}: {
  category: CheckCategory
  rows: CheckResult[]
  defaultOpen?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultOpen ?? true)
  const failed = rows.filter((r) => r.status === 'fail')
  const warns = rows.filter((r) => r.status === 'warn')
  const catOverall: 'pass' | 'warn' | 'fail' =
    failed.length > 0 ? 'fail' : warns.length > 0 ? 'warn' : 'pass'
  const hints = categoryHints(
    category,
    [...failed, ...warns].map((r) => r.message).join(' '),
  )

  return (
    <section className="rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-800/30 transition text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          )}
          <h2 className="font-semibold text-slate-100">{CHECK_CATEGORY_LABELS[category]}</h2>
          <span
            className={`text-xs px-2 py-0.5 rounded-full border ${overallBadgeClass(catOverall)}`}
          >
            {rows.filter((r) => r.status === 'pass').length}/{rows.length} OK
          </span>
        </div>
      </button>
      {expanded && (
        <>
          {failed.length > 0 && hints.length > 0 && (
            <div className="px-4 pb-2">
              <ErrorBanner
                title={`${CHECK_CATEGORY_LABELS[category]} issues`}
                headline={failed.map((r) => r.message).join(' · ')}
                hints={hints}
                tone="red"
              />
            </div>
          )}
          <div>
            {rows.map((r) => (
              <CheckRow key={r.id} result={r} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export default function SystemCheckPage() {
  const { isConnected: wsConnected } = useWebSocketContext()
  const toast = useToastContext()
  const { connectionHint } = useOpenStackConnection()

  const [results, setResults] = useState<CheckResult[]>([])
  const [platform, setPlatform] = useState<PlatformInfo | null>(null)
  const [running, setRunning] = useState(false)
  const [progressLabel, setProgressLabel] = useState<string | null>(null)
  const [deepOpen, setDeepOpen] = useState(false)
  const [deepRunning, setDeepRunning] = useState(false)

  const summary = useMemo(() => summarizeCheckResults(results), [results])
  const byCategory = useMemo(() => resultsByCategory(results), [results])

  const runChecks = useCallback(async () => {
    setRunning(true)
    setProgressLabel('Starting…')
    try {
      const { results: r, platform: p } = await runSystemCheckSuite(
        { wsConnected },
        (p) => setProgressLabel(p.label),
      )
      setResults(r)
      setPlatform(p)
    } catch (e: unknown) {
      toast.error(`System check failed: ${String(e)}`)
    } finally {
      setRunning(false)
      setProgressLabel(null)
    }
  }, [wsConnected, toast])

  useEffect(() => {
    void runChecks()
  }, [runChecks])

  const copyReport = async () => {
    const md = formatCheckReportMarkdown(results, summary)
    try {
      await navigator.clipboard.writeText(md)
      toast.success('Report copied to clipboard')
    } catch {
      toast.error('Copy failed')
    }
  }

  const runDeepSmoke = async () => {
    if (!platform) {
      toast.warning('Run system check first')
      return
    }
    setDeepOpen(false)
    setDeepRunning(true)
    setProgressLabel('Deep OpenStack smoke…')
    try {
      const deep = await runOpenStackDeepSmoke(platform, setProgressLabel)
      setResults((prev) => {
        const merged = [...prev.filter((r) => !r.id.startsWith('deep-')), ...deep]
        const s = summarizeCheckResults(merged)
        if (s.fail > 0) toast.error('Deep smoke had failures')
        else toast.success('Deep OpenStack smoke completed')
        return merged
      })
    } catch (e: unknown) {
      toast.error(String(e))
    } finally {
      setDeepRunning(false)
      setProgressLabel(null)
    }
  }

  const busy = running || deepRunning
  const openstackConfigured = Boolean(platform?.openstack?.enabled && platform?.openstack?.configured)

  return (
    <PageLayout
      className="max-w-4xl"
      title="System Check"
      icon={<Stethoscope className="w-7 h-7 text-sky-400" />}
      subtitle={
        <>
          Auto-runs read-only diagnostics (API, host, libvirt, OpenStack, Kubernetes, services).
          Same coverage as <code className="text-slate-500">e2e-test.sh</code> preflight — from the UI.
        </>
      }
      actions={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runChecks()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} />
            Run again
          </button>
          <button
            type="button"
            disabled={results.length === 0 || busy}
            onClick={() => void copyReport()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 text-sm disabled:opacity-50"
          >
            <Copy className="w-4 h-4" />
            Copy report
          </button>
          {openstackConfigured && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setDeepOpen(true)}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm disabled:opacity-50 ${statusSurfaceClasses('warn')}`}
            >
              <Zap className="w-4 h-4" />
              Deep smoke
            </button>
          )}
        </>
      }
      contentClassName="space-y-6"
    >
      {(running || deepRunning) && progressLabel && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-sky-500/30 bg-sky-950/25 text-sm text-sky-200">
          <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
          {progressLabel}
        </div>
      )}

      {results.length > 0 && !running && (
        <div
          className={`flex flex-wrap items-center gap-4 px-4 py-4 rounded-xl border ${overallBadgeClass(summary.overall)}`}
        >
          <span className="text-lg font-semibold capitalize">{summary.overall}</span>
          <span className="text-sm">
            <span className={statusToneClass('ok')}>{summary.pass} passed</span>
            {' · '}
            <span className={statusToneClass('warn')}>{summary.warn} warnings</span>
            {' · '}
            <span className={statusToneClass('error')}>{summary.fail} failed</span>
            {summary.skip > 0 && (
              <>
                {' · '}
                <span className="text-slate-400">{summary.skip} skipped</span>
              </>
            )}
          </span>
        </div>
      )}

      {connectionHint && results.some((r) => r.category === 'openstack' && r.status !== 'pass') && (
        <div className={`rounded-xl px-4 py-3 text-sm ${statusSurfaceClasses('warn')}`}>
          {connectionHint}
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        <Link to="/settings?openstack=1" className="text-sky-400 hover:underline">
          OpenStack settings
        </Link>
        <span className="text-slate-600">·</span>
        <Link to="/services" className="text-sky-400 hover:underline">
          Services
        </Link>
        <span className="text-slate-600">·</span>
        <Link to="/capabilities" className="text-sky-400 hover:underline">
          Capabilities
        </Link>
        <span className="text-slate-600">·</span>
        <Link to="/node" className="text-sky-400 hover:underline">
          Host overview
        </Link>
      </div>

      {running && results.length === 0 && (
        <div className="flex items-center justify-center py-16 text-slate-500">
          <RefreshCw className="w-8 h-8 animate-spin text-sky-400 mr-3" />
          Running system check…
        </div>
      )}

      <div className="space-y-4">
        {CHECK_CATEGORY_ORDER.map((cat) => {
          const rows = byCategory.get(cat)
          if (!rows?.length) return null
          return (
            <CategorySection
              key={cat}
              category={cat}
              rows={rows}
              defaultOpen={rows.some((r) => r.status === 'fail' || r.status === 'warn')}
            />
          )
        })}
      </div>

      {results.length > 0 && summary.fail === 0 && summary.warn === 0 && !running && (
        <div className={`flex items-center gap-2 text-sm px-4 py-3 rounded-xl border ${statusSurfaceClasses('ok')}`}>
          <Activity className="w-4 h-4" />
          All checks passed.
        </div>
      )}

      <ConfirmDialog
        open={deepOpen}
        title="Run OpenStack deep smoke?"
        message="Creates a short-lived Cirros instance (syscheck-os-*), lists it, then deletes it. Requires flavors, image, and network in Glance/Nova."
        confirmLabel="Run smoke test"
        onConfirm={() => void runDeepSmoke()}
        onCancel={() => setDeepOpen(false)}
      />
    </PageLayout>
  )
}
