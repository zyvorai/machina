// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import { MacGlassPanel } from '../../components/platform/mac/PlatformMacUi'
import PlatformPageChrome, { PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import {
  createAiProvider,
  deleteAiProvider,
  listAiProviderModels,
  listAiProviders,
  patchAiProvider,
  testAiProvider,
  type AiModelRow,
  type AiProviderRow,
} from '../../api/ai'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'

const PROVIDER_KINDS = [
  'openai', 'anthropic', 'google', 'xai', 'deepseek', 'mistral', 'meta', 'qwen',
  'azure_openai', 'ollama', 'vllm', 'openai_compatible',
]

export default function PlatformAiProviders({ embedded }: { embedded?: boolean } = {}) {
  const toast = useToastContext()
  const [providers, setProviders] = useState<AiProviderRow[]>([])
  const [models, setModels] = useState<AiModelRow[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('OpenAI')
  const [kind, setKind] = useState('openai')
  const [baseUrl, setBaseUrl] = useState('')
  const [modelId, setModelId] = useState('gpt-4o-mini')
  const [apiKey, setApiKey] = useState('')

  const load = useCallback(async () => {
    const rows = await listAiProviders()
    setProviders(rows)
    if (rows[0] && !selected) {
      setSelected(rows[0].id)
      setModels(await listAiProviderModels(rows[0].id).catch(() => []))
    }
  }, [selected])

  useEffect(() => { void load().catch(() => {}) }, [load])

  useEffect(() => {
    if (!selected) return
    void listAiProviderModels(selected).then(setModels).catch(() => setModels([]))
  }, [selected])

  return (
    <PlatformPageChrome
      hideHeader={embedded}
      compact={embedded}
      title={embedded ? undefined : 'AI Providers'}
      subtitle={embedded ? undefined : 'Multi-LLM BYOK — OpenAI, Anthropic, Gemini, Ollama, vLLM, and custom endpoints'}
      icon={embedded ? undefined : <Bot className="w-6 h-6 text-slate-400" />}
      actions={embedded ? undefined : <PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      <MacGlassPanel title="Add provider" subtitle="API keys are stored encrypted and never returned on GET">
        <div className="grid md:grid-cols-2 gap-3">
          <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {PROVIDER_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input className="input md:col-span-2" placeholder="Base URL (optional — Ollama/vLLM/Azure)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <input className="input" placeholder="Default model" value={modelId} onChange={(e) => setModelId(e.target.value)} />
          <input className="input" type="password" placeholder="API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn-primary mt-3"
          onClick={async () => {
            try {
              await createAiProvider({
                name,
                kind,
                base_url: baseUrl,
                api_key: apiKey,
                is_default: providers.length === 0,
                models: [{ model_id: modelId, display_name: modelId }],
              })
              setApiKey('')
              toast.success('Provider added')
              await load()
            } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}
        >
          Add provider
        </button>
      </MacGlassPanel>
      <MacGlassPanel title="Configured providers" subtitle="Zeus routes requests by task class to the best model">
        <div className="space-y-2">
          {providers.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] p-3 text-sm">
              <button type="button" className="font-medium text-left hover:text-orange-300" onClick={() => setSelected(p.id)}>
                {p.name} {p.is_default ? '· default' : ''}
              </button>
              <span className="text-xs text-slate-500">{p.kind}</span>
              {p.api_key_configured ? <span className="text-xs text-emerald-400">key ok</span> : <span className="text-xs text-amber-400">no key</span>}
              <button type="button" className="btn-secondary text-xs ml-auto" onClick={async () => {
                try {
                  const r = await testAiProvider(p.id)
                  toast.success(r.ok ? 'Connection OK' : 'Connection failed')
                } catch (e: unknown) { toast.error(formatUserError(e)) }
              }}>Test</button>
              {!p.is_default && (
                <button type="button" className="btn-secondary text-xs" onClick={async () => {
                  try {
                    await patchAiProvider(p.id, { is_default: true })
                    toast.success('Set as default')
                    await load()
                  } catch (e: unknown) { toast.error(formatUserError(e)) }
                }}>Make default</button>
              )}
              <button type="button" className="btn-secondary text-xs" onClick={async () => {
                try {
                  await deleteAiProvider(p.id)
                  toast.success('Deleted')
                  await load()
                } catch (e: unknown) { toast.error(formatUserError(e)) }
              }}>Delete</button>
            </div>
          ))}
          {providers.length === 0 && <p className="text-sm text-slate-500">No providers yet — add one above or configure legacy Zeus AI in General.</p>}
        </div>
        {selected && models.length > 0 && (
          <div className="mt-4 text-xs text-slate-400">
            Models: {models.map((m) => m.display_name).join(', ')}
          </div>
        )}
      </MacGlassPanel>
    </PlatformPageChrome>
  )
}
