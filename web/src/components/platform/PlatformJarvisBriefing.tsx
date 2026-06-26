// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { Search } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { getJarvisLanding, type SpotlightIntent } from '../../api/ai'
import { ZEUS_ASSISTANT_NAME, ZEUS_SEARCH_PLACEHOLDER } from '../../config/aiBrand'
import { useFleetDesktop } from '../../hooks/useFleetDesktop'
import { dispatchOpenSpotlight } from '../../utils/platformJarvisShell'
import { statusChipClasses } from '../../utils/semanticColors'
import { usePlatformDesktopTier } from '../../hooks/usePlatformDesktopTier'
import { tierAtLeast, type PlatformDesktopTier } from '../../utils/platformDesktopTier'
import { hubTilesForTier } from '../../utils/platformHubZones'

const MAX_INTENTS = 5

function greetingName(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function filterIntents(intents: SpotlightIntent[], tier: PlatformDesktopTier): SpotlightIntent[] {
  const hubPaths = new Set(hubTilesForTier(tier).map((h) => h.href.split('?')[0]))
  const seen = new Set<string>()
  const out: SpotlightIntent[] = []
  for (const intent of intents) {
    const nav = intent.navigate?.split('?')[0]
    if (nav && hubPaths.has(nav)) continue
    const key = intent.label.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(intent)
    if (out.length >= MAX_INTENTS) break
  }
  return out
}

export default function PlatformJarvisBriefing() {
  const navigate = useNavigate()
  const [tier] = usePlatformDesktopTier()
  const showPower = tierAtLeast(tier, 'power')
  const { desktop } = useFleetDesktop(true, 90_000)
  const [rawIntents, setRawIntents] = useState<SpotlightIntent[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    void getJarvisLanding()
      .catch(() => ({ intents: [], search_hits: [] }))
      .then((landing) => setRawIntents(landing.intents ?? []))
  }, [])

  useEffect(() => {
    if (!desktop) return
    void getJarvisLanding()
      .catch(() => ({ intents: [], search_hits: [] }))
      .then((landing) => setRawIntents(landing.intents ?? []))
  }, [desktop])

  const intents = useMemo(() => filterIntents(rawIntents, tier), [rawIntents, tier])

  const runIntent = (intent: SpotlightIntent) => {
    if (intent.navigate) {
      navigate(intent.navigate)
      return
    }
    dispatchOpenSpotlight(intent.label)
  }

  const submitQuery = (e: FormEvent) => {
    e.preventDefault()
    dispatchOpenSpotlight(query.trim() || undefined)
    setQuery('')
  }

  return (
    <section
      className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 space-y-3"
      data-testid="platform-jarvis-shell"
    >
      {!showPower && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-orange-400/80">{ZEUS_ASSISTANT_NAME}</p>
          <h2 className="text-xl font-semibold text-slate-50 mt-0.5">{greetingName()}.</h2>
        </div>
      )}

      <form onSubmit={submitQuery} className="relative max-w-2xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden />
        <input
          type="search"
          aria-label="Zeus search"
          className="input w-full pl-10"
          placeholder={ZEUS_SEARCH_PLACEHOLDER}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>

      {intents.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {intents.map((intent) => (
            <button
              key={intent.id}
              type="button"
              title={intent.review}
              className={statusChipClasses('info')}
              onClick={() => runIntent(intent)}
            >
              {intent.label}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
