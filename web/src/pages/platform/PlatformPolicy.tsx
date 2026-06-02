// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Shield } from 'lucide-react'
import PageLayout from '../../components/PageLayout'
import FleetSettingsPane from '../../components/platform/FleetSettingsPane'
import { MacGlassPanel, MacListRow, MacSectionTitle } from '../../components/platform/mac/PlatformMacUi'
import { listPolicyRules, listProjectQuotas, upsertProjectQuota, type PolicyRule } from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'

export default function PlatformPolicy({ embedded }: { embedded?: boolean } = {}) {
  const toast = useToastContext()
  const [rules, setRules] = useState<PolicyRule[]>([])
  const [quotas, setQuotas] = useState<Awaited<ReturnType<typeof listProjectQuotas>>>([])
  const [error, setError] = useState<string | null>(null)
  const [project, setProject] = useState('default')
  const [maxVms, setMaxVms] = useState(50)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [r, q] = await Promise.all([listPolicyRules(), listProjectQuotas()])
      setRules(r)
      setQuotas(q)
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const saveQuota = async () => {
    try {
      await upsertProjectQuota({
        project,
        max_vms: maxVms,
        max_vcpu: maxVms * 4,
        max_memory_mib: maxVms * 8192,
        max_storage_gib: maxVms * 100,
      })
      toast.success('Quota saved')
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  return (
    <PageLayout hideHeader compact={embedded} error={error}>
      {!embedded && <MacSectionTitle title="Policy & Quotas" subtitle="Controller policy rules and per-project resource limits." />}
      <MacGlassPanel title="Policy rules">
        {rules.length === 0 ? (
          <p className="text-sm text-slate-400">No policy rules configured.</p>
        ) : (
          <ul className="divide-y divide-white/[0.04] -mx-1">
            {rules.map((r) => (
              <MacListRow
                key={r.id}
                title={r.name}
                subtitle={r.enabled ? 'Enabled' : 'Disabled'}
                badge={<Shield className="w-4 h-4 text-orange-400" />}
              />
            ))}
          </ul>
        )}
      </MacGlassPanel>
      <MacGlassPanel title="Project quotas">
        <div className="grid gap-3 sm:grid-cols-3 max-w-xl mb-4">
          <label className="block text-xs text-slate-500">
            Project
            <input className="input text-sm mt-1 w-full" value={project} onChange={(e) => setProject(e.target.value)} />
          </label>
          <label className="block text-xs text-slate-500">
            Max VMs
            <input type="number" className="input text-sm mt-1 w-full" value={maxVms} onChange={(e) => setMaxVms(Number(e.target.value))} />
          </label>
          <div className="flex items-end">
            <button type="button" className="btn-primary text-sm w-full" onClick={() => void saveQuota()}>Save quota</button>
          </div>
        </div>
        <ul className="divide-y divide-white/[0.04] -mx-1">
          {quotas.map((q) => (
            <MacListRow
              key={q.project}
              title={q.project}
              subtitle={`${q.max_vms} VMs · ${q.max_vcpu} vCPU · ${Math.round(q.max_memory_mib / 1024)} GiB RAM`}
            />
          ))}
        </ul>
      </MacGlassPanel>
      {!embedded && <FleetSettingsPane kind="general" />}
    </PageLayout>
  )
}
