// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Loader2,
  Pin,
  Route,
  Share2,
  SquareArrowOutUpRight,
} from 'lucide-react'
import ErrorBanner from '../../components/ErrorBanner'
import LaunchpadInspector from '../../components/launchpad/LaunchpadInspector'
import OperatingSurfaceLayout from '../../components/platform/OperatingSurfaceLayout'
import PlatformPageChrome from '../../components/platform/PlatformPageChrome'
import { MacGlassPanel } from '../../components/platform/mac/PlatformMacUi'
import { getLaunchpadApp, listLaunchpadCatalog, type LaunchpadApp } from '../../api/launchpad'
import { formatUserError } from '../../utils/apiError'
import {
  copyLaunchpadUrl,
  launchpadStatusLabel,
  launchpadStatusTone,
  openLaunchpadApp,
  openLaunchpadInWorkspace,
  pinLaunchpadApp,
  shareLaunchpadApp,
} from '../../utils/launchpadHelpers'
import { statusToneClass } from '../../utils/semanticColors'
import { useToastContext } from '../../contexts/ToastContext'

function findApp(catalog: LaunchpadApp[], idParam: string): LaunchpadApp | undefined {
  const decoded = decodeURIComponent(idParam)
  return (
    catalog.find((a) => a.id === decoded) ||
    catalog.find((a) => a.canonicalSlug === decoded) ||
    catalog.find((a) => a.slug === decoded)
  )
}

export default function PlatformLaunchpadAppDetail() {
  const { id = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToastContext()
  const [app, setApp] = useState<LaunchpadApp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [techOpen, setTechOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(() => searchParams.get('inspect') === '1')

  useEffect(() => {
    setInspectorOpen(searchParams.get('inspect') === '1')
  }, [searchParams])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      try {
        const single = await getLaunchpadApp(decodeURIComponent(id))
        setApp(single)
        return
      } catch {
        const catalog = await listLaunchpadCatalog()
        const found = findApp(catalog, id)
        if (!found) throw new Error('App not found')
        setApp(found)
      }
    } catch (e: unknown) {
      setError(formatUserError(e))
      setApp(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const tone = launchpadStatusTone(app?.status ?? 'unknown') as 'ok' | 'warn' | 'error' | 'neutral'
  const subtitle = useMemo(() => {
    if (!app) return ''
    return [launchpadStatusLabel(app.status), app.category, app.description?.trim()].filter(Boolean).join(' · ')
  }, [app])

  const closeInspector = () => {
    setInspectorOpen(false)
    const next = new URLSearchParams(searchParams)
    next.delete('inspect')
    setSearchParams(next, { replace: true })
  }

  const openInspector = () => {
    setInspectorOpen(true)
    const next = new URLSearchParams(searchParams)
    next.set('inspect', '1')
    setSearchParams(next, { replace: true })
  }

  return (
    <PlatformPageChrome
      title={app?.displayName ?? 'App'}
      subtitle={subtitle || 'Launchpad app details'}
      icon={<Route className="w-6 h-6 text-orange-400" />}
      contentClassName="space-y-4"
    >
      <OperatingSurfaceLayout testId="platform-launchpad-app-detail">
        <Link to="/platform/launchpad" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-orange-300">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Launchpad
        </Link>

        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-8">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading app…
          </div>
        ) : app ? (
          <div className="space-y-5">
            <MacGlassPanel>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-semibold text-slate-50">{app.displayName}</h1>
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full border border-white/10 ${statusToneClass(tone)}`}
                    >
                      {launchpadStatusLabel(app.status)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-400 mt-2">{app.description || app.category}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary text-xs inline-flex items-center gap-1.5" onClick={() => void openLaunchpadApp(app)}>
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs inline-flex items-center gap-1.5"
                    onClick={() =>
                      void pinLaunchpadApp(app).then(() => toast.success('Pinned to dock favorites'))
                    }
                  >
                    <Pin className="w-3.5 h-3.5" />
                    Pin
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs inline-flex items-center gap-1.5"
                    onClick={() =>
                      void copyLaunchpadUrl(app).then(() => toast.success('URL copied'))
                    }
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy URL
                  </button>
                  <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={openInspector}>
                    <Route className="w-3.5 h-3.5" />
                    Inspect Route
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs inline-flex items-center gap-1.5"
                    onClick={() =>
                      void shareLaunchpadApp(app)
                        .then(() => toast.success('Shared or copied link'))
                        .catch((e: unknown) => toast.error(formatUserError(e)))
                    }
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    Share
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs inline-flex items-center gap-1.5"
                    onClick={() =>
                      void openLaunchpadInWorkspace(app)
                        .then(() => toast.success('Opened in workspace window'))
                        .catch((e: unknown) => toast.error(formatUserError(e)))
                    }
                  >
                    <SquareArrowOutUpRight className="w-3.5 h-3.5" />
                    Open in Workspace
                  </button>
                </div>
              </div>
            </MacGlassPanel>

            <MacGlassPanel>
              <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-slate-500 text-xs uppercase tracking-wide">Stable Zeus URL</dt>
                  <dd className="font-mono text-slate-200 mt-1 break-all">{app.routePath}</dd>
                </div>
                <div>
                  <dt className="text-slate-500 text-xs uppercase tracking-wide">Public URL</dt>
                  <dd className="font-mono text-slate-200 mt-1 break-all">{app.publicUrl}</dd>
                </div>
              </dl>
            </MacGlassPanel>

            <MacGlassPanel>
              <button
                type="button"
                className="w-full flex items-center justify-between text-left text-sm font-medium text-slate-200"
                onClick={() => setTechOpen((v) => !v)}
              >
                Technical details
                <span className="text-slate-500 text-xs">{techOpen ? 'Hide' : 'Show'}</span>
              </button>
              {techOpen ? (
                <dl className="mt-4 grid gap-3 sm:grid-cols-2 font-mono text-xs text-slate-300 border-t border-white/10 pt-4">
                  <div>
                    <dt className="text-slate-500">Namespace</dt>
                    <dd className="mt-1">{app.namespace}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Service</dt>
                    <dd className="mt-1">
                      {app.backend.name}:{app.backend.port}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Backend kind</dt>
                    <dd className="mt-1">{app.backend.kind}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Auth mode</dt>
                    <dd className="mt-1">{app.authMode}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Source</dt>
                    <dd className="mt-1">{app.source}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Ready endpoints</dt>
                    <dd className="mt-1">{app.readyEndpoints}</dd>
                  </div>
                </dl>
              ) : null}
            </MacGlassPanel>
          </div>
        ) : null}
      </OperatingSurfaceLayout>

      <LaunchpadInspector app={app} open={inspectorOpen} onClose={closeInspector} />
    </PlatformPageChrome>
  )
}
