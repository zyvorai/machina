// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Bot, Sparkles } from 'lucide-react'
import PageLayout from '../../components/PageLayout'
import { MacGlassPanel, MacSectionTitle } from '../../components/platform/mac/PlatformMacUi'
import SecurityTimelinePanel from '../../components/platform/SecurityTimelinePanel'
import {
  getFleetSecurityTimeline,
  getHuntQueries,
  getSecurityCorrelations,
  getSecurityHuntSummary,
  nlSecuritySearch,
  reconstructAttack,
  runHuntQuery,
  type HuntQuery,
  type SecurityEvent,
} from '../../api/zeusSecurity'
import { formatUserError } from '../../utils/apiError'
import { hubLinkClasses, riskTone, statusToneClass } from '../../utils/semanticColors'

function LlmBadge({ powered }: { powered?: boolean }) {
  if (!powered) return null
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-violet-300/90">
      <Sparkles className="w-3 h-3" aria-hidden /> AI
    </span>
  )
}

function extractSearchHits(payload: Record<string, unknown>): Array<{ summary: string; host_id?: string }> {
  const nested = payload.results
  const list = Array.isArray(nested)
    ? nested
    : nested && typeof nested === 'object' && Array.isArray((nested as { results?: unknown[] }).results)
      ? (nested as { results: unknown[] }).results
      : Array.isArray(payload) ? payload : []
  return list.slice(0, 12).map((item) => {
    const row = item as Record<string, unknown>
    return {
      summary: String(row.summary ?? row.kind ?? 'event'),
      host_id: row.host_id ? String(row.host_id) : undefined,
    }
  })
}

export default function PlatformThreatHunting() {
  const [timeline, setTimeline] = useState<SecurityEvent[]>([])
  const [correlations, setCorrelations] = useState<Array<Record<string, unknown>>>([])
  const [huntQueries, setHuntQueries] = useState<HuntQuery[]>([])
  const [query, setQuery] = useState('')
  const [searchHits, setSearchHits] = useState<Array<{ summary: string; host_id?: string }>>([])
  const [searchMeta, setSearchMeta] = useState<{ query: string; llm?: boolean; count?: number; backend?: string } | null>(null)
  const [attackChain, setAttackChain] = useState<string[] | null>(null)
  const [attackSummary, setAttackSummary] = useState<string | null>(null)
  const [attackLlm, setAttackLlm] = useState(false)
  const [huntSummary, setHuntSummary] = useState<{ summary: string; actions: string[]; llm?: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [tl, corr, hunts] = await Promise.all([
        getFleetSecurityTimeline(48),
        getSecurityCorrelations(),
        getHuntQueries(),
      ])
      setTimeline(tl.events ?? [])
      setCorrelations(corr.correlations ?? [])
      setHuntQueries(hunts.queries ?? [])
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const applySearchResponse = (r: {
    search_query: string
    results: Record<string, unknown>
    hit_count?: number
    llm_powered?: boolean
    search_backend?: string
  }) => {
    setSearchHits(extractSearchHits(r.results))
    setSearchMeta({
      query: r.search_query,
      llm: r.llm_powered,
      count: r.hit_count,
      backend: r.search_backend,
    })
  }

  const runHunt = (queryId: string) => {
    void runHuntQuery(queryId)
      .then((r) => {
        const hits = (r.results ?? []).slice(0, 12).map((row) => ({
          summary: String(row.summary ?? row.kind ?? 'event'),
          host_id: row.host_id ? String(row.host_id) : undefined,
        }))
        setSearchHits(hits)
        setSearchMeta({
          query: r.query_name ?? queryId,
          count: r.hit_count ?? hits.length,
          backend: r.backend,
        })
      })
      .catch((e: unknown) => setError(formatUserError(e)))
  }

  const runHuntSummary = () => {
    void getSecurityHuntSummary(48)
      .then((r) => setHuntSummary({
        summary: r.summary,
        actions: r.priority_actions ?? [],
        llm: r.llm_powered,
      }))
      .catch((e: unknown) => setError(formatUserError(e)))
  }

  return (
    <PageLayout hideHeader error={error}>
      <MacSectionTitle title="Threat hunting" subtitle="Search · timeline · graph · evidence · AI summary" />
      <Link to="/platform/zeus/security" className={`text-sm ${hubLinkClasses()}`}>← Security Center</Link>
      {huntQueries.length > 0 && (
        <MacGlassPanel title="Saved hunt queries" subtitle="OpenSearch-backed SOC playbooks">
          <div className="flex flex-wrap gap-2">
            {huntQueries.map((q) => (
              <button
                key={q.id}
                type="button"
                className="btn-secondary text-xs"
                title={q.description}
                onClick={() => runHunt(q.id)}
              >
                {q.name}
              </button>
            ))}
          </div>
        </MacGlassPanel>
      )}

      <MacGlassPanel
        title="AI hunt summary"
        subtitle="Correlations + fleet timeline synthesis"
        action={
          <button type="button" className="btn-secondary text-xs flex items-center gap-1" onClick={runHuntSummary}>
            <Bot className="w-3 h-3" /> Generate
          </button>
        }
      >
        {huntSummary ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-300 flex items-start gap-2">
              <LlmBadge powered={huntSummary.llm} />
              <span>{huntSummary.summary}</span>
            </p>
            {huntSummary.actions.length > 0 && (
              <ul className="text-xs text-slate-500 list-disc pl-5 space-y-1">
                {huntSummary.actions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Generate an operator summary from current correlations and timeline.</p>
        )}
      </MacGlassPanel>

      <MacGlassPanel title="Natural language search" subtitle="LLM query translation + PacketWolf index">
        <div className="flex flex-wrap gap-2">
          <input
            className="input text-sm flex-1 min-w-[14rem]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find every sudo event last week"
            onKeyDown={(e) => e.key === 'Enter' && void nlSecuritySearch(query).then(applySearchResponse).catch((err: unknown) => setError(formatUserError(err)))}
          />
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => void nlSecuritySearch(query).then(applySearchResponse).catch((e: unknown) => setError(formatUserError(e)))}
          >
            Search
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => void reconstructAttack('h1', 48).then((r) => {
              setAttackChain(r.attack_chain)
              setAttackSummary(r.summary)
              setAttackLlm(Boolean(r.llm_powered))
            }).catch((e: unknown) => setError(formatUserError(e)))}
          >
            Reconstruct attack (h1)
          </button>
        </div>
        {searchMeta && (
          <p className="text-xs text-slate-500 mt-2 flex items-center gap-2">
            <LlmBadge powered={searchMeta.llm} />
            <span>
              {searchMeta.query.startsWith('reverse') || huntQueries.some((q) => q.name === searchMeta.query)
                ? `Hunt: "${searchMeta.query}"`
                : `Translated: "${searchMeta.query}"`}
              {' · '}
              {searchMeta.count ?? searchHits.length} hit(s)
              {searchMeta.backend ? ` · ${searchMeta.backend} index` : ''}
            </span>
          </p>
        )}
        {searchHits.length > 0 && (
          <ul className="mt-2 space-y-1">
            {searchHits.map((h, i) => (
              <li key={i} className="text-sm text-slate-300">
                {h.summary}
                {h.host_id ? (
                  <>
                    {' '}
                    <Link to={`/platform/zeus/machines/${h.host_id}`} className={`text-xs ${hubLinkClasses()}`}>
                      {h.host_id}
                    </Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </MacGlassPanel>

      <SecurityTimelinePanel events={timeline} />

      {correlations.length > 0 && (
        <MacGlassPanel title="Threat correlations" subtitle="Rule engine findings">
          <ul className="text-sm text-slate-300 space-y-2">
            {correlations.map((c, i) => (
              <li key={i}>
                <span className={statusToneClass(riskTone(String(c.severity)))}>{String(c.severity)}</span> · {String(c.summary)}
                {c.host_id ? (
                  <>
                    {' '}
                    <Link to={`/platform/zeus/machines/${String(c.host_id)}`} className={hubLinkClasses()}>
                      {String(c.host_id)}
                    </Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </MacGlassPanel>
      )}

      {attackChain && (
        <MacGlassPanel
          title="AI attack reconstruction"
          subtitle={attackSummary ?? 'Timeline slice'}
          action={<LlmBadge powered={attackLlm} />}
        >
          <ol className="list-decimal pl-5 text-sm text-slate-300 space-y-1">
            {attackChain.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </MacGlassPanel>
      )}
    </PageLayout>
  )
}
