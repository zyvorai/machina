// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { CheckCircle2, Circle, Loader2, Sparkles, X } from 'lucide-react'
import {
  discoverPlatformNetworks,
  discoverStoragePools,
  getClusterSummary,
  listPlatformHosts,
  listPlatformVms,
  seedDefaultTemplates,
  syncAllHosts,
} from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { statusToneClass } from '../../utils/semanticColors'

const WELCOME_KEY = 'zyvor-platform-welcome-done'

type StepId = 'health' | 'hosts' | 'networks' | 'storage' | 'templates' | 'integrations' | 'vm'

const STEPS: { id: StepId; label: string; hint: string }[] = [
  { id: 'health', label: 'Check cluster health', hint: 'Verify controller and cluster summary' },
  { id: 'hosts', label: 'Sync hosts', hint: 'Refresh hypervisor inventory' },
  { id: 'networks', label: 'Import networks', hint: 'Pull libvirt networks from online hosts' },
  { id: 'storage', label: 'Import storage', hint: 'Discover storage pools from libvirt' },
  { id: 'templates', label: 'Seed templates', hint: 'Load the default App Store catalog' },
  { id: 'integrations', label: 'Explore Apps & Integrations', hint: 'OpenStack, K8s, HyperSDK, and classic tools' },
  { id: 'vm', label: 'Create your first VM', hint: 'Optional — launch the VM wizard when ready' },
]

export function isWelcomeDismissed(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissWelcome() {
  try {
    localStorage.setItem(WELCOME_KEY, '1')
  } catch { /* ignore */ }
}

export default function PlatformWelcome({
  vmCount,
  onCreateVm,
  onDone,
}: {
  vmCount: number
  onCreateVm: () => void
  onDone?: () => void
}) {
  const toast = useToastContext()
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState<StepId | null>(null)
  const [done, setDone] = useState<Record<StepId, boolean>>({
    health: false,
    hosts: false,
    networks: false,
    storage: false,
    templates: false,
    integrations: false,
    vm: false,
  })

  const checkFresh = useCallback(async () => {
    if (isWelcomeDismissed()) return
    try {
      const [hosts, vms] = await Promise.all([listPlatformHosts(), listPlatformVms()])
      const fresh = vms.length === 0 || hosts.length === 0
      if (fresh) setOpen(true)
    } catch {
      setOpen(true)
    }
  }, [])

  useEffect(() => { void checkFresh() }, [checkFresh])

  useEffect(() => {
    if (vmCount > 0) setDone((d) => ({ ...d, vm: true }))
  }, [vmCount])

  const runStep = async (id: StepId) => {
    setRunning(id)
    try {
      switch (id) {
        case 'health':
          await getClusterSummary()
          setDone((d) => ({ ...d, health: true }))
          break
        case 'hosts':
          await syncAllHosts()
          setDone((d) => ({ ...d, hosts: true }))
          toast.success('Host sync queued')
          break
        case 'networks': {
          const r = await discoverPlatformNetworks()
          setDone((d) => ({ ...d, networks: true }))
          toast.success(r.networks.length ? `Imported ${r.networks.length} network(s)` : 'Networks step complete')
          break
        }
        case 'storage': {
          const r = await discoverStoragePools()
          setDone((d) => ({ ...d, storage: true }))
          toast.success(r.pools.length ? `Imported ${r.pools.length} pool(s)` : 'Storage step complete')
          break
        }
        case 'templates': {
          const r = await seedDefaultTemplates()
          setDone((d) => ({ ...d, templates: true }))
          toast.success(`Catalog: ${r.templates.length} templates`)
          break
        }
        case 'integrations':
          setDone((d) => ({ ...d, integrations: true }))
          window.location.assign('/platform/integrations')
          break
        case 'vm':
          onCreateVm()
          setDone((d) => ({ ...d, vm: true }))
          break
      }
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setRunning(null)
    }
  }

  const runAll = async () => {
    for (const step of STEPS) {
      if (step.id === 'vm') continue
      if (!done[step.id]) await runStep(step.id)
    }
  }

  const close = () => {
    dismissWelcome()
    setOpen(false)
    onDone?.()
  }

  if (!open) return null

  const completed = STEPS.filter((s) => done[s.id]).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl overflow-hidden" role="dialog" aria-modal="true" aria-label="Welcome">
        <div className="flex items-start justify-between p-6 border-b border-white/[0.06]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-orange-400/80 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" /> Welcome
            </p>
            <h2 className="text-xl font-bold text-slate-50 mt-1">Set up your datacenter</h2>
            <p className="text-sm text-slate-400 mt-1">Import inventory from libvirt, seed templates, then create a VM.</p>
          </div>
          <button type="button" className="text-slate-500 hover:text-slate-300 p-1" onClick={close} aria-label="Dismiss"><X className="w-5 h-5" /></button>
        </div>
        <ul className="p-6 space-y-3">
          {STEPS.map((step) => (
            <li key={step.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-slate-800/40 px-4 py-3">
              {done[step.id] ? (
                <CheckCircle2 className={`w-5 h-5 shrink-0 ${statusToneClass('ok')}`} />
              ) : running === step.id ? (
                <Loader2 className={`w-5 h-5 animate-spin shrink-0 ${statusToneClass('info')}`} />
              ) : (
                <Circle className="w-5 h-5 text-slate-600 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200">{step.label}</p>
                <p className="text-xs text-slate-500">{step.hint}</p>
              </div>
              {!done[step.id] && (
                step.id === 'integrations' ? (
                  <Link to="/platform/integrations" className="btn-secondary text-xs shrink-0" onClick={() => setDone((d) => ({ ...d, integrations: true }))}>
                    Open hub
                  </Link>
                ) : (
                <button type="button" className="btn-secondary text-xs shrink-0" disabled={running !== null} onClick={() => void runStep(step.id)}>
                  {step.id === 'vm' ? 'Open wizard' : 'Run'}
                </button>
                )
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 p-6 pt-0 border-t border-white/[0.04]">
          <button type="button" className="btn-primary flex-1" disabled={running !== null} onClick={() => void runAll()}>
            Run setup ({completed}/{STEPS.length})
          </button>
          <button type="button" className="btn-secondary" onClick={close}>Skip for now</button>
        </div>
      </div>
    </div>
  )
}
