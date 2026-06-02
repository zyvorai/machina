// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { MacGlassPanel } from '../../components/platform/mac/PlatformMacUi'
import PlatformPageChrome, { PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import {
  getClusterSummary,
  getClusterLeadership,
  getClusterSettings,
  patchCluster,
  patchClusterSettings,
  getOidcSettings,
  patchOidcSettings,
  getCpuCompatMatrix,
  patchCpuCompatMatrix,
  getOidcLoginUrl,
  listProjectQuotas,
  upsertProjectQuota,
  type CpuCompatRule,
  type OidcSettings,
} from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { statusToneClass } from '../../utils/semanticColors'
import { getAiSettings, patchAiSettings, type AiSettings } from '../../api/ai'
import { useAi } from '../../contexts/AiContext'

export default function PlatformSettings({ embedded }: { embedded?: boolean }) {
  const toast = useToastContext()
  const { setMode } = useAi()
  const [error, setError] = useState<string | null>(null)
  const [clusterName, setClusterName] = useState('')
  const [syncInterval, setSyncInterval] = useState(30)
  const [leadership, setLeadership] = useState<{ controller_id: string; is_leader: boolean; holder_id: string; lease_until: string } | null>(null)
  const [oidc, setOidc] = useState<OidcSettings>({ enabled: false, issuer: '', client_id: '', client_secret: '', redirect_uri: '' })
  const [cpuRules, setCpuRules] = useState<CpuCompatRule[]>([])
  const [cpuJson, setCpuJson] = useState('[]')
  const [quotaProject, setQuotaProject] = useState('default')
  const [quotaVms, setQuotaVms] = useState(0)
  const [quotaVcpu, setQuotaVcpu] = useState(0)
  const [quotaMem, setQuotaMem] = useState(0)
  const [quotaStorage, setQuotaStorage] = useState(0)
  const [quotas, setQuotas] = useState<Array<{ project: string; max_vms: number; max_vcpu: number; max_memory_mib: number; max_storage_gib: number }>>([])
  const [ai, setAi] = useState<AiSettings>({ enabled: false, mode: 'advisor', provider: 'openai', model: 'gpt-4o-mini', api_key_configured: false, autopilot_interval_secs: 0, autopilot_max_actions: 5, fleet_peer_urls: [] })
  const [fleetPeers, setFleetPeers] = useState('')
  const [aiKey, setAiKey] = useState('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const [cluster, o, cpu, lead, settings, q, aiSettings] = await Promise.all([
        getClusterSummary(),
        getOidcSettings(),
        getCpuCompatMatrix(),
        getClusterLeadership(),
        getClusterSettings(),
        listProjectQuotas().catch(() => []),
        getAiSettings().catch(() => null),
      ])
      setClusterName(cluster.name)
      setSyncInterval(settings.inventory_sync_interval_secs)
      setLeadership(lead)
      setOidc(o)
      setCpuRules(cpu)
      setCpuJson(JSON.stringify(cpu, null, 2))
      setQuotas(q)
      if (aiSettings) {
        setAi(aiSettings)
        setFleetPeers((aiSettings.fleet_peer_urls ?? []).join('\n'))
        setMode(aiSettings.enabled ? (aiSettings.mode === 'autopilot' ? 'autopilot' : aiSettings.mode === 'autopilot_preview' ? 'autopilot_preview' : 'advisor') : 'off')
      }
    } catch (e: unknown) { setError(formatUserError(e)) }
  }, [setMode])

  useEffect(() => { void load() }, [load])

  return (
    <PlatformPageChrome
      hideHeader={embedded}
      compact={embedded}
      error={error}
      onErrorRetry={() => void load()}
      title={embedded ? undefined : 'Platform settings'}
      subtitle={embedded ? undefined : 'Cluster name, OIDC, CPU compatibility, HA'}
      icon={embedded ? undefined : <Settings className="w-6 h-6 text-slate-400" />}
      actions={embedded ? undefined : <PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      {leadership && (
        <MacGlassPanel title="Controller leadership">
          <div className="space-y-2 text-sm">
          <p className="text-slate-400">
            This instance: <span className="text-slate-200">{leadership.controller_id}</span>
            {' · '}
            {leadership.is_leader ? <span className={statusToneClass('ok')}>leader</span> : <span className={statusToneClass('warn')}>follower</span>}
          </p>
          <p className="text-slate-500">Holder: {leadership.holder_id || 'none'} · lease until {new Date(leadership.lease_until).toLocaleString()}</p>
          </div>
        </MacGlassPanel>
      )}
      <MacGlassPanel title="Cluster">
        <input className="input" value={clusterName} onChange={(e) => setClusterName(e.target.value)} />
        <button type="button" className="btn-secondary" onClick={async () => {
          try { await patchCluster({ name: clusterName }); toast.success('Cluster updated'); await load() } catch (e: unknown) { toast.error(formatUserError(e)) }
        }}>Save cluster name</button>
      </MacGlassPanel>
      <MacGlassPanel title="Inventory sync" subtitle="Leader-only periodic host inventory sync. Set 0 to disable.">
        <label className="text-sm block">
          Interval (seconds)
          <input type="number" min={0} max={86400} className="input mt-1 block w-40" value={syncInterval}
            onChange={(e) => setSyncInterval(Number(e.target.value))} />
        </label>
        <button type="button" className="btn-secondary" onClick={async () => {
          try {
            await patchClusterSettings({ inventory_sync_interval_secs: syncInterval })
            toast.success('Sync interval saved')
            await load()
          } catch (e: unknown) { toast.error(formatUserError(e)) }
        }}>Save sync interval</button>
      </MacGlassPanel>
      <MacGlassPanel title="OIDC login">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={oidc.enabled} onChange={(e) => setOidc({ ...oidc, enabled: e.target.checked })} /> Enable OIDC</label>
        <input className="input" placeholder="issuer URL" value={oidc.issuer} onChange={(e) => setOidc({ ...oidc, issuer: e.target.value })} />
        <input className="input" placeholder="client id" value={oidc.client_id} onChange={(e) => setOidc({ ...oidc, client_id: e.target.value })} />
        <input className="input" type="password" placeholder="client secret" value={oidc.client_secret} onChange={(e) => setOidc({ ...oidc, client_secret: e.target.value })} />
        <input className="input" placeholder="redirect URI (optional)" value={oidc.redirect_uri} onChange={(e) => setOidc({ ...oidc, redirect_uri: e.target.value })} />
        <div className="flex gap-2 flex-wrap">
          <button type="button" className="btn-secondary" onClick={async () => {
            try { await patchOidcSettings(oidc); toast.success('OIDC settings saved') } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>Save OIDC</button>
          {oidc.enabled && (
            <a href={getOidcLoginUrl()} className="btn-primary inline-flex items-center">Login with OIDC</a>
          )}
        </div>
      </MacGlassPanel>
      <MacGlassPanel title="Project quotas" subtitle="0 = unlimited. Enforced on VM create.">
        {quotas.length > 0 && (
          <ul className="text-xs text-slate-400 space-y-1">
            {quotas.map((q) => (
              <li key={q.project}>{q.project}: {q.max_vms || '∞'} VMs, {q.max_vcpu || '∞'} vCPU, {q.max_memory_mib || '∞'} MiB, {q.max_storage_gib || '∞'} GiB</li>
            ))}
          </ul>
        )}
        <div className="grid gap-2 md:grid-cols-2">
          <input className="input" placeholder="project" value={quotaProject} onChange={(e) => setQuotaProject(e.target.value)} />
          <input className="input" type="number" placeholder="max VMs" value={quotaVms || ''} onChange={(e) => setQuotaVms(Number(e.target.value))} />
          <input className="input" type="number" placeholder="max vCPU" value={quotaVcpu || ''} onChange={(e) => setQuotaVcpu(Number(e.target.value))} />
          <input className="input" type="number" placeholder="max memory MiB" value={quotaMem || ''} onChange={(e) => setQuotaMem(Number(e.target.value))} />
          <input className="input" type="number" placeholder="max storage GiB" value={quotaStorage || ''} onChange={(e) => setQuotaStorage(Number(e.target.value))} />
        </div>
        <button type="button" className="btn-secondary" onClick={async () => {
          try {
            await upsertProjectQuota({ project: quotaProject, max_vms: quotaVms, max_vcpu: quotaVcpu, max_memory_mib: quotaMem, max_storage_gib: quotaStorage })
            toast.success('Quota saved')
            await load()
          } catch (e: unknown) { toast.error(formatUserError(e)) }
        }}>Save quota</button>
      </MacGlassPanel>
      <MacGlassPanel title="Zeus AI (BYOK)" subtitle="Deterministic engines work with AI disabled. Optional LLM improves NL parsing and explanations. Configure providers under Settings → AI Providers.">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ai.enabled} onChange={(e) => setAi({ ...ai, enabled: e.target.checked })} />
          Enable Zeus AI
        </label>
        <label className="text-sm block">
          Mode
          <select className="input mt-1 block w-full max-w-xs" value={ai.mode} onChange={(e) => setAi({ ...ai, mode: e.target.value })}>
            <option value="advisor">Advisor — recommend only</option>
            <option value="autopilot_preview">Autopilot preview — proposed fixes in Copilot</option>
            <option value="autopilot">Autopilot — auto-run low-risk fixes (configurable batch)</option>
          </select>
        </label>
        <label className="text-sm block">
          Autopilot max actions per batch
          <input
            type="number"
            min={1}
            max={10}
            className="input mt-1 block w-40"
            value={ai.autopilot_max_actions ?? 5}
            onChange={(e) => setAi({ ...ai, autopilot_max_actions: Number(e.target.value) })}
          />
        </label>
        {ai.mode === 'autopilot' && (
          <label className="text-sm block">
            Scheduled Autopilot interval (seconds)
            <input
              type="number"
              min={0}
              max={86400}
              className="input mt-1 block w-40"
              value={ai.autopilot_interval_secs}
              onChange={(e) => setAi({ ...ai, autopilot_interval_secs: Number(e.target.value) })}
            />
            <span className="text-xs text-slate-500">0 = manual only. Leader runs safe batch on interval.</span>
            {ai.autopilot_last_run && (
              <span className="text-xs text-slate-500 block mt-1">
                Last run: {new Date(ai.autopilot_last_run).toLocaleString()}
              </span>
            )}
          </label>
        )}
        <label className="text-sm block">
          Fleet peer controller URLs (one per line, for multi-cluster Zeus summary)
          <textarea
            className="input mt-1 block w-full max-w-lg min-h-20 font-mono text-xs"
            placeholder="https://controller-site-b.example.com"
            value={fleetPeers}
            onChange={(e) => setFleetPeers(e.target.value)}
          />
        </label>
        <select className="input w-full max-w-xs" value={ai.provider} onChange={(e) => setAi({ ...ai, provider: e.target.value })}>
          <option value="openai">OpenAI-compatible</option>
          <option value="anthropic">Anthropic</option>
        </select>
        <input className="input" placeholder="Model (e.g. gpt-4o-mini)" value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} />
        <input className="input" type="password" placeholder={ai.api_key_configured ? 'API key configured — enter to replace' : 'API key'} value={aiKey} onChange={(e) => setAiKey(e.target.value)} />
        <button type="button" className="btn-secondary" onClick={async () => {
          try {
            const body: Partial<AiSettings & { api_key?: string }> = {
              enabled: ai.enabled,
              provider: ai.provider,
              model: ai.model,
              mode: ai.mode,
              autopilot_interval_secs: ai.autopilot_interval_secs,
              autopilot_max_actions: ai.autopilot_max_actions ?? 5,
              fleet_peer_urls: fleetPeers.split('\n').map((s) => s.trim()).filter(Boolean),
            }
            if (aiKey.trim()) body.api_key = aiKey.trim()
            const saved = await patchAiSettings(body)
            setAi(saved)
            setAiKey('')
            setMode(saved.enabled ? (saved.mode === 'autopilot' ? 'autopilot' : saved.mode === 'autopilot_preview' ? 'autopilot_preview' : 'advisor') : 'off')
            toast.success('AI settings saved')
          } catch (e: unknown) { toast.error(formatUserError(e)) }
        }}>Save AI settings</button>
      </MacGlassPanel>
      <MacGlassPanel title="CPU compatibility matrix">
        <textarea className="input font-mono text-xs min-h-32" value={cpuJson} onChange={(e) => setCpuJson(e.target.value)} />
        <button type="button" className="btn-secondary" onClick={async () => {
          try {
            const rules = JSON.parse(cpuJson) as CpuCompatRule[]
            await patchCpuCompatMatrix(rules)
            setCpuRules(rules)
            toast.success('CPU matrix updated')
          } catch (e: unknown) { toast.error(formatUserError(e)) }
        }}>Save matrix ({cpuRules.length} rules)</button>
      </MacGlassPanel>
    </PlatformPageChrome>
  )
}
