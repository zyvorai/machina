// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useEffect, useState, useMemo } from 'react'
import { Search, Play } from 'lucide-react'
import { formatUserError } from '../utils/apiError'
import PageLayout from '../components/PageLayout'

interface PathItem {
  summary?: string
  description?: string
  tags?: string[]
  parameters?: { name: string; in: string; required?: boolean; schema?: { type: string } }[]
  requestBody?: { content?: { 'application/json'?: { schema?: unknown } } }
  responses?: Record<string, { description?: string }>
}

interface OpenApiSpec {
  info: { title: string; version: string; description?: string }
  paths: Record<string, Record<string, PathItem>>
}

const METHOD_COLORS: Record<string, string> = {
  get: 'bg-green-600/20 text-green-400 border-green-600/30',
  post: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  put: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
  delete: 'bg-red-600/20 text-red-400 border-red-600/30',
  patch: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
}

export default function ApiDocs() {
  const [spec, setSpec] = useState<OpenApiSpec | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [tryEndpoint, setTryEndpoint] = useState<string | null>(null)
  const [tryPath, setTryPath] = useState('')
  const [tryBody, setTryBody] = useState('')
  const [tryResponse, setTryResponse] = useState<{ status: number; body: string } | null>(null)
  const [tryLoading, setTryLoading] = useState(false)

  useEffect(() => {
    fetch('/api/v1/openapi.json', { credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setSpec)
      .catch((e) => setError(`Failed to load OpenAPI spec: ${e.message}`))
  }, [])

  const endpoints = useMemo(() => {
    if (!spec) return []
    const list: { method: string; path: string; summary: string; tags: string[] }[] = []
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, detail] of Object.entries(methods)) {
        if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
          list.push({
            method: method.toUpperCase(),
            path,
            summary: detail.summary || detail.description || '',
            tags: detail.tags || [],
          })
        }
      }
    }
    return list
  }, [spec])

  const tagFilters = useMemo(() => {
    const tags = new Set<string>()
    for (const e of endpoints) {
      for (const t of e.tags) tags.add(t)
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b))
  }, [endpoints])

  const filtered = useMemo(() => {
    if (!search.trim()) return endpoints
    const q = search.toLowerCase()
    return endpoints.filter(
      (e) =>
        e.path.toLowerCase().includes(q) ||
        e.method.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q))
    )
  }, [endpoints, search])

  const tryIt = async (method: string, path: string, body?: string) => {
    setTryLoading(true)
    setTryResponse(null)
    try {
      const opts: RequestInit = { method, credentials: 'same-origin' as RequestCredentials }
      if (body && body.trim()) {
        opts.headers = { 'Content-Type': 'application/json' }
        opts.body = body
      }
      const res = await fetch(path, opts)
      const text = await res.text()
      let formatted = text
      try { formatted = JSON.stringify(JSON.parse(text), null, 2) } catch { /* not json */ }
      setTryResponse({ status: res.status, body: formatted })
    } catch (e: unknown) {
      setTryResponse({ status: 0, body: `Error: ${formatUserError(e)}` })
    } finally { setTryLoading(false) }
  }

  return (
    <PageLayout
      title={spec?.info.title}
      subtitle={
        spec ? (
          <>
            <span className="text-slate-500">Version {spec.info.version}</span>
            {spec.info.description && (
              <span className="block mt-2 max-w-4xl leading-relaxed">{spec.info.description}</span>
            )}
          </>
        ) : undefined
      }
      error={error || null}
      contentLoading={!spec && !error}
      contentClassName="space-y-6"
    >
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder="Search endpoints by path, method, or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500 text-slate-200"
        />
      </div>

      {tagFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tagFilters.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSearch(tag)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                search.toLowerCase() === tag.toLowerCase()
                  ? 'bg-sky-600/30 border-sky-500/50 text-sky-200'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
              }`}
            >
              {tag}
            </button>
          ))}
          {search.trim() && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="px-2.5 py-1 rounded-lg text-xs text-slate-500 hover:text-slate-300"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="text-xs text-slate-500">{filtered.length} of {endpoints.length} endpoints</div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 divide-y divide-slate-700/30 overflow-hidden">
        {filtered.map((ep, i) => {
          const key = `${ep.method}-${ep.path}`
          return (
            <div key={`${key}-${i}`}>
              <div className="flex items-center gap-4 px-5 py-3 hover:bg-slate-700/20 transition">
                <span className={`px-2.5 py-0.5 rounded text-xs font-bold border ${METHOD_COLORS[ep.method.toLowerCase()] || 'bg-slate-600/20 text-slate-400'}`} style={{ minWidth: '60px', textAlign: 'center' }}>
                  {ep.method}
                </span>
                <code className="text-sm font-mono text-blue-300 flex-shrink-0">{ep.path}</code>
                <span className="text-sm text-slate-400 truncate">{ep.summary}</span>
                <div className="flex gap-1 ml-auto flex-shrink-0">
                  {ep.tags.map((t) => (
                    <span key={t} className="px-1.5 py-0.5 bg-slate-700 rounded text-[10px] text-slate-400">{t}</span>
                  ))}
                </div>
                <button
                  onClick={() => {
                    if (tryEndpoint === key) {
                      setTryEndpoint(null)
                    } else {
                      setTryEndpoint(key)
                      setTryPath(ep.path)
                      setTryBody('')
                      setTryResponse(null)
                    }
                  }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition flex-shrink-0 ${
                    tryEndpoint === key
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                  }`}
                >
                  <Play className="w-3 h-3" />
                  Try
                </button>
              </div>
              {tryEndpoint === key && (
                <div className="bg-slate-900 border-t border-slate-700/30 px-5 py-4 space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">URL</label>
                    <input value={tryPath} onChange={e => setTryPath(e.target.value)} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500 text-slate-200 font-mono text-xs" />
                  </div>
                  {ep.method !== 'GET' && (
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Request Body (JSON)</label>
                      <textarea value={tryBody} onChange={e => setTryBody(e.target.value)} rows={4} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500 text-slate-200 font-mono text-xs" placeholder='{"key": "value"}' />
                    </div>
                  )}
                  <button onClick={() => tryIt(ep.method, tryPath, tryBody)} disabled={tryLoading} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium transition">
                    {tryLoading ? 'Sending...' : 'Send Request'}
                  </button>
                  {tryResponse && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${tryResponse.status >= 200 && tryResponse.status < 300 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                          {tryResponse.status || 'Error'}
                        </span>
                      </div>
                      <pre className="bg-slate-950 rounded-lg p-3 text-xs font-mono text-slate-300 overflow-auto max-h-64">{tryResponse.body}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="px-6 py-8 text-center text-slate-500">No endpoints match your search</div>
        )}
      </div>
    </PageLayout>
  )
}
