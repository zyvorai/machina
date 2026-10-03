// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Bot, Zap } from 'lucide-react'
import { executeAutopilotAction, getAutopilotProposal, type ProposedAction } from '../../api/ai'
import { useAi } from '../../contexts/AiContext'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { hubLinkClasses } from '../../utils/semanticColors'
import ConfirmDialog from '../ConfirmDialog'

export default function AutopilotSuggestionsStrip() {
  const { mode, openCopilot } = useAi()
  const toast = useToastContext()
  const [proposals, setProposals] = useState<ProposedAction[]>([])
  const [executingId, setExecutingId] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ProposedAction | null>(null)

  const load = useCallback(async () => {
    if (mode === 'off') {
      setProposals([])
      return
    }
    try {
      const p = await getAutopilotProposal()
      setProposals(p.actions.slice(0, 3))
    } catch {
      setProposals([])
    }
  }, [mode])

  useEffect(() => {
    void load()
  }, [load])

  if (proposals.length === 0) return null

  const runAction = async (action: ProposedAction) => {
    setExecutingId(action.id)
    try {
      const r = await executeAutopilotAction(action.action_type, action.object_ref)
      toast.success(r.message)
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setExecutingId(null)
    }
  }

  return (
    <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4 space-y-3">
      <ConfirmDialog
        open={confirmAction !== null}
        title="Run Autopilot fix"
        message={confirmAction ? `Run "${confirmAction.label}" now? ${confirmAction.review}` : ''}
        confirmLabel="Run fix"
        variant="warning"
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          const action = confirmAction
          setConfirmAction(null)
          if (action) void runAction(action)
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-orange-700 flex items-center gap-2">
          <Zap className="w-4 h-4" /> Autopilot suggestions
        </p>
        <button type="button" className={`text-xs ${hubLinkClasses()}`} onClick={openCopilot}>
          <Bot className="w-3.5 h-3.5 inline mr-1" />
          Open Zyra
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {proposals.map((a) => (
          <div key={a.id} className="rounded-lg border border-white/[0.06] bg-[var(--apple-surface)] p-3 text-xs">
            <p className="font-medium text-[var(--text-primary)]">{a.label}</p>
            <p className="text-[var(--text-muted)] mt-0.5 line-clamp-2">{a.review}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="button"
                className="btn-primary text-[10px]"
                disabled={executingId === a.id}
                onClick={() => setConfirmAction(a)}
              >
                {executingId === a.id ? 'Running…' : 'Run fix'}
              </button>
              <Link to="/platform/zyra/approvals" className={`text-[10px] self-center ${hubLinkClasses()}`}>
                Approvals
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
