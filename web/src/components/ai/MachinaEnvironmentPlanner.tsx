// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useState } from 'react'
import { Layers, Play } from 'lucide-react'
import { MacGlassPanel } from '../platform/mac/PlatformMacUi'
import { executeEnvironment, planEnvironment, type EnvironmentResourcePlan } from '../../api/ai'
import { statusToneClass } from '../../utils/semanticColors'

export default function MachinaEnvironmentPlanner() {
  const [query, setQuery] = useState('medium staging environment for 20 developers')
  const [plan, setPlan] = useState<EnvironmentResourcePlan | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    setSummary(null)
    try {
      setPlan(await planEnvironment(query))
    } finally {
      setBusy(false)
    }
  }

  const preview = async () => {
    setBusy(true)
    try {
      const r = await executeEnvironment(query, true)
      setPlan(r.plan)
      setSummary(r.summary)
    } finally {
      setBusy(false)
    }
  }

  return (
    <MacGlassPanel title="Intent environment planner" subtitle="NL staging / dev / prod sizing">
      <div className="flex flex-wrap gap-2">
        <input aria-label="Environment plan query" className="input flex-1 text-sm min-w-[12rem]" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="btn-primary text-xs flex items-center gap-1" disabled={busy} onClick={() => void run()}>
          <Layers className="w-3 h-3" /> Plan
        </button>
        <button type="button" className="btn-secondary text-xs flex items-center gap-1" disabled={busy} onClick={() => void preview()}>
          <Play className="w-3 h-3" /> Preview build
        </button>
      </div>
      {summary && <p className={`text-xs mt-2 ${statusToneClass('ok')}`}>{summary}</p>}
      {plan && (
        <div className="mt-3 text-xs space-y-1 text-slate-400">
          <p className="text-slate-200 font-medium">{plan.label}</p>
          <p>{plan.review}</p>
          {plan.build_steps.map((s) => <p key={s}>• {s}</p>)}
        </div>
      )}
    </MacGlassPanel>
  )
}
