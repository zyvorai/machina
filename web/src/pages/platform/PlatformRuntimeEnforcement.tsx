// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Shield, ShieldBan, Server, Ban } from 'lucide-react'
import PageLayout from '../../components/PageLayout'
import {
  MacGlassPanel,
  MacListRow,
  MacSectionTitle,
  MacStatWidget,
} from '../../components/platform/mac/PlatformMacUi'
import PageSkeleton from '../../components/PageSkeleton'
import {
  applyEnforcementPolicy,
  createEnforcementPolicy,
  getAgentSecurityBundle,
  getEnforcementPolicies,
  getEnforcementStatus,
  type EnforcementPolicy,
  type EnforcementStatus,
} from '../../api/zeusSecurity'
import { formatUserError } from '../../utils/apiError'
import { useToastContext } from '../../contexts/ToastContext'
import { hubLinkClasses } from '../../utils/semanticColors'

const KINDS = [
  { id: 'deny_process', label: 'Deny process' },
  { id: 'deny_dns', label: 'Deny DNS' },
  { id: 'deny_port', label: 'Deny port' },
  { id: 'deny_ip', label: 'Deny IP/CIDR' },
] as const

export default function PlatformRuntimeEnforcement() {
  const toast = useToastContext()
  const [status, setStatus] = useState<EnforcementStatus | null>(null)
  const [policies, setPolicies] = useState<EnforcementPolicy[]>([])
  const [name, setName] = useState('')
  const [kind, setKind] = useState<(typeof KINDS)[number]['id']>('deny_process')
  const [match, setMatch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [agentBundle, setAgentBundle] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [st, pol] = await Promise.all([getEnforcementStatus(), getEnforcementPolicies()])
      setStatus(st)
      setPolicies(pol.policies ?? [])
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const applyToHost = (policyId: string, hostId: string) => {
    void applyEnforcementPolicy(policyId, [hostId])
      .then((r) => {
        toast.success(r.summary)
        void load()
      })
      .catch((e: unknown) => toast.error(formatUserError(e)))
  }

  const createPolicy = () => {
    if (!name.trim() || !match.trim()) return
    void createEnforcementPolicy({ name: name.trim(), kind, match: match.trim() })
      .then(() => {
        toast.success('Policy created')
        setName('')
        setMatch('')
        void load()
      })
      .catch((e: unknown) => toast.error(formatUserError(e)))
  }

  return (
    <PageLayout hideHeader error={error}>
      <MacSectionTitle
        title="Runtime enforcement"
        subtitle="eBPF deny rules — process · DNS · port · IP via Tetragon TracingPolicy"
      />
      <Link to="/platform/zeus/security" className={`text-sm ${hubLinkClasses()}`}>← Security Center</Link>
      {loading && !status && <PageSkeleton />}

      {status && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MacStatWidget label="Mode" value={status.mode ?? 'observe'} icon={<ShieldBan className="w-4 h-4" />} />
          <MacStatWidget label="Active policies" value={String(status.policies_enabled ?? 0)} icon={<Shield className="w-4 h-4" />} />
          <MacStatWidget label="Applied hosts" value={String(status.applied_hosts?.length ?? 0)} icon={<Server className="w-4 h-4" />} />
          <MacStatWidget
            label="Blocked events"
            value={String(status.blocked_events ?? 0)}
            icon={<Ban className="w-4 h-4" />}
            tone={(status.blocked_events ?? 0) > 0 ? 'warn' : 'ok'}
          />
        </div>
      )}

      <MacGlassPanel title="Enforcement policies" subtitle={status?.summary}>
        {policies.length === 0 ? (
          <p className="text-sm text-slate-500 p-3">No policies yet.</p>
        ) : (
          policies.map((p) => (
            <MacListRow
              key={p.id}
              title={p.name}
              subtitle={`${p.kind} · ${p.match}${p.enabled === false ? ' · disabled' : ''}`}
              trailing={
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => applyToHost(String(p.id), 'h1')}
                >
                  Apply to h1
                </button>
              }
            />
          ))
        )}
      </MacGlassPanel>

      <MacGlassPanel title="Create policy" subtitle="Generates Tetragon TracingPolicy on apply">
        <div className="p-3 space-y-3">
          <input className="input text-sm w-full" placeholder="Policy name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <select className="input text-sm" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>{k.label}</option>
              ))}
            </select>
            <input
              className="input text-sm flex-1 min-w-[12rem]"
              placeholder="/usr/bin/nc · *.xyz · 4444/tcp · 10.0.0.0/8"
              value={match}
              onChange={(e) => setMatch(e.target.value)}
            />
            <button type="button" className="btn-primary text-sm" onClick={createPolicy}>Create</button>
          </div>
        </div>
      </MacGlassPanel>

      <MacGlassPanel title="Agent pull bundle" subtitle="machina-agent → GET /zeus-security/agents/{hostId}/bundle">
        <div className="p-3 flex flex-wrap gap-2 items-center">
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => void getAgentSecurityBundle('h1').then((b) => setAgentBundle(`${b.policy_count ?? 0} TracingPolicy(ies) queued for h1`)).catch((e: unknown) => setError(formatUserError(e)))}
          >
            Preview bundle (h1)
          </button>
          {agentBundle && <p className="text-sm text-slate-400">{agentBundle}</p>}
        </div>
      </MacGlassPanel>
    </PageLayout>
  )
}
