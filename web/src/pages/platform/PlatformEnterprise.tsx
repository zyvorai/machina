// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Key, Lock, Shield, Users } from 'lucide-react'
import ErrorBanner from '../../components/ErrorBanner'
import DetailTabs from '../../components/platform/DetailTabs'
import { MacGlassPanel, MacListRow, MacStatWidget } from '../../components/platform/mac/PlatformMacUi'
import PlatformPageChrome, { PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { usePlatformTabState } from '../../hooks/usePlatformTabState'
import {
  getEnterpriseSecurityOverview,
  getFipsMatrix,
  getFleetKeychain,
  getMfaCompliance,
  getTenantIsolationOverview,
  listVaultProviders,
  syncAllVaultProviders,
  syncVaultProvider,
  type EnterpriseSecurityOverview,
  type FipsMatrix,
  type FleetKeychainOverview,
  type MfaComplianceReport,
  type TenantIsolationOverview,
  type VaultProvider,
} from '../../api/platform'
import { formatUserError } from '../../utils/apiError'
import {hostStateTone, httpStatusTone, migrationReadinessTone, riskTone, statusBadgeClasses, statusPillClasses, statusToneClass, taskStatusTone, webhookDeliveryTone, hubLinkClasses} from '../../utils/semanticColors'
import { useToastContext } from '../../contexts/ToastContext'

type TabId = 'keychain' | 'vault' | 'mfa' | 'fips' | 'tenants'

const ENTERPRISE_TABS = [
  { id: 'keychain' as const, label: 'Keychain' },
  { id: 'vault' as const, label: 'Vault sync' },
  { id: 'mfa' as const, label: 'MFA compliance' },
  { id: 'fips' as const, label: 'FIPS matrix' },
  { id: 'tenants' as const, label: 'Tenant isolation' },
]

const KIND_LABELS: Record<string, string> = {
  vault: 'Vault',
  mfa: 'MFA',
  air_gap: 'Air-gap',
  api_key: 'API key',
}

function entryHref(kind: string): string | undefined {
  if (kind === 'vault') return '/platform/enterprise?tab=vault'
  if (kind === 'mfa') return '/platform/enterprise?tab=mfa'
  if (kind === 'air_gap') return '/platform/settings?section=security'
  if (kind === 'api_key') return '/platform/api-keys'
  return undefined
}

export default function PlatformEnterprise({ embedded }: { embedded?: boolean } = {}) {
  const toast = useToastContext()
  const [tab, setTab] = usePlatformTabState<TabId>(ENTERPRISE_TABS.map((t) => t.id), { defaultTab: 'keychain' })
  const activeTab: TabId = embedded ? 'keychain' : tab

  const [keychain, setKeychain] = useState<FleetKeychainOverview | null>(null)
  const [overview, setOverview] = useState<EnterpriseSecurityOverview | null>(null)
  const [vaults, setVaults] = useState<VaultProvider[]>([])
  const [mfa, setMfa] = useState<MfaComplianceReport | null>(null)
  const [fips, setFips] = useState<FipsMatrix | null>(null)
  const [tenants, setTenants] = useState<TenantIsolationOverview | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      if (activeTab === 'keychain') {
        setKeychain(await getFleetKeychain())
        return
      }
      const [ov, v, m, f, t] = await Promise.all([
        getEnterpriseSecurityOverview(),
        listVaultProviders(),
        getMfaCompliance(),
        getFipsMatrix(),
        getTenantIsolationOverview(),
      ])
      setOverview(ov)
      setVaults(v)
      setMfa(m)
      setFips(f)
      setTenants(t)
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [activeTab])

  useEffect(() => { void load() }, [load])

  const syncAll = async () => {
    setActionError(null)
    setSyncBusy(true)
    try {
      const r = await syncAllVaultProviders()
      toast.success(r.summary)
      await load()
    } catch (e: unknown) {
      setActionError(formatUserError(e))
    } finally {
      setSyncBusy(false)
    }
  }

  const syncOne = async (id: string) => {
    setActionError(null)
    try {
      const r = await syncVaultProvider(id)
      toast.success(`${r.provider_name}: ${r.message}`)
      await load()
    } catch (e: unknown) {
      setActionError(formatUserError(e))
    }
  }

  return (
    <PlatformPageChrome
      hideHeader={embedded}
      compact={embedded}
      error={error}
      onErrorRetry={() => void load()}
      title={embedded ? undefined : 'Enterprise Security'}
      subtitle={embedded ? undefined : 'Secrets inventory and link-out — vault, MFA, API keys, air-gap bundles (no live secret export).'}
      icon={embedded ? undefined : <Lock className="w-6 h-6 text-slate-400" />}
      actions={embedded ? undefined : <PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      {actionError && <ErrorBanner message={actionError} />}
      {(keychain?.summary || overview?.summary) && activeTab !== 'keychain' && (
        <p className="text-sm text-slate-400">{overview?.summary}</p>
      )}
      {activeTab === 'keychain' && keychain && (
        <p className="text-sm text-slate-400">{keychain.summary}</p>
      )}
      {activeTab === 'keychain' && keychain && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MacStatWidget label="Vault connected" value={`${keychain.vault_connected}/${keychain.vault_providers}`} icon={<Lock className="w-4 h-4" />} tone={keychain.disconnected_vaults > 0 ? 'warn' : 'ok'} />
          <MacStatWidget label="MFA enrolled" value={String(keychain.mfa_enrolled_users)} icon={<Shield className="w-4 h-4" />} />
          <MacStatWidget label="API keys" value={String(keychain.api_keys)} icon={<Key className="w-4 h-4" />} />
          <MacStatWidget label="Air-gap bundles" value={String(keychain.air_gap_bundles)} icon={<Users className="w-4 h-4" />} />
        </div>
      )}
      {activeTab !== 'keychain' && (
        <div className="grid gap-4 sm:grid-cols-3">
          <MacStatWidget label="Vault connected" value={overview ? `${overview.vault_connected}/${overview.vault_providers}` : '—'} icon={<Lock className="w-4 h-4" />} />
          <MacStatWidget label="MFA enrolled" value={overview ? String(overview.mfa_enrolled_users) : '—'} icon={<Shield className="w-4 h-4" />} />
          <MacStatWidget label="Tenant policies" value={overview ? String(overview.tenant_policies) : '—'} icon={<Users className="w-4 h-4" />} />
        </div>
      )}
      {!embedded && <DetailTabs primary={ENTERPRISE_TABS} active={tab} onChange={setTab} />}

      {activeTab === 'keychain' && (
        <MacGlassPanel title="Secrets inventory" subtitle="Metadata only — manage credentials in linked panes.">
          {!keychain ? (
            <p className="text-sm text-slate-400 py-6 text-center">Loading keychain inventory…</p>
          ) : keychain.entries.length === 0 ? (
            <p className="text-sm text-slate-400">No credentials registered — add vault providers or API keys in Settings.</p>
          ) : (
            <div className="divide-y divide-white/[0.04] -mx-1">
              {keychain.entries.map((e) => (
                <MacListRow
                  key={`${e.kind}-${e.id}`}
                  title={e.name}
                  subtitle={e.summary}
                  href={entryHref(e.kind)}
                  badge={
                    <span className="text-[10px] uppercase px-2 py-0.5 rounded border border-white/[0.08] text-slate-400">
                      {KIND_LABELS[e.kind] ?? e.kind}
                    </span>
                  }
                  trailing={
                    <span className={`text-[10px] ${
                      e.status === 'active' || e.status === 'required'
                        ? statusToneClass('ok')
                        : e.status === 'disconnected'
                          ? statusToneClass('warn')
                          : 'text-slate-500'
                    }`}>
                      {e.status}
                    </span>
                  }
                />
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-3 mt-4 pt-2 border-t border-white/[0.04]">
            <Link to="/platform/settings?section=security" className={`text-sm ${hubLinkClasses()}`}>System Settings → Security</Link>
            <Link to="/platform/api-keys" className={`text-sm ${hubLinkClasses()}`}>API keys</Link>
            <Link to="/platform/enterprise?tab=vault" className={`text-sm ${hubLinkClasses()}`}>Vault sync</Link>
          </div>
        </MacGlassPanel>
      )}

      {activeTab === 'vault' && (
        <MacGlassPanel title="Vault providers" action={
          <button type="button" className={`text-xs ${hubLinkClasses()}`} disabled={syncBusy} onClick={() => void syncAll()}>
            {syncBusy ? 'Syncing…' : 'Sync all'}
          </button>
        }>
          <ul className="space-y-2">
            {vaults.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 border border-slate-700/60 rounded-lg p-3">
                <div>
                  <p className="text-sm text-slate-200">{v.name}</p>
                  <p className="text-xs text-slate-500">{v.provider_type} · {v.status}{v.last_sync_at ? ` · synced ${v.last_sync_at}` : ''}</p>
                </div>
                <button type="button" className={`text-xs ${hubLinkClasses()}`} onClick={() => void syncOne(v.id)}>Sync</button>
              </li>
            ))}
          </ul>
        </MacGlassPanel>
      )}

      {activeTab === 'mfa' && mfa && (
        <MacGlassPanel title="MFA compliance">
          <p className="text-sm text-slate-400 mb-3">{mfa.summary}</p>
          {mfa.users.length === 0 ? (
            <p className="text-sm text-slate-500">No roles require MFA yet — enable in Settings → Security.</p>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 border-b border-slate-700">
                <tr>
                  <th className="py-2 pr-4">User</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Method</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {mfa.users.map((u) => (
                  <tr key={u.username} className="border-b border-slate-800/60">
                    <td className="py-2 pr-4 text-slate-200">{u.username}</td>
                    <td className="py-2 pr-4 text-slate-400">{u.role}</td>
                    <td className="py-2 pr-4 text-slate-400">{u.required_method}</td>
                    <td className={`py-2 text-xs ${statusToneClass(u.compliant ? 'ok' : 'warn')}`}>
                      {u.compliant ? 'compliant' : 'needs enrollment'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </MacGlassPanel>
      )}

      {activeTab === 'fips' && fips && (
        <MacGlassPanel title="FIPS crypto matrix">
          <p className="text-sm text-slate-400 mb-2">{fips.summary}</p>
          <p className="text-xs text-slate-500 mb-4">Runtime: {fips.openssl_version}</p>
          <ul className="space-y-3">
            {fips.profiles.map((p) => (
              <li key={p.id} className="rounded-lg border border-slate-700/60 p-3">
                <p className="text-sm font-medium text-slate-200">{p.name}</p>
                <p className="text-xs text-slate-500 mt-1">TLS {p.tls_min_version} · FIPS {p.fips_mode}</p>
                <p className="text-xs text-slate-500">{p.cipher_suites}</p>
                <p className="text-xs text-slate-600 mt-1">{p.notes}</p>
              </li>
            ))}
          </ul>
        </MacGlassPanel>
      )}

      {activeTab === 'tenants' && tenants && (
        <MacGlassPanel title="Workspace isolation">
          <p className="text-sm text-slate-400 mb-3">{tenants.summary}</p>
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 border-b border-slate-700">
              <tr>
                <th className="py-2 pr-4">Project</th>
                <th className="py-2 pr-4">VMs</th>
                <th className="py-2 pr-4">Network</th>
                <th className="py-2 pr-4">Quotas</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {tenants.projects.map((p) => (
                <tr key={p.project_name} className="border-b border-slate-800/60">
                  <td className="py-2 pr-4 text-slate-200">{p.project_name}</td>
                  <td className="py-2 pr-4 text-slate-400">{p.vm_count}{p.max_vms > 0 ? ` / ${p.max_vms}` : ''}</td>
                  <td className="py-2 pr-4 text-slate-400">{p.network_isolation}</td>
                  <td className="py-2 pr-4 text-slate-400">{p.enforce_quotas ? 'enforced' : 'off'}</td>
                  <td className={`py-2 text-xs ${statusToneClass(p.quota_status.includes('exceeded') ? 'error' : 'ok')}`}>{p.quota_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </MacGlassPanel>
      )}
    </PlatformPageChrome>
  )
}
