// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { MacGlassPanel } from '../../components/platform/mac/PlatformMacUi'
import PlatformPageChrome, { PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import {
  createAiPrompt,
  deleteAiPrompt,
  getMemorySettings,
  installAgentMarketplace,
  listAgentMarketplace,
  listAiPrompts,
  patchMemorySettings,
  uninstallAgentMarketplace,
  type AgentPluginRow,
  type AiPromptRow,
} from '../../api/ai'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'

export default function PlatformZeusSettings({ embedded }: { embedded?: boolean } = {}) {
  const toast = useToastContext()
  const [prompts, setPrompts] = useState<AiPromptRow[]>([])
  const [agents, setAgents] = useState<AgentPluginRow[]>([])
  const [memoryEnabled, setMemoryEnabled] = useState(true)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const load = useCallback(async () => {
    setPrompts(await listAiPrompts().catch(() => []))
    setAgents(await listAgentMarketplace().catch(() => []))
    const mem = await getMemorySettings().catch(() => null)
    if (mem) setMemoryEnabled(mem.enabled)
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <PlatformPageChrome
      hideHeader={embedded}
      compact={embedded}
      title={embedded ? undefined : 'Zeus'}
      subtitle={embedded ? undefined : 'Prompt library, memory controls, and agent marketplace'}
      icon={embedded ? undefined : <Sparkles className="w-6 h-6 text-slate-400" />}
      actions={embedded ? undefined : <PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      <MacGlassPanel title="Memory" subtitle="Enterprise controls for conversation and infrastructure recall">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={memoryEnabled} onChange={(e) => setMemoryEnabled(e.target.checked)} />
          Enable Zeus memory
        </label>
        <button type="button" className="btn-secondary mt-3" onClick={async () => {
          try {
            await patchMemorySettings({ enabled: memoryEnabled })
            toast.success('Memory settings saved')
          } catch (e: unknown) { toast.error(formatUserError(e)) }
        }}>Save memory settings</button>
      </MacGlassPanel>
      <MacGlassPanel title="Prompt library" subtitle="Infrastructure, security, Kubernetes, runbooks, SOPs">
        <div className="grid gap-2 mb-3">
          <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input min-h-24" placeholder="Prompt body" value={body} onChange={(e) => setBody(e.target.value)} />
          <button type="button" className="btn-primary w-fit" onClick={async () => {
            try {
              await createAiPrompt({ scope: 'personal', title, body, tags: ['infrastructure'] })
              setTitle('')
              setBody('')
              toast.success('Prompt saved')
              await load()
            } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>Save prompt</button>
        </div>
        <ul className="space-y-2 text-sm">
          {prompts.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-2 border border-white/[0.06] rounded-lg p-2">
              <div><p className="font-medium">{p.title}</p><p className="text-xs text-slate-500 line-clamp-2">{p.body}</p></div>
              <button type="button" className="btn-secondary text-xs" onClick={async () => {
                try { await deleteAiPrompt(p.id); await load() } catch (e: unknown) { toast.error(formatUserError(e)) }
              }}>Delete</button>
            </li>
          ))}
        </ul>
      </MacGlassPanel>
      <MacGlassPanel title="Agent marketplace" subtitle="Install specialist agents (AWS, Terraform, FinOps, …)">
        <div className="space-y-2">
          {agents.map((a) => (
            <div key={a.slug} className="flex items-center gap-2 text-sm border border-white/[0.06] rounded-lg p-2">
              <div className="flex-1">
                <p className="font-medium">{a.name}</p>
                <p className="text-xs text-slate-500">{a.description}</p>
              </div>
              <button type="button" className="btn-secondary text-xs" onClick={async () => {
                try {
                  if (a.installed) await uninstallAgentMarketplace(a.slug)
                  else await installAgentMarketplace(a.slug)
                  toast.success(a.installed ? 'Uninstalled' : 'Installed')
                  await load()
                } catch (e: unknown) { toast.error(formatUserError(e)) }
              }}>{a.installed ? 'Uninstall' : 'Install'}</button>
            </div>
          ))}
        </div>
      </MacGlassPanel>
    </PlatformPageChrome>
  )
}
