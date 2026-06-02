// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Loader2, Server } from 'lucide-react'
import {
  getOpenStackHypervisor,
  setOpenStackHypervisorMaintenance,
  type OpenStackHypervisor,
} from '../api/openstackExtras'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusBadgeClasses, statusToneClass } from '../utils/semanticColors'

export default function OpenStackHypervisorDetailPage() {
  return (
    <OpenStackGate title="Hypervisor">
      <OpenStackHypervisorDetailContent />
    </OpenStackGate>
  )
}

function OpenStackHypervisorDetailContent() {
  const { id } = useParams<{ id: string }>()
  const toast = useToastContext()
  const [hv, setHv] = useState<OpenStackHypervisor | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { hypervisor } = await getOpenStackHypervisor(id)
      setHv(hypervisor)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setHv(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { void load() }, [load])

  const runMaintenance = async (maintenance: boolean) => {
    if (!hv) return
    try {
      await setOpenStackHypervisorMaintenance(hv.id, maintenance)
      toast.success(maintenance ? 'Maintenance mode enabled' : 'Maintenance mode disabled')
      void load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  if (loading) return <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
  if (!hv) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
        <Link to="/openstack" className="text-sky-400 hover:underline">Back to OpenStack</Link>
      </div>
    )
  }

  const memPct = hv.memory_mb > 0 ? Math.round((hv.memory_mb_used / hv.memory_mb) * 100) : 0
  const vcpuPct = hv.vcpus > 0 ? Math.round((hv.vcpus_used / hv.vcpus) * 100) : 0

  return (
    <PageLayout
      hideHeader
      className="max-w-3xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <Link to="/openstack" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> OpenStack overview
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Server className="w-7 h-7 text-sky-400" />
        {hv.hostname}
      </h1>
      <dl className="grid sm:grid-cols-2 gap-4 rounded-xl border border-slate-700 p-4 text-sm">
        <div><dt className="text-xs text-slate-500 uppercase">Hypervisor ID</dt><dd className="font-mono text-slate-200 mt-1">{hv.id}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">State</dt><dd className="text-slate-200 mt-1">{hv.state}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Status</dt><dd className="text-slate-200 mt-1">{hv.status}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Running VMs</dt><dd className="text-slate-200 mt-1">{hv.running_vms}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">vCPU used</dt><dd className="text-slate-200 mt-1">{hv.vcpus_used} / {hv.vcpus} ({vcpuPct}%)</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Memory used</dt><dd className="text-slate-200 mt-1">{hv.memory_mb_used} / {hv.memory_mb} MB ({memPct}%)</dd></div>
      </dl>
      <div className="flex flex-wrap gap-2">
        {hv.status === 'disabled' ? (
          <button type="button" className={`px-3 py-1.5 rounded-lg border text-sm hover:bg-[color-mix(in_srgb,var(--machina-status-ok)_10%,transparent)] ${statusBadgeClasses('ok')} border-[color-mix(in_srgb,var(--machina-status-ok)_40%,transparent)]`}
            onClick={() => void runMaintenance(false)}>
            Exit maintenance
          </button>
        ) : (
          <button type="button" className={`px-3 py-1.5 rounded-lg border text-sm hover:bg-[color-mix(in_srgb,var(--machina-status-warn)_10%,transparent)] ${statusBadgeClasses('warn')} border-[color-mix(in_srgb,var(--machina-status-warn)_40%,transparent)]`}
            onClick={() => void runMaintenance(true)}>
            Enter maintenance
          </button>
        )}
      </div>
      <OpenStackFooter />
    </PageLayout>
  )
}
