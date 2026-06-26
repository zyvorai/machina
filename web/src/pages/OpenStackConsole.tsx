// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import {
  getOpenStackRemoteConsole,
  OPENSTACK_CONSOLE_TYPES,
  type OpenStackConsoleType,
} from '../api/openstack'
import { getOpenStackConsoleTunnel } from '../api/openstackExtras'
import OpenStackFooter from '../components/OpenStackFooter'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import ErrorBanner from '../components/ErrorBanner'
import { formatUserError } from '../utils/apiError'
import { openStackErrorHints } from '../utils/openstackHints'
import { ArrowLeft, ExternalLink, Loader2, Monitor } from 'lucide-react'

export default function OpenStackConsolePage() {
  return (
    <OpenStackGate>
      <OpenStackConsoleContent />
    </OpenStackGate>
  )
}

function OpenStackConsoleContent() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const typeParam = searchParams.get('type') || 'novnc'
  const consoleType = (OPENSTACK_CONSOLE_TYPES.some((t) => t.id === typeParam)
    ? typeParam
    : 'novnc') as OpenStackConsoleType

  const useTunnel = searchParams.get('tunnel') === '1'
  const [url, setUrl] = useState<string | null>(null)
  const [directUrl, setDirectUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadConsole = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      if (useTunnel) {
        const t = await getOpenStackConsoleTunnel(id, consoleType)
        setDirectUrl(t.url)
        setUrl(t.proxy_path)
      } else {
        const c = await getOpenStackRemoteConsole(id, consoleType)
        setDirectUrl(c.url)
        setUrl(c.url)
      }
    } catch (e: unknown) {
      const msg = formatUserError(e)
      setError(msg)
      setUrl(null)
    } finally {
      setLoading(false)
    }
  }, [id, consoleType, useTunnel])

  useEffect(() => {
    void loadConsole()
  }, [loadConsole])

  const setConsoleType = (t: OpenStackConsoleType) => {
    setSearchParams({ type: t }, { replace: true })
  }

  if (!id) {
    return (
      <div className="p-8 text-center text-slate-500">
        Missing instance id.
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-8rem)] space-y-4">
      <OpenStackSubNav />

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/openstack/instances/${encodeURIComponent(id)}`}
          className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Instance
        </Link>
        <h1 className="text-lg font-semibold flex items-center gap-2 text-slate-100">
          <Monitor className="w-5 h-5 text-sky-400" />
          Remote console
        </h1>
        <select
          aria-label="Console type"
          value={consoleType}
          onChange={(e) => setConsoleType(e.target.value as OpenStackConsoleType)}
          className="ml-auto px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm"
        >
          {OPENSTACK_CONSOLE_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-slate-500 ml-2">
          <input
            type="checkbox"
            checked={useTunnel}
            onChange={(e) => {
              setSearchParams(
                { type: consoleType, ...(e.target.checked ? { tunnel: '1' } : {}) },
                { replace: true },
              )
            }}
          />
          Proxy via Machina
        </label>
        {directUrl && (
          <a
            href={directUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-600 text-sm text-slate-300 hover:bg-slate-800"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open in tab
          </a>
        )}
        <button
          type="button"
          onClick={() => void loadConsole()}
          className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm text-slate-300 hover:bg-slate-800"
        >
          Reload
        </button>
      </div>

      {error && (
        <ErrorBanner
          title="Console unavailable"
          headline={error}
          hints={openStackErrorHints(error)}
          technicalDetail={error}
          tone="red"
          onRetry={() => void loadConsole()}
          retryLabel="Retry"
        />
      )}

      <div className="flex-1 min-h-[24rem] rounded-xl border border-slate-700 overflow-hidden bg-black relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
            Loading console URL…
          </div>
        )}
        {!loading && url && (
          <iframe
            title="OpenStack remote console"
            src={url}
            className="w-full h-full min-h-[70vh] border-0"
            allow="clipboard-read; clipboard-write"
          />
        )}
        {!loading && !url && !error && (
          <p className="p-8 text-center text-slate-500">No console URL returned.</p>
        )}
      </div>

      <p className="text-xs text-slate-600 px-1">
        Embedded view uses the URL from Nova. If the console is blank, your browser may block mixed content
        or the console host may require opening in a new tab.
      </p>

      <OpenStackFooter />
    </div>
  )
}
