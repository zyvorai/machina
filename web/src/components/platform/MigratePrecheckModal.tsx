// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useEffect, useState } from 'react'
import { migratePrecheck, vmMigrate, type MigratePrecheckResult, type PlatformVm } from '../../api/platform'
import { statusToneClass } from '../../utils/semanticColors'

interface MigratePrecheckModalProps {
  vm: PlatformVm
  destHostId: string
  destHostName: string
  onClose: () => void
  onDone: (taskId?: string) => void
}

export default function MigratePrecheckModal({ vm, destHostId, destHostName, onClose, onDone }: MigratePrecheckModalProps) {
  const [precheck, setPrecheck] = useState<MigratePrecheckResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setPrecheck(await migratePrecheck(vm.id, destHostId))
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Pre-check failed')
      }
    })()
  }, [vm.id, destHostId])

  const migrate = async () => {
    setBusy(true)
    try {
      const r = await vmMigrate(vm.id, { dest_host_id: destHostId })
      onDone(r.task_id)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Migration failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl" role="dialog" aria-modal="true" aria-label="Migrate precheck" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-800">
          <h2 className="text-lg font-semibold">Live migrate {vm.name}</h2>
          <p className="text-sm text-slate-400 mt-1">Target host: {destHostName}</p>
        </div>
        <div className="p-5 space-y-3 text-sm">
          {error && <p className={statusToneClass('error')}>{error}</p>}
          {!precheck && !error && <p className="text-slate-400">Running pre-checks…</p>}
          {precheck && (
            <>
              <p className={precheck.ok ? statusToneClass('ok') : statusToneClass('warn')}>
                {precheck.ok ? 'Ready to migrate with minimal downtime (<2s expected)' : 'Some checks failed — review before continuing'}
              </p>
              <ul className="space-y-2 text-xs">
                {precheck.checks.map((c) => (
                  <li key={c.name} className={c.passed ? statusToneClass('ok') : statusToneClass('error')}>
                    {c.name}: {c.message}
                    {c.remediation && !c.passed && <p className="text-slate-500 mt-0.5">→ {c.remediation}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="p-5 border-t border-slate-800 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy || !precheck} onClick={() => void migrate()}>
            {busy ? 'Starting…' : 'Start migration'}
          </button>
        </div>
      </div>
    </div>
  )
}
