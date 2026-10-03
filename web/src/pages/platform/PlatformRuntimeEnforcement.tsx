// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useSearchParams } from 'react-router'
import { Eye, Shield, Trash2 } from 'lucide-react'
import ConfirmDialog from '../../components/ConfirmDialog'
import {
  MacGlassPanel,
  MacListRow,
  MacSheet,
} from '../../components/platform/mac/PlatformMacUi'
import PlatformPageChrome, { PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import TerminalFrame from '../../components/TerminalFrame'
import { renderHighlightedJson } from '../../utils/terminalHighlight'
import { useExpandable } from '../../hooks/useExpandable'
import { ExpandableToggle } from '../../components/ui/ExpandableToggle'
import {
  applyEnforcementPolicy,
  attachEnforcement,
  createEnforcementPolicy,
  deleteEnforcementPolicy,
  detachEnforcement,
  getAgentSecurityBundle,
  getEnforcementPolicies,
  getEnforcementPolicyTetragon,
  getEnforcementStatus,
  patchEnforcementPolicy,
  syncEnforcement,
  type EnforcementPolicy,
  type EnforcementStatus,
} from '../../api/zeusSecurity'
import { listPlatformHosts, type PlatformHost } from '../../api/platform'
import { formatUserError } from '../../utils/apiError'
import { useToastContext } from '../../contexts/ToastContext'
import { usePlatformDesktopTier } from '../../hooks/usePlatformDesktopTier'
import { hubLinkClasses } from '../../utils/semanticColors'
import { toastQueuedOperation } from '../../utils/platformTaskToast'

const KINDS = [
  { id: 'deny_process', label: 'Deny process', hint: '/usr/bin/nc' },
  { id: 'deny_dns', label: 'Deny DNS', hint: '*.xyz' },
  { id: 'deny_port', label: 'Deny port', hint: '4444/tcp' },
  { id: 'deny_ip', label: 'Deny IP/CIDR', hint: '10.0.0.0/8' },
  { id: 'deny_file', label: 'Deny file', hint: '/etc/shadow' },
  { id: 'deny_cap', label: 'Deny capability', hint: 'CAP_NET_RAW' },
  { id: 'deny_namespace', label: 'Deny K8s namespace', hint: 'kube-system' },
  { id: 'tc_allow', label: 'TC egress allow', hint: '8.8.8.8:53/udp' },
] as const

function matchPlaceholder(kind: string): string {
  return KINDS.find((k) => k.id === kind)?.hint ?? '/usr/bin/nc · *.xyz · 4444/tcp'
}

export default function PlatformRuntimeEnforcement() {
  const toast = useToastContext()
  const [tier] = usePlatformDesktopTier()
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<EnforcementStatus | null>(null)
  const [policies, setPolicies] = useState<EnforcementPolicy[]>([])
  const policyList = useExpandable(policies, 30)
  const [hosts, setHosts] = useState<PlatformHost[]>([])
  const [selectedHosts, setSelectedHosts] = useState<string[]>([])
  const [name, setName] = useState(searchParams.get('name') ?? '')
  const [kind, setKind] = useState(searchParams.get('kind') ?? 'deny_process')
  const [match, setMatch] = useState(searchParams.get('match') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [agentBundle, setAgentBundle] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewYaml, setPreviewYaml] = useState('')
  const [previewTitle, setPreviewTitle] = useState('')
  const [confirmDeletePolicyId, setConfirmDeletePolicyId] = useState<string | null>(null)

  const onlineHosts = useMemo(
    () => hosts.filter((h) => h.state === 'online'),
    [hosts],
  )

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [st, pol, hostList] = await Promise.all([
        getEnforcementStatus(),
        getEnforcementPolicies(),
        listPlatformHosts().catch(() => [] as PlatformHost[]),
      ])
      setStatus(st)
      setPolicies(pol.policies ?? [])
      setHosts(hostList)
      const online = hostList.filter((h) => h.state === 'online')
      setSelectedHosts((prev) => (prev.length > 0 ? prev : online.slice(0, 1).map((h) => h.id)))
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggleHost = (hostId: string) => {
    setSelectedHosts((prev) =>
      prev.includes(hostId) ? prev.filter((id) => id !== hostId) : [...prev, hostId],
    )
  }

  const notifyTasks = (summary: string, taskIds?: string[]) => {
    if (taskIds?.length) {
      toastQueuedOperation(toast, summary, taskIds[0], tier)
    } else {
      toast.success(summary)
    }
  }

  const applyToSelected = (policyId: string) => {
    if (selectedHosts.length === 0) {
      toast.error('Select at least one online host')
      return
    }
    void applyEnforcementPolicy(policyId, selectedHosts)
      .then((r) => {
        notifyTasks(r.summary, r.task_ids)
        void load()
      })
      .catch((e: unknown) => toast.error(formatUserError(e)))
  }

  const applyFleetPolicies = () => {
    const fleet = policies.filter((p) => p.enabled !== false && (p.scope === 'fleet' || !p.scope))
    if (fleet.length === 0 || selectedHosts.length === 0) return
    void Promise.all(fleet.map((p) => (p.id ? applyEnforcementPolicy(p.id, selectedHosts) : Promise.resolve())))
      .then(() => {
        toast.success(`Fleet apply queued for ${fleet.length} policy(ies) on ${selectedHosts.length} host(s)`)
        void load()
      })
      .catch((e: unknown) => toast.error(formatUserError(e)))
  }

  const togglePolicy = (p: EnforcementPolicy) => {
    if (!p.id) return
    void patchEnforcementPolicy(p.id, { enabled: p.enabled === false })
      .then((r) => {
        // A Netra-backed deny_ip toggle Netra itself rejects (unreachable, etc.)
        // comes back as 200 + {ok: false, error} — the live rule state didn't
        // actually change, so this must not show a success toast.
        if (r.ok === false) {
          toast.error(r.error ?? 'Policy was not updated')
          return
        }
        notifyTasks(r.summary ?? (p.enabled === false ? 'Policy enabled' : 'Policy disabled'), r.task_ids)
        void load()
      })
      .catch((e: unknown) => toast.error(formatUserError(e)))
  }

  const removePolicy = (policyId: string) => {
    setConfirmDeletePolicyId(policyId)
  }

  const doDeletePolicy = (policyId: string) => {
    setConfirmDeletePolicyId(null)
    void deleteEnforcementPolicy(policyId)
      .then((r) => {
        if (r.ok === false) {
          toast.error(r.error ?? 'Policy was not deleted — it may still be live')
          return
        }
        notifyTasks(r.summary ?? 'Policy deleted', r.task_ids)
        void load()
      })
      .catch((e: unknown) => toast.error(formatUserError(e)))
  }

  const previewTetragon = (policyId: string, policyName: string) => {
    void getEnforcementPolicyTetragon(policyId)
      .then((r) => {
        setPreviewTitle(policyName)
        setPreviewYaml(JSON.stringify(r.tetragon_policy ?? r, null, 2))
        setPreviewOpen(true)
      })
      .catch((e: unknown) => toast.error(formatUserError(e)))
  }

  const createPolicy = () => {
    if (!name.trim() || !match.trim()) return
    void createEnforcementPolicy({ name: name.trim(), kind, match: match.trim() })
      .then((r) => {
        // A malformed tc_allow/allow_port rule (e.g. missing destination IP) is rejected with a
        // 200 + {ok: false, error}, not an HTTP error — nothing was actually created.
        if (r.ok === false || !r.policy) {
          toast.error(r.error ?? 'Policy was not created')
          return
        }
        toast.success('Policy created')
        setName('')
        setMatch('')
        void load()
      })
      .catch((e: unknown) => toast.error(formatUserError(e)))
  }

  const previewBundle = () => {
    const hostId = selectedHosts[0]
    if (!hostId) {
      toast.error('Select a host to preview bundle')
      return
    }
    void getAgentSecurityBundle(hostId)
      .then((b) => {
        const removed = (b as { removed_policies?: string[] }).removed_policies?.length ?? 0
        setAgentBundle(
          `${b.policy_count ?? 0} TracingPolicy(ies)${removed > 0 ? ` · ${removed} removal(s)` : ''} for ${hostId}`,
        )
      })
      .catch((e: unknown) => setError(formatUserError(e)))
  }

  return (
    <PlatformPageChrome
      eyebrow="Platform"
      error={error}
      onErrorRetry={() => void load()}
      prepend={<Link to="/platform/zeus/security" className={`text-sm inline-flex items-center gap-1 ${hubLinkClasses()}`}>← Security Center</Link>}
      title="Runtime enforcement"
      subtitle="eBPF deny rules — process · DNS · port · IP · file · cap · namespace via Tetragon TracingPolicy"
      icon={<Shield className="w-6 h-6 text-[var(--text-muted)]" />}
      actions={
        <div className="flex items-center gap-2">
          <button type="button" className="btn-primary text-sm" onClick={createPolicy}>
            Create policy
          </button>
          <PlatformRefreshButton onClick={() => void load()} />
        </div>
      }
      contentLoading={loading && !status}
      contentClassName="space-y-4"
    >
      {status && (
        <div className="apple-metric-band">
          {[
            { label: 'Mode', value: status.mode ?? 'observe' },
            { label: 'Active policies', value: String(status.policies_enabled ?? 0) },
            { label: 'Applied hosts', value: String(status.applied_hosts?.length ?? 0) },
            { label: 'Blocked events', value: String(status.blocked_events ?? 0) },
          ].map((s) => (
            <div key={s.label} className="min-w-0">
              <div className="apple-metric-value">{s.value}</div>
              <div className="apple-metric-label">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {status?.api_mode === 'production_tc' && (
        <MacGlassPanel title="PacketWolf TC enforcement" subtitle={status.summary}>
          <div className="p-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => void syncEnforcement().then((r) => {
                if (r.ok === false) { toast.error(r.note ?? 'BPF map sync did not apply'); return }
                toast.success('BPF map synced')
                void load()
              }).catch((e: unknown) => toast.error(formatUserError(e)))}
            >
              Sync BPF map
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => void attachEnforcement().then((r) => {
                if (r.ok === false || r.attached === false) { toast.error(r.note ?? 'TC enforcement did not attach'); return }
                toast.success('TC enforcement attached')
                void load()
              }).catch((e: unknown) => toast.error(formatUserError(e)))}
            >
              Attach
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => void detachEnforcement().then((r) => {
                // Unlike attach, a successful detach IS attached:false — only ok:false (mode
                // gating / unreachable fabric) means the call didn't actually apply.
                if (r.ok === false) { toast.error(r.note ?? 'TC enforcement did not detach'); return }
                toast.success('TC enforcement detached')
                void load()
              }).catch((e: unknown) => toast.error(formatUserError(e)))}
            >
              Detach
            </button>
            {status.attached != null && (
              <span className="text-xs text-[var(--text-muted)] self-center">
                BPF {status.attached ? 'attached' : 'detached'}
                {status.default_deny ? ' · defaultDeny' : ''}
              </span>
            )}
          </div>
        </MacGlassPanel>
      )}

      {status?.api_mode === 'netra' && (
        <MacGlassPanel title="Netra eBPF enforcement" subtitle={status.summary}>
          <div className="p-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => void syncEnforcement().then((r) => {
                if (r.ok === false) { toast.error(r.note ?? 'Netra sync did not apply'); return }
                toast.success(r.note ?? 'Netra config refreshed')
                void load()
              }).catch((e: unknown) => toast.error(formatUserError(e)))}
            >
              Sync
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => void attachEnforcement().then((r) => {
                if (r.ok === false || r.attached === false) { toast.error(r.note ?? 'Netra did not switch to enforce'); return }
                toast.success(r.note ?? 'Netra enforce lease active')
                void load()
              }).catch((e: unknown) => toast.error(formatUserError(e)))}
            >
              Enforce
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => void detachEnforcement().then((r) => {
                if (r.ok === false) { toast.error(r.note ?? 'Netra did not revert to observe'); return }
                toast.success(r.note ?? 'Netra reverted to observe')
                void load()
              }).catch((e: unknown) => toast.error(formatUserError(e)))}
            >
              Observe (fail-open)
            </button>
            <span className="text-xs text-[var(--text-muted)] self-center">
              {status.reachable ? 'netrad reachable' : 'netrad unreachable'}
            </span>
          </div>
        </MacGlassPanel>
      )}

      <MacGlassPanel title="Target hosts" subtitle="Online hosts only — select targets for apply">
        {onlineHosts.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] p-3">No online hosts. Enroll agents first.</p>
        ) : (
          <div className="p-3 flex flex-wrap gap-2">
            {onlineHosts.map((h) => (
              <label key={h.id} className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedHosts.includes(h.id)}
                  onChange={() => toggleHost(h.id)}
                />
                {h.hostname || h.id}
              </label>
            ))}
          </div>
        )}
        <div className="px-3 pb-3">
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={policies.length === 0 || selectedHosts.length === 0}
            onClick={applyFleetPolicies}
          >
            Fleet apply all (scope: fleet)
          </button>
        </div>
      </MacGlassPanel>

      <MacGlassPanel title="Enforcement policies" subtitle={status?.summary}>
        {policies.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] p-3">No policies yet.</p>
        ) : (
          <div id={policyList.listId}>
          {policyList.shown.map((p) => (
            <MacListRow
              key={p.id}
              title={p.name}
              subtitle={`${p.kind} · ${p.match}${p.enabled === false ? ' · disabled' : ''}${p.scope ? ` · ${p.scope}` : ''}${p.backend ? ` · ${p.backend}` : ''}`}
              trailing={
                <div className="flex flex-wrap gap-1 justify-end">
                  <button type="button" className="btn-secondary text-xs" onClick={() => p.id && applyToSelected(p.id)}>
                    Apply
                  </button>
                  <button type="button" className="btn-secondary text-xs" onClick={() => togglePolicy(p)}>
                    {p.enabled === false ? 'Enable' : 'Disable'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs inline-flex items-center gap-1"
                    onClick={() => p.id && previewTetragon(p.id, p.name)}
                  >
                    <Eye className="w-3 h-3" /> Preview
                  </button>
                  <button
                    type="button"
                    aria-label="Delete"
                    className="btn-secondary text-xs text-red-600"
                    onClick={() => p.id && removePolicy(p.id)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              }
            />
          ))}
          </div>
        )}
        {policyList.showToggle && (
          <div className="p-3 pt-0">
            <ExpandableToggle expanded={policyList.expanded} hidden={policyList.hidden} listId={policyList.listId} onToggle={policyList.toggle} noun="policies" />
          </div>
        )}
      </MacGlassPanel>

      <MacGlassPanel title="Create policy" subtitle="Generates Tetragon TracingPolicy on apply">
        <div className="p-3 space-y-3">
          <input className="input text-sm w-full" aria-label="Policy name" placeholder="Policy name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <select className="input text-sm" aria-label="Policy kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>{k.label}</option>
              ))}
            </select>
            <input
              className="input text-sm flex-1 min-w-[12rem]"
              aria-label="Match pattern"
              placeholder={matchPlaceholder(kind)}
              value={match}
              onChange={(e) => setMatch(e.target.value)}
            />
            <button type="button" className="btn-primary text-sm" onClick={createPolicy}>Create</button>
          </div>
        </div>
      </MacGlassPanel>

      <MacGlassPanel title="Agent pull bundle" subtitle="machina-agent → GET /zeus-security/agents/{hostId}/bundle">
        <div className="p-3 flex flex-wrap gap-2 items-center">
          <button type="button" className="btn-secondary text-sm" onClick={previewBundle}>
            Preview bundle ({selectedHosts[0] ?? 'select host'})
          </button>
          {agentBundle && <p className="text-sm text-[var(--text-muted)]">{agentBundle}</p>}
        </div>
      </MacGlassPanel>

      <MacSheet
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="TracingPolicy preview"
        subtitle={previewTitle}
        wide
      >
        <TerminalFrame label={`${previewTitle || 'policy'}.json`} maxHeight="max-h-[60vh]">
          {renderHighlightedJson(previewYaml)}
        </TerminalFrame>
      </MacSheet>
      <ConfirmDialog
        open={confirmDeletePolicyId !== null}
        title="Delete Enforcement Policy"
        message="Delete this enforcement policy? Agents will remove the TracingPolicy on next sync."
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => setConfirmDeletePolicyId(null)}
        onConfirm={() => { if (confirmDeletePolicyId) doDeletePolicy(confirmDeletePolicyId) }}
      />
    </PlatformPageChrome>
  )
}
