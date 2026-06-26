// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, Play, Search } from 'lucide-react'
import JsonInspector from './JsonInspector'
import { getControllerBase, platformFetch, platformHeaders } from '../../api/platform'
import { formatUserError } from '../../utils/apiError'
import { statusToneClass } from '../../utils/semanticColors'

type ApiTarget = 'controller' | 'host'
type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'

interface OpenApiOp {
  id: string
  method: HttpMethod
  path: string
  summary: string
  tag: string
  transport?: 'websocket'
}

interface OpenApiSpec {
  paths?: Record<string, Record<string, {
    summary?: string
    operationId?: string
    description?: string
    'x-machina-transport'?: string
  }>>
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PATCH', 'DELETE', 'PUT']

const AGENT_ONLY = new Set([
  '/api/v1/hosts/join',
  '/install.sh',
  '/api/v1/install.sh',
  '/api/v1/metrics/prometheus',
])

const WS_HINT =
  'WebSocket endpoint — use wscat or a WS client. Obtain a short-lived token via POST /api/v1/ws-token, then connect with ?token=…'

function groupTag(path: string) {
  const stripped = path.replace(/^\/api\/v1\//, '').replace(/^\/ws\/v1\//, '')
  return stripped.split('/')[0] || 'root'
}

function buildOps(spec: OpenApiSpec): OpenApiOp[] {
  const ops: OpenApiOp[] = []
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      const lower = method.toLowerCase()
      if (!methods[lower]) continue
      const meta = methods[lower]
      if (meta['x-machina-transport'] === 'websocket') continue
      ops.push({
        id: `${method}:${path}`,
        method,
        path,
        summary: meta.summary ?? meta.operationId ?? path,
        tag: groupTag(path),
      })
    }
    const wsMeta = methods.get
    if (wsMeta?.['x-machina-transport'] === 'websocket') {
      ops.push({
        id: `WS:${path}`,
        method: 'GET',
        path,
        summary: wsMeta.summary ?? `WebSocket ${path}`,
        tag: groupTag(path),
        transport: 'websocket',
      })
    }
  }
  return ops.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}

async function fetchHostSpec(): Promise<OpenApiSpec> {
  const res = await fetch('/api/v1/openapi.json', { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`Host OpenAPI HTTP ${res.status}`)
  return res.json() as Promise<OpenApiSpec>
}

async function fetchControllerSpec(): Promise<OpenApiSpec> {
  return platformFetch<OpenApiSpec>('/api/v1/openapi.json')
}

async function executeHost(path: string, init: RequestInit) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: platformHeaders(init.headers),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body || `${res.status} ${res.statusText}`)
  }
  if (res.status === 204) return null
  return res.json()
}

export default function PlatformApiConsole() {
  const [target, setTarget] = useState<ApiTarget>('controller')
  const [spec, setSpec] = useState<OpenApiSpec | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<OpenApiOp | null>(null)
  const [body, setBody] = useState('{}')
  const [pathParams, setPathParams] = useState<Record<string, string>>({})
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setSpec(null)
    setSelected(null)
    setLoadError(null)
    const load = target === 'controller' ? fetchControllerSpec : fetchHostSpec
    void load()
      .then(setSpec)
      .catch((e: unknown) => {
        setLoadError(formatUserError(e))
        setSpec({ paths: {} })
      })
  }, [target])

  const ops = useMemo(() => buildOps(spec ?? {}), [spec])

  const tags = useMemo(() => [...new Set(ops.map((o) => o.tag))].sort(), [ops])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ops
    return ops.filter(
      (o) =>
        o.path.toLowerCase().includes(q) ||
        o.summary.toLowerCase().includes(q) ||
        o.tag.includes(q),
    )
  }, [ops, query])

  const selectOp = (op: OpenApiOp) => {
    setSelected(op)
    setResult(null)
    setError(null)
    const params: Record<string, string> = {}
    for (const m of op.path.matchAll(/\{([^}]+)\}/g)) params[m[1]] = ''
    setPathParams(params)
    setBody(op.method === 'GET' || op.method === 'DELETE' ? '' : '{}')
  }

  const resolvedPath = useCallback(() => {
    if (!selected) return ''
    let p = selected.path
    for (const [k, v] of Object.entries(pathParams)) {
      p = p.replace(`{${k}}`, encodeURIComponent(v || 'id'))
    }
    return p
  }, [selected, pathParams])

  const copyCurl = (path: string, method: string) => {
    const base = target === 'controller' ? getControllerBase() : window.location.origin
    const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`
    const lines = [`curl -fsS -X ${method} '${url}'`]
    if (method !== 'GET' && method !== 'DELETE') lines.push("  -H 'Content-Type: application/json' -d '{}'")
    void navigator.clipboard.writeText(lines.join(' \\\n'))
  }

  const execute = async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const path = resolvedPath()
      if (selected.transport === 'websocket') {
        setResult({ note: WS_HINT, wscat: `wscat -c 'wss://${window.location.host}${path}?token=YOUR_WS_TOKEN'` })
        return
      }
      if (AGENT_ONLY.has(selected.path) || AGENT_ONLY.has(path)) {
        setResult({
          note: 'Agent-only route — use shell command instead of browser try-it',
          curl: `curl -fsS ${target === 'controller' ? getControllerBase() : window.location.origin}${path}`,
        })
        return
      }
      const init: RequestInit = { method: selected.method }
      if (selected.method !== 'GET' && selected.method !== 'DELETE' && body.trim()) {
        init.body = body
        init.headers = { 'Content-Type': 'application/json' }
      }
      const data =
        target === 'controller'
          ? await platformFetch<unknown>(path, init)
          : await executeHost(path, init)
      setResult(data)
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {([
          ['controller', 'Controller (fleet)'],
          ['host', 'Host (daemon)'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTarget(id)}
            className={`px-3 py-1.5 rounded-lg text-sm transition ${
              target === id ? 'bg-sky-600/30 text-sky-100 border border-sky-500/40' : 'text-slate-400 hover:text-slate-200 border border-white/10'
            }`}
          >
            {label}
            <span className="ml-2 text-xs text-slate-500">{ops.length}</span>
          </button>
        ))}
      </div>
      {loadError ? <p className={`text-sm ${statusToneClass('warn')}`}>{loadError}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="tahoe-glass-card p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
            <input
              aria-label="Filter operations"
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-black/25 border border-white/10 text-sm text-white"
              placeholder="Filter operations…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="max-h-[28rem] overflow-y-auto space-y-3">
            {tags.map((tag) => {
              const group = filtered.filter((o) => o.tag === tag)
              if (!group.length) return null
              return (
                <section key={tag}>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    {tag} <span className="text-slate-600">({group.length})</span>
                  </h3>
                  <ul className="space-y-1">
                    {group.map((op) => (
                      <li key={op.id}>
                        <button
                          type="button"
                          onClick={() => selectOp(op)}
                          className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition ${
                            selected?.id === op.id ? 'bg-sky-500/15 text-sky-100' : 'text-slate-300 hover:bg-white/[0.04]'
                          }`}
                        >
                          <span className="font-mono text-sky-300/90">{op.transport === 'websocket' ? 'WS' : op.method}</span>{' '}
                          <span className="font-mono">{op.path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </div>

        <div className="tahoe-glass-card p-4 space-y-3">
          {!selected ? (
            <p className="text-sm text-slate-400">
              Select an operation to try it against the {target === 'controller' ? 'controller' : 'host daemon'}.
            </p>
          ) : (
            <>
              <div>
                <p className="text-sm font-medium text-white">{selected.summary}</p>
                <p className="text-xs font-mono text-slate-400 mt-1">
                  {selected.transport === 'websocket' ? 'WS' : selected.method} {resolvedPath()}
                </p>
              </div>
              {Object.keys(pathParams).length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.keys(pathParams).map((k) => (
                    <label key={k} className="text-xs text-slate-400">
                      {k}
                      <input
                        className="input text-sm mt-1 w-full"
                        value={pathParams[k]}
                        onChange={(e) => setPathParams((prev) => ({ ...prev, [k]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
              )}
              {selected.method !== 'GET' && selected.method !== 'DELETE' && selected.transport !== 'websocket' && (
                <textarea
                  aria-label="Request body"
                  className="input text-xs font-mono min-h-[8rem] w-full"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="tahoe-btn-primary text-sm" disabled={busy} onClick={() => void execute()}>
                  <Play className="w-3.5 h-3.5" /> {busy ? 'Running…' : selected.transport === 'websocket' ? 'Show WS hint' : 'Execute'}
                </button>
                <button
                  type="button"
                  className="tahoe-btn-secondary text-sm"
                  onClick={() => copyCurl(resolvedPath(), selected.method)}
                >
                  <Copy className="w-3.5 h-3.5" /> Copy curl
                </button>
              </div>
              {error ? <p className={`text-sm ${statusToneClass('error')}`}>{error}</p> : null}
              {result != null ? <JsonInspector data={result} /> : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
