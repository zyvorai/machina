// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Lightbulb, Workflow } from 'lucide-react'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import RemediateChips from '../../components/platform/RemediateChips'
import { createVmBackup, listPlatformRecommendations, setVmHa, type PlatformRecommendation } from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'

export default function PlatformRecommendations() {
  const toast = useToastContext()
  const navigate = useNavigate()
  const [rows, setRows] = useState<PlatformRecommendation[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setRows(await listPlatformRecommendations())
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const execute = async (r: PlatformRecommendation) => {
    try {
      const vmIds = (r.object_ref?.vm_ids as string[] | undefined) ?? []
      if (r.fix_action === 'bulk_backup') {
        await Promise.all(vmIds.slice(0, 5).map((id) => createVmBackup(id)))
        toast.success('Backup tasks queued')
      } else if (r.fix_action === 'bulk_ha') {
        await Promise.all(vmIds.slice(0, 5).map((id) => setVmHa(id, { enabled: true })))
        toast.success('HA enabled on selected VMs')
      } else if (r.fix_action === 'open_hosts') {
        navigate('/platform/hosts')
      } else if (r.fix_action === 'open_vms') {
        navigate('/platform/vms')
      }
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load()}
      prepend={<PlatformBackLink to="/platform/operations" label="Operations" />}
      title="Recommendations"
      subtitle="Live analysis from your cluster — not static placeholders."
      icon={<Lightbulb className="w-6 h-6 text-slate-400" />}
      actions={<PlatformRefreshButton onClick={() => void load()} />}
      className="max-w-3xl"
      contentClassName="space-y-4"
    >
      <RemediateChips />
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.id} className="card p-5 space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{r.impact}</span>
            <h3 className="font-semibold text-lg">{r.title}</h3>
            <p className="text-sm text-slate-400"><strong className="text-slate-300">Why?</strong> {r.why}</p>
            <p className="text-xs text-slate-500">Risk: {r.risk}</p>
            <div className="flex gap-2 pt-2">
              <button type="button" className="btn-primary text-sm" onClick={() => void execute(r)}>{r.action}</button>
            </div>
          </li>
        ))}
        {rows.length === 0 && !error && (
          <PlatformEmptyState title="No recommendations" subtitle="Your estate looks good — check back after changes to hosts or VMs." />
        )}
      </ul>
    </PlatformPageChrome>
  )
}
