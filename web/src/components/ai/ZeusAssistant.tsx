// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Bot, Send, X, Zap } from 'lucide-react'
import { useLocation } from 'react-router'
import { useAi } from '../../contexts/AiContext'
import {
  aiCopilotStream,
  executeAutopilotAction,
  getAutopilotProposal,
  listZeusAgents,
  runNlOps,
  zeusChat,
  type NlOpsPlan,
  type ProposedAction,
  type ZeusAgentInfo,
} from '../../api/ai'
import { usePlatformInfo } from '../../contexts/PlatformInfoContext'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { statusPillClasses } from '../../utils/semanticColors'

const GUEST_SUGGESTED_PROMPTS = [
  'Which guests have no connected guest agent?',
  'Summarize guest time drift across the fleet',
  'What should I fix before migration cutover?',
]

function guestContextActive(summary: string | null, vmIds: string[]): boolean {
  if (vmIds.length > 0) return true
  const s = summary?.toLowerCase() ?? ''
  return s.includes('qga') || s.includes('guest') || s.includes('agent') || s.includes('ubuntu')
}

export default function ZeusAssistant() {
  const {
    copilotOpen,
    closeCopilot,
    contextVmId,
    contextHostId,
    contextVmIds,
    contextSummary,
    mode,
    selectedAgent,
    setSelectedAgent,
  } = useAi()
  const location = useLocation()
  const { info } = usePlatformInfo()
  const toast = useToastContext()
  const platform = Boolean(info?.control_plane?.proxy_url)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([])
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [proposals, setProposals] = useState<ProposedAction[]>([])
  const [nlOpsPlan, setNlOpsPlan] = useState<NlOpsPlan | null>(null)
  const [executingId, setExecutingId] = useState<string | null>(null)
  const [agents, setAgents] = useState<ZeusAgentInfo[]>([])

  const showGuestPrompts = guestContextActive(contextSummary, contextVmIds)

  useEffect(() => {
    if (!platform) return
    void listZeusAgents().then(setAgents).catch(() => setAgents([]))
  }, [platform])

  const loadProposals = useCallback(async () => {
    if (!platform || mode === 'off') return
    try {
      const p = await getAutopilotProposal(contextVmId ?? undefined)
      setProposals(p.actions)
    } catch {
      setProposals([])
    }
  }, [platform, mode, contextVmId])

  useEffect(() => {
    if (copilotOpen) void loadProposals()
  }, [copilotOpen, loadProposals])

  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim()
    if (!text || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text }])
    if (!platform) {
      setMessages((m) => [...m, { role: 'assistant', text: 'Connect Zyvor Platform (control plane) to use Zeus.' }])
      return
    }
    setBusy(true)
    setNlOpsPlan(null)
    const assistantIdx = messages.length + 1
    setMessages((m) => [...m, { role: 'assistant', text: '' }])
    const ql = text.toLowerCase()
    const looksLikeOps = (ql.includes('create') && (ql.includes('vm') || ql.includes('ubuntu')))
      || (ql.includes('migrate') && ql.includes('from'))
      || ql.includes('risky infra')
      || (ql.includes('storage') && ql.includes('slow'))
      || ql.includes('troubleshoot')
      || (ql.includes('slow') && ql.includes('vm'))
      || (ql.includes('guest') && (ql.includes('agent') || ql.includes('qga')))
    try {
      if (looksLikeOps) {
        const plan = await runNlOps(text, true)
        setNlOpsPlan(plan)
        setMessages((m) => {
          const next = [...m]
          next[assistantIdx] = { role: 'assistant', text: plan.reply || plan.summary }
          return next
        })
        setBusy(false)
        return
      }
      let streamed = ''
      let streamFailed = false
      setStreaming(true)
      try {
        await aiCopilotStream(
          text,
          contextVmId ?? undefined,
          (ev) => {
            if (ev.type === 'chunk' && ev.text) {
              streamed += ev.text
              setMessages((m) => {
                const next = [...m]
                next[assistantIdx] = { role: 'assistant', text: streamed }
                return next
              })
            } else if (ev.type === 'error') {
              streamFailed = true
            }
          },
          contextHostId ?? undefined,
          contextVmIds.length > 0 ? contextVmIds : undefined,
        )
      } catch {
        streamFailed = true
      } finally {
        setStreaming(false)
      }
      if (streamFailed || !streamed.trim()) {
        const zeus = await zeusChat({
          message: text,
          agent: selectedAgent,
          vm_id: contextVmId ?? undefined,
          host_id: contextHostId ?? undefined,
          vm_ids: contextVmIds.length > 0 ? contextVmIds : undefined,
          page_path: location.pathname,
        })
        setMessages((m) => {
          const next = [...m]
          next[assistantIdx] = { role: 'assistant', text: zeus.reply }
          return next
        })
      }
    } catch (e: unknown) {
      setMessages((m) => {
        const next = [...m]
        next[assistantIdx] = { role: 'assistant', text: formatUserError(e) }
        return next
      })
    } finally {
      setBusy(false)
    }
  }, [input, busy, platform, contextVmId, contextHostId, contextVmIds, messages.length, selectedAgent, location.pathname])

  const queueNlOps = async () => {
    if (!nlOpsPlan) return
    setBusy(true)
    try {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.text ?? nlOpsPlan.summary
      const plan = await runNlOps(lastUser, false)
      toast.success(plan.action_ids.length > 0 ? `Queued ${plan.action_ids.length} approval(s)` : plan.summary)
      setNlOpsPlan(null)
      setMessages((m) => [...m, { role: 'assistant', text: `✓ ${plan.summary}` }])
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setBusy(false)
    }
  }

  const runAction = async (action: ProposedAction) => {
    setExecutingId(action.id)
    try {
      const r = await executeAutopilotAction(action.action_type, action.object_ref)
      toast.success(r.message)
      setMessages((m) => [...m, { role: 'assistant', text: `✓ ${r.message}` }])
      await loadProposals()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setExecutingId(null)
    }
  }

  if (!copilotOpen || mode === 'off') return null

  const modeLabel = mode === 'autopilot' ? 'Autopilot — low-risk fixes run in batch' : mode === 'autopilot_preview' ? 'Autopilot preview — confirm each action' : 'Advisor mode'

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/20 lg:hidden" onClick={closeCopilot} aria-hidden />
      <aside className="fixed right-0 top-0 bottom-0 z-[56] w-full max-w-md border-l border-white/[0.08] bg-slate-900/98 backdrop-blur-xl flex flex-col shadow-2xl animate-fade-in">
        <header className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 min-w-0">
            <Bot className="w-5 h-5 text-orange-400 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-sm">Zeus</p>
              <p className="text-[10px] text-slate-500 truncate">{modeLabel}</p>
            </div>
          </div>
          <select
            className="input text-[10px] max-w-[120px] mr-2"
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            aria-label="Zeus agent"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button type="button" onClick={closeCopilot} className="p-1 text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </header>

        {(contextVmIds.length > 0 || contextSummary || contextVmId) && (
          <div className="px-4 py-2 border-b border-white/[0.06] flex flex-wrap gap-1.5">
            {contextVmId && (
              <span className={statusPillClasses('info')}>VM context</span>
            )}
            {contextVmIds.length > 0 && (
              <span className={statusPillClasses('info')}>
                {contextVmIds.length} VM{contextVmIds.length === 1 ? '' : 's'} · guest query
              </span>
            )}
            {contextSummary && (
              <span className={`${statusPillClasses('neutral')} max-w-full truncate`} title={contextSummary}>
                {contextSummary}
              </span>
            )}
          </div>
        )}

        {proposals.length > 0 && (
          <div className="px-4 py-3 border-b border-white/[0.06] space-y-2 max-h-48 overflow-y-auto">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-400/80 flex items-center gap-1">
              <Zap className="w-3 h-3" /> Proposed fixes
            </p>
            {proposals.map((a) => (
              <div key={a.id} className="rounded-lg border border-white/[0.06] p-2 text-xs">
                <p className="font-medium text-slate-200">{a.label}</p>
                <p className="text-slate-500 mt-0.5 line-clamp-2">{a.review}</p>
                <button
                  type="button"
                  className="btn-primary text-[10px] mt-2"
                  disabled={executingId === a.id}
                  onClick={() => void runAction(a)}
                >
                  {executingId === a.id ? 'Running…' : 'Review & run'}
                </button>
              </div>
            ))}
          </div>
        )}
        {nlOpsPlan && nlOpsPlan.approval_required && (
          <div className="px-4 py-3 border-b border-white/[0.06] space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-400/80">NL Ops plan (dry-run)</p>
            <p className="text-xs text-slate-400">Risk {nlOpsPlan.risk_score}/10 · {nlOpsPlan.steps.length} step(s)</p>
            <button type="button" className="btn-primary text-xs w-full" disabled={busy} onClick={() => void queueNlOps()}>
              Queue for approval
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-slate-500">
                Ask Zeus about VM health, capacity, cost, migrations, security, guest agents, or network paths.
              </p>
              {showGuestPrompts && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Guest agent prompts</p>
                  {GUEST_SUGGESTED_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="block w-full text-left text-xs rounded-lg border border-white/[0.06] px-3 py-2 text-slate-300 hover:bg-white/[0.04]"
                      onClick={() => void send(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`rounded-xl px-3 py-2 ${m.role === 'user' ? 'bg-blue-500/15 ml-8' : 'bg-slate-800/80 mr-4'}`}>
              <p className="whitespace-pre-wrap text-slate-200">{m.text}</p>
            </div>
          ))}
          {streaming && (
            <p className="text-[10px] text-orange-400/70 px-1">Streaming…</p>
          )}
        </div>
        <footer className="p-3 border-t border-white/[0.06] flex gap-2">
          <input
            aria-label={showGuestPrompts ? 'Ask about guest agents' : 'Ask Zeus'}
            className="input flex-1 text-sm"
            placeholder={showGuestPrompts ? 'Ask about guest agents…' : 'Ask Zeus…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void send() }}
          />
          <button type="button" className="btn-primary px-3" disabled={busy} onClick={() => void send()}>
            <Send className="w-4 h-4" />
          </button>
        </footer>
      </aside>
    </>
  )
}
