// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { LayoutGrid, Loader2 } from 'lucide-react'
import ErrorBanner from '../../components/ErrorBanner'
import LaunchpadAppTile from '../../components/launchpad/LaunchpadAppTile'
import LaunchpadHeroSearch from '../../components/launchpad/LaunchpadHeroSearch'
import LaunchpadInspector from '../../components/launchpad/LaunchpadInspector'
import LaunchpadSpaceGrid from '../../components/launchpad/LaunchpadSpaceGrid'
import OperatingSurfaceLayout from '../../components/platform/OperatingSurfaceLayout'
import PlatformPageChrome from '../../components/platform/PlatformPageChrome'
import { MacSectionTitle, MacGlassPanel } from '../../components/platform/mac/PlatformMacUi'
import {
  launchpadHealthSummary,
  listLaunchpadCatalog,
  listLaunchpadFavorites,
  type LaunchpadApp,
} from '../../api/launchpad'
import { formatUserError } from '../../utils/apiError'
import { launchpadDetailPath } from '../../utils/launchpadHelpers'

export default function PlatformLaunchpad() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const filter = searchParams.get('filter')
  const [catalog, setCatalog] = useState<LaunchpadApp[]>([])
  const [favorites, setFavorites] = useState<LaunchpadApp[]>([])
  const [broken, setBroken] = useState<LaunchpadApp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inspectApp, setInspectApp] = useState<LaunchpadApp | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [cat, fav, health] = await Promise.all([
        listLaunchpadCatalog(),
        listLaunchpadFavorites(),
        launchpadHealthSummary(),
      ])
      setCatalog(cat)
      setFavorites(fav)
      setBroken((health.apps ?? []).filter((a) => a.status === 'broken' || a.status === 'degraded'))
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const recent = useMemo(
    () =>
      [...catalog]
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        .slice(0, 8),
    [catalog],
  )

  const showBroken = filter === 'broken' ? broken : broken.slice(0, 4)
  const published = catalog.filter((a) => a.visibility?.published !== false)

  const tileProps = (app: LaunchpadApp) => ({
    app,
    onOpen: () => navigate(launchpadDetailPath(app)),
    onInspect: () => setInspectApp(app),
    onDiagnose: () => setInspectApp(app),
  })

  return (
    <PlatformPageChrome
      title="Launchpad"
      subtitle="Every service, console, and dashboard in one place."
      icon={<LayoutGrid className="w-6 h-6 text-orange-400" />}
      contentClassName="space-y-4"
    >
      <OperatingSurfaceLayout testId="platform-launchpad-page">
        <MacSectionTitle
          title="Launchpad"
          subtitle="Apps, services, consoles, dashboards, APIs, and internal tools."
        />
        <LaunchpadHeroSearch />

        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-8">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading apps…
          </div>
        ) : (
          <div className="space-y-8">
            {showBroken.length > 0 ? (
              <section>
                <h2 className="text-sm font-semibold text-amber-300 mb-3">Needs attention</h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {showBroken.map((app) => (
                    <LaunchpadAppTile key={app.id} {...tileProps(app)} />
                  ))}
                </div>
              </section>
            ) : null}

            {favorites.length > 0 ? (
              <section>
                <h2 className="text-sm font-semibold text-slate-200 mb-3">Favorites</h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {favorites.slice(0, 8).map((app) => (
                    <LaunchpadAppTile key={app.id} {...tileProps(app)} />
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <h2 className="text-sm font-semibold text-slate-200 mb-3">Spaces</h2>
              <LaunchpadSpaceGrid apps={published} />
            </section>

            <section>
              <h2 className="text-sm font-semibold text-slate-200 mb-3">Recently discovered</h2>
              {recent.length === 0 ? (
                <MacGlassPanel>
                  <p className="text-sm text-slate-400">
                    No apps in the catalog yet. Services will appear here as they are discovered in the cluster.
                  </p>
                </MacGlassPanel>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {(filter === 'broken' ? published.filter((a) => a.status === 'broken') : recent).map((app) => (
                    <LaunchpadAppTile key={app.id} {...tileProps(app)} />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </OperatingSurfaceLayout>

      <LaunchpadInspector app={inspectApp} open={!!inspectApp} onClose={() => setInspectApp(null)} />
    </PlatformPageChrome>
  )
}
