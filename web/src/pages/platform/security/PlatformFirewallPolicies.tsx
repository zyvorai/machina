// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, RefreshCw, Shield } from 'lucide-react'
import PageLayout from '../../../components/PageLayout'
import { MacGlassPanel, MacListRow, MacSheet } from '../../../components/platform/mac/PlatformMacUi'
import {
  createFirewallPolicy,
  getMultisiteDrTemplates,
  getMultisiteExport,
  listFirewallPolicies,
  simulateFirewallPolicy,
  type FirewallPolicyRow,
} from '../../../api/zeusFirewall'
import JsonInspector from '../../../components/platform/JsonInspector'
import { useToastContext } from '../../../contexts/ToastContext'
import { formatUserError } from '../../../utils/apiError'
import { hubLinkClasses } from '../../../utils/semanticColors'

export default function PlatformFirewallPolicies() {
  const toast = useToastContext()
  const [rows, setRows] = useState<FirewallPolicyRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('production-default')
  const [profile, setProfile] = useState('ProductionServer')
  const [specYaml, setSpecYaml] = useState('profile: ProductionServer\n')
  const [simResult, setSimResult] = useState<Record<string, unknown> | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [drTemplates, setDrTemplates] = useState<Awaited<ReturnType<typeof getMultisiteDrTemplates>> | null>(null)
  const [multisiteExport, setMultisiteExport] = useState<Record<string, unknown> | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setRows(await listFirewallPolicies())
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    void getMultisiteDrTemplates().then(setDrTemplates).catch(() => setDrTemplates(null))
  }, [])

  const exportMultisite = async () => {
    try {
      const data = await getMultisiteExport()
      setMultisiteExport(data)
      toast.success('Multisite export ready')
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  const create = async () => {
    try {
      await createFirewallPolicy({ name, profile, spec_yaml: specYaml, enabled: true })
      toast.success('Policy created')
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  const simulate = async () => {
    try {
      const r = await simulateFirewallPolicy({ name, profile, spec_yaml: specYaml })
      setSimResult(r as Record<string, unknown>)
      setSheetOpen(true)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  return (
    <PageLayout
      compact
      error={error}
      prepend={
        <Link to="/platform/zeus/security/firewall" className={`text-sm inline-flex items-center gap-1 ${hubLinkClasses()}`}>
          <ArrowLeft className="w-4 h-4" /> Firewall
        </Link>
      }
      title="Policy Studio"
      subtitle={`${rows.length} polic${rows.length === 1 ? 'y' : 'ies'} · create, simulate, and manage Zeus firewall policies`}
      icon={<Shield className="w-6 h-6 text-slate-400" />}
      actions={
        <button type="button" className="btn-secondary" onClick={() => void load()} aria-label="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      }
      contentClassName="space-y-4"
    >
      <MacGlassPanel title="New policy">
        <div className="grid gap-3 max-w-lg">
          <input className="input text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input text-sm" placeholder="Profile" value={profile} onChange={(e) => setProfile(e.target.value)} />
          <textarea className="input text-sm font-mono min-h-[8rem]" value={specYaml} onChange={(e) => setSpecYaml(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={() => void simulate()}>Simulate</button>
            <button type="button" className="btn-primary text-sm" onClick={() => void create()}>Create</button>
          </div>
        </div>
      </MacGlassPanel>
      <MacGlassPanel title="Policies">
        <ul className="divide-y divide-white/[0.04] -mx-1">
          {rows.map((p) => (
            <MacListRow key={p.id} title={p.name} subtitle={`${p.profile} · ${p.enabled ? 'enabled' : 'disabled'}`} />
          ))}
          {rows.length === 0 && <p className="text-sm text-slate-400 px-1">No policies yet.</p>}
        </ul>
      </MacGlassPanel>
      <MacGlassPanel title="Multi-site DR">
        {drTemplates ? (
          <p className="text-sm text-slate-400 mb-3">{drTemplates.summary}</p>
        ) : (
          <p className="text-sm text-slate-500 mb-3">Loading DR templates…</p>
        )}
        {drTemplates?.profiles?.length ? (
          <ul className="text-xs space-y-1 mb-3">
            {drTemplates.profiles.map((p) => (
              <li key={p.primary_profile} className="text-slate-300">{p.primary_profile} → {p.dr_profile}</li>
            ))}
          </ul>
        ) : null}
        <button type="button" className="btn-secondary text-sm" onClick={() => void exportMultisite()}>Export federation bundle</button>
        {multisiteExport ? <JsonInspector data={multisiteExport} className="mt-3" /> : null}
      </MacGlassPanel>
      <MacSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Simulation result" wide>
        {simResult ? <JsonInspector data={simResult} /> : <p className="text-sm text-slate-500">—</p>}
      </MacSheet>
    </PageLayout>
  )
}
