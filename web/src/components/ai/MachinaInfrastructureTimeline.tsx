// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Clock, Sparkles } from 'lucide-react'
import { analyzeIncident, type IncidentAnalysis } from '../../api/ai'
import { hubLinkClasses, statusToneClass } from '../../utils/semanticColors'

export default function MachinaInfrastructureTimeline({ hours = 4 }: { hours?: number }) {
  const [analysis, setAnalysis] = useState<IncidentAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setAnalysis(await analyzeIncident({ hours }))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Timeline unavailable')
    }
  }, [hours])

  useEffect(() => { void load() }, [load])

  if (error) return <p className={`text-xs ${statusToneClass('error')}`}>{error}</p>
  if (!analysis) return <p className="text-slate-500 text-xs">Loading infrastructure timeline…</p>

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-3 text-sm">
        <p className="font-medium text-orange-200 flex items-center gap-2">
          <Sparkles className="w-4 h-4" /> AI Root Cause ({Math.round(analysis.confidence * 100)}% confidence)
        </p>
        <p className="text-slate-300 mt-1">{analysis.root_cause}</p>
        {(analysis.suggested_actions ?? []).slice(0, 2).map((a) => (
          <p key={a} className={`text-xs mt-1 ${hubLinkClasses()}`}>→ {a}</p>
        ))}
      </div>
      <div className="max-h-48 overflow-y-auto space-y-1.5 text-xs font-mono">
        {analysis.timeline.slice(0, 12).map((e, i) => (
          <div key={`${e.at}-${i}`} className="flex gap-2 text-slate-400">
            <Clock className="w-3 h-3 shrink-0 mt-0.5 opacity-60" />
            <span className="text-slate-500 shrink-0">{new Date(e.at).toLocaleTimeString()}</span>
            <span className="text-slate-600">[{e.source}]</span>
            <span className="text-slate-300">{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
