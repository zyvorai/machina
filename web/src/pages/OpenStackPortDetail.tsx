// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Loader2, Plug } from 'lucide-react'
import { getOpenStackPort, updateOpenStackPort, type OpenStackPort } from '../api/openstackExtras'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusBadgeClasses } from '../utils/semanticColors'

export default function OpenStackPortDetailPage() {
  return (
    <OpenStackGate title="Port">
      <OpenStackPortDetailContent />
    </OpenStackGate>
  )
}

function OpenStackPortDetailContent() {
  const { id } = useParams<{ id: string }>()
  const toast = useToastContext()
  const [port, setPort] = useState<OpenStackPort | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { port: p } = await getOpenStackPort(id)
      setPort(p)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setPort(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { void load() }, [load])

  if (loading) return <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
  if (!port) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
        <Link to="/openstack/networking" className="text-sky-400 hover:underline">Back</Link>
      </div>
    )
  }

  const adminUp = port.admin_state_up !== false

  return (
    <PageLayout
      hideHeader
      className="max-w-3xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <Link to="/openstack/networking" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> Networking
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Plug className="w-7 h-7 text-sky-400" />
        {port.name || port.id.slice(0, 12)}
      </h1>
      <dl className="grid sm:grid-cols-2 gap-4 rounded-xl border border-slate-700 p-4 text-sm">
        <div><dt className="text-xs text-slate-500 uppercase">ID</dt><dd className="font-mono text-slate-200 mt-1 break-all">{port.id}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Status</dt><dd className="text-slate-200 mt-1">{port.status}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Admin state</dt><dd className="text-slate-200 mt-1">{adminUp ? 'Up' : 'Down'}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Network</dt><dd className="font-mono text-xs mt-1">
          <Link to={`/openstack/networks/${port.network_id}`} className="text-sky-400 hover:underline">{port.network_id}</Link>
        </dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Device</dt><dd className="text-slate-200 mt-1 font-mono text-xs">
          {port.device_id ? (
            <Link to={`/openstack/instances/${port.device_id}`} className="text-sky-400 hover:underline">{port.device_id}</Link>
          ) : '—'}
        </dd></div>
        <div className="sm:col-span-2"><dt className="text-xs text-slate-500 uppercase">Fixed IPs</dt><dd className="text-slate-200 mt-1 font-mono">{port.fixed_ips.join(', ') || '—'}</dd></div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm"
          onClick={async () => {
            const n = prompt('Port name', port.name || '')
            if (n === null) return
            try {
              await updateOpenStackPort(port.id, { name: n.trim() || undefined })
              toast.success('Updated')
              void load()
            } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>Rename</button>
        {adminUp ? (
          <button type="button" className={`px-3 py-1.5 rounded-lg border text-sm ${statusBadgeClasses('warn')} border-[color-mix(in_srgb,var(--machina-status-warn)_40%,transparent)]`}
            onClick={async () => {
              if (!confirm('Set port admin state down? Traffic may stop on this port.')) return
              try {
                await updateOpenStackPort(port.id, { admin_state_up: false })
                toast.success('Admin down')
                void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>Admin down</button>
        ) : (
          <button type="button" className="px-3 py-1.5 rounded-lg border border-violet-600/50 text-violet-200 text-sm"
            onClick={async () => {
              try {
                await updateOpenStackPort(port.id, { admin_state_up: true })
                toast.success('Admin up')
                void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>Admin up</button>
        )}
      </div>
      <OpenStackFooter />
    </PageLayout>
  )
}
