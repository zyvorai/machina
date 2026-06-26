// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useNavigate } from 'react-router'
import { Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getFleetSummary } from '../../../api/ai'
import { ZEUS_ASSISTANT_NAME } from '../../../config/aiBrand'
import { statusChipClasses } from '../../../utils/semanticColors'
import { dispatchOpenSpotlight } from '../../../utils/platformJarvisShell'
import type { MissionControlFleetState } from './useMissionControlFleet'

type Props = {
  state: MissionControlFleetState
  missingImagesCount?: number
  onAnalyze?: () => void
}

export default function MissionControlBriefing({ state, missingImagesCount = 0, onAnalyze }: Props) {
  const navigate = useNavigate()
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const { unprotected, needsAttention } = state

  useEffect(() => {
    void getFleetSummary()
      .then((r) =>
        setSummaryText(
          `${r.aggregate_vm_count} VMs · ${r.reachable_peers}/${r.peer_count} peers reachable · $${r.aggregate_monthly_usd.toFixed(0)}/mo`,
        ),
      )
      .catch(() => setSummaryText(null))
  }, [state.vms.length])

  const chips = [
    missingImagesCount > 0 ? { label: 'Missing golden images', action: () => navigate('/platform/vm-builder') } : null,
    { label: 'Machine Finder', action: () => navigate('/platform/vms') },
    { label: 'Migration planner', action: () => navigate('/platform/vms?lens=migration') },
    unprotected > 0 ? { label: `${unprotected} need backup`, action: () => navigate('/platform/vms?folder=unprotected') } : null,
    needsAttention > 0 ? { label: 'Analyze fleet', action: () => onAnalyze?.() ?? dispatchOpenSpotlight('analyze fleet health') } : null,
    { label: 'GPU Command Center', action: () => navigate('/platform/gpu') },
    { label: 'Recovery center', action: () => navigate('/platform/backups') },
  ].filter(Boolean) as { label: string; action: () => void }[]

  return (
    <section className="mc-briefing rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 space-y-2" data-testid="mission-control-briefing">
      <div className="flex items-start gap-2">
        <Sparkles className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-medium text-sky-300/90">{ZEUS_ASSISTANT_NAME} Briefing</p>
          <p className="text-sm text-slate-200 mt-0.5">{summaryText ?? state.finder?.summary ?? 'Scanning fleet…'}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            className={`text-xs px-2 py-1 rounded-full border border-white/10 ${statusChipClasses('info')}`}
            onClick={chip.action}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </section>
  )
}
